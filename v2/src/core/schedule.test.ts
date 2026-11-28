import { describe, expect, it } from "vitest";
import type { EngineSource, PlayScope, Position } from "../model/runtime";
import { Song, type NoteEvent, type Pitch, type Practice } from "../model/schema";
import { generateSong } from "./generate";
import { scheduleBar, swingTick } from "./schedule";
import { DEFAULT_PRACTICE } from "./settings";
import { STYLES } from "./styles";

const ARR: PlayScope = { kind: "arrangement" };
const at = (arrIdx: number, bar: number, lap = 0): Position => ({ arrIdx, lap, bar });

/** A minimal song in C: one section, chords given, no drums or bass unless added. */
function song(edit: (s: Song) => void = () => {}): Song {
  const s: Song = Song.parse({
    version: 2,
    kind: "song",
    title: "T",
    key: "C",
    ppq: 48,
    defaults: {
      tempo: 90,
      meter: { beatsPerBar: 4, beatUnit: 4 },
      swing: 0,
      voicing: "voice-lead",
    },
    instruments: {
      chords: { kind: "builtin", id: "pad-v1" },
      bass: { kind: "builtin", id: "bass-v1" },
      drums: { kind: "builtin", id: "kit-v1" },
    },
    patches: {},
    sections: [
      {
        id: "s",
        name: "S",
        bars: 2,
        overrides: {},
        chords: [
          { start: 0, duration: 96, root: { degree: 1 }, quality: "major" },
          { start: 96, duration: 192, root: { degree: 4 }, quality: "major" },
        ],
        drums: {},
        parts: { bass: [] },
        loops: [],
      },
    ],
    arrangement: ["s"],
  });
  edit(s);
  return Song.parse(s);
}
const src = (s: Song, practice: Practice = DEFAULT_PRACTICE): EngineSource => ({
  song: s,
  practice,
});
const note = (start: number, pitch: Pitch): NoteEvent => ({ start, duration: 24, pitch });

describe("swingTick", () => {
  it.each([
    [0, 1, 0],
    [24, 1, 32],
    [12, 1, 16],
    [36, 1, 40],
    [48, 1, 48],
    [72, 0.5, 76],
    [24, 0, 24],
  ])("tick %d at swing %d → %d", (t, amount, expected) => {
    expect(swingTick(t, amount)).toBe(expected);
  });
});

describe("chords", () => {
  it("schedules chords starting in the bar, and marks one held from an earlier bar", () => {
    const s = src(song());
    const bar0 = scheduleBar(s, at(0, 0), ARR);
    expect(bar0.chords.map((c) => [c.time, c.duration, c.chordIndex, c.continued])).toEqual([
      [0, 96, 0, false],
      [96, 192, 1, false],
    ]);
    const bar1 = scheduleBar(s, at(0, 1), ARR, bar0.voicing);
    expect(bar1.chords.map((c) => [c.time, c.duration, c.chordIndex, c.continued])).toEqual([
      [0, 96, 1, true],
    ]);
    // A held chord keeps its notes when voice-leading continues.
    expect(bar1.chords[0]!.midi).toEqual(bar0.chords[1]!.midi);
  });

  it("voices C major in root position, F voice-led toward it (v1 registers)", () => {
    const bar = scheduleBar(src(song()), at(0, 0), ARR);
    expect(bar.chords[0]!.midi).toEqual([48, 60, 64, 67]);
    expect(bar.chords[1]!.midi).toEqual([53, 60, 65, 69]); // F/C-shaped: closest to C E G
    expect(bar.voicing).toEqual([60, 65, 69]);
  });

  it("root voicing never voice-leads and returns no voicing", () => {
    const s = src(song((x) => (x.defaults.voicing = "root")));
    const bar = scheduleBar(s, at(0, 0), ARR, [60, 64, 67]);
    expect(bar.chords[1]!.midi).toEqual([53, 65, 69, 72]);
    expect(bar.voicing).toBeUndefined();
  });

  it("voice-lead-loop starts fresh on the first bar of a lap; voice-lead carries on", () => {
    const prev = [65, 69, 72];
    const loop = src(song((x) => (x.defaults.voicing = "voice-lead-loop")));
    expect(scheduleBar(loop, at(0, 0), ARR, prev).chords[0]!.midi).toEqual([48, 60, 64, 67]);
    const lead = src(song());
    expect(scheduleBar(lead, at(0, 0), ARR, prev).chords[0]!.midi).toEqual([48, 64, 67, 72]);
  });

  it("transposes by lap key, staying within a tritone of the first key", () => {
    const fourths = src(song(), { ...DEFAULT_PRACTICE, cycle: { kind: "fourths" } });
    const lap = (n: number) => scheduleBar(fourths, at(0, 0, n), ARR);
    expect(lap(1).key).toBe("F");
    expect(lap(1).chords[0]!.midi).toEqual([53, 65, 69, 72]);
    expect(lap(2).key).toBe("Bb");
    expect(lap(2).chords[0]!.midi[0]).toBe(46); // Bb below C, not above
  });
});

