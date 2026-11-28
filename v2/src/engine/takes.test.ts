import { IDBFactory } from "fake-indexeddb";
import { AudioBuffer as NodeAudioBuffer } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import type { LoopAudio } from "../model/runtime";
import type { ItemId, TakeId } from "../model/schema";
import { openLoopStore, type LoopStore } from "../storage/loopStore";
import { makeTakeLibrary, pendingTakes } from "./takes";

const RATE = 4000; // 4 samples per ms (the lowest rate Web Audio allows is 3000)

function buffer(data: number[]): AudioBuffer {
  const b = new NodeAudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: RATE });
  b.copyToChannel(Float32Array.from(data), 0);
  return b as unknown as AudioBuffer;
}
const createBuffer = (channels: number, length: number, sampleRate: number) =>
  new NodeAudioBuffer({ length, numberOfChannels: channels, sampleRate }) as unknown as AudioBuffer;

/** The "recording": samples 1..10; bar 1 at sample 2, take 4 samples long. */
const RECORDING = buffer([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const record = (id: string): LoopAudio => ({
  id: id as TakeId,
  itemId: "song" as ItemId,
  blob: new Blob(["raw"]),
  mimeType: "audio/webm",
  bar1Ms: 0.5,
  takeMs: 1,
});

async function library(store: LoopStore, decode = async () => RECORDING) {
  return makeTakeLibrary({ store, decode, createBuffer });
}
const samples = (b: AudioBuffer) => [...b.getChannelData(0)];

describe("take library", () => {
  it("loads a take, aligned to bar 1 and cut to its length", async () => {
    const store = openLoopStore(new IDBFactory());
    await store.put(record("t1"));
    const lib = await library(store);
    expect(lib.status("t1")).toEqual({ kind: "unloaded" });
    expect(pendingTakes(lib, ["t1"])).toEqual(["t1"]);
    await lib.load("t1");
    const s = lib.status("t1");
    expect(s.kind).toBe("ready");
    if (s.kind === "ready") expect(samples(s.buffer)).toEqual([3, 4, 5, 6]);
    expect(pendingTakes(lib, ["t1"])).toEqual([]);
  });

  it("re-aligns with a new offset without reloading", async () => {
    const store = openLoopStore(new IDBFactory());
    await store.put(record("t1"));
    let decodes = 0;
    const lib = await library(store, async () => (decodes++, RECORDING));
    await lib.load("t1");
    lib.setOffsetMs(0.75); // the sound arrived 3 samples late
    const s = lib.status("t1");
    if (s.kind === "ready") expect(samples(s.buffer)).toEqual([6, 7, 8, 9]);
    expect(decodes).toBe(1);
  });

  it("reports a take with no audio on this device as missing", async () => {
    const lib = await library(openLoopStore(new IDBFactory()));
    await lib.load("elsewhere");
    expect(lib.status("elsewhere")).toEqual({ kind: "missing" });
  });

  it("reports store and decode failures as failed, without throwing", async () => {
    const broken = await library(openLoopStore(undefined));
    await broken.load("t1");
    expect(broken.status("t1")).toEqual({
      kind: "failed",
      error: "storage unavailable: IndexedDB is not available",
    });

    const store = openLoopStore(new IDBFactory());
    await store.put(record("t1"));
    const undecodable = await library(store, async () => {
      throw new Error("bad data");
    });
    await undecodable.load("t1");
    expect(undecodable.status("t1")).toEqual({
      kind: "failed",
      error: "couldn't decode: bad data",
    });
  });

  it("forgets a deleted take", async () => {
    const store = openLoopStore(new IDBFactory());
    await store.put(record("t1"));
    const lib = await library(store);
    await lib.load("t1");
    lib.forget("t1");
    expect(lib.status("t1")).toEqual({ kind: "unloaded" });
  });
});
