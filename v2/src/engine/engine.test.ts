/**
 * Engine timing, rendered offline (faster than real time) on node-web-audio-api.
 * Recording instruments log every scheduled note; a click instrument checks that
 * rendered audio starts where the schedule says.
 */
import { onsets, renderOffline, useIdleOfflineContext } from "./offline"; // first: installs Web Audio for Tone
import * as Tone from "tone";
import { describe, expect, it, vi } from "vitest";
import otherside from "../../fixtures/starter-otherside.json";
import { validateEnvelope } from "../model/envelope";
import { generateSong } from "../core/generate";
import { DEFAULT_PRACTICE } from "../core/settings";
import { STYLES } from "../core/styles";
import type { EngineEvent, EngineSource } from "../model/runtime";
import { instrumentKey, tailSeconds, type InstrumentSpec } from "../core/instruments";
import { BUILTIN_PATCHES } from "../model/patches";
import type { SampleSet } from "../model/sampleSets";
import {
  BackingTrack,
  DrumInstrument,
  Song,
  type Patch,
  type PatchId,
  type Practice,
  type Role,
  type SampleSetId,
} from "../model/schema";
import { makeEngine, type EngineOptions, type ScheduledBarInfo } from "./engine";
import { makePatchFactory, type PatchFactory } from "./patches";
import { makeSampleLibrary } from "./samples";

/** The real instruments, with no sample sets. */
const builtinPatches = makePatchFactory({
  samples: makeSampleLibrary({
    baseUrl: "",
    loadBuffer: () => Promise.reject(new Error("no samples in tests")),
  }),
  random: Math.random,
});

const fixtureFiles = import.meta.glob<unknown>("../../fixtures/*.json", {
  import: "default",
  eager: true,
});
const FIXTURES = Object.entries(fixtureFiles)
  .filter(([p]) => !p.endsWith("/frozen.json"))
  .map(([p, raw]) => {
    const r = validateEnvelope(raw);
    if (!r.ok) throw new Error(`${p}: ${r.errors.join("; ")}`);
    return {
      name: p
        .split("/")
        .pop()!
        .replace(/\.json$/, ""),
      env: r.value,
    };
  });
const fixture = (name: string) => FIXTURES.find((f) => f.name === name)!.env;

type Note = {
  role: Role;
  time: number;
  duration?: number;
  midi?: number | readonly number[];
  drum?: string;
};

function recorder(log: Note[]): PatchFactory {
  return ((role: Role) => ({
    play: (midi: number | readonly number[], time: number, duration: number) =>
      log.push({ role, time, duration, midi }),
    hit: (drum: string, time: number) => log.push({ role, time, drum }),
    dispose: () => {},
  })) as unknown as PatchFactory;
}

/** Drums are a short click; chords and bass are silent. */
const clicks: PatchFactory = ((role: Role, _spec: unknown, out: Tone.InputNode) => {
  if (role !== "drums") return { play: () => {}, dispose: () => {} };
  const synth = new Tone.Synth({
    envelope: { attack: 0.001, decay: 0.01, sustain: 0, release: 0.005 },
  }).connect(out);
  let lastHit = -1; // one synth for every drum: simultaneous hits make one click
  return {
    hit: (_d: string, time: number) => {
      if (time === lastHit) return;
      lastHit = time;
      synth.triggerAttackRelease(2000, 0.01, time);
    },
    dispose: () => synth.dispose(),
  };
}) as unknown as PatchFactory;

