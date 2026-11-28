/**
 * Engine bench: play fixtures through the real engine and player. Fixture picker,
 * "swap to fixture B at the next bar" (stands in for a live edit), a JSON panel
 * (edit → applied at the next bar), section looping, practice (cycle, advance),
 * the Mix sheet, and a performance readout. The player components are the real
 * play view's.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { generateSong } from "../core/generate";
import { DEFAULT_PRACTICE } from "../core/settings";
import { STYLES } from "../core/styles";
import { clampPosition } from "../core/transport";
import { playerView, type ChipView } from "../core/view";
import { makeEngine, type EngineStats, type ScheduledBarInfo } from "../engine/engine";
import { loadDrumSamples } from "../engine/patches";
import { decodeEnvelope, encodeEnvelope, validateEnvelope } from "../model/envelope";
import { SOUND_CREDITS } from "../model/sampleSets";
import {
  addTake,
  docTakeIds,
  recordAvailability,
  removeTake,
  sectionTakes,
  takeWarnings,
  updateTake,
  withoutTakes,
} from "../core/looper";
import { makeBrowserLooper } from "../engine/looper";
import { openLoopStore, requestPersistence } from "../storage/loopStore";
import {
  loadLooperPrefs,
  loadSavedEntries,
  saveEntries,
  saveLooperPrefs,
  savedTakeIds,
  type LooperPrefs,
} from "./benchStore";
import { LooperPanel } from "./player/Looper";
import { useLooper } from "./useLooper";
import type { EngineSource, PlayScope } from "../model/runtime";
import {
  DEFAULT_LEVELS,
  type Doc,
  type ItemId,
  type Mix,
  type Practice,
  type SectionId,
  type ShareEnvelope,
  type TakeId,
} from "../model/schema";
import { cuedChips, positionText, shownPosition } from "./player/derive";
import { PlayerHeader, Scrubbers, TransportButtons } from "./player/Player";
import { MixSheet, PracticeRow } from "./player/Practice";
import { usePlayback } from "./usePlayback";

const fixtureFiles = import.meta.glob<unknown>("../../fixtures/*.json", {
  import: "default",
  eager: true,
});
const FIXTURES = Object.entries(fixtureFiles)
  .filter(([path]) => !path.endsWith("/frozen.json"))
  .flatMap(([path, raw]) => {
    const result = validateEnvelope(raw);
    const name = path
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    return result.ok ? [{ name, env: result.value }] : [];
  });

/** `rev` counts edits to the entry (practice changes), so panels showing it refresh. */
type Entry = { name: string; env: ShareEnvelope; rev?: number };

function toSource(env: ShareEnvelope): EngineSource {
  const song = env.doc.kind === "song" ? env.doc : generateSong(env.doc, STYLES);
  return { song, practice: env.practice ?? DEFAULT_PRACTICE, doc: env.doc };
}

// One engine for the page, outside React: it outlives renders (and StrictMode's
// mount/unmount/mount), and it pulls the current entry at every bar.
let playingEntry: Entry = FIXTURES[0]!;
let perfLog: ScheduledBarInfo[] = [];
const perfListeners = new Set<() => void>();
const engine = makeEngine({
  sampleBaseUrl: `${import.meta.env.BASE_URL}v2/samples/`,
  onBarScheduled: (info) => {
    perfLog = [...perfLog.slice(-31), info];
    perfListeners.forEach((l) => l());
  },
});
engine.setSource(() => toSource(playingEntry.env));

