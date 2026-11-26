/**
 * Instruments: what the engine plays notes on. Each role has a small interface,
 * so the engine never touches Tone synths directly and tests can swap in
 * recording instruments.
 *
 * The built-ins are v1's sounds, ported with the same settings (Milestone 5
 * makes patches data). Drum samples are shared, loaded once, and fall back to
 * v1's synth drums until they're ready (or if they fail to load).
 */

import * as Tone from "tone";
import type { DrumInstrument, PatchRef, Role } from "../model/schema";

export interface ChordInstrument {
  /** Strike notes (MIDI) at `time` (context seconds), held for `duration` seconds. */
  play(midi: readonly number[], time: number, duration: number): void;
  dispose(): void;
}

export interface BassInstrument {
  play(midi: number, time: number, duration: number): void;
  dispose(): void;
}

export interface KitInstrument {
  hit(drum: DrumInstrument, time: number): void;
  dispose(): void;
}

export interface RoleInstruments {
  chords: ChordInstrument;
  bass: BassInstrument;
  drums: KitInstrument;
}

/** Builds an instrument for a role from a patch, connected to `out`. */
export type PatchFactory = <R extends Role>(
  role: R,
  ref: PatchRef,
  out: Tone.InputNode,
) => RoleInstruments[R];

const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * A reverb impulse built synchronously: stereo noise decaying to −60 dB over
 * `decay` seconds after a short pre-delay. Replaces `Tone.Reverb`, whose impulse
 * is rendered asynchronously with `Tone.Offline` (which also swaps Tone's global
 * context while it runs). Same settings as v1's pad reverb.
 */
function reverb(decay: number, wet: number, out: Tone.InputNode) {
  const ctx = Tone.getContext();
  const preDelay = 0.01;
  const length = Math.ceil(decay * ctx.sampleRate);
  const channel = () =>
    Float32Array.from({ length }, (_, i) => {
      const t = i / ctx.sampleRate;
      const env =
        t < preDelay ? t / preDelay : Math.exp((-6.9 * (t - preDelay)) / (decay - preDelay));
      return (Math.random() * 2 - 1) * env;
    });
  const impulse = Tone.ToneAudioBuffer.fromArray([channel(), channel()]);
  const mix = new Tone.CrossFade(wet).connect(out); // equal-power, like Tone.Reverb's `wet`
  const convolver = new Tone.Convolver({ url: impulse, normalize: true }).connect(mix.b);
  const input = new Tone.Gain();
  input.connect(mix.a);
  input.connect(convolver);
  return {
    input,
    dispose: () => [input, convolver, mix].forEach((n) => n.dispose()),
  };
}

