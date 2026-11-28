/**
 * The looper's pure core: whether recording is possible, how long a take is, how
 * a raw recording becomes a take (offset + trim), what changed since a take was
 * recorded, and doc edits that add, change or remove takes (songs and backing
 * tracks alike). No audio, no storage.
 */

import type { EngineSource } from "../model/runtime";
import {
  barLength,
  PPQ,
  type BackingSection,
  type Doc,
  type LoopTake,
  type Section,
  type SectionId,
  type ShareEnvelope,
  type TakeId,
} from "../model/schema";
import { assertNever, type DeepReadonly } from "../model/types";
import { effectiveSettings, findSection } from "./settings";

type R<T> = DeepReadonly<T>;

/** Why recording isn't possible right now, if it isn't. */
export type RecordAvailability =
  | { kind: "available" }
  /** A cycle changes key every lap; a take is in one key. */
  | { kind: "unavailable"; reason: "cycle" };

export function recordAvailability(source: R<EngineSource>): RecordAvailability {
  const cycle = source.practice.cycle;
  switch (cycle.kind) {
    case "none":
      return { kind: "available" };
    case "fourths":
    case "fifths":
    case "custom":
      return { kind: "unavailable", reason: "cycle" };
    default:
      return assertNever(cycle);
  }
}

/** One pass of the section as it plays now: what a new take records. */
export function takeShape(
  source: R<EngineSource>,
  sectionId: SectionId,
): { bars: number; seconds: number; recorded: LoopTake["recorded"] } {
  const { song } = source;
  const section = findSection(song, sectionId);
  const { tempo, meter } = effectiveSettings(song, sectionId);
  const secondsPerTick = 60 / (tempo * PPQ);
  return {
    bars: section.bars,
    seconds: section.bars * barLength(meter) * secondsPerTick,
    recorded: { key: song.key, tempo, meter: { ...meter } },
  };
}

/**
 * Raw recording → take audio. `bar1` is where the section's bar 1 fell in the
 * recording (samples, by the clock); `offset` shifts that (the device's input
 * latency: positive = the sound arrived later). The result is exactly `length`
 * samples: cut, or padded with silence where the recording runs out.
 */
export function alignTake(
  recording: Float32Array,
  bar1: number,
  offset: number,
  length: number,
): Float32Array {
  const out = new Float32Array(length);
  const start = Math.round(bar1 + offset);
  const from = Math.max(0, start);
  const to = Math.min(recording.length, start + length);
  if (to > from) out.set(recording.subarray(from, to), from - start);
  return out;
}

/** What differs since the take was recorded. Shown on the take; it still plays. */
export type TakeWarning =
  /** The song's key changed: the take is in the old key. */
  | { kind: "keyChanged"; recorded: string; now: string }
  /** Tempo changed: the take is cut short or ends early (it isn't stretched). */
  | { kind: "tempoChanged"; recorded: number; now: number }
  | { kind: "meterChanged"; recorded: string; now: string };

export function takeWarnings(
  take: R<LoopTake>,
  source: R<EngineSource>,
  sectionId: SectionId,
): TakeWarning[] {
  const { tempo, meter } = effectiveSettings(source.song, sectionId);
  const r = take.recorded;
  const meterText = (m: R<LoopTake["recorded"]["meter"]>) => `${m.beatsPerBar}/${m.beatUnit}`;
  const warnings: TakeWarning[] = [];
  if (r.key !== source.song.key) {
    warnings.push({ kind: "keyChanged", recorded: r.key, now: source.song.key });
  }
  if (r.tempo !== tempo) warnings.push({ kind: "tempoChanged", recorded: r.tempo, now: tempo });
  if (meterText(r.meter) !== meterText(meter)) {
    warnings.push({ kind: "meterChanged", recorded: meterText(r.meter), now: meterText(meter) });
  }
  return warnings;
}

// ── Doc edits (new objects; both doc kinds hold takes on their sections) ─────

/** A section's takes, whichever kind of doc it is in. */
export function sectionTakes(doc: R<Doc>, sectionId: SectionId): R<LoopTake[]> {
  const section = (doc.sections as R<(Section | BackingSection)[]>).find((s) => s.id === sectionId);
  if (!section) throw new Error(`no section with id "${sectionId}"`);
  return section.loops ?? [];
}

function withSectionTakes(
  doc: R<Doc>,
  sectionId: SectionId,
  edit: (takes: R<LoopTake[]>) => R<LoopTake[]>,
): Doc {
  const next = structuredClone(doc) as Doc;
  const section = (next.sections as (Section | BackingSection)[]).find((s) => s.id === sectionId);
  if (!section) throw new Error(`no section with id "${sectionId}"`);
  section.loops = structuredClone(edit(section.loops ?? [])) as LoopTake[];
  return next;
}

/** Adds a take on top of the section's others (overdub). */
export function addTake(doc: R<Doc>, sectionId: SectionId, take: R<LoopTake>): Doc {
  return withSectionTakes(doc, sectionId, (takes) => [...takes, take]);
}

/** Changes a take's mix settings or name. */
export function updateTake(
  doc: R<Doc>,
  sectionId: SectionId,
  takeId: TakeId,
  change: Partial<Pick<LoopTake, "name" | "gain" | "muted">>,
): Doc {
  return withSectionTakes(doc, sectionId, (takes) =>
    takes.map((t) => (t.id === takeId ? { ...t, ...change } : t)),
  );
}

export function removeTake(doc: R<Doc>, sectionId: SectionId, takeId: TakeId): Doc {
  return withSectionTakes(doc, sectionId, (takes) => takes.filter((t) => t.id !== takeId));
}

/** Every take the doc references: what its stored audio must keep. */
export function docTakeIds(doc: R<Doc>): TakeId[] {
  return (doc.sections as R<(Section | BackingSection)[]>).flatMap((s) =>
    (s.loops ?? []).map((t) => t.id),
  );
}

/** Takes the engine may play: every take in the song, unless a cycle is on (loops are off). */
export function playableTakeIds(source: R<EngineSource>): TakeId[] {
  return recordAvailability(source).kind === "available" ? docTakeIds(source.song) : [];
}

/** A takes-free copy for sharing: the audio stays on this device, so links never name it. */
export function withoutTakes(env: R<ShareEnvelope>): ShareEnvelope {
  const next = structuredClone(env) as ShareEnvelope;
  const doc = next.doc;
  switch (doc.kind) {
    case "song":
      for (const s of doc.sections) s.loops = [];
      break;
    case "backingTrack":
      for (const s of doc.sections) delete s.loops;
      break;
    default:
      assertNever(doc);
  }
  return next;
}

/** "Take 3": the next unused default name in the section. */
export function nextTakeName(takes: R<LoopTake[]>): string {
  const used = new Set(takes.map((t) => t.name));
  let n = takes.length + 1;
  while (used.has(`Take ${n}`)) n++;
  return `Take ${n}`;
}
