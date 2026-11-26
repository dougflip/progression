/**
 * Parity with v1 where behaviour should match. v1's pure core is imported directly.
 * Deliberate differences are tested as such (see "differs from v1").
 */
import { describe, expect, it } from "vitest";
import * as v1 from "../../../src/progression-core";
import { STYLES as V1_STYLES } from "../../../src/styles";
import { KeyName, type BuiltinStyleId, type Song } from "../model/schema";
import { parseProgression, parseToken, progressionBars, type ParsedChord } from "./numerals";
import { lapKeys, tonicMidi, DEFAULT_PRACTICE } from "./settings";
import { STYLES } from "./styles";
import { chordName, chordToneSemitones, stepSemitones } from "./theory";
import { registerRoot, voiceChord } from "./voicing";

const KEYS = KeyName.options;
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const SUFFIXES = [
  "",
  "m",
  "maj7",
  "m7",
  "7",
  "dim",
  "°",
  "aug",
  "+",
  "sus2",
  "sus4",
  "m7b5",
  "ø",
  "dim7",
  "°7",
  "mMaj7",
  "7sus4",
];
const TOKENS = NUMERALS.flatMap((n) =>
  [n, n.toLowerCase()].flatMap((numeral) =>
    ["", "b"].flatMap((flat) => SUFFIXES.map((s) => flat + numeral + s)),
  ),
);

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(name: string): number {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(name)!;
  return NOTE_PC[m[1]!]! + (m[2] ? 1 : 0) + (Number(m[3]) + 1) * 12;
}

function parsed(token: string): ParsedChord {
  const c = parseToken(token);
  if (typeof c === "string") throw new Error(c);
  return c;
}

const rootMidi = (key: KeyName, c: ParsedChord) => tonicMidi([key], 0) + stepSemitones(c.root);

describe("chord names", () => {
  it.each(KEYS)("match v1 for every numeral and suffix in %s", (key) => {
    for (const token of TOKENS) {
      expect(chordName(parsed(token), key), token).toBe(
        v1.resolvedChordName(token, 0, key, "none"),
      );
    }
  });
});

describe("voicing", () => {
  it.each(KEYS)("root position matches v1's makeChord in %s", (key) => {
    for (const token of TOKENS) {
      const c = parsed(token);
      const mine = voiceChord(rootMidi(key, c), c.quality);
      const theirs = v1.makeChord(v1.KEY_MIDI[key]! + stepSemitones(c.root), c.quality);
      expect(mine.upper, token).toEqual(theirs.upperVoicing);
      expect(mine.midi, token).toEqual(theirs.notes.map(noteToMidi));
    }
  });

  it.each(KEYS)("voice-leading through every chord matches v1 in %s", (key) => {
    let mine: number[] | undefined;
    let theirs: number[] | null = null;
    for (const token of TOKENS) {
      const c = parsed(token);
      const a = voiceChord(rootMidi(key, c), c.quality, mine);
      const b = v1.makeChord(v1.KEY_MIDI[key]! + stepSemitones(c.root), c.quality, theirs);
      expect(a.upper, token).toEqual(b.upperVoicing);
      mine = a.upper;
      theirs = b.upperVoicing;
    }
  });
});

describe("bass register", () => {
  it.each(KEYS)("root and third match v1 for every chord in %s", (key) => {
    for (const token of TOKENS) {
      const c = parsed(token);
      const bassRoot = registerRoot(rootMidi(key, c), c.quality) - 24;
      const theirs = v1.makeChord(v1.KEY_MIDI[key]! + stepSemitones(c.root), c.quality);
      expect(bassRoot, token).toBe(noteToMidi(theirs.bassRoot));
      expect(bassRoot + chordToneSemitones(c.quality, 3), token).toBe(noteToMidi(theirs.bassThird));
    }
  });

  it("fifth matches v1, except on maj7 / m7 / dom7 (differs from v1: v1 played the 7th)", () => {
    for (const token of TOKENS) {
      const c = parsed(token);
      const bassRoot = registerRoot(rootMidi("C", c), c.quality) - 24;
      const theirs = noteToMidi(v1.makeChord(60 + stepSemitones(c.root), c.quality).bassFifth);
      const mine = bassRoot + chordToneSemitones(c.quality, 5);
      if (["maj7", "m7", "dom7"].includes(c.quality)) {
        expect(mine, token).not.toBe(theirs);
        expect(mine - bassRoot, token).toBe(7);
      } else {
        expect(mine, token).toBe(theirs);
      }
    }
  });
});

