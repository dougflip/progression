/** Resolved settings and keys: what a section actually plays with. */

import type {
  InstrumentMap,
  KeyName,
  Practice,
  Section,
  SectionId,
  Song,
  SongDefaults,
} from "../model/schema";
import { DEFAULT_MUTES } from "../model/schema";
import type { DeepReadonly, NonEmpty } from "../model/types";
import { FLAT_NAMES, KEY_PC, SHARP_NAMES, mod12 } from "./theory";

type R<T> = DeepReadonly<T>;

export { DEFAULT_INSTRUMENTS } from "../model/schema";

export const DEFAULT_PRACTICE: Practice = {
  cycle: { kind: "none" },
  advance: "auto",
  mutes: { ...DEFAULT_MUTES },
};

export type EffectiveSettings = SongDefaults & { instruments: InstrumentMap };

export function findSection(song: R<Song>, sectionId: SectionId): R<Section> {
  const section = song.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`no section with id "${sectionId}"`);
  return section;
}

/** Section override ?? song default, per setting. */
export function effectiveSettings(song: R<Song>, sectionId: SectionId): R<EffectiveSettings> {
  const o = findSection(song, sectionId).overrides;
  const d = song.defaults;
  return {
    tempo: o.tempo ?? d.tempo,
    meter: o.meter ?? d.meter,
    swing: o.swing ?? d.swing,
    voicing: o.voicing ?? d.voicing,
    instruments: { ...song.instruments, ...o.instruments },
  };
}

/**
 * The key of each cycle lap.
 * - none: the song key.
 * - fourths / fifths: 12 keys starting from the song key, spelled with flats for
 *   fourths and sharps for fifths (v1).
 * - custom: the keys as given; the song key is ignored.
 */
export function lapKeys(song: R<Song>, practice: R<Practice>): NonEmpty<KeyName> {
  const cycle = practice.cycle;
  switch (cycle.kind) {
    case "none":
      return [song.key];
    case "fourths":
    case "fifths": {
      const step = cycle.kind === "fourths" ? 5 : 7;
      const names = cycle.kind === "fourths" ? FLAT_NAMES : SHARP_NAMES;
      const start = KEY_PC[song.key];
      return Array.from(
        { length: 12 },
        (_, i) => names[mod12(start + i * step)]!,
      ) as NonEmpty<KeyName>;
    }
    case "custom":
      return [...cycle.keys] as NonEmpty<KeyName>;
  }
}

/**
 * MIDI note of the lap key's tonic in the chord register. Laps move by at most a
 * tritone from the first lap's key (−5…+6 semitones), as in v1, so a cycle stays
 * in one register instead of climbing.
 */
export function tonicMidi(keys: readonly KeyName[], lap: number): number {
  const first = keys[0]!;
  const key = keys[lap % keys.length]!;
  const s = mod12(KEY_PC[key] - KEY_PC[first]);
  return 60 + KEY_PC[first] + (s > 6 ? s - 12 : s);
}
