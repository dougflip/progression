/**
 * Progression v2 — data model (draft spec).
 *
 * Types only, no runtime code. Milestone 1 replaces this file with the Zod 4
 * schema (types inferred from it). Rationale and data flow: data-model.md.
 *
 * Conventions:
 * - Schema evolution within version 2 is additive only: add optional fields or
 *   widen unions; never rename, remove or narrow. Every saved doc stays valid.
 * - Optional field = "inherit / not set". No `null`s in persisted data.
 * - Positions and lengths are integer ticks at PPQ (48 per quarter note).
 * - Nothing persisted is an absolute pitch: chords are Roman numerals, notes are
 *   relative to the chord or key. The engine resolves to MIDI at play time.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Ticks per quarter note. 8th = 24, 16th = 12, 8th triplet = 16, 16th triplet = 8. */
export const PPQ = 48;

/** Integer tick count. */
export type Tick = number;

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
  beatsPerBar: number; // 4
  beatUnit: 2 | 4 | 8; // 4
}

/** 0 = straight, 1 = full triplet swing. Applied by the engine at schedule time; stored data stays straight. */
export type Swing = number;

/** How chords become notes. Applied at play time (voice-lead-loop depends on playback order). */
export type Voicing = "root" | "voice-lead" | "voice-lead-loop";

export type Id = string;

// ─────────────────────────────────────────────────────────────────────────────
// Harmony: chords as Roman numerals
// ─────────────────────────────────────────────────────────────────────────────

export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Accidental = -1 | 0 | 1; // ♭ / natural / ♯ relative to the major scale

/** Scale degree of the current key, e.g. ♭VII = { degree: 7, accidental: -1 }. */
export interface ScaleStep {
  degree: Degree;
  accidental?: Accidental; // default 0
}

/** v1's full set, unchanged. */
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
  duration: Tick;
  root: ScaleStep;
  quality: ChordQuality;
  /** Slash chord / inversion: the bass note as a scale step, e.g. IV/I. Omitted = chord root. */
  bass?: ScaleStep;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes: pitch relative to the chord or key (tagged union)
// ─────────────────────────────────────────────────────────────────────────────

export type Pitch =
  /** Tone of the chord sounding at this note's start. 1 = root (v1 bass R/3/5). */
  | { kind: "chordTone"; tone: 1 | 3 | 5 | 7 | 9 | 11 | 13; octave?: number }
  /** Scale degree of the current key. */
  | { kind: "scaleDegree"; step: ScaleStep; octave?: number }
  /** Semitones above the key's tonic. Covers anything chromatic. */
  | { kind: "chromatic"; semitones: number; octave?: number };
// `octave` shifts from the part's default register (default 0).

export interface NoteEvent {
  start: Tick;
  duration: Tick;
  pitch: Pitch;
  // Later (additive): velocity?: number
}

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
 * Hit start ticks per instrument, sorted. Any subdivision works (ticks, not grid slots).
 * Later (additive): widen to `(Tick | { start: Tick; velocity: number })[]` for accents;
 * existing plain-tick docs stay valid.
 */
export type DrumHits = Partial<Record<DrumInstrument, Tick[]>>;

// ─────────────────────────────────────────────────────────────────────────────
// Sound: instruments are data
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "chords" | "bass" | "drums";

/**
 * A built-in patch id (e.g. "pad-v1") or a key into `Song.patches`.
 * Built-ins are referenced by id; custom (e.g. agent-made) patches are embedded
 * in the song so they travel with share links.
 */
export type PatchRef = string;