// Saved entries (recorded takes, edits) replace their fixture or join the list. The
// loop store then keeps only the audio they reference.
const SAVED = loadSavedEntries();
const FIXTURE_ENVS = new Set<ShareEnvelope>(FIXTURES.map((f) => f.env));
const STARTING_ENTRIES: Entry[] = [
  ...SAVED.filter((e) => !FIXTURES.some((f) => f.name === e.name)),
  ...FIXTURES.map((f) => SAVED.find((e) => e.name === f.name) ?? f),
];
playingEntry = STARTING_ENTRIES.find((e) => e.name === FIXTURES[0]!.name) ?? STARTING_ENTRIES[0]!;
const loopStore = openLoopStore();
void loopStore.sweep(savedTakeIds(SAVED)).then((r) => {
  if (r.ok && r.value.length) console.info(`looper: removed ${r.value.length} unreferenced takes`);
  if (!r.ok) console.warn("looper: couldn't sweep the loop store", r.error);
});
void requestPersistence();
let looperPrefs: LooperPrefs = loadLooperPrefs();
engine.setLoopOffsetMs(looperPrefs.offsetMs);
const looper = makeBrowserLooper({
  engine,
  source: () => toSource(playingEntry.env),
  store: loopStore,
  itemId: "bench" as ItemId,
  silenceWhileRecording: () => looperPrefs.silenceWhileRecording,
});
engine.setMutes((playingEntry.env.practice ?? DEFAULT_PRACTICE).mutes);
loadDrumSamples(`${import.meta.env.BASE_URL}samples/`);
const subscribePerf = (cb: () => void) => {
  perfListeners.add(cb);
  return () => perfListeners.delete(cb);
};
let sharedLinkRead = false;