/** A song: one section per entry of `bars`, a held chord per section, kick on every beat. */
function song(
  tempo: number,
  sections: { bars: number; beatsPerBar?: number; tempo?: number }[] = [{ bars: 1 }],
): Song {
  return Song.parse({
    version: 2,
    kind: "song",
    title: "Timing",
    key: "C",
    ppq: 48,
    defaults: { tempo, meter: { beatsPerBar: 4, beatUnit: 4 }, swing: 0, voicing: "voice-lead" },
    instruments: {
      chords: { kind: "builtin", id: "pad-v1" },
      bass: { kind: "builtin", id: "bass-v1" },
      drums: { kind: "builtin", id: "kit-v1" },
    },
    patches: {},
    sections: sections.map((s, i) => {
      const beats = s.beatsPerBar ?? 4;
      const length = s.bars * beats * 48;
      const overrides: Record<string, unknown> = {};
      if (s.beatsPerBar) overrides.meter = { beatsPerBar: beats, beatUnit: 4 };
      if (s.tempo) overrides.tempo = s.tempo;
      return {
        id: `s${i}`,
        name: `S${i}`,
        bars: s.bars,
        overrides,
        chords: [{ start: 0, duration: length, root: { degree: 1 + (i % 7) }, quality: "major" }],
        drums: { kick: Array.from({ length: s.bars * beats }, (_, b) => b * 48) },
        parts: { bass: [] },
        loops: [],
      };
    }),
    arrangement: sections.map((_, i) => `s${i}`),
  });
}

/** Plays `src` offline for `seconds`; `script` can schedule actions at audio times. */
async function run(
  seconds: number,
  src: () => EngineSource,
  opts: EngineOptions & {
    script?: (e: ReturnType<typeof makeEngine>, at: (t: number, fn: () => void) => void) => void;
  } = {},
) {
  const bars: ScheduledBarInfo[] = [];
  const notes: Note[] = [];
  const events: { e: EngineEvent; time: number }[] = [];
  let engine!: ReturnType<typeof makeEngine>;
  let audibleTime = NaN; // set while a UI callback runs (here: immediately, with its time)
  const audio = await renderOffline(seconds, () => {
    engine = makeEngine({
      patches: recorder(notes),
      atAudibleTime: (fn, time) => {
        audibleTime = time;
        fn();
        audibleTime = NaN;
      },
      onBarScheduled: (b) => bars.push(b),
      ...opts,
    });
    engine.subscribe((e) => void events.push({ e, time: audibleTime }));
    engine.setSource(src);
    const at = (t: number, fn: () => void) => Tone.getContext().setTimeout(fn, t);
    opts.script?.(engine, at);
    engine.play().catch(() => {}); // failures are asserted through events
  });
  return { bars, notes, events, audio, engine };
}

const source =
  (s: Song, practice: Practice = DEFAULT_PRACTICE) =>
  () => ({ song: s, practice });
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

