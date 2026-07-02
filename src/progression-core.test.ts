import {
  MAX_CHORDS,
  cycleUsesFlats,
  getShiftsForCycle,
  normalizePlaybackForCycle,
  parseProgression,
  parseUrl,
  remapArrangementDelete,
  remapArrangementSwap,
  resolvedChordName,
  resolvedKeyName,
  tokenize,
} from "./progression-core";
import { describe, expect, it } from "vitest";

describe("getShiftsForCycle", () => {
  it("returns [0] for 'none'", () => {
    expect(getShiftsForCycle("none", [])).toEqual([0]);
  });

  it("returns 12 shifts of +5 semitones for '4ths'", () => {
    const shifts = getShiftsForCycle("4ths", []);
    expect(shifts).toHaveLength(12);
    expect(shifts[0]).toBe(0);
    expect(shifts[1]).toBe(5);
    expect(shifts[11]).toBe(55);
  });

  it("returns 12 shifts of +7 semitones for '5ths'", () => {
    const shifts = getShiftsForCycle("5ths", []);
    expect(shifts).toHaveLength(12);
    expect(shifts[0]).toBe(0);
    expect(shifts[1]).toBe(7);
    expect(shifts[11]).toBe(77);
  });

  it("returns semitone offsets relative to first key for 'custom'", () => {
    // A=9, E=4 → 4-9=-5, D=2 → 2-9=-7, G=7 → 7-9=-2
    expect(getShiftsForCycle("custom", ["A", "E", "D", "G"])).toEqual([0, -5, -7, -2]);
  });

  it("falls back to [0] for 'custom' with empty key list", () => {
    expect(getShiftsForCycle("custom", [])).toEqual([0]);
  });
});

const BASE_PLAYBACK = {
  key: "C",
  tempo: 85,
  bars: 2,
  cycle: "none",
  customCycleKeys: [],
  style: "funk",
  bass: "busy",
  drums: "simple",
  voicing: "voice-lead-loop",
  advance: "auto",
};

describe("normalizePlaybackForCycle", () => {
  it("syncs key to customCycleKeys[0] when cycle is custom", () => {
    const result = normalizePlaybackForCycle({
      ...BASE_PLAYBACK,
      key: "C",
      cycle: "custom",
      customCycleKeys: ["A", "D", "G"],
    });
    expect(result.key).toBe("A");
  });

  it("leaves key untouched when customCycleKeys is empty", () => {
    const result = normalizePlaybackForCycle({
      ...BASE_PLAYBACK,
      key: "C",
      cycle: "custom",
      customCycleKeys: [],
    });
    expect(result.key).toBe("C");
  });

  it("leaves key untouched for non-custom cycles", () => {
    const result = normalizePlaybackForCycle({
      ...BASE_PLAYBACK,
      key: "C",
      cycle: "4ths",
      customCycleKeys: ["A", "D", "G"],
    });
    expect(result.key).toBe("C");
  });
});

describe("parseUrl", () => {
  it("resolves the key from customCycleKeys[0], not the key param, when cycle=custom", () => {
    const state = parseUrl("key=C&cycle=custom&customKeys=A,D,G");
    expect(state.playback.key).toBe("A");
    expect(state.playback.customCycleKeys).toEqual(["A", "D", "G"]);
  });
});

describe("cycleUsesFlats", () => {
  it("always uses flats for '4ths'", () => {
    expect(cycleUsesFlats("4ths", "C")).toBe(true);
  });

  it("never uses flats for '5ths'", () => {
    expect(cycleUsesFlats("5ths", "Bb")).toBe(false);
  });

  it("uses flats for flat keys in 'none' cycle", () => {
    expect(cycleUsesFlats("none", "F")).toBe(true);
    expect(cycleUsesFlats("none", "Bb")).toBe(true);
  });

  it("uses sharps for non-flat keys in 'none' cycle", () => {
    expect(cycleUsesFlats("none", "C")).toBe(false);
    expect(cycleUsesFlats("none", "G")).toBe(false);
  });

  it("checks target pitch class for 'custom'", () => {
    // targetPc=3 → FLAT_NAMES[3]="Eb" → in FLAT_KEYS → true
    expect(cycleUsesFlats("custom", "C", 3)).toBe(true);
    // targetPc=7 → FLAT_NAMES[7]="G" → not in FLAT_KEYS → false
    expect(cycleUsesFlats("custom", "C", 7)).toBe(false);
  });
});

