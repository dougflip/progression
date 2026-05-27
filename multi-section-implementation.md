# Multi-Section Progressions — Implementation Plan

This is the **build plan**. The product/UX decisions live in
[`multi-section-design.html`](multi-section-design.html) — that doc is the source of
truth for *what* and *why*; this one is *how* and *in what order*. Together they should
be enough to hand off and build.

Everything ships **in-place in `index.html`** (single-file app, Tone.js). No new
framework, no file split.

---

## 1. Goal

Replace the single `progression` string with **multiple sections** (max 6) plus an
**arrangement** that sequences them, an **Auto/Manual** advance mode, and a **bottom
scrubber** (Layout D) for navigation. Cycle 4ths/5ths keeps working, now per active
loop unit.

Read the design doc's "Decisions baked in" and "Resolved" sections first — they answer
most of the questions you'll hit.

---

## 2. Data model

State today is flat (see `currentState()` / `DEFAULTS` in `index.html`). The change:
drop `progression`, add four fields.

```js
sections:      [{ progression: 'I vi ii V' }, …]  // 1–6 objects. Object wrapper, not bare
                                                   // string, so per-section meta can be
                                                   // added later without a shape break.
arrangement:   '1 2 1 2:4 3'   // space-separated 1-based refs; `:n` = repeat n times.
                               // Empty string = implicit linear list (all sections, in order).
activeSection: 1               // 1-based section #. Shown when stopped; Play starts here.
advance:       'auto'          // 'auto' | 'manual'
// `cycle` already exists ('none' | '4ths' | '5ths') and is unchanged.
```

Only `sections[i].progression` is read in the parse layer — that's the **single place**
the object-vs-string shape leaks into code. Keep it that way.

---

## 3. Pure functions (no DOM, no Tone)

These are the testable core. Build and verify them first.

### `parseArrangement(arrangementStr, sectionCount) → number[]`
1-based section indices, `:n` expanded, capped, invalid dropped.

```js
function parseArrangement(str, count) {
  const out = [];
  for (const tok of str.trim().split(/\s+/).filter(Boolean)) {
    const [refStr, repStr] = tok.split(':');
    const ref = parseInt(refStr, 10);
    if (!Number.isInteger(ref) || ref < 1 || ref > count) continue;   // out of range → drop
    let reps = repStr === undefined ? 1 : parseInt(repStr, 10);
    if (!Number.isInteger(reps) || reps < 1) continue;                // bad :n → drop
    for (let i = 0; i < reps && out.length < 16; i++) out.push(ref);  // cap 16 after expansion
  }
  return out;
}
```

Empty / all-invalid input → caller treats `[]` as the **implicit linear list** `[1..count]`.

### `buildSongChords(sections, arrangement, key, bars) → chord[]`
Resolve the play order into a flat chord list, each chord tagged with its origin.

