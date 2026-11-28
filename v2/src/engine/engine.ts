/**
 * The audio engine: plays a Song bar by bar on Tone.js.
 *
 * - Just in time: each bar is computed from the current source shortly before it
 *   starts (`lookahead`), by the pure core (`nextPosition` → `scheduleBar`). Edits,
 *   jumps and scope changes therefore land on the next bar; nothing is rebuilt.
 * - Drift-free: bar start times are summed exactly from each bar's tempo and
 *   length, independent of when the scheduling callback actually runs.
 * - Instruments live for a play session and survive edits. Pause and stop fade the
 *   session out and dispose it, so notes already handed to Web Audio can't leak.
 *   An instrument the song no longer uses (a replaced or edited patch) is disposed
 *   once its last note and tail have finished.
 * - Sample sets and recorded takes: ▶ waits up to `sampleWait` for the song's,
 *   then plays; samplers play their fallback synth until their set is ready, and a
 *   take that isn't ready stays silent. A take with no audio (missing) or that
 *   failed to load is reported once per play session (`loopProblem`).
 * - Loops: each pass of a take is one buffer source on the loops channel, started
 *   at its bar 1 (or mid-take after a jump). A take that stops being scheduled
 *   (muted, removed, jumped away) stops at the next bar; gain lands there too.
 *   Channels (levels, mutes) are long-lived and change instantly.
 * - Late bars: if a bar is computed after its start has passed (the main thread
 *   stalled for longer than `lookahead`), it starts just after now instead of in the
 *   past. The timeline shifts by the time lost: one hiccup, not a burst of overdue
 *   notes. Late bars are counted in `stats()`.
 * - Errors: if computing a bar throws, playback pauses on the audible bar and an
 *   `error` event is emitted; listener exceptions never stop the engine.
 * - The engine runs on Tone's current context (tests set an offline one).
 */

import * as Tone from "tone";
import {
  instrumentKey,
  instrumentSpec,
  instrumentsToDispose,
  songInstrumentKeys,
  songSampleSets,
  tailSeconds,
} from "../core/instruments";
import { clampPosition, changeScope, nextPosition } from "../core/transport";
import { scheduleBar } from "../core/schedule";
import type {
  Engine,
  EngineEvent,
  EngineSource,
  Jump,
  PlayScope,
  Position,
  ScheduledBar,
  Transport,
} from "../model/runtime";
import {
  DEFAULT_LEVELS,
  DEFAULT_MUTES,
  PPQ,
  type Channel,
  type Mix,
  type PatchRef,
  type Practice,
  type Role,
  type Song,
} from "../model/schema";
import { assertNever, type DeepReadonly } from "../model/types";
import { makePatchFactory, type PatchFactory, type RoleInstruments } from "./patches";
import { playableTakeIds } from "../core/looper";
import { openLoopStore } from "../storage/loopStore";
import { makeSampleLibrary, pendingSets, webAudioLoader, type SampleLibrary } from "./samples";
import { makeTakeLibrary, pendingTakes, type TakeLibrary } from "./takes";

export interface EngineOptions {
  /** Where sample set folders are served from (ends in `/`), for the default library. */
  sampleBaseUrl?: string;
  /** Where sampler patches get their samples. Default: the app's sets from `sampleBaseUrl`. */
  samples?: SampleLibrary;
  /** Builds instruments from specs. Default: `makePatchFactory` (patches + the kit). */
  patches?: PatchFactory;
  /** Recorded takes' audio. Default: the device's loop store, decoded on this context. */
  takes?: TakeLibrary;
  /** Longest ▶ waits for the song's sample sets and takes (ms). Default 1500. */
  sampleWait?: number;
  /** Seconds before a bar starts that it is computed and scheduled. */
  lookahead?: number;
  /** Seconds between `play()` and the first bar. */
  startDelay?: number;
  /** Runs UI callbacks at audible time. Default: Tone's Draw (needs a browser). */
  atAudibleTime?: (fn: () => void, time: number) => void;
  /** Called for every scheduled bar (tests, the bench's performance readout). */
  onBarScheduled?: (info: ScheduledBarInfo) => void;
}

