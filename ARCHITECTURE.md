# Architecture

## File layout

```
index.html           — host: CSS, HTML, DOM wiring, render callbacks
progression-core.js  — pure logic: music theory, state, URL, presets, factory
progression-audio.js — Tone.js engine: plays what core gives it
```

## Key decisions

- **Headless controller pattern.** `progression-core.js` owns all state and logic. `index.html` is a skin — it translates user gestures into core commands and implements callbacks to update the DOM. Swapping to React or a CLI would be a visual-only lift.
- **Single config object, all callbacks.** `makeProgressionPlayer(config)` takes one flat object. Everything is a callback — even "dependencies" like localStorage are abstracted as `persist`/`load` behaviors. No concrete API references in core.
- **Audio engine is a swappable dep.** `makeProgressionAudio({ Tone })` is passed into the factory as `config.audio`. Core is programmed to the audio interface, not to Tone.js directly. The engine is replaceable without touching core.
- **`Tone` is a deliberate global.** Loaded via `<script>` tag and passed into the factory — an intentional choice that keeps the audio engine loosely coupled and avoids a bundler requirement. Would need to change if adopting a bundler.
- **ES modules throughout.** Requires a local server (`file://` won't work).
- **JSDoc types using TS syntax** on all public API surfaces.
- **Host receives only resolved display data.** `onChordTick` carries `resolvedChipNames` (chord names in the current key), `resolvedKey`, position/section indices, `bars`, and `sectionTokens` (raw tokens, only on section change) — no raw semitone shifts or music theory math reaches the host.
- **Two callback tiers.** `onChordTick` fires once per chord; `onBarTick` fires for each bar after the first within a multi-bar chord; `onBeatTick` fires every quarter-note beat. All three are audio-timing-sensitive (fast, no DOM work). `onStateChange` fires on any state mutation and is unrestricted.

## Audio interface

`makeProgressionAudio({ Tone })` returns:

```js
{
  isPlaying(),
  start({ chordSequence, tempo, style, bassVariant, voicing, advance,
          startPosIndex, startChipIndex, startLapIndex, key, cycle, customCycleKeys, mix,
          onChordTick, onBeatTick, onBarTick }),
  stop(),
  rebuild({ chordSequence, style, bassVariant, voicing, key, cycle, customCycleKeys }),
  setTempo(bpm),
  setVolume(channel, value),   // channel: 'chords' | 'bass' | 'drums' | 'master', value: 0–100
  setMute(channel, muted),
  setAdvance(mode),
  queueJump(posIndex),
  cancelJump(),
  queueKeyJump(lapIndex),
  cancelKeyJump(),
}
```

`startChipIndex` seeks to a specific chord within the starting section (used for pause/resume). `startLapIndex` seeks to a specific cycle lap. Both default to 0.

Channels are created once on first `start()` and survive stop/rebuild cycles. Teardown disposes synths and sequences but never channels.

## Cycle modes

`cycle` is a string: `'none' | '4ths' | '5ths' | 'custom'`. When `cycle === 'custom'`, a parallel `customCycleKeys: string[]` state field defines the key sequence (e.g. `['A', 'E', 'D', 'G']`). This two-field shape was chosen over a discriminated union to avoid polymorphism at every call site in plain JS.

`getShiftsForCycle(cycle, customCycleKeys)` in core is the single source of truth for how many laps to play and what semitone shift each lap gets:
- `'none'` → `[0]` (one lap, no shift)
- `'4ths'` → 12 shifts of +5 semitones each
- `'5ths'` → 12 shifts of +7 semitones each
- `'custom'` → one shift per key relative to `customCycleKeys[0]`; falls back to `[0]` if the list is empty

The audio engine replaces the old fixed 12-lap loop with an iteration over the array returned by `getShiftsForCycle`. No audio interface changes are needed to add new cycle modes — only core changes.

Key jump timing: `queueKeyJump(lapIndex)` queues a jump that fires at the next lap boundary (when the full song arrangement completes in the current key), not at the next chord. The engine tracks `_currentLap` from transport ticks on every chord event and fires when `lapIndex > _currentLap`.

## URL serialization

State is serialized as query parameters. Musical content (`key`, `tempo`, `bars`, `cycle`, `customKeys`, `style`, `section`, `advance`, `arrangement`, `activeSection`) and mix state (`chordsOn`/`bassOn`/`drumsOn`, `*Vol`) are all encoded. Multiple `section` params carry each section's progression string. `customKeys` is a comma-joined list of key names (e.g. `customKeys=A,E,D,G`), only written when non-empty. All values fall back to `DEFAULTS` on parse failure.

## Scrubbers

The action bar contains two stacked scrubber rows, each only visible when relevant:

- **SONG scrubber** — appears when the arrangement has 2+ positions; segments are section references. While playing: tapping queues a section jump at the next chord boundary (auto mode) or holds until tapped again (manual mode). While stopped/paused: tapping highlights the segment and calls `seekToPos(posIndex)` so play starts from that exact arrangement position (not just the section number — repeated section refs like `1 1 2 1 1 2` resume from the tapped occurrence).
- **KEY scrubber** — appears when `cycle !== 'none'` and the key sequence has 2+ entries; segments are resolved key names. While playing: tapping queues a lap jump that fires at the end of the current full-song run. While stopped/paused: tapping highlights the segment, calls `seekToLap(lapIndex)`, and immediately updates the chord chips and key display to reflect the selected key.

Both scrubbers auto-scroll to keep the active segment centered on each chord tick using `getBoundingClientRect`-based centering (not `offsetLeft`, which is relative to the nearest positioned ancestor rather than the scroll container).

The host tracks `_currentScrubPosIndex`, `_currentScrubKey`, and `_currentLapIndex` to restore `.current` highlights and correct chord display after DOM rebuilds (scrubbers do `innerHTML = ''` on every `render()` call).

## Known rough edges

- **Full re-render on every state change.** `render()` calls all sub-renders on every `setState` including rapid slider drags. Fine for current app size; revisit if sluggishness appears.

## Player factory public API

`makeProgressionPlayer(config)` returns the app controller. Key playback methods:

- `togglePlay()` — **pause** if playing, **resume** if paused or stopped. Resume uses `_pausedAt` (posIndex + chipIndex + lapIndex) so it continues from the exact chord and cycle lap where playback stopped.
- `stop()` — full reset to beginning; clears `_pausedAt`.
- `isPaused()` — returns true when paused (audio stopped, position saved).
- `seekToPos(posIndex)` — sets the resume position to a specific arrangement slot; also updates `activeSection` for chip display. Works from stopped or paused state.
- `seekToLap(lapIndex)` — sets the resume lap without affecting the song position. Works from stopped (defaults posIndex to 0) or paused (preserves posIndex/chipIndex).

Pause state is stored in private `_pausedAt: { posIndex, chipIndex, lapIndex } | null`. It is cleared by `stop()`, `loadPreset()`, and any `_set()` call touching `sections`, `arrangement`, `cycle`, or `customCycleKeys` (structural changes that would make the saved position stale). Key, tempo, style, bass, voicing, and bars changes preserve `_pausedAt`.

## Planned features

### Foot pedal support
HID-keyboard path: 2-switch + tap/long-press = 4 configurable actions. App-side mode toggle for more. Host-level feature — calls `app.togglePlay()` and `app.queueJump()`. Core needs no changes.
