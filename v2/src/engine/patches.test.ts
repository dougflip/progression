/**
 * Patches rendered offline: the data-built built-ins sound exactly like v1's code,
 * and samplers play their fallback until their set is ready.
 */
import { renderOffline, SAMPLE_RATE } from "./offline"; // first: installs Web Audio for Tone
import * as Tone from "tone";
import { describe, expect, it } from "vitest";
import { BUILTIN_PATCHES } from "../model/patches";
import type { SampleSet } from "../model/sampleSets";
import type { Patch, SampleSetId } from "../model/schema";
import { makePatchFactory, reverb, type BassInstrument, type ChordInstrument } from "./patches";
import { makeSampleLibrary, type LoadBuffer, type SampleLibrary } from "./samples";

/** A seeded noise source, so two renders get the same reverb impulse. */
function seeded(seed = 1) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

// ── v1's code, as it was before patches became data (the reference) ─────────

function padV1Code(out: Tone.InputNode, random: () => number): ChordInstrument {
  const verb = reverb(2.5, 0.25, out, random);
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.6, release: 1.5 },
  }).connect(verb.input);
  synth.volume.value = -13;
  return {
    play: (midi, time, duration) =>
      synth.triggerAttackRelease(midi.map(midiToFreq), duration, time),
    dispose: () => {
      synth.dispose();
      verb.dispose();
    },
  };
}

function bassV1Code(out: Tone.InputNode): BassInstrument {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    filter: { Q: 2, type: "lowpass" },
    envelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
    filterEnvelope: {
      attack: 0.01,
      decay: 0.2,
      sustain: 0.4,
      release: 0.3,
      baseFrequency: 80,
      octaves: 2.5,
    },
  }).connect(out);
  synth.volume.value = -6;
  return {
    play: (midi, time, duration) => synth.triggerAttackRelease(midiToFreq(midi), duration, time),
    dispose: () => synth.dispose(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const noSamples = makeSampleLibrary({
  baseUrl: "",
  loadBuffer: () => new Promise(() => {}), // never loads
});

const chords = (i: ChordInstrument) => {
  i.play([60, 64, 67], 0.1, 0.8);
  i.play([62, 65, 69, 72], 1.0, 0.5);
  i.play([59, 62, 67], 1.6, 1.0);
};
const bassLine = (i: BassInstrument) => {
  for (const [k, m] of [36, 43, 41, 40, 38, 36].entries()) i.play(m, 0.1 + k * 0.3, 0.25);
};

function patchFactory(samples: SampleLibrary = noSamples) {
  return makePatchFactory({ samples, random: seeded() });
}

function maxDiff(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

/** Zero crossings per second / 2: the frequency of a pure tone. */
function pitch(x: Float32Array, from: number, to: number) {
  let crossings = 0;
  for (let i = Math.floor(from * SAMPLE_RATE) + 1; i < to * SAMPLE_RATE; i++) {
    if (x[i - 1]! < 0 !== x[i]! < 0) crossings++;
  }
  return crossings / 2 / (to - from);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("built-in patches as data sound exactly like v1's code", () => {
  it("pad-v1", async () => {
    const code = await renderOffline(4, () => chords(padV1Code(Tone.getDestination(), seeded())));
    const data = await renderOffline(4, () =>
      chords(
        patchFactory()(
          "chords",
          { kind: "patch", role: "chords", patch: BUILTIN_PATCHES["pad-v1"] },
          Tone.getDestination(),
        ),
      ),
    );
    expect(rms(code)).toBeGreaterThan(0.005);
    expect(maxDiff(code, data)).toBeLessThan(1e-6);
  });

  it("bass-v1", async () => {
    const code = await renderOffline(2.5, () => bassLine(bassV1Code(Tone.getDestination())));
    const data = await renderOffline(2.5, () =>
      bassLine(
        patchFactory()(
          "bass",
          { kind: "patch", role: "bass", patch: BUILTIN_PATCHES["bass-v1"] },
          Tone.getDestination(),
        ),
      ),
    );
    expect(rms(code)).toBeGreaterThan(0.005);
    expect(maxDiff(code, data)).toBeLessThan(1e-6);
  });
});

describe("synth patches", () => {
  it.each<[string, Patch]>([
    ["chords with a filter (poly MonoSynth)", { ...BUILTIN_PATCHES["bass-v1"], role: "chords" }],
    ["bass without a filter (mono Synth)", { ...BUILTIN_PATCHES["pad-v1"], role: "bass" }],
  ])("%s builds and sounds", async (_, patch) => {
    const audio = await renderOffline(2.5, () => {
      const make = patchFactory();
      const out = Tone.getDestination();
      if (patch.role === "chords")
        chords(make("chords", { kind: "patch", role: "chords", patch }, out));
      else bassLine(make("bass", { kind: "patch", role: "bass", patch }, out));
    });
    expect(rms(audio)).toBeGreaterThan(0.005);
  });
});

describe("sampler patches", () => {
  const SET: SampleSet = {
    id: "test-sine",
    role: "chords",
    path: "",
    notes: { 69: "a4.wav" },
    attack: 0,
    release: 0.05,
    licence: "test",
    credit: "test",
    source: "generated",
  };
  const PATCH: Patch = {
    kind: "sampler",
    role: "chords",
    set: "test-sine" as SampleSetId,
    volume: 0,
  };
  /** One second of a 440 Hz sine, as the "recording". */
  const sine: LoadBuffer = async () =>
    Tone.ToneAudioBuffer.fromArray(
      Float32Array.from(
        { length: SAMPLE_RATE },
        (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE),
      ),
    ).get()!;

  it("plays the role's default synth while its set loads", async () => {
    const pending = makeSampleLibrary({
      baseUrl: "",
      loadBuffer: () => new Promise(() => {}),
      sets: { [SET.id]: SET },
    });
    const fallback = await renderOffline(4, () =>
      chords(
        patchFactory(pending)(
          "chords",
          { kind: "patch", role: "chords", patch: PATCH },
          Tone.getDestination(),
        ),
      ),
    );
    const pad = await renderOffline(4, () =>
      chords(
        patchFactory()(
          "chords",
          { kind: "patch", role: "chords", patch: BUILTIN_PATCHES["pad-v1"] },
          Tone.getDestination(),
        ),
      ),
    );
    expect(pending.status(SET.id).kind).toBe("loading");
    expect(maxDiff(fallback, pad)).toBeLessThan(1e-6);
  });

  it("plays its samples once the set is ready, pitched from the nearest sample", async () => {
    const ready = makeSampleLibrary({ baseUrl: "", loadBuffer: sine, sets: { [SET.id]: SET } });
    const audio = await renderOffline(1, () => {
      // The buffer is generated on the offline context, so load it there.
      void ready.load(SET.id);
    });
    void audio;
    expect(ready.status(SET.id).kind).toBe("ready");
    const played = await renderOffline(1.2, () => {
      const i = patchFactory(ready)(
        "chords",
        { kind: "patch", role: "chords", patch: PATCH },
        Tone.getDestination(),
      );
      i.play([69], 0.1, 0.4); // the sampled note
      i.play([81], 0.6, 0.4); // an octave up: the sample at double speed
    });
    expect(pitch(played, 0.15, 0.45)).toBeCloseTo(440, -1);
    expect(pitch(played, 0.65, 0.95)).toBeCloseTo(880, -1);
  });
});