- Resolve order: `arrangement.length ? arrangement : [1..sections.length]`.
- For each `posIndex`, take `sections[ref-1].progression`, run it through the existing
  `parseProgression(progStr, key, bars)`, and push the resulting chords — tagging each
  with `sectionIndex` (= `ref-1`) and `posIndex`, plus a `chipIndex` relative to that
  section (the chord's index within its own progression).

Output is the same chord shape `buildPart`/`buildBass` already consume, with three extra
tags. That's the only contract change those builders see.

---

## 4. Playback engine — the core decision

Today `buildPart()` builds one looping unit (the progression, ×12 transposed laps if
cycling) and loops it forever via `part.loopEnd`. **Keep that structure.** The only new
idea is: *what goes into the loop unit depends on advance mode.*

Introduce `buildSong()` that returns the active loop unit's chords:

| Mode   | Loop unit                                             |
|--------|-------------------------------------------------------|
| Auto   | the **whole song** (all arrangement positions concatenated) |
| Manual | the **current section only** (the active arrangement position) |

`buildSong()` feeds `buildPart()`/`buildBass()` exactly as `parseProgression()` does
today. Cycle (×12 laps) is applied inside `buildPart` as it already is — so:

- **Auto + Cycle** → whole song ×12, loops → "play my song in every key."
- **Manual + Cycle** → current section ×12, loops → today's single-progression key drill,
  preserved. The climb happens *inside* the loop unit; no rebuild per repeat.

### Advancing & jumping — branches by mode

A scrubber tap sets `pendingJump` (target arrangement position). Consumed at the next
**section boundary** (not bar). What "consume" means differs:

- **Auto**: the song Part already walks through sections and loops on its own; the
  Tone.Draw callback drives the scrubber from each event's `posIndex`. A tapped jump →
  at the boundary, **reseat `Tone.Transport.position`** to the target position's bar
  offset. No rebuild (rebuilding the whole-song Part every section would dispose/recreate
  the reverb + synths = glitches).
- **Manual**: the loop unit is one section, so reaching another section *requires* a
  **rebuild**. At the boundary, set the active position to the target, rebuild via
  `buildSong()` + `buildPart()`, restart at 0, **reset cycle to the base key** (rebuild
  starts at lap 0 naturally). Manual advances are user-paced and infrequent, so a rebuild
  there is fine; a tiny seam at an intentional transition is acceptable (the transition
  signal is deferred anyway).

> ✅ **Spike confirmed:** setting `Tone.Transport.position` inside the Part's audio
> callback (not Draw) cleanly reseats a looping Part with no double-notes or glitches.
> Key: check `pendingJump` at the top of the callback *before* any `triggerAttackRelease`
> call, so the wrong section's note is never committed to the scheduler. No cancel, no
> part stop/start needed.

### Event payload + Draw callback

`buildPart`'s events already carry `chipIndex`, `shift`, `bars`. Add `sectionIndex` and
`posIndex` (carried through from `buildSongChords`). In the Tone.Draw callback:

```
if (ev.posIndex !== lastPos) {     // entered a new arrangement position
  renderChips(sections[ev.sectionIndex].progression);  // chips = current section only
  setScrubberCurrent(ev.posIndex);                     // move the highlight
  lastPos = ev.posIndex;
}
setActiveChip(ev.chipIndex);       // chipIndex is now relative to the current section
```

So `renderChips()` changes from "read the single input" to "render a given section's
progression." `setActiveChip` semantics are unchanged once chips are the current
section's.

### Start position

Play starts at `activeSection`.
- Manual: trivial — `buildSong()` returns that section as the unit.
- Auto: build the whole song, then start `Tone.Transport` at the bar offset of the first
  arrangement position whose section == `activeSection` (0 if none).

### Voice leading

Unchanged logic, and it falls out for free: `buildSongChords` concatenates before
`buildPart` applies voicing, so `prevUpper` carries continuously across section
boundaries within a lap. `voice-lead-loop` resets per lap (= whole-song pass in Auto, =
section repeat in Manual) — same `resetEachLap` code as today.

---

## 5. UI surfaces

### Scrubber bar (new, Layout D)
- **Visible only when the play order has ≥ 2 positions** (`playOrder = parseArrangement(...)
  .length || sections.length`). A lone section or a single-token arrangement → hidden,
  **along with the Auto/Manual pill** (nothing to advance through). So the basic
  single-progression case renders exactly like today.
- Lives between the player area and the action bar. Renders the arrangement (or implicit
  linear list when empty) as segments: `played` / `current` / upcoming / `queued`.
- Segments stretch to fill; **wrap to 2 rows past 8 tokens** (16 = 2×8). Cap lower if
  thin on small screens.
- Tap a segment → set `pendingJump`, paint it `queued` (pulsing). Tapping the current or
  already-queued segment cancels. **No Next button** — tapping the *next* segment is how
  you advance in Manual; any other segment is a jump.
- When stopped, tapping a segment selects/previews that section (sets `activeSection` +
  re-renders chips).

### Readout pill (new)
- Add an **Auto/Manual** pill to the readout row, next to the Loop/Cycle pill, cycling on
  tap like the existing Style/Bass/Voicing pills (`cycleNext` pattern).
- Same visibility gate as the scrubber: shown only at ≥ 2 play positions.

### Setup sheet — section & arrangement editor
- Replace the single `#progression` input with:
  - **Sections list**: per row → number badge, progression text input, ↑ / ↓ reorder, ×
    delete. Editing live-updates the chord strip *only if* that section is currently
    showing/playing.
  - **+ Add section** (appends empty; disabled at 6).
  - **Arrangement** text input + hint ("Empty = all sections in order").
- Mutations:
  - **Delete N**: shift higher section numbers down; drop arrangement tokens == N;
    decrement tokens > N.
  - **Reorder**: swap with neighbor; remap arrangement tokens to match.
- **The section list + arrangement editor are disabled (read-only) while playing** —
  stop to edit them. Global controls (key/tempo/style/bass/voicing/bars/loop mode/mix)
  stay live as today. This is deliberate: it drops the need for per-section dirty-tracking
  or commit-on-entry rebuilds. On Play, `buildSong()` parses every section fresh, so edits
  made while stopped are always picked up.

### Chord strip
- Renders the **current section's** chords (the one playing, or `activeSection` when
  stopped) — not the whole song. Driven by the Draw callback re-rendering on
  `posIndex` change.

---

## 6. State plumbing

- **`currentState()` / `applyState()`**: swap `progression` for `sections`,
  `arrangement`, `activeSection`, `advance`. `applyState` rebuilds the Setup section rows
  and the scrubber.
- **URL**: repeated `section` params + `arrangement` + `activeSection` + `advance`.
  Read with `params.getAll('section')`. Per design: **no back-compat for the old
  `progression` URL param.**
- **Saved presets (localStorage)**: `currentState()` snapshots the new shape, so new
  presets just work. **No migration** for pre-feature presets — bump the storage key
  (`progression-presets-v1` → `-v2`) so old entries are simply ignored. Fresh start, no
  shim, nothing to break.
