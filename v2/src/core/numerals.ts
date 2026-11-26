/**
 * Progression strings in v1's numeral syntax, e.g. "I V vi IV", "I7:4 IV7:2", "bVII ii7".
 *
 * Token: `[b|#] NUMERAL [suffix] [/ [b|#] NUMERAL] [:bars]`
 * - NUMERAL is all upper (major-ish) or all lower case (minor-ish): I … VII, i … vii.
 * - suffix (v1's set): m maj7 m7 7 dim ° aug + sus2 sus4 m7b5 ø dim7 °7 mMaj7 7sus4.
 *   No suffix → major (upper case) or minor (lower case); "7" → dom7 (upper) or m7 (lower).
 * - `/NUMERAL` is a slash chord's bass note (v2 addition), e.g. IV/I.
 * - `:bars` (1–16) overrides the section's bars-per-chord for that chord.
 *
 * v2 additions over v1: `#` prefix and slash chords. v1's absolute chord names (C7)
 * are not supported: songs are key-agnostic.
 */

import type { ChordQuality, ScaleStep } from "../model/schema";
import type { NonEmpty } from "../model/types";
import { MINORISH } from "./theory";

export const MAX_TOKEN_BARS = 16;

export interface ParsedChord {
  root: ScaleStep;
  quality: ChordQuality;
  bass?: ScaleStep;
  /** From `:bars`. Omitted = use the section's bars-per-chord. */
  bars?: number;
}

export type ParseResult =
  | { ok: true; chords: NonEmpty<ParsedChord> }
  | { ok: false; errors: string[] };

const NUMERALS = ["VII", "VI", "V", "IV", "III", "II", "I"] as const;
const DEGREE: Record<string, ScaleStep["degree"]> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
};

const NUMERAL = `(?:${NUMERALS.join("|")}|${NUMERALS.map((n) => n.toLowerCase()).join("|")})`;
const TOKEN_RE = new RegExp(
  String.raw`^([b#]?)(${NUMERAL})([^/:]*)(?:/([b#]?)(${NUMERAL}))?(?::(\d+))?$`,
);

function suffixToQuality(suffix: string, lower: boolean): ChordQuality | undefined {
  switch (suffix) {
    case "":
      return lower ? "minor" : "major";
    case "7":
      return lower ? "m7" : "dom7";
    case "m":
      return "minor";
    case "maj7":
      return "maj7";
    case "m7":
      return "m7";
    case "dim":
    case "°":
      return "dim";
    case "aug":
    case "+":
      return "aug";
    case "sus2":
      return "sus2";
    case "sus4":
      return "sus4";
    case "m7b5":
    case "ø":
      return "m7b5";
    case "dim7":
    case "°7":
      return "dim7";
    case "mMaj7":
      return "mMaj7";
    case "7sus4":
      return "dom7sus4";
    default:
      return undefined;
  }
}

function step(accidental: string, numeral: string): ScaleStep {
  const degree = DEGREE[numeral.toUpperCase()]!;
  if (accidental === "b") return { degree, accidental: -1 };
  if (accidental === "#") return { degree, accidental: 1 };
  return { degree };
}

/** Parses one token, or returns a readable error. */
export function parseToken(token: string): ParsedChord | string {
  const m = TOKEN_RE.exec(token);
  if (!m) return `"${token}" is not a chord (expected a Roman numeral like I, vi, bVII7 or IV/I)`;
  const [, acc = "", numeral = "", suffix = "", bassAcc, bassNumeral, bars] = m;
  const quality = suffixToQuality(suffix, numeral === numeral.toLowerCase());
  if (!quality) return `"${token}": unknown chord quality "${suffix}"`;
  const chord: ParsedChord = { root: step(acc, numeral), quality };
  if (bassNumeral) chord.bass = step(bassAcc ?? "", bassNumeral);
  if (bars !== undefined) {
    const n = Number(bars);
    if (n < 1 || n > MAX_TOKEN_BARS) return `"${token}": bars must be 1–${MAX_TOKEN_BARS}`;
    chord.bars = n;
  }
  return chord;
}

export function parseProgression(input: string): ParseResult {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false, errors: ["progression is empty"] };
  const chords: ParsedChord[] = [];
  const errors: string[] = [];
  for (const token of tokens) {
    const parsed = parseToken(token);
    if (typeof parsed === "string") errors.push(parsed);
    else chords.push(parsed);
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, chords: chords as NonEmpty<ParsedChord> };
}

/** Total bars of a parsed progression. */
export function progressionBars(chords: readonly ParsedChord[], barsPerChord: number): number {
  return chords.reduce((sum, c) => sum + (c.bars ?? barsPerChord), 0);
}

/** Numeral text for a chord (chip label). Round-trips through `parseToken`. */
export function formatNumeral(chord: {
  root: ScaleStep;
  quality: ChordQuality;
  bass?: ScaleStep;
}): string {
  const lower = MINORISH[chord.quality];
  const numeral = (s: ScaleStep, lowerCase: boolean) => {
    const acc = s.accidental === -1 ? "b" : s.accidental === 1 ? "#" : "";
    const n = NUMERALS.find((r) => DEGREE[r] === s.degree)!;
    return acc + (lowerCase ? n.toLowerCase() : n);
  };
  const suffix = NUMERAL_SUFFIX[chord.quality];
  const bass = chord.bass ? `/${numeral(chord.bass, false)}` : "";
  return numeral(chord.root, lower) + suffix + bass;
}

/** Suffix for `formatNumeral`, chosen so the result parses back to the same quality. */
const NUMERAL_SUFFIX: Record<ChordQuality, string> = {
  major: "",
  minor: "",
  maj7: "maj7",
  m7: "7",
  dom7: "7",
  dim: "°",
  aug: "+",
  sus2: "sus2",
  sus4: "sus4",
  m7b5: "ø",
  dim7: "°7",
  mMaj7: "mMaj7",
  dom7sus4: "7sus4",
};
