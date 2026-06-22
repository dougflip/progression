# Tone.js Findings from drumhaus

Reference: https://github.com/mxfng/drumhaus — a polished Tone.js drum machine using `Tone.Player` + `.wav` samples.

## Actionable improvements (ranked)

### 1. Single unified sequence

**Their approach**: One `Tone.Sequence` over step indices `[0..15]`. Inside the callback, iterate all voices that fire on that step.

**Our approach**: 9 separate sequences (`_kickSeq`, `_snareSeq`, etc.) all started at `0`.

**Why better**: Single clock source guarantees alignment across all voices. Fewer objects to manage and dispose. Structural improvement worth doing.

---

### 2. Hat choking

When a closed hat fires, stop any ringing open hat at the same time — TR-909 behavior. Currently our two players are independent.

Quick win: a few lines in `_triggerDrum` to call `_sp.openHat.stop(time)` when triggering `_sp.hat`.

---

### 3. Swing

Pure feature gap. `Transport.swing` (range `0–0.5`) + `Transport.swingSubdivision = "16n"` applies swing automatically to all sequences using that subdivision. No structural changes needed.

---

### 4. Lazy pattern recomputation via version counter

**Their approach**: A `patternVersion` counter. Inside the audio callback, if the version has changed since last render, recompute the pattern synchronously before scheduling. No teardown/rebuild cycle.

**Our approach**: Full teardown + `scheduleOnce("+0")` rebuild when pattern changes, which introduces a brief gap.

This would close that gap but requires threading a version counter through state.

---

## Lower priority

### AudioContext health tracking

They throttle `context.resume()` calls (100ms window) and distinguish `"suspended"` from other non-running states. Our single `Tone.start()` call is fine for one trigger point, but this pattern becomes relevant if we add multiple audio trigger sources (e.g., foot pedal preview sounds).

### Tree-shaken imports

`import { getTransport, Sequence } from "tone/build/esm/index"` instead of `import * as Tone from "tone"`. Bundle size improvement, zero functional impact.

### `getCurrentStepFromTransport()` for visual sync

Polling approach using raw transport ticks instead of `Tone.Draw`. Not better than our current `Tone.Draw` approach, just an alternative.

```ts
const ticks = transport.ticks;
const ticksPerStep = Ticks("16n").valueOf();
const currentStep = Math.floor(ticks / ticksPerStep) % STEP_COUNT;
```
