/**
 * React view of the engine's events: transport state plus what's audible now
 * (the bar, its source, the beat and the sounding chord).
 */

import { useSyncExternalStore } from "react";
import type { ToneEngine } from "../engine/engine";
import type { EngineSource, LoopProblem, ScheduledBar, Transport } from "../model/runtime";
import { assertNever } from "../model/types";

/** Whether ▶ is waiting for sample sets. */
export type Sounds =
  | { kind: "ready" }
  | { kind: "loading"; sets: readonly string[]; takes: readonly string[] };

export interface Playback {
  transport: Transport;
  /** The audible bar and what it was scheduled from (while playing). */
  bar?: ScheduledBar;
  source?: EngineSource;
  beat?: number;
  chordIndex?: number;
  /** The last playback error; cleared when playback starts again. */
  error?: string;
  sounds: Sounds;
  /** Takes that couldn't play (missing audio or a load failure), by take id. */
  loopProblems: ReadonlyMap<string, LoopProblem>;
}

const stores = new WeakMap<
  ToneEngine,
  { get: () => Playback; subscribe: (cb: () => void) => () => void }
>();

function store(engine: ToneEngine) {
  let s = stores.get(engine);
  if (s) return s;
  const READY: Sounds = { kind: "ready" };
  let state: Playback = {
    transport: engine.getTransport(),
    sounds: READY,
    loopProblems: new Map(),
  };
  const listeners = new Set<() => void>();
  engine.subscribe((e) => {
    switch (e.type) {
      case "transport": {
        const stopped = e.transport.status !== "playing";
        const { error, ...rest } = state;
        // Any transport change ends a wait for sounds (it played, or was cancelled).
        state = stopped
          ? {
              transport: e.transport,
              sounds: READY,
              loopProblems: state.loopProblems,
              ...(error !== undefined && { error }),
            }
          : { ...rest, transport: e.transport, sounds: READY };
        break;
      }
      case "error":
        state = { ...state, error: e.message };
        break;
      case "bar": {
        // A chord still sounding from the previous bar stays lit until a new one starts.
        const held = e.bar.chords.find((c) => c.continued)?.chordIndex;
        const sameSection =
          state.bar?.sectionId === e.bar.sectionId &&
          state.bar.position.arrIdx === e.bar.position.arrIdx;
        state = {
          ...state,
          bar: e.bar,
          source: e.source,
          beat: undefined,
          chordIndex: held ?? (sameSection ? state.chordIndex : undefined),
        };
        break;
      }
      case "beat":
        state = { ...state, beat: e.beat };
        break;
      case "chord":
        state = { ...state, chordIndex: e.chordIndex };
        break;
      case "loadingSounds":
        state = { ...state, sounds: { kind: "loading", sets: e.sets, takes: e.takes } };
        break;
      case "loopProblem":
        state = { ...state, loopProblems: new Map(state.loopProblems).set(e.takeId, e.problem) };
        break;
      default:
        assertNever(e);
    }
    listeners.forEach((l) => l());
  });
  s = {
    get: () => state,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  stores.set(engine, s);
  return s;
}

export function usePlayback(engine: ToneEngine): Playback {
  const s = store(engine);
  return useSyncExternalStore(s.subscribe, s.get);
}