describe("bar timing", () => {
  it(
    "bars follow each other exactly, with no drift over 120 bars",
    { timeout: 30_000 },
    async () => {
      const { bars } = await run(241, source(song(120)));
      expect(bars.length).toBeGreaterThanOrEqual(120);
      bars.forEach((b, i) => {
        expect(close(b.start, 0.05 + 2 * i, 1e-9), `bar ${i} starts at ${b.start}`).toBe(true);
      });
    },
  );

  it("handles tempo and meter changes between sections", async () => {
    // 4/4 at 120 (2 s), then 3/4 at 90 (2 s), then 4/4 at 60 (4 s).
    const s = song(120, [
      { bars: 1 },
      { bars: 1, beatsPerBar: 3, tempo: 90 },
      { bars: 1, tempo: 60 },
    ]);
    const { bars } = await run(20, source(s));
    const lengths = bars.slice(0, 6).map((b) => +(b.end - b.start).toFixed(9));
    expect(lengths).toEqual([2, 2, 4, 2, 2, 4]);
    bars.slice(1).forEach((b, i) => expect(b.start).toBe(bars[i]!.end));
  });

  it("schedules each bar about `lookahead` ahead", async () => {
    const { bars } = await run(21, source(song(120)), { lookahead: 0.2 });
    for (const b of bars.slice(1)) {
      expect(b.lead).toBeGreaterThan(0.19); // the offline clock ticks every 128 samples (~3 ms)
      expect(b.lead).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });

  // Every fixture: each scheduled note lands at its bar's start + ticks × seconds per tick
  // (swing, triplets, sub-bar chords, tempo and meter changes), and each bar lasts its
  // length at its own tempo. Fixtures added later are covered automatically.
  it.each(FIXTURES)("schedules every event of $name at its tick time", async ({ env }) => {
    const song = env.doc.kind === "song" ? env.doc : generateSong(env.doc, STYLES);
    const { bars, notes } = await run(40, () => ({
      song,
      practice: env.practice ?? DEFAULT_PRACTICE,
    }));
    expect(bars.length).toBeGreaterThan(4);
    for (const b of bars) {
      const spt = 60 / (b.bar.tempo * 48);
      expect(b.end - b.start).toBeCloseTo(b.bar.length * spt, 9);
      const inBar = notes.filter((n) => n.time >= b.start - 1e-9 && n.time < b.end - 1e-9);
      const expected = [
        ...b.bar.chords.filter((c) => b.fresh || !c.continued).map((c) => b.start + c.time * spt),
        ...b.bar.parts.bass.map((n) => b.start + n.time * spt),
        ...b.bar.drums.map((h) => b.start + h.time * spt),
      ].sort((x, y) => x - y);
      expect(inBar.map((n) => n.time).sort((x, y) => x - y)).toEqual(expected);
    }
  });
});

describe("audio", () => {
  it("rendered onsets land on the beat over 100 bars (no drift)", { timeout: 60_000 }, async () => {
    // 200 bpm: beats every 0.3 s, 100 bars in 120 s of audio.
    const { audio } = await run(120.2, source(song(200)), { patches: clicks });
    const found = onsets(audio);
    expect(found.length).toBeGreaterThanOrEqual(400);
    found.slice(0, 400).forEach((t, i) => {
      expect(Math.abs(t - (0.05 + 0.3 * i)), `onset ${i} at ${t}`).toBeLessThan(0.002);
    });
  });

  it("swing moves rendered off-beats to two thirds of the beat; a straight section doesn't", async () => {
    // song-swing: 110 bpm, Swung (swing 1) then Straight (swing 0), 2 bars each, 8th hats.
    const s = fixture("song-swing").doc as Song;
    const beat = 60 / 110;
    const { audio } = await run(
      4 * 4 * beat + 0.1,
      () => ({ song: s, practice: DEFAULT_PRACTICE }),
      {
        patches: clicks,
      },
    );
    const expected = Array.from({ length: 16 }, (_, b) => {
      const off = b < 8 ? (2 / 3) * beat : beat / 2; // swung bars, then straight bars
      return [0.05 + b * beat, 0.05 + b * beat + off];
    }).flat();
    const found = onsets(audio).slice(0, expected.length); // the render runs into the next lap
    expect(found).toHaveLength(expected.length);
    found.forEach((t, i) =>
      expect(Math.abs(t - expected[i]!), `onset ${i} at ${t}`).toBeLessThan(0.002),
    );
  });

  it("6/8 bars have six 8th-note beats", async () => {
    const s = fixture("song-six-eight").doc as Song;
    const eighth = 60 / (90 * 2); // tempo counts quarter notes
    const { bars, events } = await run(3, () => ({ song: s, practice: DEFAULT_PRACTICE }));
    expect(bars[0]!.end - bars[0]!.start).toBeCloseTo(6 * eighth, 9);
    const beats = events.filter((x) => x.e.type === "beat" && x.time < bars[0]!.end - 1e-9);
    expect(beats.map((x) => +(x.time - 0.05).toFixed(9))).toEqual(
      Array.from({ length: 6 }, (_, i) => +(i * eighth).toFixed(9)),
    );
  });

  it("mutes apply instantly", async () => {
    const { audio } = await run(4, source(song(120)), {
      patches: clicks,
      script: (e, at) => at(1.2, () => e.setMutes({ ...DEFAULT_PRACTICE.mutes, drums: true })),
    });
    const found = onsets(audio);
    expect(found.filter((t) => t < 1.2)).toHaveLength(3); // 0.05, 0.55, 1.05
    expect(found.filter((t) => t > 1.2)).toEqual([]);
  });

  it("the built-in kit plays every drum on the same tick", async () => {
    // A Tone source can't start twice at one instant, so drums must not share a synth.
    const s = structuredClone(song(120, [{ bars: 1 }])) as Song;
    const all = DrumInstrument.options;
    s.sections[0].drums = Object.fromEntries(all.map((d) => [d, [0, 96]]));
    const { events, audio } = await run(
      2.2,
      () => ({ song: Song.parse(s), practice: DEFAULT_PRACTICE }),
      {
        patches: builtinPatches,
      },
    );
    expect(events.filter((x) => x.e.type === "error")).toEqual([]);
    const rms = Math.sqrt(audio.reduce((sum, x) => sum + x * x, 0) / audio.length);
    expect(rms).toBeGreaterThan(0.005); // the crash rings across both hits, so check level, not onsets
  });

  it("built-in patches build and make sound", async () => {
    const bt = BackingTrack.parse(otherside.doc);
    const { audio } = await run(
      3,
      () => ({ song: generateSong(bt, STYLES), practice: DEFAULT_PRACTICE }),
      {
        patches: builtinPatches,
      },
    );
    const rms = Math.sqrt(audio.reduce((s, x) => s + x * x, 0) / audio.length);
    expect(rms).toBeGreaterThan(0.005);
  });
});

describe("live changes land on the next bar", () => {
  const a = song(120, [{ bars: 4 }]);
  const b = { ...song(120, [{ bars: 4 }]), key: "F" as const };

  it("a source swap lands on the next bar", async () => {
    let current = a;
    const { bars } = await run(9, () => ({ song: current, practice: DEFAULT_PRACTICE }), {
      script: (_e, at) => at(3.0, () => (current = b)),
    });
    // Bars start at 0.05, 2.05, 4.05 …; the 4.05 bar is computed at 3.85, after the swap.
    expect(bars.map((x) => x.bar.key).slice(0, 4)).toEqual(["C", "C", "F", "F"]);
  });

  it("a swap within the lookahead window waits one more bar", async () => {
    let current = a;
    const { bars } = await run(9, () => ({ song: current, practice: DEFAULT_PRACTICE }), {
      script: (_e, at) => at(3.9, () => (current = b)),
    });
    expect(bars.map((x) => x.bar.key).slice(0, 4)).toEqual(["C", "C", "C", "F"]);
  });

  it("a section jump finishes the current section first", async () => {
    // Arrangement s0 (4 bars), s1 (2 bars), s2 (2 bars); jump to s2 during s0's first bar.
    const s = song(120, [{ bars: 4 }, { bars: 2 }, { bars: 2 }]);
    const { bars, events } = await run(13, source(s), {
      script: (e, at) => at(0.5, () => e.queueJump({ kind: "section", arrIdx: 2 })),
    });
    expect(bars.map((x) => `${x.bar.sectionId}:${x.bar.position.bar}`).slice(0, 6)).toEqual([
      "s0:0",
      "s0:1",
      "s0:2",
      "s0:3",
      "s2:0",
      "s2:1",
    ]);
    // The jump stays queued (for the dashed outline) until it lands.
    const queued = events.filter(
      (x) => x.e.type === "transport" && x.e.transport.status === "playing" && x.e.transport.jump,
    );
    expect(queued.length).toBeGreaterThanOrEqual(3);
  });

  it("a chord jump lands at the next bar", async () => {
    const s = song(120, [{ bars: 4 }, { bars: 2 }]);
    const { bars } = await run(7, source(s), {
      script: (e, at) =>
        at(0.5, () => e.queueJump({ kind: "chord", arrIdx: 1, bar: 1, chordIndex: 0 })),
    });
    expect(bars.map((x) => `${x.bar.sectionId}:${x.bar.position.bar}`).slice(0, 3)).toEqual([
      "s0:0",
      "s1:1",
      "s0:0",
    ]);
  });

  it("a key jump lands at the end of the lap", async () => {
    const s = song(120, [{ bars: 1 }, { bars: 1 }]);
    const practice: Practice = { ...DEFAULT_PRACTICE, cycle: { kind: "fourths" } };
    const { bars } = await run(9, source(s, practice), {
      script: (e, at) => at(0.5, () => e.queueKeyJump(5)),
    });
    expect(bars.map((x) => x.bar.key).slice(0, 4)).toEqual(["C", "C", "Db", "Db"]);
  });
});

describe("transport", () => {
  // One 2-bar section with a chord held across both bars; bars are 2 s.
  const s = song(120, [{ bars: 2 }]);

  it("pause keeps the bar; play resumes at its start and strikes the held chord", async () => {
    const { bars, notes, engine } = await run(9, source(s), {
      script: (e, at) => {
        at(2.5, () => e.pause()); // during bar 2 (2.05–4.05)
        at(5.0, () => void e.play());
      },
    });
    expect(engine.getTransport()).toMatchObject({ status: "playing" });
    const resumed = bars.find((b) => b.start > 5)!;
    expect(resumed).toMatchObject({ fresh: true, bar: { position: { bar: 1 } } });
    expect(resumed.start).toBeCloseTo(5.05, 2); // play() ran on the offline clock's next 128-sample tick
    const chords = notes.filter((n) => n.role === "chords");
    expect(chords.map((c) => +c.time.toFixed(2))).toEqual([0.05, 5.05, 7.05]);
    expect(chords[1]!.duration).toBeCloseTo(2, 9); // the rest of the held chord
    expect(chords[1]!.midi).toEqual(chords[0]!.midi);
  });

  it("nothing scheduled ahead sounds after pause", async () => {
    const { audio } = await run(4, source(song(120)), {
      patches: clicks,
      // Bar 1's kick at 1.55 was handed to Web Audio when the bar was scheduled.
      script: (e, at) => at(1.2, () => e.pause()),
    });
    expect(onsets(audio).filter((t) => t > 1.25)).toEqual([]);
  });

  it("stop clears the position; play starts from the top", async () => {
    const { bars, engine } = await run(6, source(s), {
      script: (e, at) => {
        at(2.5, () => e.stop());
        at(3.0, () => void e.play());
      },
    });
    expect(engine.getTransport().status).toBe("playing");
    expect(bars.find((b) => b.start > 3)!.bar.position).toEqual({ arrIdx: 0, lap: 0, bar: 0 });
  });

  it("emits bar, beat and chord events at audible time", async () => {
    const { events } = await run(2.1, source(song(120)));
    const kinds = events
      .filter((x) => x.e.type !== "transport")
      .map((x) => `${x.e.type}@${x.time.toFixed(2)}`);
    expect(kinds.slice(0, 6)).toEqual([
      "bar@0.05",
      "beat@0.05",
      "beat@0.55",
      "beat@1.05",
      "beat@1.55",
      "chord@0.05",
    ]);
  });
});

describe("robustness", () => {
  it("a late bar starts just after now instead of in the past, and is counted", async () => {
    // lookahead 0: each bar is computed on the offline clock's first tick after its
    // planned start, i.e. a fraction of a millisecond late.
    const { bars, engine } = await run(9, source(song(120)), { lookahead: 0 });
    const later = bars.slice(1);
    expect(later.length).toBeGreaterThanOrEqual(3);
    later.forEach((b, i) => {
      const planned = bars[i]!.end;
      const now = planned - b.lead;
      expect(b.late).toBe(true);
      expect(b.lead).toBeLessThan(0);
      expect(b.start).toBeCloseTo(now + 0.02, 9); // never in the past
    });
    expect(engine.stats()).toMatchObject({ late: later.length });
    expect(engine.stats().minLead).toBeLessThan(0);
  });

  it("on time, nothing is late", async () => {
    const { engine } = await run(21, source(song(120)));
    expect(engine.stats()).toMatchObject({ late: 0 });
    expect(engine.stats().minLead).toBeCloseTo(0.05, 9); // the first bar: play()'s start delay
  });

  it("a source that throws pauses on the audible bar and reports the error", async () => {
    const s = song(120, [{ bars: 4 }]);
    let broken = false;
    const { bars, events, engine, audio } = await run(
      9,
      () => {
        if (broken) throw new Error("bad edit");
        return { song: s, practice: DEFAULT_PRACTICE };
      },
      { patches: clicks, script: (_e, at) => at(3.0, () => (broken = true)) },
    );
    // Bars at 0.05 and 2.05 played; the 4.05 bar (computed at 3.85) failed.
    expect(bars.map((b) => b.bar.position.bar)).toEqual([0, 1]);
    expect(events.map((x) => x.e).filter((e) => e.type === "error")).toEqual([
      { type: "error", message: "bad edit" },
    ]);
    expect(engine.getTransport()).toEqual({
      status: "paused",
      scope: { kind: "arrangement" },
      at: { arrIdx: 0, lap: 0, bar: 1 },
    });
    expect(onsets(audio).filter((t) => t > 3.9)).toEqual([]);
  });

  it("play() with a source that throws rejects, reports, and stays stopped", async () => {
    let result: Promise<void> | undefined;
    const { events, engine } = await run(
      1,
      () => {
        throw new Error("no song");
      },
      {
        script: (e) => {
          result = e.play();
          result.catch(() => {}); // asserted below, after rendering
        },
      },
    );
    await expect(result).rejects.toThrow("no song");
    expect(engine.getTransport().status).toBe("stopped");
    expect(events.some((x) => x.e.type === "error")).toBe(true);
  });

  it("a listener that throws doesn't stop playback", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { bars } = await run(7, source(song(120)), {
      script: (e) =>
        e.subscribe(() => {
          throw new Error("UI bug");
        }),
    });
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});

describe("patches", () => {
  /** Logs each note with its instrument's key, and each dispose with its context time. */
  function tracking(log: { key: string; time: number }[], disposed: { key: string; at: number }[]) {
    return ((_role: Role, spec: InstrumentSpec) => {
      const key = instrumentKey(spec);
      return {
        play: (_m: unknown, time: number) => log.push({ key, time }),
        hit: (_d: unknown, time: number) => log.push({ key, time }),
        dispose: () => disposed.push({ key, at: Tone.getContext().now() }),
      };
    }) as unknown as PatchFactory;
  }

  /** 8 bars at 120 bpm (2 s each), a bass note on every beat played by custom patch `b`. */
  function bassSong(patch: Patch): Song {
    const s = structuredClone(song(120, [{ bars: 8 }])) as Song;
    s.patches = { [patchId("b")]: patch };
    s.instruments = { ...s.instruments, bass: { kind: "custom", id: patchId("b") } };
    s.sections[0]!.parts.bass = Array.from({ length: 32 }, (_, i) => ({
      start: i * 48,
      duration: 24,
      pitch: { kind: "chordTone", tone: 1 },
    })) as Song["sections"][number]["parts"]["bass"];
    return s;
  }
  const patchId = (s: string) => s as PatchId;
  const SET_FOR_CANCEL: SampleSet = {
    id: "k",
    role: "chords",
    path: "",
    notes: { 60: "c4.wav" },
    attack: 0,
    release: 0.1,
    licence: "test",
    credit: "test",
    source: "test",
  };
  const A = BUILTIN_PATCHES["bass-v1"];
  const B = { ...A, volume: -12 }; // an edit: one parameter changed
  const keyOf = (p: Patch) => instrumentKey({ kind: "patch", role: "bass", patch: p });

  it("an edited patch plays from the next bar; the old one is disposed once silent", async () => {
    const log: { key: string; time: number }[] = [];
    const disposed: { key: string; at: number }[] = [];
    let current = Song.parse(bassSong(A));
    await run(9, () => ({ song: current, practice: DEFAULT_PRACTICE }), {
      patches: tracking(log, disposed),
      script: (_e, at) => at(3.0, () => (current = Song.parse(bassSong(B)))),
    });
    const a = log.filter((n) => n.key === keyOf(A));
    const b = log.filter((n) => n.key === keyOf(B));
    // Bars start at 0.05 + 2i; the edit at 3.0 lands on the bar at 4.05.
    expect(Math.max(...a.map((n) => n.time))).toBeLessThan(4.05);
    expect(Math.min(...b.map((n) => n.time))).toBeCloseTo(4.05, 9);

    const lastA = Math.max(...a.map((n) => n.time)) + 0.25; // its last note's end (an 8th)
    const gone = disposed.filter((d) => d.key === keyOf(A));
    expect(gone).toHaveLength(1);
    expect(gone[0]!.at).toBeGreaterThan(
      lastA + tailSeconds({ kind: "patch", role: "bass", patch: A }, {}),
    );
    expect(disposed.filter((d) => d.key === keyOf(B))).toEqual([]);
  });

  it("▶ waits for the song's sample sets, then plays", async () => {
    const set: SampleSet = {
      id: "test-keys",
      role: "chords",
      path: "",
      notes: { 60: "c4.wav" },
      attack: 0,
      release: 0.1,
      licence: "test",
      credit: "test",
      source: "test",
    };
    const loads: string[] = [];
    const samples = makeSampleLibrary({
      baseUrl: "",
      loadBuffer: async (url) => (loads.push(url), {} as AudioBuffer),
      sets: { [set.id]: set },
    });
    // The schema only accepts shipped sets, so the sampler is put in after parsing.
    const s = structuredClone(song(120)) as Song;
    s.patches = {
      [patchId("keys")]: { kind: "sampler", role: "chords", set: set.id as SampleSetId, volume: 0 },
    };
    s.instruments = { ...s.instruments, chords: { kind: "custom", id: patchId("keys") } };

    useIdleOfflineContext(3);
    const events: EngineEvent["type"][] = [];
    const bars: ScheduledBarInfo[] = [];
    const engine = makeEngine({
      samples,
      patches: recorder([]),
      atAudibleTime: (fn) => fn(),
      onBarScheduled: (b) => bars.push(b),
    });
    engine.subscribe((e) => void events.push(e.type));
    engine.setSource(() => ({ song: s, practice: DEFAULT_PRACTICE }));

    const played = engine.play();
    expect(events).toEqual(["loadingSounds"]);
    expect(bars).toEqual([]); // nothing scheduled while waiting
    await played;
    expect(loads).toEqual(["c4.wav"]);
    expect(samples.status(set.id).kind).toBe("ready");
    expect(engine.getTransport().status).toBe("playing");
    expect(bars).toHaveLength(1);
    engine.dispose();
  });

  it("stop while waiting for samples cancels the start", async () => {
    const samples = makeSampleLibrary({
      baseUrl: "",
      loadBuffer: async () => ({}) as AudioBuffer,
      sets: { k: { ...SET_FOR_CANCEL } },
    });
    const s = structuredClone(song(120)) as Song;
    s.patches = {
      [patchId("keys")]: { kind: "sampler", role: "chords", set: "k" as SampleSetId, volume: 0 },
    };
    s.instruments = { ...s.instruments, chords: { kind: "custom", id: patchId("keys") } };
    useIdleOfflineContext(3);
    const engine = makeEngine({ samples, patches: recorder([]), atAudibleTime: (fn) => fn() });
    engine.setSource(() => ({ song: s, practice: DEFAULT_PRACTICE }));
    const played = engine.play();
    engine.stop();
    await played;
    expect(engine.getTransport().status).toBe("stopped");
    engine.dispose();
  });
});
