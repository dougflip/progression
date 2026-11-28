/**
 * The looper: records one pass of a section from the mic and saves it as a take.
 *
 *   idle → arming (mic opens; the section loops; wait for its bar 1)
 *        → recording (one pass of the section)
 *        → saving (audio into the loop store)
 *        → idle, with a `recorded` event carrying the new take
 *
 * The audio is saved before the take is announced, so a doc never names a take
 * whose audio failed to save. Every failure is a `RecordError`; the looper goes
 * back to idle and nothing is added. Pausing or stopping playback cancels.
 *
 * Recording starts when arming (not at bar 1), so bar 1 always lies inside the
 * recording; the take keeps where bar 1 fell (`bar1Ms`) and the device's loop
 * offset is applied at playback (`TakeLibrary`). Headless: the mic and the clock
 * are injected.
 */

import * as Tone from "tone";
import { nextTakeName, recordAvailability, sectionTakes, takeShape } from "../core/looper";
import type { EngineEvent, EngineSource, PlayScope, Position, Transport } from "../model/runtime";
import type { ItemId, LoopTake, SectionId, TakeId } from "../model/schema";
import { assertNever } from "../model/types";
import type { LoopStore, StoreError } from "../storage/loopStore";

export type LooperState =
  | { kind: "idle" }
  | { kind: "arming"; sectionId: SectionId }
  | { kind: "recording"; sectionId: SectionId; endsAt: number }
  | { kind: "saving"; sectionId: SectionId };

export type MicError =
  | { kind: "micDenied" }
  | { kind: "noMic" }
  | { kind: "notSupported" }
  | { kind: "micFailed"; message: string };

export type RecordError =
  | { kind: "unavailable"; reason: "cycle" }
  | { kind: "busy" }
  | MicError
  /** The browser produced no audio. */
  | { kind: "emptyRecording" }
  | { kind: "saveFailed"; error: StoreError };

export type LooperEvent =
  | { type: "state"; state: LooperState }
  /** Audio is saved: add `take` to the section (`addTake`). */
  | { type: "recorded"; sectionId: SectionId; take: LoopTake }
  | { type: "error"; error: RecordError };

/** Mic capture. The browser's is `browserMic`; tests use a fake. */
export interface Mic {
  /** Starts capturing. `startedAt` is the context time the recording begins. */
  start(): Promise<{ ok: true; startedAt: number } | { ok: false; error: MicError }>;
  /** Ends capture and returns the recording. */
  stop(): Promise<Blob>;
  /** Ends capture and discards it. */
  cancel(): void;
}

/** The engine calls the looper needs. */
export interface LooperEngine {
  subscribe(listener: (e: EngineEvent) => void): () => void;
  getTransport(): Transport;
  setScope(scope: PlayScope): void;
  play(from?: Position): Promise<void>;
  setSilenced(on: boolean): void;
}

export interface Looper {
  state(): LooperState;
  subscribe(listener: (e: LooperEvent) => void): () => void;
  /** Arms and records one pass of the section. Resolves when back to idle. */
  record(sectionId: SectionId): Promise<void>;
  /** Stops arming or recording and discards it. */
  cancel(): void;
  dispose(): void;
}

/** Recording runs this long past the section's end, so a late-arriving sound (the offset) fits. */
export const TAIL_SECONDS = 0.5;

