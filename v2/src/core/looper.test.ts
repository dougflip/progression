import { describe, expect, it } from "vitest";
import type { EngineSource } from "../model/runtime";
import {
  BackingTrack,
  Song,
  type LoopTake,
  type Practice,
  type SectionId,
  type ShareEnvelope,
  type TakeId,
} from "../model/schema";
import {
  addTake,
  alignTake,
  docTakeIds,
  nextTakeName,
  recordAvailability,
  removeTake,
  sectionTakes,
  takeShape,
  takeWarnings,
  updateTake,
  withoutTakes,
} from "./looper";
import { DEFAULT_PRACTICE } from "./settings";

const sid = (s: string) => s as SectionId;
const tid = (s: string) => s as TakeId;
const FOUR = { beatsPerBar: 4, beatUnit: 4 } as const;

const song = Song.parse({
  version: 2,
  kind: "song",
  title: "Looper",
  key: "G",
  ppq: 48,
  defaults: { tempo: 120, meter: FOUR, swing: 0, voicing: "voice-lead" },
  instruments: {},
  patches: {},
  sections: [
    {
      id: "verse",
      name: "Verse",
      bars: 4,
      overrides: {},
      chords: [],
      drums: {},
      parts: { bass: [] },
      loops: [],
    },
    {
      id: "waltz",
      name: "Waltz",
      bars: 2,
      overrides: { tempo: 90, meter: { beatsPerBar: 3, beatUnit: 4 } },
      chords: [],
      drums: {},
      parts: { bass: [] },
      loops: [],
    },
  ],
  arrangement: ["verse", "waltz"],
});
const backing = BackingTrack.parse({
  version: 2,
  kind: "backingTrack",
  title: "Jam",
  key: "C",
  tempo: 100,
  style: { kind: "builtin", id: "rock" },
  drums: "simple",
  bass: "simple",
  voicing: "voice-lead",
  sections: [{ id: "a", name: "A", progression: "I IV V I", barsPerChord: 1 }],
  arrangement: ["a"],
});
const source = (practice = DEFAULT_PRACTICE): EngineSource => ({ song, practice });
const take = (id: string, over: Partial<LoopTake> = {}): LoopTake => ({
  id: tid(id),
  name: `Take ${id}`,
  bars: 4,
  gain: 1,
  recorded: { key: "G", tempo: 120, meter: { ...FOUR } },
  ...over,
});

describe("recordAvailability", () => {
  it("is available without a cycle, not with one", () => {
    expect(recordAvailability(source())).toEqual({ kind: "available" });
    const cycles: Practice["cycle"][] = [
      { kind: "fourths" },
      { kind: "fifths" },
      { kind: "custom", keys: ["C"] },
    ];
    for (const cycle of cycles) {
      expect(recordAvailability(source({ ...DEFAULT_PRACTICE, cycle }))).toEqual({
        kind: "unavailable",
        reason: "cycle",
      });
    }
  });
});

describe("takeShape", () => {
  it("is one pass of the section at its current tempo and meter", () => {
    expect(takeShape(source(), sid("verse"))).toEqual({
      bars: 4,
      seconds: 8, // 4 bars of 4/4 at 120
      recorded: { key: "G", tempo: 120, meter: FOUR },
    });
    expect(takeShape(source(), sid("waltz"))).toMatchObject({
      bars: 2,
      seconds: 4, // 2 bars of 3/4 at 90: 6 beats of 2/3 s
      recorded: { tempo: 90, meter: { beatsPerBar: 3, beatUnit: 4 } },
    });
  });
});

describe("alignTake", () => {
  const rec = Float32Array.from({ length: 10 }, (_, i) => i + 1); // 1..10

  it("starts at bar 1 plus the offset and keeps exactly `length` samples", () => {
    expect([...alignTake(rec, 2, 0, 4)]).toEqual([3, 4, 5, 6]);
    expect([...alignTake(rec, 2, 3, 4)]).toEqual([6, 7, 8, 9]); // latency: sound came later
  });

  it("pads with silence where the recording runs out (either end)", () => {
    expect([...alignTake(rec, 8, 0, 4)]).toEqual([9, 10, 0, 0]);
    expect([...alignTake(rec, 0, -2, 4)]).toEqual([0, 0, 1, 2]);
    expect([...alignTake(rec, 20, 0, 3)]).toEqual([0, 0, 0]);
  });
});

describe("takeWarnings", () => {
  it("is empty when nothing changed", () => {
    expect(takeWarnings(take("1"), source(), sid("verse"))).toEqual([]);
  });

  it("flags key, tempo and meter changes since recording", () => {
    const old = take("1", {
      recorded: { key: "C", tempo: 100, meter: { beatsPerBar: 3, beatUnit: 4 } },
    });
    expect(takeWarnings(old, source(), sid("verse"))).toEqual([
      { kind: "keyChanged", recorded: "C", now: "G" },
      { kind: "tempoChanged", recorded: 100, now: 120 },
      { kind: "meterChanged", recorded: "3/4", now: "4/4" },
    ]);
  });
});

describe("take edits", () => {
  it("add, update and remove takes on songs", () => {
    const one = addTake(song, sid("verse"), take("1"));
    const two = addTake(one, sid("verse"), take("2"));
    expect(sectionTakes(two, sid("verse")).map((t) => t.id)).toEqual(["1", "2"]);
    expect(sectionTakes(song, sid("verse"))).toEqual([]); // the original is untouched

    const muted = updateTake(two, sid("verse"), tid("1"), { muted: true, gain: 0.5 });
    expect(sectionTakes(muted, sid("verse"))[0]).toMatchObject({ muted: true, gain: 0.5 });
    expect(sectionTakes(removeTake(muted, sid("verse"), tid("1")), sid("verse"))).toHaveLength(1);
    expect(Song.safeParse(two).error).toBeUndefined();
  });

  it("work on backing tracks, whose sections may have no takes yet", () => {
    expect(sectionTakes(backing, sid("a"))).toEqual([]);
    const next = addTake(backing, sid("a"), take("1"));
    expect(sectionTakes(next, sid("a"))).toHaveLength(1);
    expect(BackingTrack.safeParse(next).error).toBeUndefined();
    expect(docTakeIds(next)).toEqual(["1"]);
  });

  it("throw for an unknown section", () => {
    expect(() => addTake(song, sid("nope"), take("1"))).toThrow('no section with id "nope"');
  });

  it("name new takes after the ones already there", () => {
    expect(nextTakeName([])).toBe("Take 1");
    expect(nextTakeName([take("a", { name: "Take 2" })])).toBe("Take 3");
  });
});

describe("withoutTakes", () => {
  it("drops every take from a shared envelope (songs and backing tracks)", () => {
    const s: ShareEnvelope = { version: 2, doc: addTake(song, sid("verse"), take("1")) };
    const b: ShareEnvelope = { version: 2, doc: addTake(backing, sid("a"), take("1")) };
    expect(docTakeIds(withoutTakes(s).doc)).toEqual([]);
    expect(docTakeIds(withoutTakes(b).doc)).toEqual([]);
    expect(docTakeIds(s.doc)).toEqual(["1"]); // the original keeps them
  });
});
