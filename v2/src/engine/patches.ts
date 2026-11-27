/**
 * Instruments: what the engine plays notes on. Each role has a small interface,
 * so the engine never touches Tone synths directly and tests can swap in
 * recording instruments.
 *
 * Patches (synth or sampler) are data, built here by one builder for built-in and
 * custom patches alike. The drum kit is code: v1's drum samples, shared and loaded
 * once, falling back to v1's synth drums until they're ready (or if they fail).
 */

import * as Tone from "tone";
import { BUILTIN_PATCHES } from "../model/patches";
import type { DrumInstrument, Effect, Patch, PatchRole, Role } from "../model/schema";
import { assertNever, type DeepReadonly } from "../model/types";
import type { InstrumentSpec } from "../core/instruments";
import type { SampleLibrary } from "./samples";

type R<T> = DeepReadonly<T>;

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

/** Builds the instrument for a role from its spec, connected to `out`. */
export type PatchFactory = <R extends Role>(
  role: R,
  spec: InstrumentSpec,
  out: Tone.InputNode,
) => RoleInstruments[R];

const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * A reverb impulse built synchronously: stereo noise decaying to −60 dB over
 * `decay` seconds after a short pre-delay. Replaces `Tone.Reverb`, whose impulse
 * is rendered asynchronously with `Tone.Offline` (which also swaps Tone's global
 * context while it runs). v1's pad reverb. `random` is injectable so tests can
 * render the same impulse twice.
 */
