# Core Extraction Plan

## Goal

Extract a `progression-core.js` file that is the "brain" of the app.
`index.html` becomes a pure skin: it translates user gestures into core commands
and implements callbacks to update its own presentation layer.

Thought experiment: `index.html` could be replaced by a CLI, a React app, or
driven headlessly — the lift would be entirely visual. State management lives
in the core, not the host.

The existing `index.html` is the **proof of concept** — feature complete but
not well organized. It stays deployed and untouched as a reference and
fallback. All new work happens in `index-core.html`. When the rewrite is
complete, `index-core.html` replaces `index.html`.

---

## File Structure

```
progression-core.js    — pure logic, zero runtime deps
progression-audio.js   — Tone.js-coupled audio engine
index-core.html        — rewritten host (work in progress)
index.html             — original POC, untouched, stays deployed
```

---

## Pattern: Headless Controller

Two objects are created and composed by the host. The audio engine is passed
into the core as a dep — core is programmed to the audio interface, not to
Tone.js. This means the audio layer is swappable (different lib, mock for
testing, etc.) without touching core.

```js
const audio = makeProgressionAudio({ Tone });

const app = makeProgressionPlayer({
  audio,

  // Storage — core calls these, host decides where data lives
  persist: (key, value) => localStorage.setItem(key, value),
  load:    (key)        => localStorage.getItem(key),

  // State — fires on any state change (settings, sections, arrangement, etc.)
  // Host re-renders from the new state snapshot.
  onStateChange: (state) => {
    renderChips(state);
    renderSectionRows(state);
    renderScrubber(state);
    updateReadout(state);
    syncUrl(state);
  },

  // Playback lifecycle
  onPlaybackChange: (playing) => setPlayingUI(playing),

  // Audio timing callbacks — must be fast and synchronous
  onChordTick: ({ chipIndex, posIndex, sectionIndex, shift }) => {
    setActiveChip(chipIndex);
    updateChipsForShift(shift);
    setScrubberCurrent(posIndex);
  },
  onBeatTick: (beat) => setActiveBeat(beat),
  onBarTick:  (bar)  => setActiveBar(bar),
});
```

The host's event wiring becomes mechanical:

```js
playBtn.addEventListener('click', () => app.togglePlay());
addSectionBtn.addEventListener('click', () => app.addSection());
styleButtons.forEach(btn =>
  btn.addEventListener('click', () => app.setState({ style: btn.dataset.style }))
);
```

---

## State Object

All state currently split between JS globals and DOM `.active` classes
collapses into one plain object owned by the core:

```js
{
  key, tempo, bars, cycle, style, bass, voicing,
  sections: [{ progression }],
  arrangement,
  activeSection,
  advance,        // 'auto' | 'manual'
  chordVol, bassVol, drumVol, masterVol,
  chordsOn, bassOn, drumsOn,
}
```

**Push only.** The core always pushes state to the host via `onStateChange`.
The host never calls `app.getState()`. Data flows one direction; the host's
world is always "the last state I was given."

---

## Core Public API

```js
// State
app.setState(partial)         // merge + fire onStateChange (+ scheduleRebuild if playing)
app.loadPreset(presetState)   // merge with DEFAULTS + fire onStateChange + rebuild if playing

// Playback
app.togglePlay()              // start or stop based on current playback state
app.queueJump(posIndex)       // request scrubber jump at next section boundary

// Sections
app.addSection()
app.removeSection(index)
app.moveSection(index, direction)  // 'up' | 'down'

// Persistence (delegates to persist/load callbacks)
app.saveUserPreset(name)
app.deleteUserPreset(id)
app.renameUserPreset(id, name)
app.getUserPresets()

// URL
app.parseUrl(searchString)    // returns state object, no side effects
app.serializeUrl()            // returns query string from current state
```

---

## Audio Interface (generic terms)

What the core needs from the audio layer, independent of any library:

