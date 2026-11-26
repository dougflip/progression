/**
 * Progression v2 — data model (draft spec).
 *
 * Types only, no runtime code. Milestone 1 replaces this file with the Zod 4
 * schema (types inferred from it). Rationale, validation rules and data flow:
 * data-model.md.
 *
 * TypeScript conventions:
 * - Kinds are string-literal unions with a discriminant (`kind`, `status`, `type`),
 *   never booleans like `isScratch`. Booleans only for genuine on/off state (`muted`).
 * - Invalid states are unrepresentable where cheap (tagged unions, non-empty tuples).
 * - Ids are branded so different id kinds can't be mixed up.
 * - Persisted values are immutable: updates create new objects. Functions take
 *   `DeepReadonly<…>`. (Immutability also makes the engine's per-bar snapshot free:
 *   it's just a reference.)
 * - Enumerations live in one place (`as const` arrays / `z.enum`) and are switched
 *   on exhaustively (`never` check).
 *
 * Data conventions:
 * - Schema evolution within version 2 is additive only: add optional fields or
 *   widen unions; never rename, remove or narrow. Every saved doc stays valid.
 * - Optional field = "inherit / not set". No `null`s in persisted data.
 * - Positions and lengths are integer ticks at PPQ (48 per quarter note).
 * - Nothing persisted is an absolute pitch: chords are Roman numerals, notes are
 *   relative to the chord or key. The engine resolves to MIDI at play time.
 * - Deferred shapes are marked "Defined in Milestone N" and must not be guessed at.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

declare const brand: unique symbol;
/** Nominal type: only assignable from a value of the same brand (Zod `.brand()`). */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Mapped type, so arrays and tuples (incl. `NonEmpty`) keep their shape. */
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** At least one element. */
export type NonEmpty<T> = [T, ...T[]];

// ─────────────────────────────────────────────────────────────────────────────
// Ids (all match /^[A-Za-z0-9_-]{1,40}$/)
// ─────────────────────────────────────────────────────────────────────────────

export type SectionId = Brand<string, "SectionId">;
export type TakeId = Brand<string, "TakeId">;
export type PatchId = Brand<string, "PatchId">; // custom patch, key in Song.patches
export type ItemId = Brand<string, "ItemId">; // library item

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Ticks per quarter note. 8th = 24, 16th = 12, 8th triplet = 16, 16th triplet = 8. */
export const PPQ = 48;

/** Integer ≥ 0, in ticks. Not branded: tick arithmetic is everywhere and stays plain `number`. */
export type Tick = number;

/** Beats per minute, always counting quarter notes (also in 6/8). Integer 40–220 (v1's range). */
export type Bpm = number;

/** Both spellings are allowed; the spelling picks sharps vs flats for chord names. */
export type KeyName =
  | "C"
  | "C#"
  | "Db"
  | "D"
  | "D#"
  | "Eb"
  | "E"
  | "F"
  | "F#"
  | "Gb"
  | "G"
  | "G#"
  | "Ab"
  | "A"
  | "A#"
  | "Bb"
  | "B";

export interface Meter {
  beatsPerBar: number; // integer 1–16
  beatUnit: 2 | 4 | 8;
}
// Bar length in ticks = beatsPerBar × PPQ × 4 / beatUnit (4/4 → 192, 6/8 → 144, 3/4 → 144).

/**
 * Swing amount on 8th notes: 0 = straight, 1 = full triplet feel (the off-beat 8th
 * moves from 24 to 32 ticks after the beat). Applied at schedule time; stored data
 * stays straight. Later (additive): widen to `number | { amount; subdivision: 8 | 16 }`.
 */
export type Swing = number; // 0–1

/** How chords become notes. Applied at play time (voice-lead-loop depends on playback order). */
export type Voicing = "root" | "voice-lead" | "voice-lead-loop";

// ─────────────────────────────────────────────────────────────────────────────
// Harmony: chords as Roman numerals
// ─────────────────────────────────────────────────────────────────────────────

export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Accidental = -1 | 0 | 1; // ♭ / natural / ♯ relative to the major scale

/** Scale degree of the current key, e.g. ♭VII = { degree: 7, accidental: -1 }. */
export interface ScaleStep {
  degree: Degree;
  accidental?: Accidental; // omitted = 0
}

