import { describe, expect, it } from "vitest";
import { BUILTIN_PATCHES } from "../model/patches";
import type { SampleSet } from "../model/sampleSets";
import type { Patch, PatchId, SampleSetId, Song } from "../model/schema";
import { DEFAULT_INSTRUMENTS } from "../model/schema";
import {
  instrumentKey,
  instrumentSpec,
  instrumentsToDispose,
  songInstrumentKeys,
  songSampleSets,
  tailSeconds,
  type InstrumentSpec,
} from "./instruments";

const PAD = BUILTIN_PATCHES["pad-v1"];
const BASS = BUILTIN_PATCHES["bass-v1"];
const PIANO: Patch = {
  kind: "sampler",
  role: "chords",
  set: "test-piano" as SampleSetId,
  volume: 0,
};
const SETS: Record<string, SampleSet> = {
  "test-piano": {
    id: "test-piano",
    role: "chords",
    path: "test-piano/",
    notes: { 60: "c4.wav" },
    attack: 0,
    release: 0.8,
    licence: "test",
    credit: "test",
    source: "test",
  },
};

/** A minimal song: only the fields these functions read. */
function song(over: Partial<Song> = {}): Song {
  return {
    instruments: DEFAULT_INSTRUMENTS,
    patches: {},
    sections: [{ overrides: {} }],
    ...over,
  } as unknown as Song;
}
const id = (s: string) => s as PatchId;

describe("instrumentSpec", () => {
  it("resolves built-ins to their patch data, and the kit to code", () => {
    const s = song();
    expect(instrumentSpec(s, "chords", { kind: "builtin", id: "pad-v1" })).toEqual({
      kind: "patch",
      role: "chords",
      patch: PAD,
    });
    expect(instrumentSpec(s, "drums", { kind: "builtin", id: "kit-v1" })).toEqual({
      kind: "kit",
      id: "kit-v1",
    });
  });

  it("resolves custom patches from the song", () => {
    const s = song({ patches: { warm: BASS } as Song["patches"] });
    expect(instrumentSpec(s, "bass", { kind: "custom", id: id("warm") })).toEqual({
      kind: "patch",
      role: "bass",
      patch: BASS,
    });
  });

  it.each<
    [string, Parameters<typeof instrumentSpec>[1], Parameters<typeof instrumentSpec>[2], string]
  >([
    ["missing custom patch", "bass", { kind: "custom", id: id("nope") }, 'no patch with id "nope"'],
    ["patch in the wrong role", "bass", { kind: "builtin", id: "pad-v1" }, "can't play bass"],
    ["patch on drums", "drums", { kind: "builtin", id: "bass-v1" }, "drums need a kit"],
    ["kit on chords", "chords", { kind: "builtin", id: "kit-v1" }, "can't play chords"],
  ])("throws on a %s (validation rejects these)", (_, role, ref, message) => {
    expect(() => instrumentSpec(song(), role, ref)).toThrow(message);
  });
});

describe("instrumentKey", () => {
  const spec = (patch: Patch): InstrumentSpec => ({ kind: "patch", role: patch.role, patch });

  it("is the same for equal patches, whatever their key order", () => {
    const reordered = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(BASS).reverse())),
    ) as Patch;
    expect(instrumentKey(spec(reordered))).toBe(instrumentKey(spec(BASS)));
  });

  it("changes when any parameter changes (an edited patch is a new instrument)", () => {
    expect(instrumentKey(spec({ ...BASS, volume: -7 }))).not.toBe(instrumentKey(spec(BASS)));
  });
});

describe("songInstrumentKeys and songSampleSets", () => {
  const s = song({
    patches: { piano: PIANO, warm: BASS } as Song["patches"],
    instruments: { ...DEFAULT_INSTRUMENTS, bass: { kind: "custom", id: id("warm") } },
    sections: [
      { overrides: {} },
      { overrides: { instruments: { chords: { kind: "custom", id: id("piano") } } } },
    ] as unknown as Song["sections"],
  });

  it("include the defaults and every section override", () => {
    const keys = songInstrumentKeys(s);
    expect(keys).toEqual(
      new Set([
        instrumentKey({ kind: "patch", role: "chords", patch: PAD }),
        instrumentKey({ kind: "patch", role: "bass", patch: BASS }),
        instrumentKey({ kind: "kit", id: "kit-v1" }),
        instrumentKey({ kind: "patch", role: "chords", patch: PIANO }),
      ]),
    );
  });

  it("list each sample set once", () => {
    expect(songSampleSets(s)).toEqual(["test-piano"]);
    expect(songSampleSets(song())).toEqual([]);
  });
});

describe("tailSeconds", () => {
  it("is the release plus reverb decay", () => {
    expect(tailSeconds({ kind: "patch", role: "chords", patch: PAD }, SETS)).toBeCloseTo(1.5 + 2.5);
    expect(tailSeconds({ kind: "patch", role: "bass", patch: BASS }, SETS)).toBeCloseTo(0.3);
  });

  it("uses a sampler's own release, else its set's", () => {
    const spec = (patch: Patch): InstrumentSpec => ({ kind: "patch", role: "chords", patch });
    expect(tailSeconds(spec(PIANO), SETS)).toBe(0.8);
    expect(tailSeconds(spec({ ...PIANO, release: 2 }), SETS)).toBe(2);
  });
});

describe("instrumentsToDispose", () => {
  const inSong = new Set(["a"]);
  it("disposes only instruments the song no longer uses, once silent", () => {
    const uses = [
      { key: "a", lastEnd: 0, tail: 0 }, // still in the song: kept
      { key: "b", lastEnd: 1, tail: 1 }, // replaced, silent after 2
      { key: "c", lastEnd: 5, tail: 1 }, // replaced, still ringing
    ];
    expect(instrumentsToDispose(uses, inSong, 3)).toEqual(["b"]);
    expect(instrumentsToDispose(uses, inSong, 1.5)).toEqual([]);
  });
});
