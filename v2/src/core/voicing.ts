/**
 * Chord voicing: v1's `makeChord`, ported as-is (parity.test.ts compares them).
 *
 * - Register: the root starts at the key's octave (MIDI 60–71, ± the cycle shift)
 *   and drops by octaves, but not below 48 (C3), until the top note is ≤ 76 (E5)
 *   for triads or ≤ 72 (C5) for 4-note chords.
 * - Notes: a doubled root an octave below `registerRoot`, plus the upper voicing.
 *   7th chords are shell voicings (no 5th), as in v1.
 * - Voice-leading: with a previous upper voicing, the inversion with the smallest
 *   total movement wins.
 */

import type { ChordQuality } from "../model/schema";

const VOICED_INTERVALS: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 11],
  m7: [0, 3, 10],
  dom7: [0, 4, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  mMaj7: [0, 3, 7, 11],
  dom7sus4: [0, 5, 7, 10],
};

export interface Voiced {
  /** Every note to play, low → high: the doubled root, then the upper voicing. */
  midi: number[];
  /** Upper voicing in voice order; feed it back as `prev` for voice-leading. */
  upper: number[];
  /** Root after the register adjustment. The bass part sits two octaves below it. */
  registerRoot: number;
}

/** The chord root after v1's register rule (independent of voice-leading). */
export function registerRoot(rootMidi: number, quality: ChordQuality): number {
  const intervals = VOICED_INTERVALS[quality];
  const topMax = intervals.length > 3 ? 72 : 76;
  const top = intervals[intervals.length - 1]!;
  let r = rootMidi;
  while (r + top > topMax && r > 48) r -= 12;
  return r;
}

export function voiceChord(
  rootMidi: number,
  quality: ChordQuality,
  prev?: readonly number[],
): Voiced {
  const intervals = VOICED_INTERVALS[quality];
  const topMax = intervals.length > 3 ? 72 : 76;
  const r = registerRoot(rootMidi, quality);

  let upper: number[];
  if (prev) {
    let best: number[] = [];
    let bestScore = Infinity;
    for (let inv = 0; inv < intervals.length; inv++) {
      let notes = intervals.map((_, i) => {
        const idx = (inv + i) % intervals.length;
        return r + intervals[idx]! + (inv + i >= intervals.length ? 12 : 0);
      });
      while (notes[notes.length - 1]! > topMax) notes = notes.map((n) => n - 12);
      const score = notes.reduce((sum, n, i) => sum + Math.abs(n - (prev[i] ?? 0)), 0);
      if (score < bestScore) {
        bestScore = score;
        best = notes;
      }
    }
    upper = best;
  } else {
    upper = intervals.map((iv) => r + iv);
  }

  return { midi: [r - 12, ...upper].sort((a, b) => a - b), upper, registerRoot: r };
}