| Need | Description |
|------|-------------|
| Start playback | Given chord sequence, tempo, style, voicing, advance mode, start offset |
| Stop playback | Tear down cleanly |
| Rebuild sequence | Hot-swap to new chord sequence mid-play (debounced, safe boundary) |
| Set tempo live | No rebuild — update transport BPM only |
| Set volume/mute live | No rebuild — update channel levels only |
| Queue position jump | At next section boundary, jump to posIndex; in manual mode, loop current section instead of advancing |
| onChordChange | `{ chordIndex, posIndex, sectionIndex, shift }` — core updates activeSection, fires onChordTick to host |
| onBeatTick | Beat index 0–3 |
| onBarTick | Bar index within current chord |

**Advance/loop logic ownership:** the audio engine owns it. At build time, the
core tells the engine the advance mode and registers `queueJump`. The engine
handles timing internally and fires callbacks to report. The host is passive.

This avoids the current smell where Tone.js timing callbacks reach back into
app globals (`appAdvance`, `pendingJump`, etc.).

---

## Key Scenarios

### User hits Play
```
playBtn click
  → app.togglePlay()
  → core builds chordSequence from state
  → audio.start({ chordSequence, tempo, style, voicing, advance, startOffset })
  → audio fires onChordTick / onBeatTick as playback progresses
  → core forwards to host callbacks
  → host: setPlayingUI(true), highlights chips, animates beats
```

### User hits Stop
```
playBtn click (while playing)
  → app.togglePlay()
  → core calls audio.stop()
  → core resets transient state: pendingJump, currentPosIndex, etc.
  → core fires onPlaybackChange(false), onStateChange(state)
  → host: setPlayingUI(false), clears chips / beats / scrubber
```

### User edits a section while stopped
```
section input change
  → app.setState({ sections: [...updated] })
  → core merges, fires onStateChange(newState)
  → host re-renders chips, scrubber, syncs URL
  → no audio interaction
```

### User edits a section while playing
```
section input change
  → app.setState({ sections: [...updated] })
  → core merges, fires onStateChange(newState)
  → core schedules audio.rebuild(newChordSequence) (debounced ~250ms)
  → host re-renders chips, scrubber (via onStateChange)
```

### User taps scrubber while playing
```
scrubber tap (posIndex=2)
  → app.queueJump(2)
  → core records pendingJump, fires onStateChange (host shows 'queued' animation)
  → audio engine picks up pendingJump at next section boundary
  → audio fires onChordTick with new posIndex/sectionIndex
  → core updates activeSection, fires onStateChange
  → host updates scrubber highlight, re-renders chips for new section
```

### User taps scrubber while stopped
```
scrubber tap (posIndex=2)
  → app.setState({ activeSection: resolvedSection })
  → core fires onStateChange
  → host re-renders chips for new active section
```

---

## Rendering Principle

Host render functions receive `state` as a parameter — they never read globals.
This makes them pure-ish view functions and swap-friendly:

```js
// Today
renderChips(state);

// Tomorrow (React)
<Chips state={state} />
```

---

## What Lives Where

| `index-core.html` | `progression-core.js` | `progression-audio.js` |
|-------------------|-----------------------|------------------------|
| CSS + HTML structure | Music theory (parseRoman, buildChord, etc.) | buildPart, teardown |
| DOM event wiring | Style/pattern data (STYLES, etc.) | buildDrums, buildBass |
| Render functions (take state, produce DOM) | State object + all getters | Channel/volume management |
| Callback implementations | URL serialization / parsing | Audio-timing callbacks |
| | makeProgressionPlayer factory | makeProgressionAudio factory |
| | Preset management | Tone.js — only dep |
| | Advance/loop logic | |

## Audio Interface Contract

`progression-audio.js` exports `makeProgressionAudio({ Tone })` which returns:

```js
{
  start({ chordSequence, tempo, style, bass, voicing, advance, startOffset,
          onChordTick, onBeatTick, onBarTick }),
  stop(),
  rebuild({ chordSequence, style, bass, voicing }),  // hot-swap mid-play
  setTempo(bpm),
  setVolume(channel, db),   // channel: 'chords' | 'bass' | 'drums' | 'master'
  setMute(channel, bool),
  queueJump(posIndex),
}
```