export function makeLooper(deps: {
  engine: LooperEngine;
  source: () => EngineSource;
  store: LoopStore;
  /** The library item the takes belong to. */
  itemId: ItemId;
  openMic: () => Mic;
  /** Context time now. */
  now: () => number;
  /** Runs `fn` at context time `at` (or soon after). */
  at: (time: number, fn: () => void) => void;
  /** Silence the backing while recording (no headphones). */
  silenceWhileRecording: () => boolean;
  newId?: () => string;
}): Looper {
  const listeners = new Set<(e: LooperEvent) => void>();
  let state: LooperState = { kind: "idle" };
  /** The current attempt; a newer one (or cancel) makes older callbacks no-ops. */
  let attempt: { mic: Mic; startedAt: number; finish?: () => void } | undefined;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  const currentState = (): LooperState => state;
  const emit = (e: LooperEvent) => listeners.forEach((l) => l(e));
  function setState(next: LooperState) {
    state = next;
    emit({ type: "state", state: next });
  }
  function fail(error: RecordError) {
    deps.engine.setSilenced(false);
    setState({ kind: "idle" });
    emit({ type: "error", error });
  }

  const unsubscribe = deps.engine.subscribe((e) => {
    switch (e.type) {
      case "bar":
        if (
          state.kind === "arming" &&
          e.bar.sectionId === state.sectionId &&
          e.bar.position.bar === 0
        ) {
          startPass(state.sectionId, e.start);
        }
        break;
      case "transport":
        if (e.transport.status !== "playing") cancel(); // pause or stop
        break;
      case "beat":
      case "chord":
      case "error":
      case "loadingSounds":
      case "loopProblem":
        break;
      default:
        assertNever(e);
    }
  });

  /** Bar 1 of the section starts at `bar1`: record one pass from there. */
  function startPass(sectionId: SectionId, bar1: number) {
    const current = attempt;
    if (!current) return;
    const shape = takeShape(deps.source(), sectionId);
    const endsAt = bar1 + shape.seconds;
    if (deps.silenceWhileRecording()) deps.engine.setSilenced(true);
    setState({ kind: "recording", sectionId, endsAt });
    deps.at(endsAt, () => {
      if (attempt === current) deps.engine.setSilenced(false);
    });
    deps.at(endsAt + TAIL_SECONDS, () => {
      if (attempt === current) void save(current, sectionId, bar1, shape);
    });
  }

  async function save(
    current: NonNullable<typeof attempt>,
    sectionId: SectionId,
    bar1: number,
    shape: ReturnType<typeof takeShape>,
  ) {
    setState({ kind: "saving", sectionId });
    const blob = await current.mic.stop();
    if (attempt !== current) return;
    attempt = undefined;
    if (blob.size === 0) return fail({ kind: "emptyRecording" });

    const id = newId() as TakeId;
    const saved = await deps.store.put({
      id,
      itemId: deps.itemId,
      blob,
      mimeType: blob.type,
      bar1Ms: (bar1 - current.startedAt) * 1000,
      takeMs: shape.seconds * 1000,
    });
    if (!saved.ok) return fail({ kind: "saveFailed", error: saved.error });

    const src = deps.source();
    const doc = src.doc ?? src.song;
    const take: LoopTake = {
      id,
      name: nextTakeName(sectionTakes(doc, sectionId)),
      bars: shape.bars,
      gain: 1,
      recorded: shape.recorded,
    };
    setState({ kind: "idle" });
    emit({ type: "recorded", sectionId, take });
  }

  function cancel() {
    if (!attempt && state.kind === "idle") return;
    attempt?.mic.cancel();
    attempt = undefined;
    deps.engine.setSilenced(false);
    if (state.kind !== "idle") setState({ kind: "idle" });
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async record(sectionId) {
      if (state.kind !== "idle") return emit({ type: "error", error: { kind: "busy" } });
      const src = deps.source();
      const available = recordAvailability(src);
      switch (available.kind) {
        case "available":
          break;
        case "unavailable":
          return emit({ type: "error", error: { kind: "unavailable", reason: available.reason } });
        default:
          return assertNever(available);
      }

      setState({ kind: "arming", sectionId });
      const mic = deps.openMic();
      const started = await mic.start();
      // State may have changed while the mic opened (cancelled): read it fresh.
      if (currentState().kind !== "arming") return mic.cancel();
      if (!started.ok) return fail(started.error);
      attempt = { mic, startedAt: started.startedAt };

      // Loop the section and play into its bar 1 (from the top of it if not playing).
      deps.engine.setScope({ kind: "section", sectionId });
      if (deps.engine.getTransport().status !== "playing") {
        const arrIdx = Math.max(0, src.song.arrangement.indexOf(sectionId));
        await deps.engine.play({ arrIdx, lap: 0, bar: 0 }).catch(() => cancel());
      }
    },

    cancel,
    dispose() {
      cancel();
      unsubscribe();
      listeners.clear();
    },
  };
}

/**
 * The browser's mic: getUserMedia (raw: no echo cancellation, noise suppression
 * or gain control, which would mangle an instrument) into a MediaRecorder.
 */
export function browserMic(context: BaseAudioContext): Mic {
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  const chunks: Blob[] = [];
  const release = () => stream?.getTracks().forEach((t) => t.stop());

  return {
    async start() {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        return { ok: false, error: { kind: "notSupported" } };
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          return { ok: false, error: { kind: "micDenied" } };
        }
        if (name === "NotFoundError" || name === "OverconstrainedError") {
          return { ok: false, error: { kind: "noMic" } };
        }
        return { ok: false, error: { kind: "micFailed", message: String(e) } };
      }
      const rec = new MediaRecorder(stream);
      recorder = rec;
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      return new Promise((resolve) => {
        rec.onstart = () => resolve({ ok: true, startedAt: context.currentTime });
        rec.onerror = () => {
          release();
          resolve({ ok: false, error: { kind: "micFailed", message: "recorder error" } });
        };
        rec.start();
      });
    },
    stop() {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === "inactive") return resolve(new Blob(chunks));
        const rec = recorder;
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType }));
        };
        rec.stop();
      });
    },
    cancel() {
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      release();
      chunks.length = 0;
    },
  };
}

/** The looper wired to the browser: its mic, Tone's clock and the device's loop store. */
export function makeBrowserLooper(options: {
  engine: LooperEngine;
  source: () => EngineSource;
  store: LoopStore;
  itemId: ItemId;
  silenceWhileRecording: () => boolean;
}): Looper {
  const context = Tone.getContext();
  return makeLooper({
    ...options,
    openMic: () => browserMic(context.rawContext as BaseAudioContext),
    now: () => context.currentTime,
    // Tone's timers run off the audio clock (and keep running in background tabs).
    at: (time, fn) => void context.setTimeout(fn, Math.max(0, time - context.currentTime)),
  });
}
