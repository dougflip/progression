/**
 * Sample sets the app ships: pure data. Songs reference a set by id only
 * (`Patch.sampler.set`); this registry says where its files are, which notes were
 * sampled, and how it must be credited. Sets are never removed or changed once
 * shipped: a new recording gets a new id.
 *
 * Empty until the first CC-licensed bass and keys sets are chosen.
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

export const SAMPLE_SETS: Readonly<Record<string, SampleSet>> = {};