describe("styles", () => {
  const ids = Object.keys(STYLES) as BuiltinStyleId[];

  it("has v1's seven styles", () => {
    expect(ids.sort()).toEqual(Object.keys(V1_STYLES).sort());
  });

  it.each(ids)("%s matches v1 step for step", (id) => {
    for (const variant of ["simple", "busy"] as const) {
      const v1Variant = V1_STYLES[id]![variant];
      const { bass: v1Bass, ...v1Drums } = v1Variant;
      const drums = Object.fromEntries(
        Object.entries(v1Drums).map(([drum, steps]) => [
          drum,
          steps.flatMap((hit, i) => (hit ? [i * 12] : [])),
        ]),
      );
      expect(STYLES[id].drums[variant], `${id} ${variant} drums`).toEqual(drums);
      for (const q of ["major", "minor"] as const) {
        const expected = v1Bass[q].flatMap((step, i) =>
          step === 0 ? [] : [{ start: i * 12, tone: step === "R" ? 1 : Number(step) }],
        );
        const actual = STYLES[id].bass[variant][q].map((n) => ({
          start: n.start,
          tone: n.pitch.kind === "chordTone" ? n.pitch.tone : NaN,
        }));
        expect(actual, `${id} ${variant} ${q}`).toEqual(expected);
      }
    }
  });
});

describe("cycle keys", () => {
  const song = (key: KeyName) => ({ key }) as Song;
  const v1Cycle = { fourths: "4ths", fifths: "5ths" } as const;

  it.each(KEYS)("fourths and fifths from %s match v1's keys and registers", (key) => {
    for (const kind of ["fourths", "fifths"] as const) {
      const keys = lapKeys(song(key), { ...DEFAULT_PRACTICE, cycle: { kind } });
      const shifts = v1.getShiftsForCycle(v1Cycle[kind], []);
      expect(keys).toEqual(shifts.map((s) => v1.resolvedKeyName(key, s, v1Cycle[kind])));
      keys.forEach((_, lap) => {
        expect(tonicMidi(keys, lap)).toBe(v1.KEY_MIDI[key]! + v1.clampShift(shifts[lap]!));
      });
    }
  });

  it("custom keys play as given, registered like v1 (relative to the first key)", () => {
    const keys = ["A", "E", "D", "G"] as const;
    const shifts = v1.getShiftsForCycle("custom", [...keys]);
    keys.forEach((_, lap) => {
      expect(tonicMidi(keys, lap)).toBe(v1.KEY_MIDI.A! + v1.clampShift(shifts[lap]!));
    });
  });
});

describe("progression bars", () => {
  it.each([
    ["I vi ii V", 2],
    ["I7:4 IV7:2 I7:2 V7:1 IV7:1 I7:1 V7:1", 2],
    ["vi iii vi iii vi iii V vi:2", 1],
    ["iii:2 I:2", 4],
  ])("%s at %i bars per chord matches v1", (progression, barsPerChord) => {
    const mine = parseProgression(progression);
    if (!mine.ok) throw new Error(mine.errors.join());
    const theirs = v1.parseProgression(progression, "C", barsPerChord);
    expect(mine.chords.map((c) => c.bars ?? barsPerChord)).toEqual(theirs.map((c) => c.bars));
    expect(progressionBars(mine.chords, barsPerChord)).toBe(theirs.reduce((s, c) => s + c.bars, 0));
  });
});
