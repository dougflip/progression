# Architecture

## File layout

```
index.html                — host: CSS, HTML markup
src/app.ts                — host: DOM wiring, render callbacks, event handlers
src/progression-core.ts   — pure logic: music theory, state, URL, presets, factory
src/progression-audio.ts  — Tone.js engine: plays what core gives it
src/styles.ts             — pure data: style/bass pattern definitions
public/favicon.svg        — static asset, copied to dist/ as-is
vite.config.js            — build config: multi-page entry points, Tone vendor chunk, version/SHA injection
src/vite-env.d.ts         — ambient types for build-time globals (__APP_VERSION__, __APP_SHA__)
tsconfig.json             — strict TypeScript config (noEmit; Vite handles transpilation)
```

## Key decisions

- **Headless controller pattern.** `progression-core.ts` owns all state and logic. `index.html` is a skin — it translates user gestures into core commands and implements callbacks to update the DOM. Swapping to React or a CLI would be a visual-only lift.
- **Single config object, all callbacks.** `makeProgressionPlayer(config)` takes one flat object. Everything is a callback — even "dependencies" like localStorage are abstracted as `persist`/`load` behaviors. No concrete API references in core.
- **Audio engine is a swappable dep.** `makeProgressionAudio()` returns an `AudioEngine` (interface defined in core). Core is programmed to the interface, not to Tone.js directly. The engine is replaceable without touching core.
- **Tone.js as an npm dependency.** Imported directly in `progression-audio.ts` (`import * as Tone from 'tone'`). Bundled as a separate vendor chunk by Vite so it caches independently from app code. Previously a CDN global — the bundler made the proper import pattern straightforward.
- **Vite for dev and build.** Replaces the bare local server. Two HTML entry points (`index.html`, `docs.html`) declared as Rollup inputs. `npm run dev` serves at `/progression/` (matching the GitHub Pages subpath). `npm run typecheck` runs `tsc --noEmit` separately since Vite uses esbuild for transpilation.
- **Version display combines a manual semver with an automatic git SHA.** `vite.config.js` injects `__APP_VERSION__` (from `package.json`) and `__APP_SHA__` (`git rev-parse --short HEAD` at build time) as `define` globals, shown in the Setup sheet. The semver is bumped by hand as desired; the SHA changes on every commit, so it's the reliable signal for "is this build current."
- **TypeScript with strict mode.** `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, and `noFallthroughCasesInSwitch` all enabled. The `AudioEngine` interface in core formally enforces the contract between the player factory and the audio engine.
- **Host receives only resolved display data.** `onChordTick` carries `resolvedChipNames` (chord names in the current key), `resolvedKey`, position/section indices, `bars`, and `sectionTokens` (raw tokens, only on section change) — no raw semitone shifts or music theory math reaches the host.
- **Two callback tiers.** `onChordTick` fires once per chord; `onBarTick` fires for each bar after the first within a multi-bar chord; `onBeatTick` fires every quarter-note beat. All three are audio-timing-sensitive (fast, no DOM work). `onStateChange` fires on any state mutation and is unrestricted.
- **Playback settings are edited only on the main screen.** Key, tempo, bars, style, bass, drums, voicing, and loop mode are set exclusively through the `#readout` pills and the key/tempo popups — there is no duplicate control for any of them in the Setup sheet. This replaced an earlier design where Setup's "Playback" group duplicated every one of these controls; real usage showed that group was never touched once the main-screen pills existed, so it was removed rather than kept in sync. Setup is now purely structural: sections, arrangement, and app-level settings (theme, keep-awake, share link, version).

## Audio interface

`makeProgressionAudio()` returns an `AudioEngine` (TypeScript interface exported from `progression-core.ts`):

```ts
{
  isPlaying(): boolean,
  start(opts: AudioStartOpts): Promise<void>,
  stop(): void,
  rebuild(opts: AudioRebuildOpts): void,
  setTempo(bpm: number): void,
  setVolume(channel: 'chords' | 'bass' | 'drums' | 'master', value: number): void,
  setMute(channel: 'chords' | 'bass' | 'drums', muted: boolean): void,
  setAdvance(mode: string): void,
  queueJump(posIndex: number): void,
  cancelJump(): void,
  queueKeyJump(lapIndex: number): void,
  cancelKeyJump(): void,
  getPendingJump(): number | null,
  getPendingKeyJump(): number | null,
}
```

