import { describe, expect, it } from "vitest";
import type { EngineSource, Jump, PlayScope, Position, Transport } from "../model/runtime";
import { Song, type Advance, type Cycle } from "../model/schema";
import { DEFAULT_PRACTICE } from "./settings";
import { changeScope, clampPosition, nextPosition } from "./transport";

type Playing = Extract<Transport, { status: "playing" }>;

// Arrangement: A (2 bars), B (1 bar), A.
const song = Song.parse({
  version: 2,
  kind: "song",
  title: "T",
  key: "C",
  ppq: 48,
  defaults: { tempo: 90, meter: { beatsPerBar: 4, beatUnit: 4 }, swing: 0, voicing: "root" },
  instruments: {
    chords: { kind: "builtin", id: "pad-v1" },
    bass: { kind: "builtin", id: "bass-v1" },
    drums: { kind: "builtin", id: "kit-v1" },
  },
  patches: {},
  sections: ["a", "b"].map((id, i) => ({
    id,
    name: id.toUpperCase(),
    bars: 2 - i,
    overrides: {},
    chords: [],
    drums: {},
    parts: { bass: [] },
    loops: [],
  })),
  arrangement: ["a", "b", "a"],
});

const ARR: PlayScope = { kind: "arrangement" };
const LOOP_B: PlayScope = { kind: "section", sectionId: "b" as never };
const pos = (arrIdx: number, bar: number, lap = 0): Position => ({ arrIdx, lap, bar });

function next(
  at: Position,
  opts: { scope?: PlayScope; advance?: Advance; cycle?: Cycle; jump?: Jump; keyJump?: number } = {},
): Playing {
  const source: EngineSource = {
    song,
    practice: {
      ...DEFAULT_PRACTICE,
      advance: opts.advance ?? "auto",
      cycle: opts.cycle ?? { kind: "fourths" },
    },
  };
  const t: Playing = { status: "playing", scope: opts.scope ?? ARR, at };
  if (opts.jump) t.jump = opts.jump;
  if (opts.keyJump !== undefined) t.keyJump = opts.keyJump;
  return nextPosition(source, t);
}

