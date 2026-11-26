import { describe, expect, it } from "vitest";
import type { PlayScope } from "../model/runtime";
import { BackingTrack, Song, type SectionId } from "../model/schema";
import { generateSong } from "./generate";
import { DEFAULT_PRACTICE } from "./settings";
import { STYLES } from "./styles";
import { playerView, sectionSettings } from "./view";

const ARR: PlayScope = { kind: "arrangement" };
const id = (s: string) => s as SectionId;

const bt = BackingTrack.parse({
  version: 2,
  kind: "backingTrack",
  title: "Recipe",
  key: "Eb",
  tempo: 100,
  style: { kind: "builtin", id: "pop" },
  drums: "simple",
  bass: "simple",
  voicing: "root",
  sections: [
    { id: "a", name: "Verse", progression: "I bVII7:1 IV/I:2", barsPerChord: 2 },
    { id: "b", name: "Chorus", progression: "vi", barsPerChord: 1, bass: "busy", tempo: 120 },
  ],
  arrangement: ["a", "b", "a"],
});

describe("sectionSettings", () => {
  it("backing track: marks section overrides, everything else comes from the recipe", () => {
    expect(sectionSettings(bt, id("b"))).toEqual({
      kind: "backingTrack",
      style: { value: { kind: "builtin", id: "pop" }, from: "song" },
      drums: { value: "simple", from: "song" },
      bass: { value: "busy", from: "section" },
      tempo: { value: 120, from: "section" },
      voicing: { value: "root", from: "song" },
    });
  });

  it("song: marks overrides per setting and per instrument", () => {
    const song = structuredClone(generateSong(bt, STYLES)) as Song;
    song.sections[0].overrides = {
      swing: 0.5,
      instruments: { bass: { kind: "builtin", id: "pad-v1" } },
    };
    const s = sectionSettings(Song.parse(song), id("a"));
    expect(s).toMatchObject({
      kind: "song",
      tempo: { value: 100, from: "song" },
      swing: { value: 0.5, from: "section" },
      instruments: {
        chords: { value: { id: "pad-v1" }, from: "song" },
        bass: { value: { id: "pad-v1" }, from: "section" },
      },
    });
  });

  it("the generated song loses which settings were overridden; the recipe keeps it", () => {
    // Why views take the doc, not the generated song: the seed holds resolved values.
    const fromSong = sectionSettings(generateSong(bt, STYLES), id("b"));
    expect(fromSong.kind === "song" && fromSong.tempo.from).toBe("section");
    expect(sectionSettings(bt, id("b"))).toMatchObject({ bass: { from: "section" } });
  });
});

describe("playerView", () => {
  it("shows the section, chips with numerals, names and bar spans", () => {
    const v = playerView(bt, DEFAULT_PRACTICE, { arrIdx: 0, lap: 0, bar: 2 }, ARR, STYLES);
    expect(v).toMatchObject({
      title: "Recipe",
      kind: "backingTrack",
      key: "Eb",
      keys: ["Eb"],
      lap: 0,
      arrIdx: 0,
      section: { id: "a", name: "Verse", bars: 5, bar: 2 },
      meter: { beatsPerBar: 4, beatUnit: 4 },
      barLength: 192,
    });
    expect(v.chips.map((c) => [c.numeral, c.name, c.bars])).toEqual([
      ["I", "Eb", [0, 1]],
      ["bVII7", "Db7", [2]],
      ["IV/I", "Ab/Eb", [3, 4]],
    ]);
    expect(v.arrangement.map((e) => `${e.arrIdx}:${e.name}`)).toEqual([
      "0:Verse",
      "1:Chorus",
      "2:Verse",
    ]);
  });

  it("names chords in the lap's key while cycling", () => {
    const practice = { ...DEFAULT_PRACTICE, cycle: { kind: "fifths" as const } };
    const v = playerView(bt, practice, { arrIdx: 1, lap: 1, bar: 0 }, ARR, STYLES);
    expect(v.keys[0]).toBe("D#"); // fifths spell with sharps
    expect(v).toMatchObject({ key: "A#", lap: 1 });
    expect(v.chips[0]!.name).toBe("Gm");
  });

  it("has no current arrangement entry while looping a section", () => {
    const v = playerView(
      bt,
      DEFAULT_PRACTICE,
      { arrIdx: 0, lap: 0, bar: 0 },
      { kind: "section", sectionId: id("b") },
      STYLES,
    );
    expect(v.arrIdx).toBeUndefined();
    expect(v.section.name).toBe("Chorus");
  });

  it("gives sub-bar chords and chords in other meters the right bars", () => {
    const song = Song.parse({
      ...structuredClone(generateSong(bt, STYLES)),
      sections: [
        {
          ...structuredClone(generateSong(bt, STYLES).sections[0]),
          overrides: { meter: { beatsPerBar: 3, beatUnit: 4 } },
          bars: 3,
          chords: [
            { start: 0, duration: 72, root: { degree: 1 }, quality: "major" },
            { start: 72, duration: 216, root: { degree: 5 }, quality: "major" },
            { start: 288, duration: 144, root: { degree: 4 }, quality: "major" },
          ],
          drums: {},
          parts: { bass: [] },
        },
        structuredClone(generateSong(bt, STYLES).sections[1]),
      ],
    });
    const v = playerView(song, DEFAULT_PRACTICE, { arrIdx: 0, lap: 0, bar: 0 }, ARR, STYLES);
    expect(v.barLength).toBe(144);
    expect(v.chips.map((c) => c.bars)).toEqual([[0], [0, 1], [2]]);
  });
});
