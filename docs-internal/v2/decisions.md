# Progression v2 — Decisions

Latest decisions only. Rewrite in place as understanding changes; don't append history.
Background and goals: `version-2.md`.

## Modes

- Two modes, two UIs, one playback engine.
  - **Backing track**: quick. Edit a small `BackingTrack` recipe (progression, key, tempo, style).
  - **Composer**: detailed. Edit a full `Song` directly.
- The engine only plays `Song`. A `BackingTrack` is converted to a `Song` by a generator at playback time.
- "Open in composer" saves the generated `Song` for editing. One-way: nothing syncs back to the recipe.
- Composer can re-run the generator on a single section ("regenerate"), which explicitly overwrites it.

## Data model

- The whole app state is plain, serializable data, described by one schema.
- The schema is the single source for TS types, runtime validation, and agent-facing docs. Schema: `v2/src/model/schema.ts`; data flow and screen trace: `data-model.md`.
- The format carries a version field (`version: 2`) from day one. Within a version, changes are additive only (see `data-model.md`).
- Schema: Zod 4.
- TypeScript patterns first: discriminated unions for every "kind" (never `isX` booleans), branded ids, non-empty tuples where empty is invalid, immutable values (`DeepReadonly`), exhaustive switches. Details: `schema.ts` header.
- Clean break from v1: no v1 URL/preset import.
- Settings cascade: song defaults → section overrides (style, tempo, meter, instruments). Finer-grained overrides can come later.

## Where settings live

- **Generator inputs** (`BackingTrack`, with per-section overrides): progression, bars per chord, style, drums simple/busy, bass simple/busy.
  - In composer they're only the `seed` a section remembers for "Regenerate"; drums and bass are stored note by note.
- **Rendering** (`Song.defaults`, with section overrides): tempo, meter, swing, voicing, instruments.
  - Voicing is applied by the engine at play time (voice-lead-loop depends on playback order), never stored as notes.
- **Practice** (separate `Practice` object, works the same in both modes): cycle + custom keys, advance (auto/manual), channel mutes.
  - Room to grow: new practice-time settings go here, not into the song.
- **Local only**: volume levels, playback position, theme, keep-awake.
- Resolution: a section override always wins; otherwise the section uses the song value.
  - Changing a song-level setting affects every section without an override, from the next bar. Sections with an override are unaffected.
  - The UI labels song-level controls as "Song", and the player shows what the current section actually plays, with overrides marked.
- Mixer changes (mutes, levels) apply instantly, not at the next bar; they're channel gains, not scheduled notes. Both live in one Mix sheet despite being stored separately.

## Screens

- **Play view is home** in both modes, stopped or playing. No automatic view switching.
  - Player header (larger "stage" presentation), song-level pills (backing: style, drums, bass, voicing, tempo; composer: tempo, swing, voicing), practice (cycle, advance), ✎ Edit.
- **Edit** holds everything else. Backing: sections, overrides, arrangement, "Open in composer". Composer: song overview (instruments, sections, arrangement) → section editor.
  - **Done** returns to the play view. Pills live only on the play view (no duplicate controls).
- The action bar (Mix, transport, SONG/KEY scrubbers, Share) is on every screen; playback continues across navigation.
- "Open in composer" and "New song" open the new song item on its song overview.

## Player UI

- The same player header appears on the play view and the section editor: key, section name + its resolved settings, chord chips (numeral + resolved name, v1 highlighting with bar-progress dots), beat dots.

## Practice

- `cycle`: `none | fourths | fifths | custom` (a tagged union; `custom` carries its non-empty key list). Fourths/fifths start from the song key.
- `custom` plays its keys as given (absolute keys). The song key is ignored while cycling, so v1's "key must equal `customCycleKeys[0]`" invariant goes away.
- A cycle lap ends when the arrangement completes; the engine picks the next lap's key at that boundary (just-in-time, no lap bookkeeping).
- `advance: manual` repeats the current arrangement position until a jump is queued. A section jump lands when the current pass of the section ends; a chord jump at the next bar.
- Mutes are intent ("play without drums"), so they're shareable. Levels are device-specific, so they aren't.

## Time