`startChipIndex` seeks to a specific chord within the starting section (used for pause/resume). `startLapIndex` seeks to a specific cycle lap. Both default to 0.

Channels are created once on first `start()` and survive stop/rebuild cycles. Teardown disposes synths and sequences but never channels.

## Cycle modes

`cycle` is a string: `'none' | '4ths' | '5ths' | 'custom'`. When `cycle === 'custom'`, a parallel `customCycleKeys: string[]` state field defines the key sequence (e.g. `['A', 'E', 'D', 'G']`). This two-field shape was chosen over a discriminated union to keep call sites simple — a discriminated union would require type narrowing at every access point.

`getShiftsForCycle(cycle, customCycleKeys)` in core is the single source of truth for how many laps to play and what semitone shift each lap gets:

- `'none'` → `[0]` (one lap, no shift)
- `'4ths'` → 12 shifts of +5 semitones each
- `'5ths'` → 12 shifts of +7 semitones each
- `'custom'` → one shift per key relative to `customCycleKeys[0]`; falls back to `[0]` if the list is empty

The audio engine replaces the old fixed 12-lap loop with an iteration over the array returned by `getShiftsForCycle`. No audio interface changes are needed to add new cycle modes — only core changes.

Key jump timing: `queueKeyJump(lapIndex)` queues a jump that fires at the next lap boundary (when the full song arrangement completes in the current key), not at the next chord. The engine tracks `_currentLap` from transport ticks on every chord event and fires when `lapIndex > _currentLap`.

**Editing `customCycleKeys`.** There's no dedicated editor screen — the key pill's popup (`#key-picker`) does double duty based on `cycle`. In `'none' | '4ths' | '5ths'` mode it's a single-select grid: tap a key, set `state.playback.key`, close the popup. When `cycle === 'custom'`, the same 12-key grid (`#key-grid`) becomes a toggle instead: tapping an unselected key appends it to `customCycleKeys`, tapping a selected one (highlighted) removes it, and the popup stays open so several keys can be added in one visit. A reorder/delete list (`#custom-key-rows`) renders directly below the grid inside the same popup, driven by the same `renderCustomCycleEditor` that previously targeted a Setup-sheet panel.

The popup's outside-click-to-dismiss listener is registered on the **capture** phase, not the default bubble phase. Reordering a key calls `setPlayback`, which synchronously rebuilds `#custom-key-rows` — detaching the clicked ↑/↓/× button from the DOM before the click event finishes bubbling up to `document`. A bubble-phase listener would then see `keyPickerEl.contains(e.target)` as `false` (the target is detached) and incorrectly close the popup on every reorder. Capture phase evaluates before that rebuild happens, so the containment check still sees the button attached.

## URL serialization

State is serialized as query parameters. Musical content (`key`, `tempo`, `bars`, `cycle`, `customKeys`, `style`, `section`, `advance`, `arrangement`, `activeSection`) and mix state (`chordsOn`/`bassOn`/`drumsOn`, `*Vol`) are all encoded. Multiple `section` params carry each section's progression string. `customKeys` is a comma-joined list of key names (e.g. `customKeys=A,E,D,G`), only written when non-empty. All values fall back to `DEFAULTS` on parse failure.

## Scrubbers

The action bar contains two stacked scrubber rows, each only visible when relevant:

- **SONG scrubber** — appears when the arrangement has 2+ positions; segments are section references. While playing: tapping queues a section jump at the next chord boundary (auto mode) or holds until tapped again (manual mode). While stopped/paused: tapping highlights the segment and calls `seekToPos(posIndex)` so play starts from that exact arrangement position (not just the section number — repeated section refs like `1 1 2 1 1 2` resume from the tapped occurrence).
- **KEY scrubber** — appears when `cycle !== 'none'` and either the key sequence has 2+ entries or `cycle === 'custom'` (shown with even a single key, so the sequence being built is visible right away); segments are resolved key names. While playing: tapping queues a lap jump that fires at the end of the current full-song run. While stopped/paused: tapping highlights the segment, calls `seekToLap(lapIndex)`, and immediately updates the chord chips and key display to reflect the selected key.