describe("resolvedChordName", () => {
  it("resolves uppercase Roman numeral to major chord", () => {
    expect(resolvedChordName("I", 0, "C", "none")).toBe("C");
    expect(resolvedChordName("V", 0, "C", "none")).toBe("G");
  });

  it("resolves lowercase Roman numeral to minor chord", () => {
    expect(resolvedChordName("vi", 0, "C", "none")).toBe("Am");
    expect(resolvedChordName("ii", 0, "C", "none")).toBe("Dm");
  });

  it("uses flat names in a flat key", () => {
    // IV in F = Bb (not A#)
    expect(resolvedChordName("IV", 0, "F", "none")).toBe("Bb");
  });

  it("applies cycle shift to Roman numeral", () => {
    // I in C + shift 5 (one step in 4ths) = F; 4ths cycle always uses flats
    expect(resolvedChordName("I", 5, "C", "4ths")).toBe("F");
  });

  it("passes through absolute chord unchanged at shift 0", () => {
    expect(resolvedChordName("Am", 0, "C", "none")).toBe("Am");
    expect(resolvedChordName("F#m7", 0, "C", "none")).toBe("F#m7");
  });

  it("transposes absolute chord when shift is non-zero", () => {
    // Am + 2 semitones → Bm (sharp names, none cycle in C)
    expect(resolvedChordName("Am", 2, "C", "none")).toBe("Bm");
  });

  it("resolves flat-degree Roman numerals (bVII)", () => {
    // bVII in F: degree 6, semis = 11-1 = 10; F(65)+10 = 75 → pc 3 → Eb (flat key)
    expect(resolvedChordName("bVII", 0, "F", "none")).toBe("Eb");
  });

  it("returns '?' for unrecognized tokens", () => {
    expect(resolvedChordName("Xm", 0, "C", "none")).toBe("?");
  });
});

describe("resolvedKeyName", () => {
  it("returns the base key when shift is 0", () => {
    expect(resolvedKeyName("C", 0, "none")).toBe("C");
    expect(resolvedKeyName("Bb", 0, "none")).toBe("Bb");
  });

  it("uses flat names for 4ths cycle", () => {
    // C + 5 = F
    expect(resolvedKeyName("C", 5, "4ths")).toBe("F");
    // C + 10 = Bb (not A#)
    expect(resolvedKeyName("C", 10, "4ths")).toBe("Bb");
  });

  it("uses sharp names for 5ths cycle", () => {
    // C + 7 = G
    expect(resolvedKeyName("C", 7, "5ths")).toBe("G");
    // C + 2 = D
    expect(resolvedKeyName("C", 2, "5ths")).toBe("D");
  });
});

describe("remapArrangementDelete", () => {
  it("removes the deleted section and decrements higher refs", () => {
    expect(remapArrangementDelete("1 2 3", 0)).toBe("1 2");
  });

  it("removes all occurrences of the deleted section", () => {
    expect(remapArrangementDelete("1 2 3 2 1", 1)).toBe("1 2 1");
  });

  it("handles deleting the only/last remaining refs", () => {
    expect(remapArrangementDelete("1 1 2", 0)).toBe("1");
  });

  it("preserves :repeat suffixes on surviving tokens", () => {
    // "2:2" means section 2, repeat twice — ref=2 shifts to 1 after deleting idx=0
    expect(remapArrangementDelete("1 2:2 3", 0)).toBe("1:2 2");
  });

  it("returns empty string for empty input", () => {
    expect(remapArrangementDelete("", 0)).toBe("");
  });
});

describe("remapArrangementSwap", () => {
  it("swaps two adjacent section refs", () => {
    expect(remapArrangementSwap("1 2 3", 0, 1)).toBe("2 1 3");
  });

  it("swaps non-adjacent section refs", () => {
    expect(remapArrangementSwap("1 2 3 4", 0, 2)).toBe("3 2 1 4");
  });

  it("swaps all occurrences of both refs", () => {
    expect(remapArrangementSwap("1 2 1 2", 0, 1)).toBe("2 1 2 1");
  });

  it("preserves :repeat suffixes through a swap", () => {
    // "1:2" is section 1 repeated twice; swapping idx 0 and 1 gives "2:2 1 3"
    expect(remapArrangementSwap("1:2 2 3", 0, 1)).toBe("2:2 1 3");
  });
});

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("I ii V I")).toEqual(["I", "ii", "V", "I"]);
  });

  it("trims leading/trailing whitespace", () => {
    expect(tokenize("  I ii  ")).toEqual(["I", "ii"]);
  });

  it("returns empty array for empty/whitespace-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it(`caps output at MAX_CHORDS (${MAX_CHORDS})`, () => {
    const input = Array.from({ length: MAX_CHORDS + 5 }, () => "I").join(" ");
    expect(tokenize(input)).toHaveLength(MAX_CHORDS);
  });
});

describe("parseProgression", () => {
  it("parses a basic progression with default bars", () => {
    const chords = parseProgression("I ii V I", "C", 2);
    expect(chords).toHaveLength(4);
    expect(chords.map((c) => c.numeral)).toEqual(["I", "ii", "V", "I"]);
    expect(chords.every((c) => c.bars === 2)).toBe(true);
  });

  it("respects per-token bar overrides", () => {
    const chords = parseProgression("I:4 ii V", "C", 2);
    expect(chords[0]!.bars).toBe(4);
    expect(chords[1]!.bars).toBe(2);
    expect(chords[2]!.bars).toBe(2);
  });

  it("preserves the original token string", () => {
    const chords = parseProgression("I:4 ii", "C", 2);
    expect(chords[0]!.token).toBe("I:4");
    expect(chords[1]!.token).toBe("ii");
  });

  it("throws on empty input", () => {
    expect(() => parseProgression("", "C", 2)).toThrow("Progression is empty");
  });

  it("throws on an unrecognized chord token", () => {
    expect(() => parseProgression("I Xm V", "C", 2)).toThrow();
  });
});
