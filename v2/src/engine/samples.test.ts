import { describe, expect, it, vi } from "vitest";
import type { SampleSet } from "../model/sampleSets";
import { loadSets, makeSampleLibrary, pendingSets, type LoadBuffer } from "./samples";

const SET: SampleSet = {
  id: "test-bass",
  role: "bass",
  path: "test-bass/",
  notes: { 40: "e2.wav", 45: "a2.wav" },
  attack: 0,
  release: 0.3,
  licence: "test",
  credit: "test",
  source: "test",
};
const SETS = { [SET.id]: SET };
const buffer = (url: string) => ({ url }) as unknown as AudioBuffer;

describe("sample library", () => {
  it("loads a set once, from its folder, and reports each status", async () => {
    const loadBuffer = vi.fn<LoadBuffer>(async (url) => buffer(url));
    const lib = makeSampleLibrary({ baseUrl: "/s/", loadBuffer, sets: SETS });
    expect(lib.status("test-bass")).toEqual({ kind: "unloaded" });

    const first = lib.load("test-bass");
    expect(lib.status("test-bass").kind).toBe("loading");
    const again = lib.load("test-bass");
    await Promise.all([first, again]);

    const status = lib.status("test-bass");
    expect(status.kind).toBe("ready");
    if (status.kind !== "ready") return;
    expect([...status.buffers.keys()]).toEqual([40, 45]);
    expect(loadBuffer.mock.calls.map(([u]) => u)).toEqual([
      "/s/test-bass/e2.wav",
      "/s/test-bass/a2.wav",
    ]);
  });

  it("marks a set failed when any file fails, without throwing", async () => {
    const lib = makeSampleLibrary({
      baseUrl: "/s/",
      loadBuffer: async (url) => {
        if (url.endsWith("a2.wav")) throw new Error("HTTP 404");
        return buffer(url);
      },
      sets: SETS,
    });
    await expect(lib.load("test-bass")).resolves.toBeUndefined();
    expect(lib.status("test-bass")).toEqual({ kind: "failed", error: "HTTP 404" });
  });

  it("fails an unknown set", async () => {
    const lib = makeSampleLibrary({ baseUrl: "", loadBuffer: async (u) => buffer(u), sets: SETS });
    await lib.load("nope");
    expect(lib.status("nope")).toEqual({ kind: "failed", error: 'unknown sample set "nope"' });
  });

  it("pendingSets lists sets not yet settled", async () => {
    const lib = makeSampleLibrary({ baseUrl: "", loadBuffer: async (u) => buffer(u), sets: SETS });
    expect(pendingSets(lib, ["test-bass"])).toEqual(["test-bass"]);
    await lib.load("test-bass");
    await lib.load("nope");
    expect(pendingSets(lib, ["test-bass", "nope"])).toEqual([]);
  });

  it("loadSets gives up waiting after the timeout; loading continues", async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const lib = makeSampleLibrary({
        baseUrl: "",
        loadBuffer: (u) => new Promise((resolve) => (finish = () => resolve(buffer(u)))),
        sets: { one: { ...SET, id: "one", notes: { 40: "e2.wav" } } },
      });
      const waited = loadSets(lib, ["one"], 1500);
      await vi.advanceTimersByTimeAsync(1500);
      await waited;
      expect(lib.status("one").kind).toBe("loading");
      finish();
      await lib.load("one");
      expect(lib.status("one").kind).toBe("ready");
    } finally {
      vi.useRealTimers();
    }
  });
});
