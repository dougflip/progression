import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRACTICE } from "../core/settings";
import type { EngineEvent, EngineSource, PlayScope, Transport } from "../model/runtime";
import { Song, type ItemId, type Practice, type SectionId } from "../model/schema";
import { openLoopStore, type LoopStore } from "../storage/loopStore";
import { makeLooper, TAIL_SECONDS, type LooperEvent, type Mic, type MicError } from "./looper";

const FOUR = { beatsPerBar: 4, beatUnit: 4 } as const;
/** Verse: 2 bars at 120 = 4 s. */
const SONG = Song.parse({
  version: 2,
  kind: "song",
  title: "Rec",
  key: "D",
  ppq: 48,
  defaults: { tempo: 120, meter: FOUR, swing: 0, voicing: "voice-lead" },
  instruments: {},
  patches: {},
  sections: [
    {
      id: "intro",
      name: "Intro",
      bars: 1,
      overrides: {},
      chords: [],
      drums: {},
      parts: { bass: [] },
      loops: [],
    },
    {
      id: "verse",
      name: "Verse",
      bars: 2,
      overrides: {},
      chords: [],
      drums: {},
      parts: { bass: [] },
      loops: [],
    },
  ],
  arrangement: ["intro", "verse"],
});
const VERSE = "verse" as SectionId;

/** A fake engine: records calls; the test emits its events. */
function fakeEngine(initial: Transport["status"] = "stopped") {
  const listeners = new Set<(e: EngineEvent) => void>();
  const calls: string[] = [];
  let status = initial;
  return {
    calls,
    emit: (e: EngineEvent) => listeners.forEach((l) => l(e)),
    bar(sectionId: string, bar: number, start: number) {
      this.emit({
        type: "bar",
        start,
        source: { song: SONG, practice: DEFAULT_PRACTICE },
        bar: { sectionId: sectionId as SectionId, position: { arrIdx: 1, lap: 0, bar } } as never,
      });
    },
    stopPlaying() {
      status = "stopped";
      this.emit({
        type: "transport",
        transport: { status: "stopped", scope: { kind: "arrangement" } },
      });
    },
    engine: {
      subscribe(l: (e: EngineEvent) => void) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getTransport: () => ({ status, scope: { kind: "arrangement" } }) as Transport,
      setScope: (s: PlayScope) => void calls.push(`scope ${JSON.stringify(s)}`),
      play: async (from?: unknown) => {
        status = "playing";
        calls.push(`play ${JSON.stringify(from)}`);
      },
      setSilenced: (on: boolean) => void calls.push(`silenced ${on}`),
    },
  };
}

function fakeMic(
  result: { ok: true; startedAt: number } | { ok: false; error: MicError },
  bytes = 3,
) {
  const log: string[] = [];
  const mic: Mic = {
    start: async () => (log.push("start"), result),
    stop: async () => (log.push("stop"), new Blob([new Uint8Array(bytes)], { type: "audio/webm" })),
    cancel: () => void log.push("cancel"),
  };
  return { mic, log };
}