export function Bench() {
  const [entries, setEntries] = useState<Entry[]>(STARTING_ENTRIES);
  const [current, setCurrent] = useState<Entry>(playingEntry);
  const [swapTarget, setSwapTarget] = useState<string>(FIXTURES[1]?.name ?? FIXTURES[0]!.name);
  const perf = useSyncExternalStore(subscribePerf, () => perfLog);
  const [levels, setLevels] = useState<Mix["levels"]>(DEFAULT_LEVELS);
  const [mixOpen, setMixOpen] = useState(false);
  const playback = usePlayback(engine);
  const { transport } = playback;
  const looperView = useLooper(looper);
  const [prefs, setPrefs] = useState<LooperPrefs>(looperPrefs);

  // Entries that differ from their fixture are saved (so takes survive a reload).
  useEffect(() => {
    saveEntries(
      entries.filter((e) => !FIXTURE_ENVS.has(e.env)).map(({ name, env }) => ({ name, env })),
    );
  }, [entries]);

  // A saved take joins the section it was recorded on (the audio is already stored).
  useEffect(
    () =>
      looper.subscribe((e) => {
        if (e.type !== "recorded") return;
        const entry = playingEntry;
        replaceEntry({
          ...entry,
          env: { ...entry.env, doc: addTake(entry.env.doc, e.sectionId, e.take) },
        });
      }),
    [],
  ); // oxlint-disable-line react/exhaustive-deps -- once

  // A shared link (?s=…) is added to the picker and opened.
  useEffect(() => {
    const param = new URLSearchParams(location.search).get("s");
    if (!param || sharedLinkRead) return;
    sharedLinkRead = true;
    void decodeEnvelope(param).then((raw) => {
      const result = validateEnvelope(raw);
      if (!result.ok) return alert(`Shared link is invalid:\n${result.errors.join("\n")}`);
      const entry = { name: "shared link", env: result.value };
      setEntries((e) => [entry, ...e]);
      load(entry);
    });
  }, []); // oxlint-disable-line react/exhaustive-deps -- once, on open

  /** Makes `entry` the source. While playing it lands on the next bar (mutes: instantly). */
  function load(entry: Entry) {
    playingEntry = entry;
    setCurrent(entry);
    engine.setMutes((entry.env.practice ?? DEFAULT_PRACTICE).mutes);
  }

  /** Replaces an entry in place (same name, next revision) and plays it. */
  function replaceEntry(entry: Entry) {
    const next = { ...entry, rev: (entry.rev ?? 0) + 1 };
    setEntries((list) => list.map((x) => (x.name === next.name ? next : x)));
    load(next);
  }
  function updatePractice(practice: Practice) {
    replaceEntry({ ...current, env: { ...current.env, practice } });
  }
  function updateDoc(doc: Doc) {
    replaceEntry({ ...current, env: { ...current.env, doc } });
  }
  function updatePrefs(next: LooperPrefs) {
    looperPrefs = next;
    setPrefs(next);
    saveLooperPrefs(next);
    engine.setLoopOffsetMs(next.offsetMs);
  }
  /** Removes the take from the doc first, then its audio (a failed delete is swept later). */
  function deleteTake(sectionId: SectionId, id: TakeId) {
    updateDoc(removeTake(current.env.doc, sectionId, id));
    void loopStore.delete(id);
    engine.forgetTake(id);
  }
  const practice = current.env.practice ?? DEFAULT_PRACTICE;

  // What the player shows: while playing, the doc the audible bar came from.
  const playing = transport.status === "playing";
  const shown = playing && playback.source ? playback.source : toSource(current.env);
  const scope = transport.scope;
  const at = clampPosition(shown.song, shownPosition(transport, playback.bar?.position), scope);
  const view = playerView(shown.doc ?? shown.song, shown.practice, at, scope, STYLES);
  const cued = cuedChips(transport, view);

  const onChip = (chip: ChipView) =>
    engine.queueJump({
      kind: "chord",
      arrIdx: view.arrIdx ?? at.arrIdx,
      bar: chip.bars[0]!,
      chordIndex: chip.chordIndex,
    });
  // A failed play is reported through the engine's `error` event (shown below).
  const onPlay = () => (playing ? engine.pause() : void engine.play().catch(() => {}));
  const looping = scope.kind === "section";
  const toggleLoop = () =>
    engine.setScope(
      looping
        ? { kind: "arrangement" }
        : ({ kind: "section", sectionId: view.section.id } satisfies PlayScope),
    );

  return (
    <>
      <main>
        <div className="bench-bar">
          <label className="pill">
            Fixture{" "}
            <select
              value={current.name}
              onChange={(e) => load(entries.find((x) => x.name === e.target.value)!)}
            >
              {entries.map((f) => (
                <option key={f.name}>{f.name}</option>
              ))}
            </select>
          </label>
          <label className="pill">
            Swap to{" "}
            <select value={swapTarget} onChange={(e) => setSwapTarget(e.target.value)}>
              {entries.map((f) => (
                <option key={f.name}>{f.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => load(entries.find((x) => x.name === swapTarget)!)}
          >
            Swap at next bar
          </button>
          <button type="button" className={`pill ${looping ? "on" : ""}`} onClick={toggleLoop}>
            🔁 {looping ? "Looping section" : "Loop section"}
          </button>
        </div>

        {playback.error && (
          <p className="error-banner" role="alert">
            Playback stopped: {playback.error}
          </p>
        )}

        <PlayerHeader
          view={view}
          activeChord={playing ? playback.chordIndex : undefined}
          beat={playing ? playback.beat : undefined}
          cued={cued}
          onChip={onChip}
        />

        <PracticeRow key={current.name} practice={practice} onChange={updatePractice} />

        <LooperPanel
          sectionName={view.section.name}
          state={looperView.state}
          availability={recordAvailability(toSource(current.env))}
          error={looperView.error}
          takes={sectionTakes(current.env.doc, view.section.id).map((take) => ({
            take,
            warnings: takeWarnings(take, toSource(current.env), view.section.id),
            problem: playback.loopProblems.get(take.id),
          }))}
          offsetMs={prefs.offsetMs}
          silenceWhileRecording={prefs.silenceWhileRecording}
          onRecord={() => void looper.record(view.section.id)}
          onCancel={() => looper.cancel()}
          onTake={(id, change) =>
            updateDoc(updateTake(current.env.doc, view.section.id, id, change))
          }
          onDelete={(id) => deleteTake(view.section.id, id)}
          onOffset={(offsetMs) => updatePrefs({ ...prefs, offsetMs })}
          onSilence={(silenceWhileRecording) => updatePrefs({ ...prefs, silenceWhileRecording })}
        />

        <PerfReadout perf={perf} stats={engine.stats()} />
        <JsonPanel
          key={`${current.name}:${current.rev ?? 0}`}
          entry={current}
          onApply={(env) => {
            const entry = { name: `${current.name} (edited)`, env };
            setEntries((e) => [entry, ...e.filter((x) => x.name !== entry.name)]);
            load(entry);
          }}
        />
        <p className="muted">Sounds: {SOUND_CREDITS.join(" · ")}.</p>
      </main>

      <div className="action-bar">
        <div className="col">
          <Scrubbers
            view={view}
            showCurrent={transport.status !== "stopped" || transport.cue !== undefined}
            queuedSection={
              transport.status === "playing" && transport.jump?.kind === "section"
                ? transport.jump.arrIdx
                : undefined
            }
            queuedKey={transport.status === "playing" ? transport.keyJump : undefined}
            onSection={(arrIdx) => engine.queueJump({ kind: "section", arrIdx })}
            onKey={(lap) => engine.queueKeyJump(lap)}
          />
          <TransportButtons
            playing={playing}
            canStop={transport.status !== "stopped" || transport.cue !== undefined}
            position={
              playback.sounds.kind === "loading" ? "Loading sounds…" : positionText(transport, view)
            }
            onPlay={onPlay}
            onStop={() => engine.stop()}
            onMix={() => setMixOpen(true)}
          />
        </div>
      </div>

      {mixOpen && (
        <MixSheet
          levels={levels}
          mutes={practice.mutes}
          showLoops={docTakeIds(current.env.doc).length > 0}
          onLevels={(next) => {
            setLevels(next);
            engine.setLevels(next);
          }}
          onMutes={(mutes) => updatePractice({ ...(structuredClone(practice) as Practice), mutes })}
          onClose={() => setMixOpen(false)}
        />
      )}
    </>
  );
}

function PerfReadout({ perf, stats }: { perf: ScheduledBarInfo[]; stats: EngineStats }) {
  const { lookahead } = stats;
  const last = perf.at(-1);
  const ms = perf.map((p) => p.scheduleMs);
  const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0;
  return (
    <details className="panel" open>
      <summary>Performance</summary>
      {last ? (
        <dl className="perf">
          <dt>Scheduled ahead</dt>
          <dd>
            {(last.lead * 1000).toFixed(0)} ms (target {(lookahead * 1000).toFixed(0)} ms, one bar ={" "}
            {((last.end - last.start) * 1000).toFixed(0)} ms)
          </dd>
          <dt>Scheduling a bar</dt>
          <dd>
            last {last.scheduleMs.toFixed(2)} ms · avg {avg.toFixed(2)} ms · max{" "}
            {Math.max(...ms).toFixed(2)} ms (last {perf.length} bars)
          </dd>
          <dt>Late bars</dt>
          <dd className={stats.late ? "warn" : ""}>
            {stats.late} (closest {(stats.minLead * 1000).toFixed(0)} ms ahead
            {stats.late ? "; late bars start just after they're computed" : ""})
          </dd>
          <dt>Events in last bar</dt>
          <dd>
            {last.bar.chords.length} chords · {last.bar.parts.bass.length} bass ·{" "}
            {last.bar.drums.length} drums
          </dd>
        </dl>
      ) : (
        <p className="muted">Press ▶ to measure.</p>
      )}
    </details>
  );
}

function JsonPanel({ entry, onApply }: { entry: Entry; onApply: (env: ShareEnvelope) => void }) {
  const [text, setText] = useState(() => JSON.stringify(entry.env, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [link, setLink] = useState<string>();
  useEffect(() => {
    // Takes stay on this device: links never name them.
    void encodeEnvelope(withoutTakes(entry.env)).then((s) => setLink(`?s=${s}`));
  }, [entry]);

  const apply = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return setErrors([`not JSON: ${String(e)}`]);
    }
    const result = validateEnvelope(raw);
    if (!result.ok) return setErrors(result.errors);
    setErrors([]);
    onApply(result.value);
  };

  return (
    <details className="panel">
      <summary>JSON</summary>
      <p className="muted">
        Edit and apply: while playing, the change lands on the next bar.{" "}
        {link && <a href={link}>Share link</a>}
      </p>
      <textarea
        className="json"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="panel-row">
        <button type="button" className="btn" onClick={apply}>
          Apply
        </button>
        {errors.length > 0 && (
          <ul className="errors">
            {errors.map((e) => (
              <li key={e}>
                <code>{e}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
