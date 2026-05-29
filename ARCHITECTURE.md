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
- **ES modules throughout.** Requires a local server (`file://` won't work).
- **JSDoc types using TS syntax** on all public API surfaces.
- **Host receives only resolved display data.** `onChordTick` carries pre-resolved chord names and key display string — no raw semitone shifts or music theory math reaches the host.
- **Two callback tiers.** `onChordTick` / `onBeatTick` / `onBarTick` are audio-timing-sensitive (fast, sync only). `onStateChange` is unrestricted.

## Audio interface

`makeProgressionAudio({ Tone })` returns:

```js
{
  isPlaying(),
  start({ chordSequence, tempo, style, bassVariant, voicing, advance,
          startPosIndex, key, cycle, mix, onChordTick, onBeatTick, onBarTick }),
  stop(),
  rebuild({ chordSequence, style, bassVariant, voicing, key, cycle }),
  setTempo(bpm),
  setVolume(channel, value),   // channel: 'chords' | 'bass' | 'drums' | 'master', value: 0–100
  setMute(channel, muted),
  setAdvance(mode),
  queueJump(posIndex),
  cancelJump(),
}
```

Channels are created once on first `start()` and survive stop/rebuild cycles. Teardown disposes synths and sequences but never channels.

## Known rough edges

- **Full re-render on every state change.** `render()` calls all sub-renders on every `setState` including rapid slider drags. Fine for current app size; revisit if sluggishness appears.
- **`Tone` is a global.** Loaded via script tag, passed as `makeProgressionAudio({ Tone })`. Would need to change if adopting a bundler.
- **Intermittent auto+cycle scrubber jump bug.** No repro steps yet. Likely `posOffsets` not accounting for the current lap in cycle mode, jumping to wrong bar. Investigate when it reveals consistently.

## Planned features

### Custom key cycles
User defines their own key cycle sequence (e.g. `A → E → D → G`) instead of the built-in 4ths/5ths. Core expands the full chord sequence across each key before handing it to the audio engine — no audio interface changes needed. Proposed state shape:

```js
cycle: { type: 'custom', keys: ['A', 'E', 'D', 'G'] }
// vs existing:
cycle: 'none' | '4ths' | '5ths'
```

### Foot pedal support
HID-keyboard path: 2-switch + tap/long-press = 4 configurable actions. App-side mode toggle for more. Host-level feature — calls `app.togglePlay()` and `app.queueJump()`. Core needs no changes.