- Model supports any meter; build 4/4 straight first.
- Meter lives on the section (`beatsPerBar`, `beatUnit`).
- All positions and lengths are integer ticks at a fixed PPQ (48 per quarter: divisible by 2, 3, 4, 6 → 8ths, 16ths, triplets).
- Chords are `{ start, duration }` in ticks, not grid slots. The first UI snaps chords to 8ths and drums to 16ths.
- Swing is a playback setting applied at schedule time; the stored data stays straight. It swings 8th notes, amount 0–1 (1 = triplet feel).
- Tempo (BPM) always counts quarter notes, also in 6/8.
- Registers are fixed per role (v1 parity: chords from C3, bass two octaves below the chord root). Not stored in docs.

## Pitch

- Songs stay key-agnostic: Roman numerals for chords, no absolute pitches stored.
- A note's pitch is a tagged union, resolved to MIDI by the engine:
  - chord tone (root, 3rd, 5th, 7th, …) — what v1 bass uses
  - scale degree (relative to the key)
  - chromatic semitone offset (relative to the key)
- The UI may expose only chord tones at first; the model and engine support all three.
- Resolution rules (details in `data-model.md` → Semantics):
  - Chord tones are the chord's real tones: "5" is the fifth on 7th chords too (v1's bass played the 7th there).
  - A slash chord's bass note is the one nearest the chord's bass root.
  - Scale-degree and chromatic notes are measured from the tonic, not the chord.
- Parts are monophonic: a new note cuts the previous one.

## Sound

- Instruments are data: either a sampler (sample set reference) or a synth patch (oscillator, envelope, filter, effects as JSON).
- v1's sounds become the default patches.
- Synth patches are meant to be authored mostly by an agent ("natural language → patch"), with user controls optional.
- Samples for bass/keys/synth are lazy-loaded and cached at runtime, not precached at install.

## Playback engine

- **Lesson from v1:** pre-scheduling many events with Tone (pre-baked multi-lap `Tone.Part`/`Sequence`) made the app sluggish (see `e8c63c5`).
- Schedule just-in-time: each bar is computed from the current source `lookahead` (0.2 s) before it starts and handed to Web Audio whole. Bar start times are summed from each bar's tempo and length, never read from a timer, so nothing drifts.
- Edits, jumps and scope changes take effect at the next bar boundary; one made in the last `lookahead` of a bar lands a bar later. Instant updates aren't required.
- **Late bars** (the main thread stalled longer than `lookahead`): the bar starts just after it's computed, never in the past, so it's one hiccup instead of a burst of overdue notes. The timeline shifts by the lost time. Counted in the engine's stats; the bench shows them.
- **Errors** while computing a bar pause playback on the audible bar and emit an `error` event; ▶ resumes there once fixed. A failing `play()` rejects and leaves the transport as it was. Listener exceptions never stop the engine.
  - This replaces v1's rebuild/teardown complexity. There's nothing to cancel and rebuild; the next bar just reads new data.
- Instrument nodes (synths, samplers) live for a play session and survive edits; only events are rescheduled. Channels (levels, mutes) live as long as the engine.
  - v1 lesson: disposing the synth on rebuild cut off ringing notes (`c43e200`).
  - Pause and stop fade the session out and dispose it: that's how notes already handed to Web Audio are cancelled.
- The engine captures Tone's context once and takes its instruments and UI-event scheduler as options, so tests render offline on Node (`node-web-audio-api`) with recording instruments.
- Tone caveats found: `MetalSynth` can't hold more than one future trigger (v1's fallback closed hat is now filtered noise); `Tone.Reverb` renders its impulse with `Tone.Offline`, which swaps the global context (the pad reverb builds its impulse synchronously instead).
- Don't use Tone containers that snapshot data at construction (`Tone.Sequence` captures step values once).
- Timing logic (song + position → events for a bar) is a pure function, unit-tested without Tone.

## Transport

