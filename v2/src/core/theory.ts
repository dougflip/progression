/**
 * Music theory: keys, scale steps, chord qualities, names. Pure data and lookups.
 * v1 parity notes are inline; deliberate differences are called out.
 */

import type { ChordQuality, ChordTone, KeyName, ScaleStep } from "../model/schema";

/** Pitch class of each key name (C = 0). */
export const KEY_PC: Record<KeyName, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

export const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const satisfies readonly KeyName[];
export const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const satisfies readonly KeyName[];

/** Keys whose chord names are spelled with flats (v1's FLAT_KEYS). Every other key uses sharps. */
const FLAT_KEYS: ReadonlySet<KeyName> = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb"]);

export function usesFlats(key: KeyName): boolean {
  return FLAT_KEYS.has(key);
}

export function pcName(pc: number, flats: boolean): KeyName {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]!;
}

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Semitones of each major-scale degree above the tonic (degree 1 = index 0). */
export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;

/** Semitones above the key's tonic, e.g. ♭VII → 10, ♯IV → 6. */
export function stepSemitones(step: ScaleStep): number {
  return MAJOR_SCALE[step.degree - 1]! + (step.accidental ?? 0);
}

/** v1: these qualities pick a style's `minor` bass phrase and lower-case numerals. */
export const MINORISH: Record<ChordQuality, boolean> = {
  major: false,
  minor: true,
  maj7: false,
  m7: true,
  dom7: false,
  dim: true,
  aug: false,
  sus2: false,
  sus4: false,
  m7b5: true,
  dim7: true,
  mMaj7: true,
  dom7sus4: false,
};

/** Suffix after the root in chord names (v1's QUALITY_DISPLAY). */
export const QUALITY_NAME: Record<ChordQuality, string> = {
  major: "",
  minor: "m",
  maj7: "maj7",
  m7: "m7",
  dom7: "7",
  dim: "dim",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
  m7b5: "m7b5",
  dim7: "dim7",
  mMaj7: "mMaj7",
  dom7sus4: "7sus4",
};

/**
 * Semitones of each chord tone above the root. 1/3/5/7 come from the quality
 * (for sus chords, "3" is the suspended note; triads use the 7th that fits:
 * major → maj7, minor/aug/sus → ♭7, dim → °7). 9/11/13 are natural extensions.
 *
 * v1 difference: v1's bass read "3" and "5" from the shell voicing, so on maj7, m7
 * and dom7 chords its "5" played the 7th. v2 plays the real fifth.
 */
const CHORD_TONES: Record<ChordQuality, readonly [number, number, number, number]> = {
  major: [0, 4, 7, 11],
  minor: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  dim: [0, 3, 6, 9],
  aug: [0, 4, 8, 10],
  sus2: [0, 2, 7, 10],
  sus4: [0, 5, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  mMaj7: [0, 3, 7, 11],
  dom7sus4: [0, 5, 7, 10],
};

export function chordToneSemitones(quality: ChordQuality, tone: ChordTone): number {
  const [root, third, fifth, seventh] = CHORD_TONES[quality];
  switch (tone) {
    case 1:
      return root;
    case 3:
      return third;
    case 5:
      return fifth;
    case 7:
      return seventh;
    case 9:
      return 14;
    case 11:
      return 17;
    case 13:
      return 21;
  }
}

/** A chord's name in a key, e.g. ♭VII7 in Eb → "Db7"; IV/I in C → "F/C". Spelling follows the key. */
export function chordName(
  chord: { root: ScaleStep; quality: ChordQuality; bass?: ScaleStep },
  key: KeyName,
): string {
  const flats = usesFlats(key);
  const tonic = KEY_PC[key];
  const name = pcName(tonic + stepSemitones(chord.root), flats) + QUALITY_NAME[chord.quality];
  return chord.bass ? `${name}/${pcName(tonic + stepSemitones(chord.bass), flats)}` : name;
}

/** MIDI note name for display, e.g. 60 → "C4" (Tone/v1 octave numbering). */
export function midiName(midi: number, flats = false): string {
  return pcName(midi, flats) + (Math.floor(midi / 12) - 1);
}