function padV1(out: Tone.InputNode): ChordInstrument {
  const verb = reverb(2.5, 0.25, out);
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

function bassV1(out: Tone.InputNode): BassInstrument {
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

// ── Drums ───────────────────────────────────────────────────────────────────

/** Sample file and volume (dB) per drum: v1's kit. */
const SAMPLES: Record<DrumInstrument, { file: string; volume: number } | undefined> = {
  kick: { file: "kick.ogg", volume: 0 },
  snare: { file: "snare1.ogg", volume: 0 },
  hat: { file: "hihat-closed.ogg", volume: 0 },
  hatOpen: { file: "hihat-open.ogg", volume: 0 },
  crash: { file: "crash-l.ogg", volume: 0 },
  ride: { file: "ride.ogg", volume: -8 },
  rideBell: { file: "ride-bell.ogg", volume: -8 },
  tom: { file: "tom1.ogg", volume: 0 },
  tom2: { file: "tom2.ogg", volume: 0 },
  clap: undefined, // v2 addition: synth only for now
};

/** Where drum samples live. The app sets it (v1's samples); tests leave it unset (synths only). */
let sampleBaseUrl: string | undefined;
const buffers = new Map<DrumInstrument, Tone.ToneAudioBuffer>();

/** Starts loading v1's drum samples once (shared by every kit). */
export function loadDrumSamples(baseUrl: string): void {
  if (sampleBaseUrl !== undefined) return;
  sampleBaseUrl = baseUrl;
  for (const [drum, s] of Object.entries(SAMPLES) as [
    DrumInstrument,
    (typeof SAMPLES)[DrumInstrument],
  ][]) {
    if (!s) continue;
    const buffer = new Tone.ToneAudioBuffer(`${baseUrl}${s.file}`, undefined, () =>
      buffers.delete(drum),
    );
    buffers.set(drum, buffer);
  }
}

/** v1's synth drums: the fallback while samples load, or without them. */
function synthDrums(out: Tone.InputNode) {
  const nodes: Tone.ToneAudioNode[] = [];
  const keep = <T extends Tone.ToneAudioNode>(n: T) => (nodes.push(n), n);
  const highpass = (frequency: number) =>
    keep(new Tone.Filter({ type: "highpass", frequency, Q: 0.5 }).connect(out));

  const kick = keep(
    new Tone.MembraneSynth({
      pitchDecay: 0.05,
      octaves: 6,
      envelope: { attack: 0.005, decay: 0.4, sustain: 0, release: 1.4 },
    }).connect(out),
  );
  kick.volume.value = -4;
  const snare = keep(
    new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.005, decay: 0.15, sustain: 0 },
    }).connect(out),
  );
  snare.volume.value = -10;
  // v1 used a MetalSynth here, but Tone's MetalSynth can't hold more than one future
  // trigger, and the engine schedules a whole bar ahead. A short high-passed noise
  // burst stands in until the hat sample loads.
  const hat = keep(
    new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    }).connect(highpass(8000)),
  );
  hat.volume.value = -20;
  const hatOpen = keep(
    new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.5 },
    }).connect(highpass(7000)),
  );
  hatOpen.volume.value = -18;
  const crash = keep(
    new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 1.2 },
    }).connect(highpass(5000)),
  );
  crash.volume.value = -14;
  // One synth per drum: a Tone source can't be started twice at the same instant, so
  // two drums sharing a synth (v1's ride and ride bell) would fail on the same tick.
  const rideSynth = () => {
    const r = keep(
      new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.2 },
      }).connect(highpass(6000)),
    );
    r.volume.value = -22;
    return r;
  };
  const ride = rideSynth();
  const rideBell = rideSynth();
  const tom = (note: string) => {
    const t = keep(
      new Tone.MembraneSynth({
        pitchDecay: 0.025,
        octaves: 3,
        envelope: { attack: 0.0006, decay: 0.3, sustain: 0, release: 0.8 },
      }).connect(out),
    );
    t.volume.value = -4;
    return (time: number) => t.triggerAttackRelease(note, 0.25, time);
  };
  const clap = keep(
    new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
    }).connect(highpass(1200)),
  );
  clap.volume.value = -12;

  const play: Record<DrumInstrument, (time: number) => void> = {
    kick: (t) => kick.triggerAttackRelease("C1", 0.25, t),
    snare: (t) => snare.triggerAttackRelease(0.125, t),
    hat: (t) => hat.triggerAttackRelease(0.03, t),
    hatOpen: (t) => hatOpen.triggerAttackRelease(0.25, t),
    crash: (t) => crash.triggerAttackRelease(0.5, t),
    ride: (t) => ride.triggerAttackRelease(0.0625, t),
    rideBell: (t) => rideBell.triggerAttackRelease(0.0625, t), // v1's bell fallback sounds like the ride
    tom: tom("A1"),
    tom2: tom("D2"),
    clap: (t) => clap.triggerAttackRelease(0.125, t),
  };
  return { play, dispose: () => nodes.forEach((n) => n.dispose()) };
}

function kitV1(out: Tone.InputNode): KitInstrument {
  const synths = synthDrums(out);
  const players = new Map<DrumInstrument, Tone.Player>();
  const player = (drum: DrumInstrument): Tone.Player | undefined => {
    const buffer = buffers.get(drum);
    if (!buffer?.loaded) return undefined;
    let p = players.get(drum);
    if (!p) {
      p = new Tone.Player(buffer).connect(out);
      p.volume.value = SAMPLES[drum]?.volume ?? 0;
      players.set(drum, p);
    }
    return p;
  };
  return {
    hit: (drum, time) => {
      const p = player(drum);
      if (p) {
        p.stop(time); // v1: retrigger cuts the previous hit
        p.start(time);
      } else {
        synths.play[drum](time);
      }
    },
    dispose: () => {
      synths.dispose();
      players.forEach((p) => p.dispose());
    },
  };
}

export const builtinPatches: PatchFactory = (role, ref, out) => {
  if (ref.kind === "custom") throw new Error("custom patches arrive in Milestone 5");
  const make = { "pad-v1": padV1, "bass-v1": bassV1, "kit-v1": kitV1 }[ref.id];
  return make(out) as unknown as RoleInstruments[typeof role];
};