export interface ScheduledBarInfo {
  bar: ScheduledBar;
  /** Context time the bar starts / ends. */
  start: number;
  end: number;
  /** First bar after play (or a resume): held chords are struck. */
  fresh: boolean;
  /** How long computing and scheduling the bar took (ms of main thread). */
  scheduleMs: number;
  /** How far ahead of its planned start the bar was scheduled (seconds; < 0 = late). */
  lead: number;
  /** Computed after its planned start; `start` was moved to just after now. */
  late: boolean;
}

export interface EngineStats {
  bars: number;
  lastMs: number;
  maxMs: number;
  avgMs: number;
  /** Lead of the last bar (seconds); the target is `lookahead`. */
  lead: number;
  /** Smallest lead seen (seconds); negative means a bar was late. */
  minLead: number;
  /** Bars computed after their planned start (each one a hiccup). */
  late: number;
  lookahead: number;
}

export interface ToneEngine extends Engine {
  getTransport(): Transport;
  /** Silences every channel (instantly) while recording without headphones. */
  setSilenced(on: boolean): void;
  /** Device input latency for recorded takes (AppPrefs.loopOffsetMs). */
  setLoopOffsetMs(ms: number): void;
  /** A take's audio was deleted: drop it from memory. */
  forgetTake(id: string): void;
  stats(): EngineStats;
  dispose(): void;
}

type Playing = Extract<Transport, { status: "playing" }>;
type Session = {
  gains: Record<Role | "loops", Tone.Gain>;
  /** Per take: its gain, and the pass playing now (stopped early if it's no longer scheduled). */
  takes: Map<string, { gain: Tone.Gain; pass?: { source: AudioBufferSourceNode; end: number } }>;
  /** Takes already reported as missing or failed this session. */
  reported: Set<string>;
  /** By `instrumentKey`: the instrument, its tail and when its last note ends. */
  instruments: Map<string, { instrument: RoleInstruments[Role]; tail: number; lastEnd: number }>;
};

/** Between ▶ and the first bar: waiting for sample sets, or not. */
type Startup = { kind: "idle" } | { kind: "waitingForSounds"; token: object };

const TOP: Position = { arrIdx: 0, lap: 0, bar: 0 };
const FADE = 0.02;
/** A late bar starts this long after now. */
const RESYNC = 0.02;

function toDb(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return -100; // Tone may ignore -Infinity (v1)
  return Tone.gainToDb(Math.min(100, level) / 100);
}

