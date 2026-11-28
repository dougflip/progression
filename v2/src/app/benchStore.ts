/**
 * The bench's saved state (localStorage), until the library exists (Milestone 8):
 * entries that differ from their fixture (recorded takes, practice edits, JSON
 * edits, shared links), and the looper's device settings. Saved entries keep
 * recorded takes across reloads; the loop store's sweep keeps only their audio.
 */

import { docTakeIds } from "../core/looper";
import { validateEnvelope } from "../model/envelope";
import type { ShareEnvelope, TakeId } from "../model/schema";

const ENTRIES_KEY = "progression-v2-bench";
const LOOPER_KEY = "progression-v2-looper";

export type SavedEntry = { name: string; env: ShareEnvelope };

/** Saved entries that still validate (others are dropped, with a console note). */
export function loadSavedEntries(): SavedEntry[] {
  const raw = read(ENTRIES_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x: { name?: unknown; env?: unknown }) => {
    const result = validateEnvelope(x?.env);
    if (typeof x?.name !== "string" || !result.ok) {
      console.warn("bench: dropped a saved entry that no longer validates", x?.name);
      return [];
    }
    return [{ name: x.name, env: result.value }];
  });
}

export function saveEntries(entries: readonly SavedEntry[]): void {
  write(ENTRIES_KEY, entries);
}

/** Every take the saved entries reference: the loop store keeps exactly these. */
export function savedTakeIds(entries: readonly SavedEntry[]): Set<TakeId> {
  return new Set(entries.flatMap((e) => docTakeIds(e.env.doc)));
}

/** Device settings for the looper (AppPrefs.loopOffsetMs once the app has prefs). */
export type LooperPrefs = { offsetMs: number; silenceWhileRecording: boolean };
export const DEFAULT_LOOPER_PREFS: LooperPrefs = { offsetMs: 0, silenceWhileRecording: false };

export function loadLooperPrefs(): LooperPrefs {
  const raw = read(LOOPER_KEY) as Partial<LooperPrefs> | undefined;
  return {
    offsetMs: Number.isFinite(raw?.offsetMs) ? raw!.offsetMs! : DEFAULT_LOOPER_PREFS.offsetMs,
    silenceWhileRecording: raw?.silenceWhileRecording === true,
  };
}

export function saveLooperPrefs(prefs: LooperPrefs): void {
  write(LOOPER_KEY, prefs);
}

function read(key: string): unknown {
  try {
    const text = localStorage.getItem(key);
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`bench: couldn't save ${key}`, e);
  }
}