describe("bass", () => {
  const withBass = (notes: NoteEvent[], edit: (s: Song) => void = () => {}) =>
    src(
      song((x) => {
        x.sections[0].parts.bass = notes;
        edit(x);
      }),
    );

  it("resolves chord tones two octaves below the chord register", () => {
    const s = withBass([
      note(0, { kind: "chordTone", tone: 1 }),
      note(24, { kind: "chordTone", tone: 3 }),
      note(48, { kind: "chordTone", tone: 5, octave: 1 }),
      note(96, { kind: "chordTone", tone: 7 }), // under F: maj7 of a major triad
    ]);
    expect(scheduleBar(s, at(0, 0), ARR).parts.bass.map((n) => n.midi)).toEqual([36, 40, 55, 52]);
  });

  it("resolves scale degrees and chromatic notes from the tonic, not the chord", () => {
    const s = withBass([
      note(96, { kind: "scaleDegree", step: { degree: 5 } }),
      note(120, { kind: "scaleDegree", step: { degree: 7, accidental: -1 }, octave: -1 }),
      note(144, { kind: "chromatic", semitones: 3 }),
    ]);
    expect(scheduleBar(s, at(0, 0), ARR).parts.bass.map((n) => n.midi)).toEqual([43, 34, 39]);
  });

  it("plays a slash chord's bass note as tone 1, nearest the chord's bass root", () => {
    const s = withBass(
      [note(96, { kind: "chordTone", tone: 1 }), note(120, { kind: "chordTone", tone: 3 })],
      (x) => (x.sections[0].chords[1]!.bass = { degree: 1 }),
    );
    // IV/I in C: F's bass root is 41; the nearest C is 36 (5 below). The 3rd stays with F (A = 45).
    expect(scheduleBar(s, at(0, 0), ARR).parts.bass.map((n) => n.midi)).toEqual([36, 45]);
    // IV/VI: the nearest A is 45 (4 above F).
    const up = withBass(
      [note(96, { kind: "chordTone", tone: 1 })],
      (x) => (x.sections[0].chords[1]!.bass = { degree: 6 }),
    );
    expect(scheduleBar(up, at(0, 0), ARR).parts.bass.map((n) => n.midi)).toEqual([45]);
  });

  it("skips chord tones where no chord sounds; key-relative notes still play", () => {
    const s = withBass(
      [note(0, { kind: "chordTone", tone: 1 }), note(24, { kind: "chromatic", semitones: 0 })],
      (x) => x.sections[0].chords.shift(),
    );
    expect(scheduleBar(s, at(0, 0), ARR).parts.bass.map((n) => [n.time, n.midi])).toEqual([
      [24, 36],
    ]);
  });

  it("swings off-beat notes and their lengths", () => {
    const s = withBass(
      [note(24, { kind: "chromatic", semitones: 0 })],
      (x) => (x.defaults.swing = 1),
    );
    expect(scheduleBar(s, at(0, 0), ARR).parts.bass[0]).toMatchObject({ time: 32, duration: 16 });
  });
});