export function makeEngine(options: EngineOptions = {}): ToneEngine {
  const lookahead = options.lookahead ?? 0.2;
  const startDelay = options.startDelay ?? 0.05;
  const atAudibleTime =
    options.atAudibleTime ?? ((fn: () => void, time: number) => Tone.getDraw().schedule(fn, time));
  // Captured once: Tone's global context can be swapped (e.g. by Tone.Offline).
  const context = Tone.getContext();
  const ctx = () => context;
  const samples =
    options.samples ??
    makeSampleLibrary({
      baseUrl: options.sampleBaseUrl ?? "",
      loadBuffer: webAudioLoader(context.rawContext as BaseAudioContext),
    });
  const patches = options.patches ?? makePatchFactory({ samples, random: Math.random });
  const sampleWait = options.sampleWait ?? 1500;
  const raw = context.rawContext as BaseAudioContext;
  const takes =
    options.takes ??
    makeTakeLibrary({
      store: openLoopStore(),
      decode: async (blob) => raw.decodeAudioData(await blob.arrayBuffer()),
      createBuffer: (channels, length, rate) => raw.createBuffer(channels, length, rate),
    });
  /** Silences every channel but master while recording without headphones. */
  let silenced = false;
  let startup: Startup = { kind: "idle" };

  let getSource: (() => EngineSource) | undefined;
  let transport: Transport = { status: "stopped", scope: { kind: "arrangement" } };
  const listeners = new Set<(e: EngineEvent) => void>();

  // Playback state (while playing).
  let session: Session | undefined;
  let timer: number | undefined;
  /** The last scheduled bar: the next one follows from it. */
  let last: { at: Position; end: number } | undefined;
  /** Recently scheduled bars, to find the audible one on pause. */
  let recent: { at: Position; start: number; prevVoicing: number[] | undefined }[] = [];
  let voicing: number[] | undefined;

  // Long-lived mixer.
  let channels: Record<Channel | "master", Tone.Channel> | undefined;
  let levels: Mix["levels"] = { ...DEFAULT_LEVELS };
  let mutes: Practice["mutes"] = { ...DEFAULT_MUTES };

  const timing = { bars: 0, lastMs: 0, maxMs: 0, totalMs: 0, lead: 0, minLead: Infinity, late: 0 };

  function emit(e: EngineEvent) {
    for (const l of listeners) {
      try {
        l(e);
      } catch (err) {
        console.error("engine listener failed", err); // never let the UI stop playback
      }
    }
  }
  function setTransport(t: Transport) {
    transport = t;
    emit({ type: "transport", transport: t });
  }
  function source(): EngineSource {
    if (!getSource) throw new Error("engine has no source: call setSource first");
    return getSource();
  }

  function mixer() {
    if (!channels) {
      const master = new Tone.Channel().toDestination();
      const ch = () => new Tone.Channel().connect(master);
      channels = { master, chords: ch(), bass: ch(), drums: ch(), loops: ch() };
      applyMix();
    }
    return channels;
  }
  function applyMix() {
    if (!channels) return;
    for (const [name, channel] of Object.entries(channels) as [
      Channel | "master",
      Tone.Channel,
    ][]) {
      channel.volume.value = toDb(levels[name]);
      channel.mute = name !== "master" && (mutes[name] || silenced);
    }
  }

  function openSession(): Session {
    const ch = mixer();
    const gain = (to: Role | "loops") => new Tone.Gain(1).connect(ch[to]);
    return {
      gains: {
        chords: gain("chords"),
        bass: gain("bass"),
        drums: gain("drums"),
        loops: gain("loops"),
      },
      instruments: new Map(),
      takes: new Map(),
      reported: new Set(),
    };
  }

  /** Fades a session out and disposes it once silent. */
  function closeSession(s: Session) {
    const now = ctx().now();
    for (const g of Object.values(s.gains)) g.gain.rampTo(0, FADE, now);
    ctx().setTimeout(() => {
      for (const i of s.instruments.values()) i.instrument.dispose();
      for (const t of s.takes.values()) {
        t.pass?.source.stop();
        t.gain.dispose();
      }
      for (const g of Object.values(s.gains)) g.dispose();
    }, FADE * 5);
  }

  /** The instrument for `ref` in `song`, built on first use; `end` is when this note stops. */
  function instrument<R extends Role>(
    song: DeepReadonly<Song>,
    role: R,
    ref: DeepReadonly<PatchRef>,
    end: number,
  ): RoleInstruments[R] {
    const s = session!;
    const spec = instrumentSpec(song, role, ref);
    const key = instrumentKey(spec);
    let entry = s.instruments.get(key);
    if (!entry) {
      entry = {
        instrument: patches(role, spec, s.gains[role]),
        tail: tailSeconds(spec, samples.sets),
        lastEnd: end,
      };
      s.instruments.set(key, entry);
    }
    entry.lastEnd = Math.max(entry.lastEnd, end);
    return entry.instrument as RoleInstruments[R];
  }

  /**
   * Starts each take's pass at its bar 1 (or mid-take on a fresh start), and stops
   * a pass at this bar if its take isn't scheduled any more.
   */
  function playLoops(bar: ScheduledBar, start: number, fresh: boolean) {
    const s = session!;
    const scheduled = new Set(bar.loops.map((l) => l.takeId as string));
    for (const [id, t] of s.takes) {
      if (t.pass && t.pass.end > start && !scheduled.has(id)) {
        t.pass.source.stop(start);
        t.pass = undefined;
      }
    }
    for (const l of bar.loops) {
      const status = takes.status(l.takeId);
      switch (status.kind) {
        case "ready": {
          let t = s.takes.get(l.takeId);
          if (!t) {
            t = { gain: new Tone.Gain(l.gain).connect(s.gains.loops) };
            s.takes.set(l.takeId, t);
          }
          t.gain.gain.setValueAtTime(l.gain, start);
          if (l.barInTake !== 0 && !fresh && t.pass && t.pass.end > start) break; // still playing
          t.pass?.source.stop(start);
          const buffer = status.buffer;
          const offset = (l.barInTake / l.bars) * buffer.duration;
          if (offset >= buffer.duration) break;
          // A plain Web Audio node: its own `ended` fires after it has really played
          // (Tone's is timer-driven), and ended nodes are freed by the browser.
          const source = raw.createBufferSource();
          source.buffer = buffer;
          Tone.connect(source, t.gain);
          source.onended = () => source.disconnect();
          source.start(start, offset);
          t.pass = { source, end: start + (buffer.duration - offset) };
          break;
        }
        case "unloaded":
          void takes.load(l.takeId);
          break;
        case "loading":
          break;
        case "missing":
        case "failed":
          if (!s.reported.has(l.takeId)) {
            s.reported.add(l.takeId);
            const problem =
              status.kind === "missing"
                ? ({ kind: "missing" } as const)
                : ({ kind: "failed", error: status.error } as const);
            atAudibleTime(() => emit({ type: "loopProblem", takeId: l.takeId, problem }), start);
          }
          break;
        default:
          assertNever(status);
      }
    }
  }

  /** Disposes instruments the song no longer uses once they're silent. */
  function sweep(song: DeepReadonly<Song>) {
    const s = session!;
    const uses = [...s.instruments].map(([key, e]) => ({ key, lastEnd: e.lastEnd, tail: e.tail }));
    for (const key of instrumentsToDispose(uses, songInstrumentKeys(song), ctx().now())) {
      s.instruments.get(key)!.instrument.dispose();
      s.instruments.delete(key);
    }
  }

  /** Computes, schedules and emits one bar starting at `start`; queues the next. */
  function playBar(at: Position, planned: number, fresh: boolean) {
    const t0 = performance.now();
    const src = source();
    const scope = transport.scope;
    const prevVoicing = voicing;
    const bar = scheduleBar(src, at, scope, voicing);
    voicing = bar.voicing;

    const now = ctx().now();
    const lead = planned - now;
    const late = lead < 0;
    const start = late ? now + RESYNC : planned;

    const spt = 60 / (bar.tempo * PPQ);
    const time = (ticks: number) => start + ticks * spt;
    const song = src.song;
    for (const c of bar.chords) {
      if (c.continued && !fresh) continue; // already ringing
      const end = time(c.time + c.duration);
      instrument(song, "chords", c.instrument, end).play(c.midi, time(c.time), c.duration * spt);
    }
    for (const n of bar.parts.bass) {
      const end = time(n.time + n.duration);
      instrument(song, "bass", n.instrument, end).play(n.midi, time(n.time), n.duration * spt);
    }
    for (const h of bar.drums) {
      instrument(song, "drums", h.instrument, time(h.time)).hit(h.drum, time(h.time));
    }
    playLoops(bar, start, fresh);
    sweep(song);
    for (const id of songSampleSets(song)) void samples.load(id); // edits may add sets
    for (const id of playableTakeIds(src)) void takes.load(id); // and takes

    const end = time(bar.length);
    const beatTicks = (PPQ * 4) / bar.meter.beatUnit;
    atAudibleTime(() => emit({ type: "bar", bar, source: src, start }), start);
    for (let beat = 0; beat < bar.meter.beatsPerBar; beat++) {
      atAudibleTime(
        () => emit({ type: "beat", position: bar.position, beat }),
        time(beat * beatTicks),
      );
    }
    for (const c of bar.chords) {
      atAudibleTime(
        () => emit({ type: "chord", position: bar.position, chordIndex: c.chordIndex }),
        time(c.time),
      );
    }

    last = { at: bar.position, end };
    recent = [
      ...recent.filter((r) => r.start > start - 60),
      { at: bar.position, start, prevVoicing },
    ];

    const scheduleMs = performance.now() - t0;
    timing.bars++;
    timing.lastMs = scheduleMs;
    timing.maxMs = Math.max(timing.maxMs, scheduleMs);
    timing.totalMs += scheduleMs;
    timing.lead = lead;
    timing.minLead = Math.min(timing.minLead, lead);
    if (late) timing.late++;
    options.onBarScheduled?.({ bar, start, end, fresh, scheduleMs, lead, late });

    timer = ctx().setTimeout(nextBar, Math.max(0, end - lookahead - ctx().now()));
  }

  /** Follows the last bar: applies queued jumps and the current source, then plays. */
  function nextBar() {
    timer = undefined;
    if (transport.status !== "playing" || !last) return;
    try {
      const src = source();
      const at = clampPosition(src.song, last.at, transport.scope);
      const next = nextPosition(src, { ...transport, at } as Playing);
      const t: Playing = { ...next, at: clampPosition(src.song, next.at, next.scope) };
      transport = t; // jumps consumed; announced with the bar
      emit({ type: "transport", transport: t });
      playBar(t.at, last.end, false);
    } catch (error) {
      fail(error);
    }
  }

  /** Stops sound and pauses on the audible bar (stops if nothing played yet), then reports. */
  function fail(error: unknown) {
    const a = audible();
    const scope = transport.scope;
    stopSound();
    voicing = a?.prevVoicing;
    setTransport(a ? { status: "paused", scope, at: a.at } : { status: "stopped", scope });
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }

  function stopSound() {
    if (timer !== undefined) ctx().clearTimeout(timer);
    timer = undefined;
    if (session) closeSession(session);
    session = undefined;
    last = undefined;
  }

  /** The bar sounding now (or about to). */
  function audible(): { at: Position; prevVoicing: number[] | undefined } | undefined {
    const now = ctx().now();
    const started = recent.filter((r) => r.start <= now);
    return started.at(-1) ?? recent[0];
  }

  /** Starts the first bar now (after any wait for samples). */
  function start(from: Position | undefined, resumed: Promise<void>): Promise<void> {
    if (transport.status === "playing") return Promise.resolve();
    const before = transport;
    try {
      const src = source();
      const scope = transport.scope;
      const resumeAt = transport.status === "paused" ? transport.at : transport.cue;
      if (transport.status === "stopped") voicing = undefined; // stop resets voice-leading
      const at = clampPosition(src.song, from ?? resumeAt ?? TOP, scope);
      session = openSession();
      recent = [];
      setTransport({ status: "playing", scope, at });
      playBar(at, ctx().now() + startDelay, true);
    } catch (error) {
      stopSound();
      return failStart(error, before);
    }
    return resumed.then(() => undefined);
  }

  /** A failed ▶: back to where we were, report, reject. */
  function failStart(error: unknown, before: Transport): Promise<void> {
    setTransport(before); // nothing played
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  const engine: ToneEngine = {
    setSource(get) {
      getSource = get;
    },

    play(from) {
      if (transport.status === "playing") return Promise.resolve();
      // Resume inside the user gesture; schedule right away (a suspended context's
      // clock doesn't move until it resumes).
      const resumed = ctx().resume();
      let pending: { sets: string[]; takes: string[] };
      try {
        const src = source();
        pending = {
          sets: pendingSets(samples, songSampleSets(src.song)),
          takes: pendingTakes(takes, playableTakeIds(src)),
        };
      } catch (error) {
        return failStart(error, transport);
      }
      if (pending.sets.length === 0 && pending.takes.length === 0) {
        startup = { kind: "idle" };
        return start(from, resumed);
      }
      const token = {};
      startup = { kind: "waitingForSounds", token };
      emit({ type: "loadingSounds", ...pending });
      const loading = Promise.all([
        ...pending.sets.map((id) => samples.load(id)),
        ...pending.takes.map((id) => takes.load(id)),
      ]);
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, sampleWait));
      return Promise.race([loading, timeout]).then(() => {
        // Paused, stopped or pressed ▶ again while waiting: that call wins.
        if (startup.kind !== "waitingForSounds" || startup.token !== token) return;
        startup = { kind: "idle" };
        return start(from, resumed);
      });
    },

    pause() {
      startup = { kind: "idle" };
      if (transport.status !== "playing") return;
      const a = audible();
      stopSound();
      voicing = a?.prevVoicing; // resume re-voices the paused bar the same way
      setTransport({ status: "paused", scope: transport.scope, at: a?.at ?? transport.at });
    },

    stop() {
      startup = { kind: "idle" };
      stopSound();
      voicing = undefined;
      setTransport({ status: "stopped", scope: transport.scope });
    },

    setScope(scope: PlayScope) {
      const song = getSource?.().song;
      const move = (at: Position) => (song ? changeScope(song, at, transport.scope, scope) : at);
      switch (transport.status) {
        case "playing":
          if (last) last = { ...last, at: move(last.at) };
          setTransport({ ...transport, scope });
          break;
        case "paused":
          setTransport({ status: "paused", scope, at: move(transport.at) });
          break;
        case "stopped": {
          const t: Transport = { status: "stopped", scope };
          if (transport.cue) t.cue = move(transport.cue);
          setTransport(t);
          break;
        }
      }
    },

    queueJump(jump: Jump | undefined) {
      const land = (at: Position): Position =>
        jump ? { ...at, arrIdx: jump.arrIdx, bar: jump.kind === "chord" ? jump.bar : 0 } : at;
      switch (transport.status) {
        case "playing": {
          const { jump: _old, ...rest } = transport;
          setTransport(jump ? { ...rest, jump } : rest);
          break;
        }
        case "paused":
          setTransport({ ...transport, at: land(transport.at) });
          break;
        case "stopped":
          if (jump) setTransport({ ...transport, cue: land(transport.cue ?? TOP) });
          break;
      }
    },

    queueKeyJump(lap: number | undefined) {
      switch (transport.status) {
        case "playing": {
          const { keyJump: _old, ...rest } = transport;
          setTransport(lap === undefined ? rest : { ...rest, keyJump: lap });
          break;
        }
        case "paused":
          if (lap !== undefined) setTransport({ ...transport, at: { ...transport.at, lap } });
          break;
        case "stopped":
          if (lap !== undefined)
            setTransport({ ...transport, cue: { ...(transport.cue ?? TOP), lap } });
          break;
      }
    },

    setLevels(next) {
      levels = { ...next };
      applyMix();
    },

    setMutes(next) {
      mutes = { ...next };
      applyMix();
    },

    setSilenced(on) {
      silenced = on;
      applyMix();
    },

    setLoopOffsetMs(ms) {
      takes.setOffsetMs(ms); // the next pass of each take uses it
    },

    forgetTake(id) {
      takes.forget(id);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getTransport: () => transport,

    stats: () => ({
      bars: timing.bars,
      lastMs: timing.lastMs,
      maxMs: timing.maxMs,
      avgMs: timing.bars ? timing.totalMs / timing.bars : 0,
      lead: timing.lead,
      minLead: timing.bars ? timing.minLead : 0,
      late: timing.late,
      lookahead,
    }),

    dispose() {
      stopSound();
      listeners.clear();
      if (channels) for (const c of Object.values(channels)) c.dispose();
      channels = undefined;
    },
  };
  return engine;
}