Both scrubbers auto-scroll to keep the active segment centered on each chord tick using `getBoundingClientRect`-based centering (not `offsetLeft`, which is relative to the nearest positioned ancestor rather than the scroll container).

The host tracks `_currentScrubPosIndex`, `_currentScrubKey`, and `_currentLapIndex` to restore `.current` highlights and correct chord display after DOM rebuilds (scrubbers do `innerHTML = ''` on every `render()` call).

## Known rough edges

- **Full re-render on every state change.** `render()` calls all sub-renders on every `setPlayback`/`setMix`/structural mutation including rapid slider drags. Fine for current app size; revisit if sluggishness appears.

## Player factory public API

`makeProgressionPlayer(config)` returns the app controller. Key playback methods:

- `togglePlay()` — **pause** if playing, **resume** if paused or stopped. Resume uses `_pausedAt` (posIndex + chipIndex + lapIndex) so it continues from the exact chord and cycle lap where playback stopped.
- `stop()` — full reset to beginning; clears `_pausedAt`.
- `isPaused()` — returns true when paused (audio stopped, position saved).
- `seekToPos(posIndex)` — sets the resume position to a specific arrangement slot; also updates `activeSection` for chip display. Works from stopped or paused state.
- `seekToLap(lapIndex)` — sets the resume lap without affecting the song position. Works from stopped (defaults posIndex to 0) or paused (preserves posIndex/chipIndex).

State mutation API: `setPlayback(partial)` merges into `state.playback`; `setMix(partial)` merges into `state.mix`; structural changes use named methods (`addSection`, `removeSection`, `moveSection`, `updateSection`, `setArrangement`, `setCycle`). The generic `setState` is gone.

Pause state is stored in private `_pausedAt: { posIndex, chipIndex, lapIndex } | null`. It is cleared by `stop()`, `loadPreset()`, and any mutation touching `sections`, `arrangement`, `cycle`, or `customCycleKeys` (structural changes that would make the saved position stale). Key, tempo, style, bass, voicing, and bars changes preserve `_pausedAt`.

## File structure and split thresholds

Five source files with clear per-file purpose: logic, audio, view, markup, style data. The structure has absorbed multi-section, custom cycle, scrubbers, seek, and the Vite + TypeScript migration without breaking down — evidence the split is right.

**Current pressure points:**

`progression-core.ts` carries two distinct concerns that share a file comfortably at current size (~1230 lines):

- **Music theory** — constants, note math, chord building, name resolution (`resolvedChordName`, `buildChord`, etc.)
- **App architecture** — `AppState`, `DEFAULTS`, URL serialization, `makeProgressionPlayer`

**Triggers to split:**

- `progression-core.ts` crossing ~1500 lines → separate music-theory utilities from state/player factory. The cut is clean; coupling between the two halves is already minimal.

`progression-audio.ts` (~840 lines) and `src/app.ts` (~1120 lines) are growing but well-scoped; revisit if either approaches 1500 lines.

## References

### drumhaus

https://github.com/mxfng/drumhaus — a polished Tone.js drum machine that uses **sample playback** (`Tone.Player` loading `.wav` files from classic drum machines like the Roland TR-808). Its `.dhkit` format is a clean JSON schema (`kind: "drumhaus.kit"`, `version: 1`) mapping each instrument to a sample path. Good architectural reference for the sample playback approach now used in this app.

### Drum samples

Drum sounds use **MuldjordKit** (CC BY 4.0, https://freepats.zenvoid.org/Percussion/acoustic-drum-kit.html) — an acoustic kit recorded at multiple velocity layers. 14 OGG files (~1.2 MB total) live in `public/samples/` and are loaded via `Tone.Player` instances created at engine init so loading begins before first play. Each sequence callback prefers the sample player when its buffer is loaded and falls back to the synth otherwise. Clap has no sample equivalent and remains synth-only.
