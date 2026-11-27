/**
 * Built-in patches as data: v1's chord pad and synth bass (exactly v1's settings),
 * and the sampled instruments (volumes level them with v1's sounds). Frozen: a
 * new sound gets a new id (`*-v2`, …), so saved songs never change how they sound.
 * `kit-v1` (drums) is code in `engine/patches.ts`.
 */

import type { BuiltinPatchId, Patch, SampleSetId } from "./schema";

/** Sample set ids are validated against the registry; these are known to be in it. */
const set = (id: string) => id as SampleSetId;

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
  "piano-v1": { kind: "sampler", role: "chords", set: set("piano-v1"), volume: 0 },
  "epiano-fm-v1": { kind: "sampler", role: "chords", set: set("epiano-fm-v1"), volume: -12 },
  "bass-electric-v1": { kind: "sampler", role: "bass", set: set("bass-electric-v1"), volume: -8 },
};