- **Built-in `PRESETS`**: rewrite the 11 entries inline to the new shape, e.g.
  `state: { sections: [{ progression: 'I V vi IV' }], arrangement: '', cycle: 'none' }`.
  The Cycle starters keep their single-section + `cycle` shape, just wrapped in `sections`.
- **`DEFAULTS`**: `sections: [{ progression: 'I vi ii V' }]`, `arrangement: ''`,
  `activeSection: 1`, `advance: 'auto'`.

---

## 7. Phases

Each phase leaves the app **runnable**. Land them in order.

### Phase 1 — Data model + pure functions
State carries `sections`/`arrangement`/`activeSection`/`advance` (with exactly one
section, empty arrangement, `auto`). `parseArrangement` + `buildSongChords` written and
exercised. `currentState`/`applyState`/URL updated; built-in `PRESETS` rewritten inline;
localStorage presets key bumped to `-v2`.
**Done when:** app behaves *identically to today* (one section, looped) but on the new
state shape; reload/share/preset round-trip works.

### Phase 2 — Setup editor
Section rows (add/edit/reorder/delete, cap 6) + arrangement input replace the single
progression field. Chord strip shows `activeSection`.
**Done when:** you can build a 3-section setup in Setup and see the active section's chips;
state persists.

### Phase 3 — Auto playback of the song
`buildSong()` (Auto branch) → whole-song concatenation → `buildPart`/`buildBass`. Draw
callback re-renders chips + tracks position on `posIndex` change. Cycle = song ×12.
**Done when:** an arrangement plays start→finish and loops forever; cycle plays the whole
song through 12 keys; voice leading flows across boundaries.

### Phase 4 — Scrubber + tap-to-jump (Auto)
Render the scrubber from the arrangement; played/current/upcoming states; tap → schedule
jump → pulse → reseat at boundary. 2-row wrap past 8. Gate visibility (scrubber +
Auto/Manual pill) on ≥ 2 play positions.
**Done when:** you can watch the playhead move along the scrubber and tap to jump within
an Auto song.

### Phase 5 — Manual mode + advance
Auto/Manual readout pill. Manual branch of `buildSong()` (current section as loop unit);
advance/jump rebuilds at the boundary; cycle resets to base on advance; Manual+cycle
climbs within the unit.
**Done when:** all four design use cases work — practice one section, play the song,
rehearse at your pace, drill in 12 keys.

### Phase 6 — Edge cases + polish
Start-at-`activeSection` for Auto; empty-arrangement linear list; invalid-token dropping;
delete/reorder arrangement remap; edit-during-playback handling; scrubber legibility at
16; preset migration verified.

---

## 8. Edge cases & risks

- **Auto-jump reseat** (§4 spike) — the one unproven Tone mechanic. Validate early.
- **Rebuild churn** — never rebuild the whole-song Part on Auto boundaries (reverb/synth
  dispose = clicks). Only Manual section *changes* rebuild.
- **`chipIndex` is now per-section** — make sure `setActiveChip` and bar-dot rendering key
  off the current section's chips, not the whole song.
- **Empty arrangement** must resolve to `[1..N]` everywhere (playback, scrubber, start).
- **Delete/reorder remap** of arrangement tokens is easy to get subtly wrong — test with
  an arrangement that references the deleted/moved section multiple times.
- **`activeSection` after delete** — clamp if it pointed at the removed section.
- **`MAX_CHORDS` (24) stays per section** — each section's string runs through the
  existing `tokenize()` cap independently, so no new code; the concatenated Auto song can
  be up to 6 × 24. Confirm a max-size song doesn't choke `buildPart`.
- **Old saved presets / shared URLs** — intentionally not supported. localStorage key
  bumped (`-v2`) so old presets are ignored; old `progression` URLs not honored.

---

## 9. Verification checklist

- One-section setup = byte-for-byte today's behavior (regression guard) — **no scrubber, no Auto/Manual pill**.
- Scrubber + Auto/Manual pill appear at 2+ play positions; hidden for a single-token arrangement even with multiple sections defined.
- 3-section Auto song: plays through, loops, scrubber tracks, chips swap per section.
- Single-token arrangement (`2`) loops just that section.
- Empty arrangement walks all sections in order.
- `:n` shorthand (`2:4`) expands; 16-cap holds; invalid tokens dropped.
- Manual: holds current section; tap next = advance; tap elsewhere = jump; pulse →
  fires at boundary.
- Cycle: Auto climbs per song-pass; Manual climbs per section repeat; Manual advance
  resets to base key. Flats ascending 4ths, sharps ascending 5ths; octave clamp intact.
- Reorder/delete remap arrangement correctly; `activeSection` stays valid.
- Section + arrangement inputs are disabled while playing; global controls still apply live.
- Reload, Copy-share link, save/load preset all round-trip the new state.
- iOS: audio survives Setup edits; Manual rebuild doesn't kill the transport.

---

## 10. Unresolved questions

None. All questions resolved. Ready to implement.