describe("nextPosition", () => {
  it.each<[string, Position, Parameters<typeof next>[1], Position]>([
    // Auto advance through the arrangement; the lap ends after the last entry.
    ["next bar in the section", pos(0, 0), {}, pos(0, 1)],
    ["next arrangement entry", pos(0, 1), {}, pos(1, 0)],
    ["end of arrangement → next lap", pos(2, 1, 3), {}, pos(0, 0, 4)],
    ["laps wrap around the cycle", pos(2, 1, 11), {}, pos(0, 0, 0)],
    ["no cycle: lap stays 0", pos(2, 1), { cycle: { kind: "none" } }, pos(0, 0, 0)],
    // Looping one section: each pass is a lap.
    ["section loop: end → bar 0, next lap", pos(1, 0, 2), { scope: LOOP_B }, pos(1, 0, 3)],
    // Manual advance: the section repeats and the key holds.
    ["manual: within the section", pos(0, 0), { advance: "manual" }, pos(0, 1)],
    ["manual: end repeats, same lap", pos(0, 1, 5), { advance: "manual" }, pos(0, 0, 5)],
    ["manual: end of the last entry repeats too", pos(2, 1), { advance: "manual" }, pos(2, 0)],
    [
      "manual section loop: key holds",
      pos(1, 0, 2),
      { advance: "manual", scope: LOOP_B },
      pos(1, 0, 2),
    ],
    // Jumps land at the next bar.
    [
      "section jump waits for the section to finish",
      pos(0, 0),
      { jump: { kind: "section", arrIdx: 2 } },
      pos(0, 1),
    ],
    [
      "section jump at the end of the section",
      pos(0, 1),
      { jump: { kind: "section", arrIdx: 2 } },
      pos(2, 0),
    ],
    [
      "section jump to the playing entry: finish, then start it again",
      pos(0, 1),
      { jump: { kind: "section", arrIdx: 0 } },
      pos(0, 0),
    ],
    [
      "chord jump lands on its bar",
      pos(1, 0),
      { jump: { kind: "chord", arrIdx: 0, bar: 1, chordIndex: 3 } },
      pos(0, 1),
    ],
    [
      "jump in manual advance",
      pos(0, 1),
      { advance: "manual", jump: { kind: "section", arrIdx: 1 } },
      pos(1, 0),
    ],
    [
      "jump at the end of a lap: the lap still ends",
      pos(2, 1, 1),
      { jump: { kind: "section", arrIdx: 1 } },
      pos(1, 0, 2),
    ],
    // Key jumps land at the end of the lap.
    ["key jump waits for the lap to end", pos(0, 1), { keyJump: 7 }, pos(1, 0)],
    ["key jump at the end of the lap", pos(2, 1, 1), { keyJump: 7 }, pos(0, 0, 7)],
    [
      "key jump in manual: at the end of the section",
      pos(0, 1, 1),
      { advance: "manual", keyJump: 4 },
      pos(0, 0, 4),
    ],
    ["key jump to the current key repeats it", pos(2, 1, 3), { keyJump: 3 }, pos(0, 0, 3)],
  ])("%s", (_label, at, opts, expected) => {
    expect(next(at, opts).at).toEqual(expected);
  });

  it("keeps a section jump queued until the section ends", () => {
    const jump = { kind: "section", arrIdx: 2 } as const;
    expect(next(pos(0, 0), { jump })).toMatchObject({ at: pos(0, 1), jump });
  });

  it("keeps a key jump queued until the lap ends, clears jumps once landed", () => {
    expect(next(pos(0, 0), { keyJump: 2 })).toMatchObject({ keyJump: 2 });
    expect(next(pos(2, 1), { keyJump: 2 }).keyJump).toBeUndefined();
    expect(next(pos(0, 1), { jump: { kind: "section", arrIdx: 1 } }).jump).toBeUndefined();
    expect(
      next(pos(0, 0), { jump: { kind: "chord", arrIdx: 1, bar: 0, chordIndex: 0 } }).jump,
    ).toBeUndefined();
  });

  it("keeps the scope", () => {
    expect(next(pos(1, 0), { scope: LOOP_B }).scope).toEqual(LOOP_B);
  });
});

describe("clampPosition", () => {
  it.each<[string, Position, PlayScope, Position]>([
    ["valid position unchanged", pos(2, 1, 4), ARR, pos(2, 1, 4)],
    ["missing arrangement entry → first", pos(9, 1), ARR, pos(0, 1)],
    ["bar past the section end → bar 0", pos(1, 1), ARR, pos(1, 0)],
    ["section scope checks the looped section", pos(0, 1), LOOP_B, pos(0, 0)],
    ["negative values → 0", pos(-1, -1, -1), ARR, pos(0, 0, 0)],
  ])("%s", (_label, at, scope, expected) => {
    expect(clampPosition(song, at, scope)).toEqual(expected);
  });
});

describe("changeScope", () => {
  const LOOP_A: PlayScope = { kind: "section", sectionId: "a" as never };
  it.each<[string, Position, PlayScope, PlayScope, Position]>([
    ["into a loop: keeps bar and arrIdx", pos(2, 1, 3), ARR, LOOP_A, pos(2, 1, 3)],
    ["into a loop: bar that doesn't fit → 0", pos(0, 1), ARR, LOOP_B, pos(0, 0)],
    ["out of a loop: back to the same entry", pos(2, 1), LOOP_A, ARR, pos(2, 1)],
    ["out of a loop: else the section's first entry", pos(1, 0), LOOP_A, ARR, pos(0, 0)],
    ["out of a loop: B's only entry", pos(0, 0), LOOP_B, ARR, pos(1, 0)],
  ])("%s", (_label, at, from, to, expected) => {
    expect(changeScope(song, at, from, to)).toEqual(expected);
  });
});
