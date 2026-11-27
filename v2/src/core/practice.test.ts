import { describe, expect, it } from "vitest";
import { Practice } from "../model/schema";
import { parseKeyList, withCycle } from "./practice";
import { DEFAULT_PRACTICE } from "./settings";

describe("parseKeyList", () => {
  it.each([
    ["A E D G", ["A", "E", "D", "G"]],
    ["bb, f#  c", ["Bb", "F#", "C"]],
    ["E♭ B♭ F♯", ["Eb", "Bb", "F#"]],
    ["Gb F#", ["Gb", "F#"]], // spelling is kept
  ])("%s", (text, keys) => {
    expect(parseKeyList(text)).toEqual({ ok: true, keys });
  });

  it.each([
    ["", "enter at least one key"],
    ["  ,  ", "enter at least one key"],
    ["A H", '"H" is not a key'],
    ["Cb", '"Cb" is not a key'],
  ])("rejects %j", (text, error) => {
    expect(parseKeyList(text)).toMatchObject({ ok: false, error: expect.stringContaining(error) });
  });
});

describe("withCycle", () => {
  it("sets the cycle and keeps the rest of the practice", () => {
    const p = { ...DEFAULT_PRACTICE, advance: "manual" as const };
    expect(withCycle(p, "fourths")).toEqual({ ...p, cycle: { kind: "fourths" } });
    const custom = withCycle(p, "custom", ["A", "E"]);
    expect(custom.cycle).toEqual({ kind: "custom", keys: ["A", "E"] });
    expect(Practice.safeParse(custom).success).toBe(true);
  });

  it("needs keys for a custom cycle", () => {
    expect(() => withCycle(DEFAULT_PRACTICE, "custom")).toThrow(/needs its keys/);
  });
});
