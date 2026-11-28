import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { LoopAudio } from "../model/runtime";
import type { ItemId, TakeId } from "../model/schema";
import { DB_NAME, openLoopStore } from "./loopStore";

const audio = (id: string, itemId = "song-1"): LoopAudio => ({
  id: id as TakeId,
  itemId: itemId as ItemId,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
  mimeType: "audio/webm",
  bar1Ms: 120,
  takeMs: 8000,
});
const tid = (s: string) => s as TakeId;

describe("loop store", () => {
  it("stores, reads back and deletes a take's audio", async () => {
    const store = openLoopStore(new IDBFactory());
    expect(await store.put(audio("t1"))).toEqual({ ok: true, value: undefined });

    const got = await store.get(tid("t1"));
    expect(got.ok && got.value.kind).toBe("found");
    if (got.ok && got.value.kind === "found") {
      expect(got.value.audio).toMatchObject({
        id: "t1",
        itemId: "song-1",
        bar1Ms: 120,
        takeMs: 8000,
      });
      expect(new Uint8Array(await got.value.audio.blob.arrayBuffer())).toEqual(
        new Uint8Array([1, 2, 3]),
      );
    }

    await store.delete(tid("t1"));
    expect(await store.get(tid("t1"))).toEqual({ ok: true, value: { kind: "missing" } });
  });

  it("reports a take with no audio on this device as missing, not as an error", async () => {
    const store = openLoopStore(new IDBFactory());
    expect(await store.get(tid("from-another-device"))).toEqual({
      ok: true,
      value: { kind: "missing" },
    });
  });

  it("deletes everything an item owns", async () => {
    const store = openLoopStore(new IDBFactory());
    await store.put(audio("a1", "song-a"));
    await store.put(audio("a2", "song-a"));
    await store.put(audio("b1", "song-b"));
    expect(await store.deleteItem("song-a" as ItemId)).toEqual({ ok: true, value: 2 });
    expect((await store.get(tid("a1"))).ok && (await store.get(tid("b1")))).toEqual({
      ok: true,
      value: { kind: "found", audio: expect.objectContaining({ id: "b1" }) },
    });
  });

  it("sweeps audio no doc references", async () => {
    const store = openLoopStore(new IDBFactory());
    for (const id of ["keep", "orphan1", "orphan2"]) await store.put(audio(id));
    const swept = await store.sweep(new Set(["keep"]));
    expect(swept.ok && [...swept.value].sort()).toEqual(["orphan1", "orphan2"]);
    expect(await store.get(tid("keep"))).toMatchObject({ ok: true, value: { kind: "found" } });
  });

  it("keeps audio across reopening (a reload)", async () => {
    const idb = new IDBFactory();
    await openLoopStore(idb).put(audio("t1"));
    expect(await openLoopStore(idb).get(tid("t1"))).toMatchObject({
      ok: true,
      value: { kind: "found" },
    });
  });

  it("reports unavailable when there is no IndexedDB", async () => {
    const store = openLoopStore(undefined);
    expect(await store.put(audio("t1"))).toEqual({
      ok: false,
      error: { kind: "unavailable", message: "IndexedDB is not available" },
    });
  });

  it("reports a full disk as quotaExceeded", async () => {
    const idb = new IDBFactory();
    const store = openLoopStore(idb);
    await store.get(tid("warm-up")); // opens the database
    const quota = new DOMException("full", "QuotaExceededError");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      throw quota;
    };
    try {
      expect(await store.put(audio("t1"))).toEqual({ ok: false, error: { kind: "quotaExceeded" } });
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  });

  it("uses the v2 database name", () => {
    expect(DB_NAME).toBe("progression-v2");
  });
});
