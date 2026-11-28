/**
 * The looper panel: record a take on the current section, and each take's mix
 * (gain, mute), delete, warnings and load problems; plus the device's loop offset
 * and "silence while recording". All state comes in as props.
 */

import { useState } from "react";
import type { RecordAvailability, TakeWarning } from "../../core/looper";
import type { LooperState, RecordError } from "../../engine/looper";
import { storeErrorText } from "../../engine/takes";
import type { LoopProblem } from "../../model/runtime";
import type { LoopTake, TakeId } from "../../model/schema";
import { assertNever, type DeepReadonly } from "../../model/types";

export interface TakeRow {
  take: DeepReadonly<LoopTake>;
  warnings: TakeWarning[];
  problem?: LoopProblem;
}

export function LooperPanel(props: {
  sectionName: string;
  state: LooperState;
  availability: RecordAvailability;
  error?: RecordError;
  takes: TakeRow[];
  offsetMs: number;
  silenceWhileRecording: boolean;
  onRecord: () => void;
  onCancel: () => void;
  onTake: (id: TakeId, change: Partial<Pick<LoopTake, "gain" | "muted">>) => void;
  onDelete: (id: TakeId) => void;
  onOffset: (ms: number) => void;
  onSilence: (on: boolean) => void;
}) {
  const { state, availability } = props;
  return (
    <details className="panel" open>
      <summary>Looper · {props.sectionName}</summary>
      <div className="panel-row">
        <RecordButton
          state={state}
          availability={availability}
          sectionName={props.sectionName}
          onRecord={props.onRecord}
          onCancel={props.onCancel}
        />
        <label className="pill">
          <input
            type="checkbox"
            checked={props.silenceWhileRecording}
            onChange={(e) => props.onSilence(e.target.checked)}
          />{" "}
          Silence backing while recording
        </label>
        <label className="pill" title="Mic and output delay on this device; adjust by ear">
          Loop offset{" "}
          <input
            className="text num"
            type="number"
            step={5}
            value={props.offsetMs}
            onChange={(e) => {
              const ms = Number(e.target.value);
              if (Number.isFinite(ms)) props.onOffset(ms);
            }}
          />{" "}
          ms
        </label>
      </div>
      {availability.kind === "unavailable" && (
        <p className="muted">{unavailableText(availability.reason)}</p>
      )}
      {props.error && (
        <p className="error-banner" role="alert">
          Recording failed: {recordErrorText(props.error)}
        </p>
      )}
      {props.takes.length === 0 ? (
        <p className="muted">No takes on this section yet.</p>
      ) : (
        <ul className="takes">
          {props.takes.map((row) => (
            <TakeItem key={row.take.id} row={row} onTake={props.onTake} onDelete={props.onDelete} />
          ))}
        </ul>
      )}
    </details>
  );
}

function RecordButton(props: {
  state: LooperState;
  availability: RecordAvailability;
  sectionName: string;
  onRecord: () => void;
  onCancel: () => void;
}) {
  const { state } = props;
  switch (state.kind) {
    case "idle":
      return (
        <button
          type="button"
          className="btn"
          disabled={props.availability.kind !== "available"}
          onClick={props.onRecord}
        >
          ⏺ Record a take on {props.sectionName}
        </button>
      );
    case "arming":
      return (
        <button type="button" className="btn" onClick={props.onCancel}>
          ⏳ Waiting for bar 1… (cancel)
        </button>
      );
    case "recording":
      return (
        <button type="button" className="btn rec" onClick={props.onCancel}>
          ● Recording… (cancel)
        </button>
      );
    case "saving":
      return (
        <button type="button" className="btn" disabled>
          Saving…
        </button>
      );
    default:
      return assertNever(state);
  }
}

function TakeItem(props: {
  row: TakeRow;
  onTake: (id: TakeId, change: Partial<Pick<LoopTake, "gain" | "muted">>) => void;
  onDelete: (id: TakeId) => void;
}) {
  const { take, warnings, problem } = props.row;
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="take">
      <label>
        <input
          type="checkbox"
          checked={!take.muted}
          onChange={(e) => props.onTake(take.id, { muted: !e.target.checked })}
        />{" "}
        {take.name}
      </label>
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(take.gain * 100)}
        aria-label={`${take.name} level`}
        onChange={(e) => props.onTake(take.id, { gain: Number(e.target.value) / 100 })}
      />
      {confirming ? (
        <>
          <button
            type="button"
            className="btn small danger"
            onClick={() => props.onDelete(take.id)}
          >
            Delete
          </button>
          <button type="button" className="btn small" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </>
      ) : (
        <button type="button" className="btn small" onClick={() => setConfirming(true)}>
          🗑
        </button>
      )}
      {problem && <span className="warn">{problemText(problem)}</span>}
      {warnings.map((w) => (
        <span key={w.kind} className="muted">
          {warningText(w)}
        </span>
      ))}
    </li>
  );
}

export function unavailableText(
  reason: Extract<RecordAvailability, { kind: "unavailable" }>["reason"],
) {
  switch (reason) {
    case "cycle":
      return "Loops are off while a key cycle is on (a take is in one key).";
    default:
      return assertNever(reason);
  }
}

export function recordErrorText(error: RecordError): string {
  switch (error.kind) {
    case "unavailable":
      return unavailableText(error.reason);
    case "busy":
      return "a recording is already under way.";
    case "micDenied":
      return "microphone access was denied. Allow it in the browser's site settings.";
    case "noMic":
      return "no microphone found.";
    case "notSupported":
      return "this browser can't record audio.";
    case "micFailed":
      return `the microphone failed (${error.message}).`;
    case "emptyRecording":
      return "the browser recorded no audio.";
    case "saveFailed":
      return `couldn't save the take: ${storeErrorText(error.error)}.`;
    default:
      return assertNever(error);
  }
}

export function problemText(problem: LoopProblem): string {
  switch (problem.kind) {
    case "missing":
      return "No audio on this device (recorded elsewhere, or site data was cleared).";
    case "failed":
      return `Couldn't load: ${problem.error}`;
    default:
      return assertNever(problem);
  }
}

export function warningText(w: TakeWarning): string {
  switch (w.kind) {
    case "keyChanged":
      return `Recorded in ${w.recorded}; the song is now in ${w.now}.`;
    case "tempoChanged":
      return `Recorded at ${w.recorded} bpm; now ${w.now} (the take isn't stretched).`;
    case "meterChanged":
      return `Recorded in ${w.recorded}; now ${w.now}.`;
    default:
      return assertNever(w);
  }
}