Core calls this interface. It never imports Tone directly.

---

## Milestones

These are broad phases, not strict steps. Leave room to iterate within each.

### 1. Music Theory Foundation
Get `progression-core.js` started as an ES module. Move all pure functions and
constants in: parsing, chord building, `STYLES` data, `resolvePlayOrder`,
arrangement parsing. No state, no audio, no DOM.

Surface it in `index-core.html` early with something minimal — e.g. a text
input that resolves and displays chord names — just enough to confirm the
module loads and the functions work correctly.

Establish JSDoc/TS-syntax type conventions here that carry through the rest.

### 2. State + Core Factory
Add the state object, `DEFAULTS`, `parseUrl`, `serializeUrl`, preset logic.
Build the `makeProgressionPlayer(config)` factory — it initializes state,
wires callbacks, exposes the public API. No audio yet; playback methods are
stubs that no-op.

`index-core.html` should now be driveable: load from URL, change settings,
save presets, sync URL — all working without any sound.

### 3. Audio Engine
Build `progression-audio.js` as a separate ES module exporting
`makeProgressionAudio({ Tone })`. Port the existing Tone.js code, expose the
interface contract (start, stop, rebuild, setTempo, setVolume, setMute,
queueJump). Audio-timing callbacks (`onChordTick`, `onBeatTick`, `onBarTick`)
fire into core, which resolves display state and fires `onStateChange` to host.

Wire it into the factory. At the end of this milestone the app plays music.

### 4. Feature Completion + index-core.html Polish
Bring all remaining features to parity with `index.html`: sections, scrubber,
manual/auto advance, theme, mix sheet, keep-awake, share link. Clean up CSS
along the way — treat this as the production version, not a port.

### 5. Replace
Verify feature parity, do a final review, rename `index-core.html` →
`index.html`. Archive or delete the old POC.

## Settled Decisions

- Audio engine passed as dep to core (Option A) — core programmed to interface
- Two files: `progression-core.js` (pure) + `progression-audio.js` (Tone-coupled)
- ES modules (`type="module"`) throughout — requires a local server, not `file://`
- JSDoc types using TS syntax throughout
- Working file is `index-core.html`; `index.html` stays deployed and untouched
- Rewrite from scratch (using existing as reference), not incremental refactor
- Host receives only resolved, display-ready data — no raw `shift` values or music theory math
- Cycle mode key changes resolved in core; host gets updated state via `onStateChange`
- `onChordTick` / `onBeatTick` / `onBarTick` are audio-timing-sensitive (fast, sync only);
  `onStateChange` is unrestricted

## Known Rough Edges (post-M2)

- **Full re-render on every state change** — `render()` calls all 5 sub-renders on every `setState`, including rapid slider drags. Fine for now; revisit if sluggishness appears.
- **`Tone` is a global** — loaded via script tag, passed as `makeProgressionAudio({ Tone })`. Works fine; would need to change if we ever adopt a bundler.
- **`serializeUrl` imported two ways** — directly in host (for `syncUrl`) and via `app.serializeUrl()`. Both correct, slightly redundant. Easy cleanup.
- **`onChordTick` must NOT go through `setState → onStateChange`** — audio timing callbacks are fast-path only. Core pre-computes `resolvedChipNames` / `resolvedKey` and hands them to the host directly. Host updates DOM without triggering a full re-render. This is the key boundary to enforce in M3.

## Future Features (architecture must support)

### Custom Key Cycles
User defines their own key cycle sequence (e.g. `A → E → D → G`) instead of
the built-in 4ths/5ths. Fits cleanly: core expands the full chord sequence
across each key in the list before handing it to the audio engine. Audio engine
has no awareness of cycle mode — it just plays what it's given. State shape:

```js
// Named preset
cycle: { type: '5ths' }

// Custom sequence
cycle: { type: 'custom', keys: ['A', 'E', 'D', 'G'] }
```

No changes required to the audio interface or host rendering logic.
