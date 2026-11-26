import { describe, expect, it } from "vitest";
import { ChordQuality } from "../model/schema";
import { formatNumeral, parseProgression, parseToken } from "./numerals";

describe("parseToken", () => {
  it.each([
    ["I", { root: { degree: 1 }, quality: "major" }],
    ["vi", { root: { degree: 6 }, quality: "minor" }],
    ["V7", { root: { degree: 5 }, quality: "dom7" }],
    ["ii7", { root: { degree: 2 }, quality: "m7" }],
    ["IVmaj7", { root: { degree: 4 }, quality: "maj7" }],
    ["bVII", { root: { degree: 7, accidental: -1 }, quality: "major" }],
    ["#iv°", { root: { degree: 4, accidental: 1 }, quality: "dim" }],
    ["viiø", { root: { degree: 7 }, quality: "m7b5" }],
    ["V7sus4", { root: { degree: 5 }, quality: "dom7sus4" }],
    ["imMaj7", { root: { degree: 1 }, quality: "mMaj7" }],
    ["IV/I", { root: { degree: 4 }, quality: "major", bass: { degree: 1 } }],
    ["V/bVII", { root: { degree: 5 }, quality: "major", bass: { degree: 7, accidental: -1 } }],
    ["I7:4", { root: { degree: 1 }, quality: "dom7", bars: 4 }],
    ["iii:16", { root: { degree: 3 }, quality: "minor", bars: 16 }],
    ["IV/I:2", { root: { degree: 4 }, quality: "major", bass: { degree: 1 }, bars: 2 }],
  ])("%s", (token, expected) => {
    expect(parseToken(token)).toEqual(expected);
  });

  it.each([
    ["Q", "is not a chord"],
    ["C7", "is not a chord"], // v1's absolute chord names: songs are key-agnostic
    ["Iv", 'unknown chord quality "v"'],
    ["Ixyz", 'unknown chord quality "xyz"'],
    ["I:0", "bars must be 1–16"],
    ["I:17", "bars must be 1–16"],
    ["I/Q", "is not a chord"],
    ["bbI", "is not a chord"],
  ])("rejects %s", (token, message) => {
    expect(parseToken(token)).toContain(message);
  });
});

describe("parseProgression", () => {
  it("parses every token and reports every bad one", () => {
    expect(parseProgression("  I   V vi IV ")).toMatchObject({ ok: true, chords: { length: 4 } });
    expect(parseProgression("I Q V Z")).toEqual({
      ok: false,
      errors: [expect.stringContaining('"Q"'), expect.stringContaining('"Z"')],
    });
    expect(parseProgression("   ")).toEqual({ ok: false, errors: ["progression is empty"] });
  });
});

describe("formatNumeral", () => {
  it("round-trips every quality, accidental and slash", () => {
    for (const quality of ChordQuality.options) {
      for (const accidental of [-1, 0, 1] as const) {
        for (const degree of [1, 4, 7] as const) {
          const chord = { root: { degree, accidental }, quality, bass: { degree: 1 as const } };
          const parsed = parseToken(formatNumeral(chord));
          expect(parsed, formatNumeral(chord)).toEqual({
            root: accidental ? { degree, accidental } : { degree },
            quality,
            bass: { degree: 1 },
          });
        }
      }
    }
  });

  it("reads like a numeral", () => {
    expect(formatNumeral({ root: { degree: 2 }, quality: "m7" })).toBe("ii7");
    expect(formatNumeral({ root: { degree: 7, accidental: -1 }, quality: "dom7" })).toBe("bVII7");
    expect(formatNumeral({ root: { degree: 7 }, quality: "dim7" })).toBe("vii°7");
  });
});
