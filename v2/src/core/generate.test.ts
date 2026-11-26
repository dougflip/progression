import { describe, expect, it } from "vitest";
import { BackingTrack, Song, type SectionId, type SectionSeed } from "../model/schema";
import { generateSong, regenerateSection } from "./generate";
import { STYLES } from "./styles";

const bt = BackingTrack.parse({
  version: 2,
  kind: "backingTrack",
  title: "Test",
  key: "G",
  tempo: 100,
  style: { kind: "builtin", id: "pop" },
  drums: "simple",
  bass: "simple",
  voicing: "voice-lead",
  sections: [
    { id: "a", name: "A", progression: "I vi:1 IV/I", barsPerChord: 2 },
    {
      id: "b",
      name: "B",
      progression: "ii7 V7",
      barsPerChord: 1,
      style: { kind: "builtin", id: "rock" },
      bass: "busy",
      tempo: 120,
    },
  ],
  arrangement: ["a", "b", "a"],
});
const id = (s: string) => s as SectionId;

describe("generateSong", () => {
  const song = generateSong(bt, STYLES);

  it("produces a valid song with the recipe's settings", () => {
    expect(Song.safeParse(song).error).toBeUndefined();
    expect(song).toMatchObject({
      title: "Test",
      key: "G",
      defaults: {
        tempo: 100,
        meter: { beatsPerBar: 4, beatUnit: 4 },
        swing: 0,
        voicing: "voice-lead",
      },
      instruments: { chords: { id: "pad-v1" }, bass: { id: "bass-v1" }, drums: { id: "kit-v1" } },
      arrangement: ["a", "b", "a"],
    });
  });

  it("lays chords out by bars-per-chord and :bars", () => {
    const [a] = song.sections;
    expect(a.bars).toBe(5);
    expect(a.chords.map((c) => [c.start, c.duration])).toEqual([
      [0, 384],
      [384, 192],
      [576, 384],
    ]);
    expect(a.chords[2]).toMatchObject({ root: { degree: 4 }, bass: { degree: 1 } });
  });

  it("repeats the style's drums every bar", () => {
    const [a] = song.sections;
    expect(a.drums.kick).toEqual(
      [0, 96].flatMap((t) => [0, 1, 2, 3, 4].map((b) => b * 192 + t)).sort((x, y) => x - y),
    );
    expect(Object.keys(a.drums).sort()).toEqual(Object.keys(STYLES.pop.drums.simple).sort());
  });

  it("picks the bass phrase by the chord sounding in each bar", () => {
    const [a] = song.sections;
    const bar = (b: number) =>
      a.parts.bass.filter((n) => n.start >= b * 192 && n.start < (b + 1) * 192);
    const tones = (b: number) =>
      bar(b).map((n) => (n.pitch.kind === "chordTone" ? n.pitch.tone : 0));
    expect(tones(0)).toEqual([1, 1, 5, 1]); // I: pop simple major
    expect(tones(2)).toEqual([1, 1, 1, 1]); // vi: minor phrase
    expect(bar(2)[0]!.start).toBe(384);
  });

  it("applies section overrides: style and variants into the seed, tempo into overrides", () => {
    const b = song.sections[1]!;
    expect(b.seed).toEqual({
      progression: "ii7 V7",
      barsPerChord: 1,
      style: { kind: "builtin", id: "rock" },
      drums: "simple",
      bass: "busy",
    });
    expect(b.overrides).toEqual({ tempo: 120 });
    expect(b.drums).toEqual({
      kick: [0, 72, 96, 192, 264, 288],
      snare: [48, 144, 240, 336],
      hat: Array.from({ length: 16 }, (_, i) => i * 24),
    });
  });

  it("is deep-frozen in dev builds, so in-place edits throw", () => {
    expect(() => {
      (song.sections[0].chords[0] as { start: number }).start = 1;
    }).toThrow(TypeError);
  });

  it("caches by input identity", () => {
    expect(generateSong(bt, STYLES)).toBe(song);
    expect(generateSong(structuredClone(bt), STYLES)).not.toBe(song);
  });
});

describe("regenerateSection", () => {
  const seed: SectionSeed = {
    progression: "I IV",
    barsPerChord: 1,
    style: { kind: "builtin", id: "ballad" },
    drums: "busy",
    bass: "simple",
  };
  const base = structuredClone(generateSong(bt, STYLES));
  base.sections[0].name = "Intro";
  base.sections[0].overrides = { swing: 0.5 };
  base.sections[0].loops = [
    { id: "t1" as never, name: "Take 1", bars: 4, gain: 1 },
    { id: "t2" as never, name: "Take 2", bars: 1, gain: 0.5 },
  ];

  it("rebuilds content, keeps id, name, overrides; shortens loops to fit", () => {
    const next = regenerateSection(base, id("a"), seed, STYLES);
    expect(Song.safeParse(next).error).toBeUndefined();
    const a = next.sections[0];
    expect(a).toMatchObject({ id: "a", name: "Intro", bars: 2, overrides: { swing: 0.5 }, seed });
    expect(a.loops.map((t) => t.bars)).toEqual([2, 1]);
    expect(next.sections[1]).toEqual(base.sections[1]);
    expect(base.sections[0].bars).toBe(5); // input untouched
  });

  it("forces 4/4 when the song's default meter isn't", () => {
    const waltz = structuredClone(base);
    waltz.defaults.meter = { beatsPerBar: 3, beatUnit: 4 };
    const next = regenerateSection(waltz, id("a"), seed, STYLES);
    expect(next.sections[0].overrides.meter).toEqual({ beatsPerBar: 4, beatUnit: 4 });

    const back = regenerateSection({ ...next, defaults: base.defaults }, id("a"), seed, STYLES);
    expect(back.sections[0].overrides.meter).toBeUndefined();
  });
});
