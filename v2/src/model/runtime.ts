/**
 * Runtime-only types: never persisted, never validated. The transport, the
 * engine contract and the pure transforms' signatures. Persisted shapes are in
 * schema.ts. Data flow: docs-internal/v2/data-model.md.
 */

import type {
  BackingTrack,
  Doc,
  Bpm,
  BuiltinStyleId,
  DrumInstrument,
  InstrumentMap,
  KeyName,
  Meter,
  Mix,
  ItemId,
  PatchRef,
  Practice,
  SectionId,
  SectionSeed,
  Song,
  SongDefaults,
  StyleDef,
  TakeId,
  Tick,
} from "./schema";
import type { DeepReadonly, NonEmpty } from "./types";

/** IndexedDB record for a take's audio (object store "loopAudio", key = take id). */
export interface LoopAudio {
  id: TakeId;
  itemId: ItemId; // owner; deleting the item deletes its audio
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** Playback position is always a bar. */
export interface Position {
  arrIdx: number; // index into arrangement
  lap: number; // cycle lap; key = lapKeys[lap % lapKeys.length]
  bar: number; // bar within the section, 0-based
}

/** A queued move. Chord jumps land on the chord's bar; the UI outlines every chord in it. */
export type Jump =
  | { kind: "section"; arrIdx: number }
  | { kind: "chord"; arrIdx: number; bar: number; chordIndex: number };

/** Section editor: loop one section instead of following the arrangement. */
export type PlayScope = { kind: "arrangement" } | { kind: "section"; sectionId: SectionId };

export type Transport =
  | { status: "stopped"; scope: PlayScope; cue?: Position } // cue = where ▶ starts (tapped while stopped)
  | { status: "paused"; scope: PlayScope; at: Position }
  | {
      status: "playing";
      scope: PlayScope;
      at: Position;
      jump?: Jump; // lands at the next bar
      keyJump?: number; // lap index; lands at the end of the current lap
    };

// ── Engine contract ──────────────────────────────────────────────────────────

/** A chord as scheduled: what to play, plus what the UI needs to highlight it. */
export interface ScheduledChord {
  time: number; // ticks within the bar; fractional after swing
  duration: number;
  chordIndex: number; // index into Section.chords (chip highlight)
  midi: number[]; // voiced notes, low → high
  instrument: PatchRef;
  /**
   * Started in an earlier bar and still sounding (time 0, remaining duration).
   * Strike it only when playback starts or jumps into this bar; otherwise it's
   * already ringing.
   */
  continued: boolean;
}

export interface ScheduledNote {
  time: number;
  duration: number;
  midi: number;
  instrument: PatchRef;
}

export interface ScheduledHit {
  time: number;
  drum: DrumInstrument;
  instrument: PatchRef;
}

/**
 * One bar of concrete events: `scheduleBar`'s output and the engine's only input.
 * Mutes are NOT applied here: they're channel gains, applied instantly by the engine.
 * Golden tests compare these.
 */
export interface ScheduledBar {
  position: Position;
  sectionId: SectionId;
  key: KeyName; // the lap's key
  tempo: Bpm;
  meter: Meter;
  length: Tick; // bar length in ticks
  chords: ScheduledChord[];
  parts: { bass: ScheduledNote[] }; // mirrors Section.parts
  drums: ScheduledHit[];
  loops: { takeId: TakeId; gain: number; startsThisBar: boolean }[];
  /** Upper voicing of the last chord; pass as `prevVoicing` for the next bar. */
  voicing?: number[];
}

/** Fired at audible time (Tone.Draw), so the UI matches what you hear. */
export type EngineEvent =
  | { type: "transport"; transport: Transport }
  /** `source` is what the bar was scheduled from, so the UI shows what is actually playing. */
  | { type: "bar"; bar: ScheduledBar; source: EngineSource }
  | { type: "beat"; position: Position; beat: number } // 0-based within the bar
  | { type: "chord"; position: Position; chordIndex: number }
  /** Playback hit an error (e.g. the source threw) and paused on the audible bar. */
  | { type: "error"; message: string }
  /** ▶ is waiting (briefly) for these sample sets; a `transport` event follows when it plays. */
  | { type: "loadingSounds"; sets: readonly string[] };

/** What the engine plays: the open item's song (or the one generated from it) + its practice. */
export interface EngineSource {
  song: DeepReadonly<Song>;
  practice: DeepReadonly<Practice>;
  /** The doc `song` came from (a BackingTrack generates it). Views read it for override marks. */
  doc?: DeepReadonly<Doc>;
}

/**
 * The audio engine. It *pulls* the current source at each bar boundary (so edits
 * land on the next bar) and keeps instruments alive across edits.
 */
export interface Engine {
  setSource(get: () => EngineSource): void;
  play(from?: Position): Promise<void>; // first call needs a user gesture (AudioContext)
  pause(): void;
  stop(): void;
  setScope(scope: PlayScope): void;
  queueJump(jump: Jump | undefined): void; // undefined cancels
  queueKeyJump(lap: number | undefined): void;
  setLevels(levels: Mix["levels"]): void; // instant
  setMutes(mutes: Practice["mutes"]): void; // instant
  subscribe(listener: (e: EngineEvent) => void): () => void; // returns unsubscribe
}

// ── Transformations (all pure). Implemented in src/core/ (core/index.ts checks the match). ─

type R<T> = DeepReadonly<T>;
type Styles = R<Record<BuiltinStyleId, StyleDef>>;
type Playing = Extract<Transport, { status: "playing" }>;

export interface Transforms {
  /** Recipe → song. Runs at each bar while a backing track plays, and once for "Open in composer". */
  generateSong(bt: R<BackingTrack>, styles: Styles): Song;
  /** Rebuild one section from a seed ("Regenerate"). Keeps id, name, overrides, loops. */
  regenerateSection(
    song: R<Song>,
    sectionId: SectionId,
    seed: R<SectionSeed>,
    styles: Styles,
  ): Song;
  /** Section override ?? song default, per setting. Drives the player's "• override" marks. */
  effectiveSettings(
    song: R<Song>,
    sectionId: SectionId,
  ): R<SongDefaults & { instruments: InstrumentMap }>;
  /** Keys each cycle lap plays in. */
  lapKeys(song: R<Song>, practice: R<Practice>): NonEmpty<KeyName>;
  /** song + practice + position → one bar of events. `prevVoicing` feeds voice-leading. */
  scheduleBar(
    source: EngineSource,
    at: Position,
    scope: PlayScope,
    prevVoicing?: readonly number[],
  ): ScheduledBar;
  /** After a bar: apply advance mode, a queued jump (next bar), a queued key jump (end of lap). */
  nextPosition(source: EngineSource, transport: Playing): Playing;
  /** A saved position made invalid by edits is clamped, never discarded. */
  clampPosition(song: R<Song>, at: Position, scope: PlayScope): Position;
}