- Playback position is always a bar: `{ arrIdx, lap, bar }`. Pause, resume and every jump land on a bar start.
- **Pause** stops sound and keeps the position; ▶ resumes from the start of that bar.
- **Stop** stops sound and clears the position; ▶ starts from the top.
- **Jumps:** tap a chord chip (→ that chord's bar) or a section in the SONG scrubber / arrangement (→ its first bar).
  - While playing, a **section jump** is queued and lands when the current section finishes (cue "chorus next" mid-verse, play into it). It stays outlined until then; a new tap replaces it.
  - While playing, a **chord jump** lands at the next bar (precise navigation within what you hear).
  - While paused/stopped: moves where ▶ starts.
  - A chord jump lands on its bar, so the cue outlines every chord in that bar. Later option (engine-only): land on the chord's own beat by switching mid-bar at the same in-bar offset.
- **Key jumps** (KEY scrubber, shown whenever a cycle is on) are the one exception: they land at the end of the current lap (end of the section in manual advance).
  - Tapping the current key repeats it; any other key skips to it.
- SONG and KEY scrubbers sit above the transport, as in v1; the SONG scrubber is hidden while looping a single section.
- Edits that make a saved position invalid clamp it (missing section → first, bar past the end → bar 1) rather than discarding it.
- **Looping a section and back** (`changeScope`): entering a loop keeps the bar; leaving returns to the arrangement entry you were on if it's that section, else its first entry.
- **Voice-leading** carries across pause (resume sounds continuous) and resets on stop.
- Position is local playback state: never shared, never stored in the song.

## Looper

- Loops belong to sections. A section holds a list of takes, so overdub = add a take.
- Audio is stored in IndexedDB; the song references takes by ID. Audio never goes in the song data or the URL.
- Export is deferred. The model must not block either option:
  - **Share a recording**: `Tone.Recorder` on the master output → audio file. Likely first.
  - **Share the project**: one file bundling song JSON + loop audio, imported by the recipient.
  - On mobile, both go through the Web Share API (file sharing).

## UI

- A framework renders the UI from the state data (React likely; Preact if bytes matter).
- Keep v1's headless pattern: core state + engine have no framework dependency.
- **The core exposes view data.** Pure functions (`core/view.ts`, e.g. `playerView`) return what screens show: names, numerals, bar spans, and where each setting comes from (song or section override). Views take the doc, not the generated song, since a backing track's overrides only live in the recipe. The UI renders these and holds no music logic, so it can change freely.
- Docs are immutable values; dev builds deep-freeze them as they enter (validation, generation) so in-place edits fail loudly.

## Agent workflow

- The agent is an outside tool (e.g. Claude with a skill), not an in-app feature. No backend, no API keys.
- The skill uses the schema docs to produce `Song` / `BackingTrack` JSON.
- A script validates the JSON and encodes it into a URL that opens the app in that state.
- The app also accepts pasted/imported JSON as a fallback for long URLs.

## Library and URL state

- Working state lives in a local library of items (survives refresh). Per device; no sync. Moving work between devices = share link (or project file later).
- An item = one doc (`BackingTrack` or `Song`, which carries its `title`) + its own `Practice`. A song item owns its loop takes.
- The item's kind decides the mode; there are no mode tabs. The library (📚, or tap the title on the play view) is how you switch.
- Everything autosaves. Rename an item from its ✎ Edit screen (the doc's `title` is the item name); there's no separate rename in the library.
- **Scratch**: one reusable backing-track item for quick jams. "Keep" names it into a new item and resets Scratch.
- **Starters** (v1's built-in presets) load a copy into Scratch, with an inline confirm if Scratch has edits. First run opens Scratch pre-filled, so the app is never empty.
- "Open in composer" and "New song" create new song items; the source recipe is untouched.
- The URL is for sharing only: generated on Share, read on open. It doesn't mirror state while you edit.
- Opening a link adds a new library item (marked "shared with you"); it never overwrites what you were working on.
- Pasted agent JSON (a doc or an envelope) takes the same path: validate against the schema, add, open.
- A link carries a versioned envelope: `{ version, doc, practice? }`.
  - `practice` is optional; the Share sheet shows a summary and a toggle (on by default when it differs from defaults).
  - New blocks (e.g. `mix`) can be added to the envelope later without touching the song format.
- Encoding: one param, JSON → deflate (`CompressionStream`) → base64url.
- Never shared: loop audio, cached samples, volume levels, playback position, app preferences.

## Deployment

- v2 lives on `main` in its own source folder, served at `/progression/v2/` via a second Vite entry point.
  - GitHub Pages only deploys `main`, and a long-lived branch would drift from v1 fixes and dependabot updates.
- The v1 service worker (scope `/progression/`) also covers `/progression/v2/`.
  - Exclude v2 from v1's navigation fallback (`navigateFallbackDenylist`), or give v2 its own scope or manifest.

## Open questions

- Export format and order (recording vs project bundle).
- Practical URL size limit and when to fall back to JSON import.
- Where an edit takes effect (next bar vs next downbeat vs next section) for each kind of change.
- Custom styles (reusable drum + bass patterns) in v2: kept for backing tracks? How do they relate to composer sections?
