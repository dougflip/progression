/**
 * Sample sets the app ships: pure data. Songs reference a set by id only
 * (`Patch.sampler.set`); this registry says where its files are, which notes were
 * sampled, and how it must be credited. Sets are never removed or changed once
 * shipped: a new recording gets a new id.
 *
 * Files are built by `scripts/build-sample-sets.mjs` (from each set's `source`)
 * into `public/v2/samples/<id>/<midi>.ogg`. A test checks every file exists.
 */

import type { PatchRole } from "./schema";

export interface SampleSet {
  id: string;
  role: PatchRole;
  /** Folder under the app's sample base URL, e.g. `bass-electric-v1/`. */
  path: string;
  /** Sampled notes: MIDI number → file name in `path`. Other notes are pitched from the nearest. */
  notes: Readonly<Record<number, string>>;
  /** Defaults for a patch that doesn't set them (seconds). */
  attack: number;
  release: number;
  /** Licence (e.g. "CC-BY 3.0") and the credit line the app must show. */
  licence: string;
  credit: string;
  /** Where the recordings came from. */
  source: string;
}

/** `<midi>.ogg` for each note. */
const files = (notes: number[]): Record<number, string> =>
  Object.fromEntries(notes.map((m) => [m, `${m}.ogg`]));
const range = (from: number, to: number, step: number) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

export const SAMPLE_SETS: Readonly<Record<string, SampleSet>> = {
  "bass-electric-v1": {
    id: "bass-electric-v1",
    role: "bass",
    path: "bass-electric-v1/",
    // Recorded chromatically E1–D#2 only; higher notes are pitched up from D#2.
    notes: files(range(28, 39, 1)),
    attack: 0,
    release: 0.5,
    licence: "CC0 1.0",
    credit: "Finger Bass YR by Andrea Biasior, FreePats project (CC0)",
    source: "https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html",
  },
  "piano-v1": {
    id: "piano-v1",
    role: "chords",
    path: "piano-v1/",
    notes: files(range(36, 84, 3)), // minor thirds, velocity layer 10 of 16
    attack: 0,
    release: 1,
    licence: "CC BY 3.0",
    credit: "Salamander Grand Piano by Alexander Holm (CC BY 3.0)",
    source: "https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html",
  },
  "epiano-fm-v1": {
    id: "epiano-fm-v1",
    role: "chords",
    path: "epiano-fm-v1/",
    notes: files(range(36, 84, 6)), // every 6 semitones, velocity layer 80
    attack: 0,
    release: 0.4,
    licence: "CC0 1.0",
    credit: "FM Synthesized Piano #1 by Roberto, FreePats project (CC0)",
    source: "https://freepats.zenvoid.org/ElectricPiano/synthesized-piano.html",
  },
};

/** Credit lines for sounds the app ships, including v1's drum kit (shown in the app). */
export const SOUND_CREDITS: readonly string[] = [
  ...Object.values(SAMPLE_SETS).map((s) => s.credit),
  "MuldjordKit drums, FreePats project (CC BY 4.0)",
];
