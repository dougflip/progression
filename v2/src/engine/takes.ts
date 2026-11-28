/**
 * Recorded takes at runtime: audio read from the loop store, decoded once, and
 * aligned with the device's loop offset (`alignTake`). The raw recording is kept,
 * so changing the offset re-aligns every take without reloading.
 *
 * Loading never throws. A take ends up `ready`, `missing` (this device has no
 * audio for it: another device's song, or cleared site data) or `failed` (the
 * store or the decoder failed). Only `ready` takes sound; the engine reports the
 * others once and keeps playing.
 */

import { alignTake } from "../core/looper";
import { assertNever } from "../model/types";
import type { LoopStore, StoreError } from "../storage/loopStore";

export type TakeStatus =
  | { kind: "unloaded" }
  | { kind: "loading"; done: Promise<void> }
  | { kind: "ready"; buffer: AudioBuffer }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

export interface TakeLibrary {
  status(id: string): TakeStatus;
  /** Starts loading (once). Resolves when settled; never rejects. */
  load(id: string): Promise<void>;
  /** Device input latency (ms): re-aligns every take from its raw recording. */
  setOffsetMs(ms: number): void;
  /** Drops a take (deleted), so a later load reads the store again. */
  forget(id: string): void;
}

/** A decoded recording and where its take lies in it. */
interface Raw {
  recording: AudioBuffer;
  bar1Ms: number;
  takeMs: number;
}

type Entry =
  | { kind: "loading"; done: Promise<void> }
  | { kind: "loaded"; raw: Raw; aligned?: { offsetMs: number; buffer: AudioBuffer } }
  | { kind: "missing" }
  | { kind: "failed"; error: string };

export function makeTakeLibrary(options: {
  store: LoopStore;
  decode: (blob: Blob) => Promise<AudioBuffer>;
  /** Makes an empty buffer (the aligned take) on the playing context. */
  createBuffer: (channels: number, length: number, sampleRate: number) => AudioBuffer;
  offsetMs?: number;
}): TakeLibrary {
  const entries = new Map<string, Entry>();
  let offsetMs = options.offsetMs ?? 0;

  async function read(id: string): Promise<Entry> {
    const found = await options.store.get(id as never);
    if (!found.ok) return { kind: "failed", error: storeErrorText(found.error) };
    switch (found.value.kind) {
      case "missing":
        return { kind: "missing" };
      case "found": {
        const { blob, bar1Ms, takeMs } = found.value.audio;
        try {
          return { kind: "loaded", raw: { recording: await options.decode(blob), bar1Ms, takeMs } };
        } catch (e) {
          return {
            kind: "failed",
            error: `couldn't decode: ${e instanceof Error ? e.message : e}`,
          };
        }
      }
      default:
        return assertNever(found.value);
    }
  }

  function aligned(entry: Extract<Entry, { kind: "loaded" }>): AudioBuffer {
    if (entry.aligned?.offsetMs === offsetMs) return entry.aligned.buffer;
    const { recording, bar1Ms, takeMs } = entry.raw;
    const rate = recording.sampleRate;
    const length = Math.round((takeMs / 1000) * rate);
    const buffer = options.createBuffer(recording.numberOfChannels, length, rate);
    for (let c = 0; c < recording.numberOfChannels; c++) {
      const data = alignTake(
        recording.getChannelData(c),
        (bar1Ms / 1000) * rate,
        (offsetMs / 1000) * rate,
        length,
      );
      buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c);
    }
    entry.aligned = { offsetMs, buffer };
    return buffer;
  }

  return {
    status(id) {
      const entry = entries.get(id);
      if (!entry) return { kind: "unloaded" };
      switch (entry.kind) {
        case "loading":
        case "missing":
        case "failed":
          return entry;
        case "loaded":
          return { kind: "ready", buffer: aligned(entry) };
        default:
          return assertNever(entry);
      }
    },
    load(id) {
      const entry = entries.get(id);
      if (entry?.kind === "loading") return entry.done;
      if (entry) return Promise.resolve();
      const done = read(id).then((settled) => {
        if (entries.get(id)?.kind === "loading") entries.set(id, settled); // not forgotten meanwhile
      });
      entries.set(id, { kind: "loading", done });
      return done;
    },
    setOffsetMs(ms) {
      offsetMs = ms;
    },
    forget(id) {
      entries.delete(id);
    },
  };
}

/** A store failure in words, for the UI. */
export function storeErrorText(error: StoreError): string {
  switch (error.kind) {
    case "quotaExceeded":
      return "storage is full";
    case "unavailable":
      return `storage unavailable: ${error.message}`;
    case "failed":
      return `storage error: ${error.message}`;
    default:
      return assertNever(error);
  }
}

/** Takes still to load (unloaded or loading). Settled takes need no wait. */
export function pendingTakes(library: TakeLibrary, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const status = library.status(id);
    switch (status.kind) {
      case "unloaded":
      case "loading":
        return true;
      case "ready":
      case "missing":
      case "failed":
        return false;
      default:
        return assertNever(status);
    }
  });
}