export function reverb(
  decay: number,
  wet: number,
  out: Tone.InputNode,
  random: () => number = Math.random,
) {
  const ctx = Tone.getContext();
  const preDelay = 0.01;
  const length = Math.ceil(decay * ctx.sampleRate);
  const channel = () =>
    Float32Array.from({ length }, (_, i) => {
      const t = i / ctx.sampleRate;
      const env =
        t < preDelay ? t / preDelay : Math.exp((-6.9 * (t - preDelay)) / (decay - preDelay));
      return (random() * 2 - 1) * env;
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

/** Chains `effects` in order into `out`; returns the chain's input. */
function effectChain(effects: R<Effect[]> | undefined, out: Tone.InputNode, random: () => number) {
  const built: { input: Tone.InputNode; dispose: () => void }[] = [];
  let next = out;
  for (const effect of [...(effects ?? [])].reverse()) {
    switch (effect.kind) {
      case "reverb": {
        const r = reverb(effect.decay, effect.wet, next, random);
        built.push(r);
        next = r.input;
        break;
      }
      default:
        assertNever(effect.kind);
    }
  }
  return { input: next, dispose: () => built.forEach((e) => e.dispose()) };
}

/** A role's instrument from one Tone voice: chords strike chords, bass single notes. */
type Voice = {
  /** Frequencies sound at `time` for `duration` seconds. */
  strike(freqs: number[], time: number, duration: number): void;
  dispose(): void;
};

function asRole<P extends PatchRole>(role: P, voice: Voice): RoleInstruments[P] {
  switch (role) {
    case "chords":
      return {
        play: (midi: readonly number[], time: number, duration: number) =>
          voice.strike(midi.map(midiToFreq), time, duration),
        dispose: voice.dispose,
      } satisfies ChordInstrument as RoleInstruments[P];
    case "bass":
      return {
        play: (midi: number, time: number, duration: number) =>
          voice.strike([midiToFreq(midi)], time, duration),
        dispose: voice.dispose,
      } satisfies BassInstrument as RoleInstruments[P];
    default:
      return assertNever(role);
  }
}

type SynthPatch = Extract<R<Patch>, { kind: "synth" }>;
type SamplerPatch = Extract<R<Patch>, { kind: "sampler" }>;

/**
 * A synth patch as Tone nodes. Chords are polyphonic (`PolySynth`), bass is mono.
 * With a filter the voice is a `MonoSynth` (filter + filter envelope); without one,
 * a plain `Synth`. These are exactly v1's pad (PolySynth of Synth) and bass (MonoSynth).
 */
function synthVoice(
  role: PatchRole,
  patch: SynthPatch,
  out: Tone.InputNode,
  random: () => number,
): Voice {
  const chain = effectChain(patch.effects, out, random);
  const oscillator = { type: patch.oscillator.type };
  const envelope = { ...patch.envelope };
  const filter = patch.filter;
  const mono = filter
    ? {
        oscillator,
        envelope,
        filter: { type: filter.type, Q: filter.q },
        filterEnvelope: {
          ...(filter.envelope ?? { attack: 0, decay: 0, sustain: 1, release: 0 }),
          baseFrequency: filter.frequency,
          octaves: filter.envelope?.octaves ?? 0,
        },
      }
    : undefined;

  const synth = ((): Tone.PolySynth | Tone.Synth | Tone.MonoSynth => {
    switch (role) {
      case "chords":
        return mono
          ? new Tone.PolySynth(Tone.MonoSynth, mono)
          : new Tone.PolySynth(Tone.Synth, { oscillator, envelope });
      case "bass":
        return mono ? new Tone.MonoSynth(mono) : new Tone.Synth({ oscillator, envelope });
      default:
        return assertNever(role);
    }
  })();
  synth.connect(chain.input);
  synth.volume.value = patch.volume;
  return {
    strike: (freqs, time, duration) =>
      synth instanceof Tone.PolySynth
        ? synth.triggerAttackRelease(freqs, duration, time)
        : synth.triggerAttackRelease(freqs[0]!, duration, time),
    dispose: () => {
      synth.dispose();
      chain.dispose();
    },
  };
}

/**
 * A sampler patch: plays `fallback` (the role's default synth) until its set is
 * ready, then the samples. Bass stays monophonic: a new note releases the last.
 */
function samplerVoice(
  role: PatchRole,
  patch: SamplerPatch,
  out: Tone.InputNode,
  library: SampleLibrary,
  fallback: Voice,
  random: () => number,
): Voice {
  void library.load(patch.set);
  const set = library.sets[patch.set];
  const chain = effectChain(patch.effects, out, random);
  let sampler: Tone.Sampler | undefined;
  let sounding: { freq: number; end: number } | undefined;

  const ready = (): Tone.Sampler | undefined => {
    if (sampler) return sampler;
    const status = library.status(patch.set);
    switch (status.kind) {
      case "ready":
        sampler = new Tone.Sampler({
          urls: Object.fromEntries(status.buffers),
          attack: patch.attack ?? set?.attack ?? 0,
          release: patch.release ?? set?.release ?? 0.1,
        }).connect(chain.input);
        sampler.volume.value = patch.volume;
        return sampler;
      case "unloaded":
      case "loading":
      case "failed":
        return undefined;
      default:
        return assertNever(status);
    }
  };

  return {
    strike: (freqs, time, duration) => {
      const s = ready();
      if (!s) return fallback.strike(freqs, time, duration);
      switch (role) {
        case "chords":
          s.triggerAttackRelease(freqs, duration, time);
          break;
        case "bass":
          if (sounding && sounding.end > time) s.triggerRelease(sounding.freq, time);
          s.triggerAttackRelease(freqs[0]!, duration, time);
          sounding = { freq: freqs[0]!, end: time + duration };
          break;
        default:
          assertNever(role);
      }
    },
    dispose: () => {
      sampler?.dispose();
      chain.dispose();
      fallback.dispose();
    },
  };
}

/** The role's default patch: what a sampler plays until its samples are ready. */
const FALLBACK: Record<PatchRole, SynthPatch> = {
  chords: BUILTIN_PATCHES["pad-v1"] as SynthPatch,
  bass: BUILTIN_PATCHES["bass-v1"] as SynthPatch,
};

function patchVoice(role: PatchRole, patch: R<Patch>, out: Tone.InputNode, deps: PatchDeps): Voice {
  switch (patch.kind) {
    case "synth":
      return synthVoice(role, patch, out, deps.random);
    case "sampler":
      return samplerVoice(
        role,
        patch,
        out,
        deps.samples,
        synthVoice(role, FALLBACK[role], out, deps.random),
        deps.random,
      );
    default:
      return assertNever(patch);
  }
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

export interface PatchDeps {
  /** Where sampler patches get their samples. */
  samples: SampleLibrary;
  /** Noise source for reverb impulses (tests seed it). */
  random: () => number;
}

/** The engine's instrument builder: patches (data) and the drum kit (code). */
export function makePatchFactory(deps: PatchDeps): PatchFactory {
  return ((role: Role, spec: InstrumentSpec, out: Tone.InputNode) => {
    switch (spec.kind) {
      case "kit":
        return kitV1(out);
      case "patch":
        if (role !== spec.role) throw new Error(`a ${spec.role} patch can't play ${role}`);
        return asRole(spec.role, patchVoice(spec.role, spec.patch, out, deps));
      default:
        return assertNever(spec);
    }
  }) as PatchFactory;
}
