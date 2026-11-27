/**
 * Built-in patches as data: v1's chord pad and synth bass, with exactly v1's
 * settings. Frozen: a new sound gets a new id (`*-v2`, `piano-v1`, …), so saved
 * songs never change how they sound. `kit-v1` (drums) is code in `engine/patches.ts`.
 */

import type { BuiltinPatchId, Patch } from "./schema";

export const BUILTIN_PATCHES: Record<Exclude<BuiltinPatchId, "kit-v1">, Patch> = {
  "pad-v1": {
    kind: "synth",
    role: "chords",
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1.5 },
    effects: [{ kind: "reverb", decay: 2.5, wet: 0.25 }],
    volume: -13,
  },
  "bass-v1": {
    kind: "synth",
    role: "bass",
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
    filter: {
      type: "lowpass",
      frequency: 80,
      q: 2,
      envelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.3, octaves: 2.5 },
    },
    volume: -6,
  },
};
