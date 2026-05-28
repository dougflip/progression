# Core Extraction Plan

## Goal

Extract a `progression-core.js` file that is the "brain" of the app.
`index.html` becomes a pure skin: it translates user gestures into core commands
and implements callbacks to update its own presentation layer.

Thought experiment: `index.html` could be replaced by a CLI, a React app, or
driven headlessly — the lift would be entirely visual. State management lives
in the core, not the host.

---

## Pattern: Headless Controller

The core is instantiated once with a single config object. Everything in that
object is a callback — there are no concrete dependency references. Even
"dependencies" like localStorage are abstracted as behaviors:

```js
const app = makeProgressionPlayer({
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

## What Moves to core vs. Stays in index.html

| Stays in `index.html` | Moves to `progression-core.js` |
|-----------------------|-------------------------------|
| CSS + HTML structure | Music theory (parseRoman, buildChord, etc.) |
| DOM event wiring | Style/pattern data (STYLES, etc.) |
| Render functions (take state, produce DOM) | State object + all getters |
| Callback implementations | URL serialization / parsing |
| | Audio engine (buildPart, teardown, etc.) |
| | Preset management |
| | Advance/loop logic |

---

## Open Questions (for when we start coding)

1. Should Tone.js itself be injected as a callback/behavior, or accepted as a named dep? Abstracting it fully is a big lift — probably not worth it now.
2. Split `progression-core.js` into `progression-core.js` (pure logic) + `progression-audio.js` (Tone-coupled)? Given their size difference and testability profile, a split may be cleaner.
3. JSDoc/TS types for the public API surface? Probably worth it for the config object shape and state type at minimum.
4. Callback distinction: document clearly that `onChordTick` / `onBeatTick` are audio-timing-sensitive (fast, sync only) vs. `onStateChange` (unrestricted).