describe("drums, meter, settings, loops", () => {
  it("orders hits by time, then kit order", () => {
    const s = src(
      song((x) => {
        x.sections[0].drums = { hat: [0, 24, 192], snare: [24], kick: [0] };
      }),
    );
    expect(scheduleBar(s, at(0, 0), ARR).drums.map((h) => `${h.time}${h.drum}`)).toEqual([
      "0kick",
      "0hat",
      "24snare",
      "24hat",
    ]);
  });

  it("uses the section's overrides: meter (bar length), tempo, instruments", () => {
    const s = src(
      song((x) => {
        x.sections[0].overrides = {
          meter: { beatsPerBar: 6, beatUnit: 8 },
          tempo: 120,
          instruments: { drums: { kind: "builtin", id: "kit-v1" } },
        };
        x.sections[0].chords = [{ start: 0, duration: 288, root: { degree: 1 }, quality: "major" }];
        x.sections[0].drums = { kick: [0, 144] };
      }),
    );
    const bar1 = scheduleBar(s, at(0, 1), ARR);
    expect(bar1).toMatchObject({ length: 144, tempo: 120, meter: { beatsPerBar: 6, beatUnit: 8 } });
    expect(bar1.drums).toEqual([
      { time: 0, drum: "kick", instrument: { kind: "builtin", id: "kit-v1" } },
    ]);
    expect(bar1.chords[0]).toMatchObject({ time: 0, duration: 144, continued: true });
  });

  it("plays unmuted takes while they last, starting on the section's first bar", () => {
    const s = src(
      song((x) => {
        x.sections[0].loops = [
          {
            id: "a" as never,
            name: "A",
            bars: 2,
            gain: 0.5,
            recorded: { key: "C", tempo: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
          },
          {
            id: "b" as never,
            name: "B",
            bars: 1,
            gain: 1,
            recorded: { key: "C", tempo: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
          },
          {
            id: "c" as never,
            name: "C",
            bars: 2,
            gain: 1,
            muted: true,
            recorded: { key: "C", tempo: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
          },
        ];
      }),
    );
    expect(scheduleBar(s, at(0, 0), ARR).loops).toEqual([
      { takeId: "a", gain: 0.5, bars: 2, barInTake: 0 },
      { takeId: "b", gain: 1, bars: 1, barInTake: 0 },
    ]);
    expect(scheduleBar(s, at(0, 1), ARR).loops).toEqual([
      { takeId: "a", gain: 0.5, bars: 2, barInTake: 1 },
    ]);
  });

  it("plays no loops while a cycle is on (a take is in one key)", () => {
    const withTake = song((x) => {
      x.sections[0].loops = [
        {
          id: "a" as never,
          name: "A",
          bars: 2,
          gain: 1,
          recorded: { key: "C", tempo: 120, meter: { beatsPerBar: 4, beatUnit: 4 } },
        },
      ];
    });
    const cycling = { ...DEFAULT_PRACTICE, cycle: { kind: "fourths" as const } };
    expect(scheduleBar({ song: withTake, practice: cycling }, at(0, 0), ARR).loops).toEqual([]);
  });

  it("plays the looped section in section scope", () => {
    const bt = generateSong(
      {
        version: 2,
        kind: "backingTrack",
        title: "T",
        key: "D",
        tempo: 80,
        style: { kind: "builtin", id: "pop" },
        drums: "simple",
        bass: "simple",
        voicing: "root",
        sections: [
          { id: "a" as never, name: "A", progression: "I", barsPerChord: 1 },
          { id: "b" as never, name: "B", progression: "V", barsPerChord: 1 },
        ],
        arrangement: ["a" as never],
      },
      STYLES,
    );
    const bar = scheduleBar(src(bt), at(0, 0), { kind: "section", sectionId: "b" as never });
    expect(bar.sectionId).toBe("b");
    expect(bar.chords[0]!.midi).toEqual([57, 69, 73, 76]); // A major in D
  });

  it("rejects a bar outside the section", () => {
    expect(() => scheduleBar(src(song()), at(0, 2), ARR)).toThrow(/outside section/);
  });
});