/** v1's full set, unchanged. Minor-ish (for bass phrases): minor, m7, dim, m7b5, dim7, mMaj7. */
export type ChordQuality =
  | "major"
  | "minor"
  | "maj7"
  | "m7"
  | "dom7"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "m7b5"
  | "dim7"
  | "mMaj7"
  | "dom7sus4";

/** A chord placed on the timeline. `start` is relative to its section. */
export interface ChordEvent {
  start: Tick;
  duration: Tick; // > 0
  root: ScaleStep;
  quality: ChordQuality;
  /** Slash chord / inversion: the bass note as a scale step, e.g. IV/I. Omitted = chord root. */
  bass?: ScaleStep;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes: pitch relative to the chord or key (tagged union)
// ─────────────────────────────────────────────────────────────────────────────

export type ChordTone = 1 | 3 | 5 | 7 | 9 | 11 | 13;

/** Octaves up/down from the part's register (see Registers). Integer −2…2, omitted = 0. */
export type Octave = number;

export type Pitch =
  /** Tone of the chord sounding at this note's start. 1 = root (v1 bass R/3/5). */
  | { kind: "chordTone"; tone: ChordTone; octave?: Octave }
  /** Scale degree of the current key. */
  | { kind: "scaleDegree"; step: ScaleStep; octave?: Octave }
  /** Semitones above the key's tonic (0–11); `octave` moves it further. */
  | { kind: "chromatic"; semitones: number; octave?: Octave };

export interface NoteEvent {
  start: Tick;
  duration: Tick; // > 0
  pitch: Pitch;
  // Later (additive): velocity?: number
}

/**
 * Pitched parts of a section, keyed by name. Only `bass` exists today; a melody or
 * second line is added later as a new optional key (additive).
 */
export interface Parts {
  bass: NoteEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Registers: where relative pitches land (fixed per role; v1 parity)
// ─────────────────────────────────────────────────────────────────────────────
// - Chords: root placed at or above MIDI 48 (C3), lowered by octaves until the top
//   note is ≤ 76 (E5) for triads / ≤ 72 (C5) for 4-note chords. Voice-leading then
//   picks the inversion closest to the previous chord (v1's algorithm).
// - Bass: two octaves below the chord root chosen above (v1 `synthBass`).
//   chordTone / scaleDegree / chromatic notes resolve relative to that bass root,
//   then `octave` shifts by 12 semitones per step.
// - Not stored in docs. If registers ever become configurable: additive
//   `register?` on SongDefaults / SectionOverrides.

// ─────────────────────────────────────────────────────────────────────────────
// Drums
// ─────────────────────────────────────────────────────────────────────────────

/** v1's drum set plus clap. */
export type DrumInstrument =
  | "kick"
  | "snare"
  | "hat"
  | "hatOpen"
  | "crash"
  | "ride"
  | "rideBell"
  | "tom"
  | "tom2"
  | "clap";

/**
 * Hit start ticks per instrument: sorted, unique. Any subdivision works (ticks, not
 * grid slots). Later (additive): widen to `(Tick | { start: Tick; velocity: number })[]`.
 */
export type DrumHits = Partial<Record<DrumInstrument, Tick[]>>;

// ─────────────────────────────────────────────────────────────────────────────
// Roles and channels
// ─────────────────────────────────────────────────────────────────────────────

/** What an instrument plays. New parts would widen this (additive). */
export type Role = "chords" | "bass" | "drums";
/** Mixer channels: every role plus recorded loops. */
export type Channel = Role | "loops";

// ─────────────────────────────────────────────────────────────────────────────
// Sound: instruments are data
// ─────────────────────────────────────────────────────────────────────────────

/** Built-in patch ids (registry defined in Milestone 5; v1's sounds are the defaults). */
export type BuiltinPatchId = "pad-v1" | "bass-v1" | "kit-v1";

/** Either a built-in, or a custom patch embedded in `Song.patches`. */
export type PatchRef = { kind: "builtin"; id: BuiltinPatchId } | { kind: "custom"; id: PatchId };

/**
 * Patch shape. The vocabulary (oscillator types, effect types and their params,
 * ranges) is **defined in Milestone 5**. Until then only built-in refs are used, and
 * the schema accepts `Song.patches` only as an empty object.
 */
export type Patch =
  | {
      kind: "synth";
      role: Role;
      label: string;
      /** Defined in Milestone 5. */
      synth: unknown;
    }
  | {
      kind: "sampler";
      role: Role;
      label: string;
      sampleSet: string; // sample-set id; shape defined in Milestone 5
    };

export type InstrumentMap = Record<Role, PatchRef>;

// ─────────────────────────────────────────────────────────────────────────────
// Styles: the generator's input data
// ─────────────────────────────────────────────────────────────────────────────

export type BuiltinStyleId = "pop" | "funk" | "ballad" | "rock"; // v1's four
export type Variant = "simple" | "busy";
export type BarsPerChord = 1 | 2 | 4; // v1's options

/** Built-in now; custom styles (user-authored, v1's custom-styles) are an open question. */
export type StyleRef = { kind: "builtin"; id: BuiltinStyleId };

/**
 * One style: a one-bar 4/4 drum pattern and bass phrase per variant. Uses the same
 * shapes as songs (ticks, chord-tone pitches), so a generated section is these
 * patterns repeated per bar. Bass picks `major` or `minor` by the sounding chord's
 * quality. Ported from v1's STYLES. Later (additive): `meter?` for other meters.
 */
export interface StyleDef {
  id: BuiltinStyleId;
  label: string;
  drums: Record<Variant, DrumHits>; // ticks within one 4/4 bar (0–191)
  bass: Record<Variant, { major: NoteEvent[]; minor: NoteEvent[] }>; // one bar, chordTone pitches
}

/** Everything the generator needs to (re)build a section. Kept on Song sections for "Regenerate". */
export interface SectionSeed {
  progression: string; // "I V vi IV": v1's numeral syntax, parsed by the generator
  barsPerChord: BarsPerChord;
  style: StyleRef;
  drums: Variant;
  bass: Variant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc 1: BackingTrack (the recipe)
// ─────────────────────────────────────────────────────────────────────────────

export interface BackingSection {
  id: SectionId;
  name: string; // 1–40 chars, trimmed
  progression: string; // must parse to ≥ 1 chord
  barsPerChord: BarsPerChord;
  // Overrides: omitted = use the BackingTrack value.
  style?: StyleRef;
  drums?: Variant;
  bass?: Variant;
  tempo?: Bpm;
}

export interface BackingTrack {
  version: 2;
  kind: "backingTrack";
  title: string; // 1–80 chars, trimmed; = library item name
  key: KeyName;
  tempo: Bpm;
  style: StyleRef;
  drums: Variant;
  bass: Variant;
  voicing: Voicing;
  sections: NonEmpty<BackingSection>;
  arrangement: NonEmpty<SectionId>; // repeats allowed
  // Always 4/4, straight. Later (additive): meter?, swing?
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc 2: Song (what the engine plays)
// ─────────────────────────────────────────────────────────────────────────────

export interface SongDefaults {
  tempo: Bpm;
  meter: Meter;
  swing: Swing;
  voicing: Voicing;
}

/** Omitted = inherit from Song.defaults / Song.instruments. */
export interface SectionOverrides {
  tempo?: Bpm;
  meter?: Meter;
  swing?: Swing;
  voicing?: Voicing;
  instruments?: Partial<InstrumentMap>;
}

/** A recorded loop. Audio lives in IndexedDB (see LoopAudio); the song only references it. */
export interface LoopTake {
  id: TakeId;
  name: string;
  bars: number; // integer 1…section bars; starts at bar 1. Later (additive): offset?: Tick
  gain: number; // 0–1
  muted?: boolean; // omitted = false
}

export interface Section {
  id: SectionId;
  name: string; // 1–40 chars, trimmed
  bars: number; // integer 1–64
  overrides: SectionOverrides;
  chords: ChordEvent[]; // sorted, non-overlapping, within the section; gaps = no chord
  drums: DrumHits;
  parts: Parts;
  loops: LoopTake[]; // several = overdub; layered in order
  seed?: SectionSeed; // present if the generator made it
}

export interface Song {
  version: 2;
  kind: "song";
  title: string; // 1–80 chars, trimmed; = library item name
  key: KeyName;
  ppq: typeof PPQ; // self-describing for agents; always 48
  defaults: SongDefaults;
  instruments: InstrumentMap;
  patches: Record<PatchId, Patch>; // custom patches; `{}` until Milestone 5
  sections: NonEmpty<Section>;
  arrangement: NonEmpty<SectionId>;
}

export type Doc = BackingTrack | Song;

// ─────────────────────────────────────────────────────────────────────────────
// Practice (separate from the doc; saved per library item; shareable)
// ─────────────────────────────────────────────────────────────────────────────

/** A custom cycle carries its keys, so "custom with no keys" can't exist. */
export type Cycle =
  | { kind: "none" }
  | { kind: "fourths" }
  | { kind: "fifths" }
  | { kind: "custom"; keys: NonEmpty<KeyName> }; // played as given (absolute keys)

export type Advance = "auto" | "manual";

export interface Practice {
  cycle: Cycle;
  advance: Advance;
  mutes: Record<Channel, boolean>; // intent ("play without drums"), so shareable
}

// ─────────────────────────────────────────────────────────────────────────────
// Share envelope (what a link carries). New blocks can be added later.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareEnvelope {
  version: 2;
  doc: Doc;
  practice?: Practice;
  /** Free-text note for humans/agents (fixtures say what they exercise). Ignored by the app. */
  $comment?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local only: never shared
// ─────────────────────────────────────────────────────────────────────────────

/** Where a saved item came from. */
export type Origin = "created" | "shared" | "imported";

export type LibraryItem =
  /** The one reusable quick-jam backing track. */
  | {
      kind: "scratch";
      id: ItemId;
      doc: BackingTrack;
      practice: Practice;
      updated: number; // epoch ms
      state: "pristine" | "edited"; // "edited" → confirm before a starter replaces it
    }
  | {
      kind: "saved";
      id: ItemId;
      doc: Doc;
      practice: Practice;
      updated: number;
      origin: Origin;
    };

/** localStorage, one key. Versioned separately from docs so the store can migrate. */
export interface LibraryStore {
  version: 1;
  items: NonEmpty<LibraryItem>; // exactly one `scratch`
  currentItemId: ItemId;
}

/** IndexedDB record for a take's audio (object store "loopAudio", key = take id). */
export interface LoopAudio {
  id: TakeId;
  itemId: ItemId; // owner; deleting the item deletes its audio
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export interface Mix {
  levels: Record<Channel | "master", number>; // integer 0–100
}

export interface AppPrefs {
  version: 1;
  theme: "dark" | "light";
  keepAwake: boolean;
  loopOffsetMs: number; // device latency compensation for the looper (Milestone 6)
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime only: never persisted
// ─────────────────────────────────────────────────────────────────────────────

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
}

/** Fired at audible time (Tone.Draw), so the UI matches what you hear. */
export type EngineEvent =
  | { type: "transport"; transport: Transport }
  | { type: "bar"; bar: ScheduledBar }
  | { type: "beat"; position: Position; beat: number } // 0-based within the bar
  | { type: "chord"; position: Position; chordIndex: number };

/** What the engine plays: the open item's song (or the one generated from it) + its practice. */
export interface EngineSource {
  song: DeepReadonly<Song>;
  practice: DeepReadonly<Practice>;
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

// ─────────────────────────────────────────────────────────────────────────────
// Transformations (all pure). Signatures only; see data-model.md.
// ─────────────────────────────────────────────────────────────────────────────

type R<T> = DeepReadonly<T>;
type Styles = R<Record<BuiltinStyleId, StyleDef>>;
type Playing = Extract<Transport, { status: "playing" }>;

export interface Transforms {
  /** Recipe → song. Runs at each bar while a backing track plays, and once for "Open in composer". */
  generateSong(bt: R<BackingTrack>, styles: Styles): Song;
  /** Rebuild one section from a seed ("Regenerate"). Keeps id, name, loops. */
  regenerateSection(section: R<Section>, seed: R<SectionSeed>, styles: Styles): Section;
  /** Section override ?? song default, per setting. Drives the player's "• override" marks. */
  effectiveSettings(
    song: R<Song>,
    sectionId: SectionId,
  ): SongDefaults & { instruments: InstrumentMap };
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
  /** Schema validation for imports, links, and agent output. */
  validateEnvelope(
    input: unknown,
  ): { ok: true; value: ShareEnvelope } | { ok: false; errors: string[] };
  encodeEnvelope(env: R<ShareEnvelope>): Promise<string>; // JSON → deflate-raw → base64url
  decodeEnvelope(param: string): Promise<unknown>; // then validateEnvelope
}
