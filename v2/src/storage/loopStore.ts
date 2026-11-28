/**
 * Loop audio on the device: IndexedDB database "progression-v2", store
 * "loopAudio" (key = take id, index on the owning item). Headless: no UI, no
 * Tone. Every call resolves to a result; nothing throws, so callers handle each
 * failure explicitly (a full disk is its own case).
 *
 * Schema changes go through `UPGRADES` (one function per version, run in order).
 * Upgrades never wipe recorded audio.
 */

import type { LoopAudio } from "../model/runtime";
import type { ItemId, TakeId } from "../model/schema";

export type StoreError =
  /** The browser refused to store more (disk or quota full). */
  | { kind: "quotaExceeded" }
  /** IndexedDB isn't available (e.g. some private modes) or the database wouldn't open. */
  | { kind: "unavailable"; message: string }
  | { kind: "failed"; message: string };

export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

/** A take's audio, or the fact that this device has none for it. */
export type AudioLookup = { kind: "found"; audio: LoopAudio } | { kind: "missing" };

export interface LoopStore {
  put(audio: LoopAudio): Promise<StoreResult<void>>;
  get(id: TakeId): Promise<StoreResult<AudioLookup>>;
  delete(id: TakeId): Promise<StoreResult<void>>;
  /** Deletes all audio an item owns (the item was deleted). Returns how many. */
  deleteItem(itemId: ItemId): Promise<StoreResult<number>>;
  /** Deletes audio no saved doc references. Returns the ids deleted. */
  sweep(keep: ReadonlySet<string>): Promise<StoreResult<TakeId[]>>;
}

export const DB_NAME = "progression-v2";
const STORE = "loopAudio";

/** Version n+1 = UPGRADES[n]. Append only; never edit a shipped upgrade. */
const UPGRADES: ((db: IDBDatabase) => void)[] = [
  (db) => {
    const store = db.createObjectStore(STORE, { keyPath: "id" });
    store.createIndex("itemId", "itemId");
  },
];

function toError(e: unknown): StoreError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : "";
  const message = e instanceof Error || e instanceof DOMException ? e.message : String(e);
  return name === "QuotaExceededError" ? { kind: "quotaExceeded" } : { kind: "failed", message };
}

const done = <T>(value: T): StoreResult<T> => ({ ok: true, value });
const fail = <T>(error: StoreError): StoreResult<T> => ({ ok: false, error });

/** Wraps a request (or a transaction's completion) in a promise. */
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("transaction aborted", "AbortError"));
  });
}

/**
 * Opens the store. The database opens lazily on first use and is reused; if it
 * can't open, every call reports `unavailable`.
 */
export function openLoopStore(idb: IDBFactory | undefined = globalThis.indexedDB): LoopStore {
  let db: Promise<StoreResult<IDBDatabase>> | undefined;

  function open(): Promise<StoreResult<IDBDatabase>> {
    db ??= new Promise((resolve) => {
      if (!idb)
        return resolve(fail({ kind: "unavailable", message: "IndexedDB is not available" }));
      let req: IDBOpenDBRequest;
      try {
        req = idb.open(DB_NAME, UPGRADES.length);
      } catch (e) {
        return resolve(
          fail({ kind: "unavailable", message: e instanceof Error ? e.message : String(e) }),
        );
      }
      req.onupgradeneeded = (event) => {
        for (let v = event.oldVersion; v < UPGRADES.length; v++) UPGRADES[v]!(req.result);
      };
      req.onsuccess = () => resolve(done(req.result));
      req.onerror = () =>
        resolve(fail({ kind: "unavailable", message: req.error?.message ?? "could not open" }));
      req.onblocked = () =>
        resolve(fail({ kind: "unavailable", message: "close other tabs using the app and retry" }));
    });
    return db;
  }

  /** Runs `body` in a transaction; any failure becomes a `StoreError`. */
  async function run<T>(
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => Promise<T>,
  ): Promise<StoreResult<T>> {
    const opened = await open();
    if (!opened.ok) return opened;
    try {
      const tx = opened.value.transaction(STORE, mode);
      const finished = complete(tx);
      const value = await body(tx.objectStore(STORE));
      await finished;
      return done(value);
    } catch (e) {
      return fail(toError(e));
    }
  }

  return {
    put: (audio) => run("readwrite", (s) => request(s.put(audio)).then(() => undefined)),

    get: (id) =>
      run("readonly", async (s) => {
        const found = (await request(s.get(id))) as LoopAudio | undefined;
        return found ? { kind: "found" as const, audio: found } : { kind: "missing" as const };
      }),

    delete: (id) => run("readwrite", (s) => request(s.delete(id)).then(() => undefined)),

    deleteItem: (itemId) =>
      run("readwrite", async (s) => {
        const keys = await request(s.index("itemId").getAllKeys(itemId));
        await Promise.all(keys.map((k) => request(s.delete(k))));
        return keys.length;
      }),

    sweep: (keep) =>
      run("readwrite", async (s) => {
        const keys = (await request(s.getAllKeys())) as TakeId[];
        const orphans = keys.filter((k) => !keep.has(k));
        await Promise.all(orphans.map((k) => request(s.delete(k))));
        return orphans;
      }),
  };
}

/**
 * Asks the browser not to evict the app's storage under pressure. Returns whether
 * it agreed; a refusal isn't an error (audio may just be evicted later).
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