export interface Envelope {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface Effect {
  type: "reverb" | "chorus" | "delay" | "distortion" | "filter";
  wet: number; // 0..1
  /** Effect-specific numeric params (decay, frequency, depth, …). Validated per type by the schema. */
  params?: Record<string, number>;
}

export interface SynthPatch {
  kind: "synth";
  role: Role;
  label: string;
  oscillator: { type: string; params?: Record<string, number> };
  envelope: Envelope;
  filter?: { type: "lowpass" | "highpass" | "bandpass"; frequency: number; Q?: number };
  effects?: Effect[];
}

export interface SamplerPatch {
  kind: "sampler";
  role: Role;
  label: string;
  sampleSet: string; // id of a lazily loaded, cached sample set
  release?: number;
  effects?: Effect[];
}

export type Patch = SynthPatch | SamplerPatch;

export type InstrumentMap = Record<Role, PatchRef>;

// ─────────────────────────────────────────────────────────────────────────────
// Generator inputs (styles)
// ─────────────────────────────────────────────────────────────────────────────

/** Built-in style id ("pop", "funk", …) or "custom:<id>" (custom styles: open question). */
export type StyleId = string;
export type Variant = "simple" | "busy";

/** Everything the generator needs to (re)build a section. Kept on Song sections for "Regenerate". */
export interface SectionSeed {
  progression: string; // "I V vi IV" — parsed with the same numeral syntax as v1
  barsPerChord: number;
  style: StyleId;
  drums: Variant;
  bass: Variant;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc 1: BackingTrack (the recipe)
// ─────────────────────────────────────────────────────────────────────────────

export interface BackingSection {
  id: Id;
  name: string;
  progression: string;
  barsPerChord: number;
  // Overrides: omitted = use the BackingTrack value.
  style?: StyleId;
  drums?: Variant;
  bass?: Variant;
  tempo?: number;
}

export interface BackingTrack {
  version: 2;
  kind: "backingTrack";
  title: string; // = library item name
  key: KeyName;
  tempo: number;
  style: StyleId;
  drums: Variant;
  bass: Variant;
  voicing: Voicing;
  sections: BackingSection[];
  arrangement: Id[]; // section ids, repeats allowed
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc 2: Song (what the engine plays)
// ─────────────────────────────────────────────────────────────────────────────

export interface SongDefaults {
  tempo: number;
  meter: Meter;
  swing: Swing;
  voicing: Voicing;
}

/** Omitted = inherit from Song.defaults / Song.instruments. */
export interface SectionOverrides {
  tempo?: number;
  meter?: Meter;
  swing?: Swing;
  voicing?: Voicing;
  instruments?: Partial<InstrumentMap>;
}

/** A recorded loop. Audio lives in IndexedDB; the song only references it. */
export interface LoopTake {
  id: Id;
  name: string;
  audio: string; // IndexedDB key
  bars: number;
  gain: number; // 0..1
  muted?: boolean;
  // Takes start at bar 1 of their section. Later (additive): offset?: Tick
}

/**
 * Pitched parts of a section, keyed by name. Only `bass` exists today; a melody or
 * second line is added later as a new optional key (additive).
 */
export interface Parts {
  bass: NoteEvent[];
}

export interface Section {
  id: Id;
  name: string;
  bars: number;
  overrides: SectionOverrides;
  chords: ChordEvent[]; // sorted, non-overlapping; gaps = no chord
  drums: DrumHits;
  parts: Parts;
  loops: LoopTake[]; // several takes = overdub
  seed?: SectionSeed; // present if the generator made it
}

export interface Song {
  version: 2;
  kind: "song";
  title: string; // = library item name
  key: KeyName;
  ppq: typeof PPQ; // self-describing for agents; always 48
  defaults: SongDefaults;
  instruments: InstrumentMap;
  patches: Record<Id, Patch>; // custom patches only
  sections: Section[];
  arrangement: Id[];
}

export type Doc = BackingTrack | Song;

// ─────────────────────────────────────────────────────────────────────────────
// Practice (separate from the doc; saved per library item; shareable)
// ─────────────────────────────────────────────────────────────────────────────

export type Cycle = "none" | "4ths" | "5ths" | "custom";

export interface Practice {
  cycle: Cycle;
  customKeys: KeyName[]; // used when cycle = "custom"; played as given (absolute)
  advance: "auto" | "manual";
  mutes: Record<Role, boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Share envelope (what a link carries). New blocks can be added later.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareEnvelope {
  version: 2;
  doc: Doc;
  practice?: Practice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local only: never shared
// ─────────────────────────────────────────────────────────────────────────────

export interface LibraryItem {
  id: Id;
  doc: Doc;
  practice: Practice;
  updated: number; // epoch ms
  scratch?: true; // the one reusable quick-jam item
  modified?: true; // Scratch has edits since it was last reset/loaded
  origin?: "shared" | "import";
}

export interface Mix {
  chords: number; // 0..100
  bass: number;
  drums: number;
  loops: number;
  master: number;
}

export interface AppPrefs {
  theme: "dark" | "light";
  keepAwake: boolean;
  currentItemId: Id;
  loopOffsetMs: number; // device latency compensation for the looper
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime only: never persisted
// ─────────────────────────────────────────────────────────────────────────────

/** Playback position is always a bar. */
export interface Position {
  arrIdx: number; // index into arrangement
  lap: number; // cycle lap; key = lapKeys[lap % lapKeys.length]
  bar: number; // bar within the section
}

export type Transport =
  | { status: "stopped" }
  | { status: "paused"; at: Position }
  | {
      status: "playing";
      at: Position;
      jump?: { arrIdx: number; bar: number }; // lands at the next bar
      keyJump?: number; // lap index; lands at the end of the current lap
      loopSection?: Id; // section editor: loop one section
    };

/** One bar of concrete, schedulable events: the engine's only input. */
export interface ScheduledBar {
  position: Position;
  key: KeyName;
  tempo: number;
  meter: Meter;
  notes: {
    role: Role;
    time: Tick; // within the bar, swing already applied
    duration: Tick;
    midi: number; // drums: instrument mapping
    instrument: PatchRef;
  }[];
  loops: { take: LoopTake; offsetBars: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformations (all pure). Signatures only; see data-model.md.
// ─────────────────────────────────────────────────────────────────────────────

export interface Transforms {
  /** Recipe → song. Runs on every bar while a backing track plays, and once for "Open in composer". */
  generateSong(bt: BackingTrack): Song;
  /** Rebuild one section from a seed ("Regenerate"). Keeps id, name, loops. */
  regenerateSection(section: Section, seed: SectionSeed): Section;
  /** Section override ?? song default, per setting. Drives the player's "• override" marks. */
  effectiveSettings(song: Song, sectionId: Id): SongDefaults & { instruments: InstrumentMap };
  /** Keys each cycle lap plays in. */
  lapKeys(song: Song, practice: Practice): KeyName[];
  /** The heart of the engine: song + practice + position → one bar of events. */
  scheduleBar(song: Song, practice: Practice, at: Position, transport: Transport): ScheduledBar;
  /** Where playback goes after this bar (advance mode, queued jumps, lap end). */
  nextPosition(
    song: Song,
    practice: Practice,
    transport: Transport & { status: "playing" },
  ): Transport;
  /** A saved position made invalid by edits is clamped, never discarded. */
  clampPosition(song: Song, at: Position, loopSection?: Id): Position;
  /** Schema validation for imports, links, and agent output. Returns errors or the parsed value. */
  validateEnvelope(
    input: unknown,
  ): { ok: true; value: ShareEnvelope } | { ok: false; errors: string[] };
  encodeEnvelope(env: ShareEnvelope): Promise<string>; // JSON → deflate-raw → base64url
  decodeEnvelope(param: string): Promise<unknown>; // then validateEnvelope
}
