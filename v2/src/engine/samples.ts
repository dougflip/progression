/**
 * Sample sets at runtime: fetched on first use, cached with the Cache API (so a
 * set downloads once per device, and plays offline after that), decoded into
 * AudioBuffers. Loading never throws: a set ends up `ready` or `failed`, and a
 * sampler plays its fallback synth until it's ready.
 *
 * How bytes become buffers is injected (`LoadBuffer`), so tests use generated
 * buffers and nothing here needs a network.
 */

import { SAMPLE_SETS, type SampleSet } from "../model/sampleSets";
import { assertNever } from "../model/types";

export type SampleSetStatus =
  | { kind: "unloaded" }
  | { kind: "loading"; done: Promise<void> }
  | { kind: "ready"; buffers: ReadonlyMap<number, AudioBuffer> }
  | { kind: "failed"; error: string };

export interface SampleLibrary {
  readonly sets: Readonly<Record<string, SampleSet>>;
  status(id: string): SampleSetStatus;
  /** Starts loading the set (once). Resolves when it is ready or has failed; never rejects. */
  load(id: string): Promise<void>;
}

/** Fetches and decodes one sample file. */
export type LoadBuffer = (url: string) => Promise<AudioBuffer>;

export function makeSampleLibrary(options: {
  /** Where set folders live, ending in `/`. */
  baseUrl: string;
  loadBuffer: LoadBuffer;
  sets?: Readonly<Record<string, SampleSet>>;
}): SampleLibrary {
  const sets = options.sets ?? SAMPLE_SETS;
  const statuses = new Map<string, SampleSetStatus>();

  async function fetchSet(set: SampleSet): Promise<SampleSetStatus> {
    try {
      const entries = await Promise.all(
        Object.entries(set.notes).map(
          async ([midi, file]) =>
            [
              Number(midi),
              await options.loadBuffer(`${options.baseUrl}${set.path}${file}`),
            ] as const,
        ),
      );
      return { kind: "ready", buffers: new Map(entries) };
    } catch (error) {
      return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    sets,
    status: (id) => statuses.get(id) ?? { kind: "unloaded" },
    load(id) {
      const current = statuses.get(id) ?? { kind: "unloaded" };
      switch (current.kind) {
        case "loading":
          return current.done;
        case "ready":
        case "failed":
          return Promise.resolve();
        case "unloaded": {
          const set = sets[id];
          if (!set) {
            statuses.set(id, { kind: "failed", error: `unknown sample set "${id}"` });
            return Promise.resolve();
          }
          const done = fetchSet(set).then((settled) => void statuses.set(id, settled));
          statuses.set(id, { kind: "loading", done });
          return done;
        }
        default:
          return assertNever(current);
      }
    },
  };
}

/** Sets still to load (unloaded or loading). Ready and failed sets need no wait. */
export function pendingSets(library: SampleLibrary, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const status = library.status(id);
    switch (status.kind) {
      case "unloaded":
      case "loading":
        return true;
      case "ready":
      case "failed":
        return false;
      default:
        return assertNever(status);
    }
  });
}

/**
 * Loads `ids` and resolves once they've all settled or `timeoutMs` has passed,
 * whichever is first. Sets still loading keep loading; their samplers switch from
 * the fallback synth as soon as they're ready.
 */
export function loadSets(library: SampleLibrary, ids: readonly string[], timeoutMs: number) {
  return Promise.race([
    Promise.all(ids.map((id) => library.load(id))).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

const CACHE_NAME = "progression-v2-samples";

/**
 * Fetches through the Cache API when the browser has it (secure contexts), else
 * plainly; then decodes on `context`. A failed response is never cached.
 */
export function webAudioLoader(context: BaseAudioContext): LoadBuffer {
  return async (url) => {
    const bytes = await cachedFetch(url);
    return context.decodeAudioData(bytes);
  };
}

async function cachedFetch(url: string): Promise<ArrayBuffer> {
  const cache = typeof caches === "undefined" ? undefined : await caches.open(CACHE_NAME);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await cache?.put(url, response.clone());
  return response.arrayBuffer();
}
