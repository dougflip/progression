/**
 * Test helper: runs Tone on Node with an offline (faster than real time) audio
 * context from node-web-audio-api. Import it before anything that imports Tone.
 * Tests only; never bundled.
 */

import * as wa from "node-web-audio-api";

// Tone looks for the Web Audio API on the global object / window.
Object.assign(globalThis, wa);
(globalThis as { window?: unknown }).window ??= globalThis;

const Tone = await import("tone");

export const SAMPLE_RATE = 44100;

/**
 * Makes an offline context `seconds` long the current Tone context, runs `setup`,
 * renders, and returns channel 0. Callbacks scheduled with `Tone.getContext()
 * .setTimeout` run during rendering, at their audio time.
 */
export async function renderOffline(seconds: number, setup: () => void): Promise<Float32Array> {
  const native = new wa.OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  const context = new Tone.OfflineContext(native as unknown as OfflineAudioContext);
  Tone.setContext(context);
  setup();
  const buffer = await context.render(false);
  return buffer.getChannelData(0);
}

/** Note onsets (seconds): where the signal turns loud after ≥ `gap` of quiet. */
export function onsets(data: Float32Array, { threshold = 0.01, gap = 0.02 } = {}): number[] {
  const window = Math.round(SAMPLE_RATE * 0.001);
  const quietWindows = Math.round(gap / 0.001);
  const out: number[] = [];
  let quiet = Infinity;
  for (let i = 0; i + window <= data.length; i += window) {
    let energy = 0;
    for (let j = i; j < i + window; j++) energy += data[j]! * data[j]!;
    const loud = Math.sqrt(energy / window) > threshold;
    if (loud && quiet >= quietWindows) {
      let k = Math.max(0, i - window);
      while (k < i + window && Math.abs(data[k]!) < threshold / 4) k++;
      out.push(k / SAMPLE_RATE);
    }
    quiet = loud ? 0 : quiet + 1;
  }
  return out;
}