function setup(
  options: {
    mic?: ReturnType<typeof fakeMic>;
    store?: LoopStore;
    practice?: Practice;
    silence?: boolean;
    status?: Transport["status"];
  } = {},
) {
  const engine = fakeEngine(options.status);
  const mic = options.mic ?? fakeMic({ ok: true, startedAt: 9.5 });
  const store = options.store ?? openLoopStore(new IDBFactory());
  const timers: { time: number; fn: () => void }[] = [];
  const events: LooperEvent[] = [];
  const source = (): EngineSource => ({
    song: SONG,
    practice: options.practice ?? DEFAULT_PRACTICE,
  });
  const looper = makeLooper({
    engine: engine.engine,
    source,
    store,
    itemId: "item" as ItemId,
    openMic: () => mic.mic,
    now: () => 0,
    at: (time, fn) => void timers.push({ time, fn }),
    silenceWhileRecording: () => options.silence ?? false,
    newId: () => "take-1",
  });
  looper.subscribe((e) => void events.push(e));
  /** Runs timers due by `time`, in order, and waits for their async work. */
  const advance = async (time: number) => {
    for (const t of timers.filter((t) => t.time <= time).sort((a, b) => a.time - b.time)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    // Let the mic, the store (IndexedDB is async) and the looper settle.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const states = () => events.filter((e) => e.type === "state").map((e) => e.state.kind);
  return { engine, mic, store, looper, events, advance, states };
}

describe("looper", () => {
  it("records one pass of the section from its bar 1, saves it, then announces the take", async () => {
    const t = setup();
    await t.looper.record(VERSE);
    expect(t.looper.state()).toEqual({ kind: "arming", sectionId: "verse" });
    // Arming loops the section and plays from its top.
    expect(t.engine.calls).toEqual([
      'scope {"kind":"section","sectionId":"verse"}',
      'play {"arrIdx":1,"lap":0,"bar":0}',
    ]);

    t.engine.bar("verse", 0, 10); // bar 1 at context time 10 (the mic started at 9.5)
    expect(t.looper.state()).toEqual({ kind: "recording", sectionId: "verse", endsAt: 14 });

    await t.advance(14 + TAIL_SECONDS);
    expect(t.states()).toEqual(["arming", "recording", "saving", "idle"]);
    const recorded = t.events.find((e) => e.type === "recorded");
    expect(recorded).toEqual({
      type: "recorded",
      sectionId: "verse",
      take: {
        id: "take-1",
        name: "Take 1",
        bars: 2,
        gain: 1,
        recorded: { key: "D", tempo: 120, meter: FOUR },
      },
    });
    const stored = await t.store.get("take-1" as never);
    expect(stored).toMatchObject({
      ok: true,
      value: { kind: "found", audio: { itemId: "item", bar1Ms: 500, takeMs: 4000 } },
    });
  });

  it("waits for the section's bar 1, not any bar", async () => {
    const t = setup({ status: "playing" });
    await t.looper.record(VERSE);
    expect(t.engine.calls.some((c) => c.startsWith("play"))).toBe(false); // already playing
    t.engine.bar("intro", 0, 10);
    t.engine.bar("verse", 1, 12);
    expect(t.looper.state().kind).toBe("arming");
    t.engine.bar("verse", 0, 14);
    expect(t.looper.state().kind).toBe("recording");
  });

  it("silences the backing for the recording only, when asked", async () => {
    const t = setup({ silence: true });
    await t.looper.record(VERSE);
    t.engine.bar("verse", 0, 10);
    expect(t.engine.calls.at(-1)).toBe("silenced true");
    await t.advance(14);
    expect(t.engine.calls.at(-1)).toBe("silenced false");
  });

  it("refuses while a cycle is on", async () => {
    const t = setup({ practice: { ...DEFAULT_PRACTICE, cycle: { kind: "fifths" } } });
    await t.looper.record(VERSE);
    expect(t.events).toEqual([{ type: "error", error: { kind: "unavailable", reason: "cycle" } }]);
    expect(t.mic.log).toEqual([]);
  });

  it.each<MicError>([
    { kind: "micDenied" },
    { kind: "noMic" },
    { kind: "notSupported" },
    { kind: "micFailed", message: "x" },
  ])("reports a mic problem ($kind) and goes back to idle", async (error) => {
    const t = setup({ mic: fakeMic({ ok: false, error }) });
    await t.looper.record(VERSE);
    expect(t.looper.state()).toEqual({ kind: "idle" });
    expect(t.events.at(-1)).toEqual({ type: "error", error });
    expect(t.engine.calls.filter((c) => c.startsWith("play"))).toEqual([]);
  });

  it("adds nothing when saving fails, and says why", async () => {
    const t = setup({ store: openLoopStore(undefined) });
    await t.looper.record(VERSE);
    t.engine.bar("verse", 0, 10);
    await t.advance(20);
    expect(t.events.some((e) => e.type === "recorded")).toBe(false);
    expect(t.events.at(-1)).toEqual({
      type: "error",
      error: {
        kind: "saveFailed",
        error: { kind: "unavailable", message: "IndexedDB is not available" },
      },
    });
    expect(t.looper.state()).toEqual({ kind: "idle" });
  });

  it("reports an empty recording", async () => {
    const t = setup({ mic: fakeMic({ ok: true, startedAt: 9.5 }, 0) });
    await t.looper.record(VERSE);
    t.engine.bar("verse", 0, 10);
    await t.advance(20);
    expect(t.events.at(-1)).toEqual({ type: "error", error: { kind: "emptyRecording" } });
  });

  it("stopping playback cancels: the mic is discarded and nothing is saved", async () => {
    const t = setup({ silence: true });
    await t.looper.record(VERSE);
    t.engine.bar("verse", 0, 10);
    t.engine.stopPlaying();
    expect(t.looper.state()).toEqual({ kind: "idle" });
    expect(t.mic.log).toEqual(["start", "cancel"]);
    expect(t.engine.calls.at(-1)).toBe("silenced false");
    await t.advance(20); // the pass's timers fire into a cancelled attempt
    expect(t.events.some((e) => e.type === "recorded")).toBe(false);
    expect(await t.store.get("take-1" as never)).toEqual({ ok: true, value: { kind: "missing" } });
  });

  it("refuses a second recording while one is under way", async () => {
    const t = setup();
    await t.looper.record(VERSE);
    await t.looper.record(VERSE);
    expect(t.events.at(-1)).toEqual({ type: "error", error: { kind: "busy" } });
  });
});
