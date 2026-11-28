/**
 * Progression v2: the data schema (Zod 4). Single source for TS types, runtime
 * validation and (Milestone 7) the agent-facing JSON Schema. Runtime-only types
 * (transport, engine contract) live in `runtime.ts`. Rationale and data flow:
 * docs-internal/v2/data-model.md.
 *
 * TypeScript conventions:
 * - Kinds are string-literal unions with a discriminant (`kind`, `status`, `type`),
 *   never booleans like `isScratch`. Booleans only for genuine on/off state (`muted`).
 * - Invalid states are unrepresentable where cheap (tagged unions, non-empty tuples).
 * - Ids are branded so different id kinds can't be mixed up.
 * - Persisted values are immutable: updates create new objects. Functions take
 *   `DeepReadonly<…>` (types.ts).
 * - Enumerations live in one place (`z.enum` / `*_VALUES` arrays) and are switched
 *   on exhaustively (`assertNever`).
 *
 * Data conventions:
 * - Schema evolution within version 2 is additive only: add optional fields or
 *   widen unions; never rename, remove or narrow. Every saved doc stays valid
 *   (guarded by the fixture tests).
 * - Objects are strict: unknown keys are rejected, so agent typos fail loudly
 *   instead of being silently dropped.
 * - Optional field = "inherit / not set". No `null`s in persisted data.
 * - Positions and lengths are integer ticks at PPQ (48 per quarter note).
 * - Nothing persisted is an absolute pitch: chords are Roman numerals, notes are
 *   relative to the chord or key. The engine resolves to MIDI at play time.
 * - Deferred shapes are marked "Defined in Milestone N" and must not be guessed at.
 */

import { z } from "zod";
import { parseProgression, progressionBars } from "../core/numerals";
import { SAMPLE_SETS } from "./sampleSets";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Trimmed, non-empty, at most `max` characters. Validated, not transformed. */
const label = (max: number) =>
  z
    .string()
    .min(1, "must not be empty")
    .max(max, `must be at most ${max} characters`)
    .refine((s) => s.trim() === s, "must not have leading or trailing spaces");

/**
 * At least one element, typed `[T, ...T[]]`. Zod 4's `.nonempty()` validates but
 * keeps `T[]`, and `z.tuple` types it but reports empty arrays badly, so this
 * validates as an array and declares the tuple type.
 */
/**
 * A map with one entry per key of an enum (role, channel). Any subset of the keys
 * may be given; a missing key takes its default and an unknown key is rejected.
 * Parsed values always have every key. This is what keeps widening the enum
 * additive: a role or channel added later just needs a default, and every doc
 * saved before it (which lacks the key) still parses.
 */
function keyedMap<K extends string, V extends z.ZodType>(
  keys: z.ZodEnum<{ [k in K]: k }>,
  value: V,
  defaults: Record<K, z.output<V>>,
) {
  return z
    .partialRecord(keys, value)
    .transform((given) => ({ ...defaults, ...given }) as Record<K, z.output<V>>);
}

const nonEmpty = <T extends z.ZodType>(item: T) =>
  z.array(item).nonempty() as unknown as z.ZodType<
    [z.output<T>, ...z.output<T>[]],
    [z.input<T>, ...z.input<T>[]]
  >;

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const idString = () => z.string().regex(ID_RE, "ids are 1–40 of A–Z, a–z, 0–9, _ or -");

// ─────────────────────────────────────────────────────────────────────────────
// Ids
// ─────────────────────────────────────────────────────────────────────────────

export const SectionId = idString().brand<"SectionId">();
export type SectionId = z.infer<typeof SectionId>;
export const TakeId = idString().brand<"TakeId">();
export type TakeId = z.infer<typeof TakeId>;
/** Custom patch, key in `Song.patches`. */
export const PatchId = idString().brand<"PatchId">();
export type PatchId = z.infer<typeof PatchId>;
/** Library item. */
export const ItemId = idString().brand<"ItemId">();
export type ItemId = z.infer<typeof ItemId>;

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_SECTION_BARS = 64;

/** Ticks per quarter note. 8th = 24, 16th = 12, 8th triplet = 16, 16th triplet = 8. */
export const PPQ = 48;

/** Integer ≥ 0, in ticks. Not branded: tick arithmetic stays plain `number`. */
export const Tick = z.int().min(0);
export type Tick = z.infer<typeof Tick>;
/** Integer > 0, in ticks. */
export const Duration = z.int().min(1);

/** Beats per minute, always counting quarter notes (also in 6/8). v1's range. */
export const Bpm = z.int().min(40).max(220);
export type Bpm = z.infer<typeof Bpm>;

/** Both spellings are allowed; the spelling picks sharps vs flats for chord names. */
export const KEY_NAMES = [
  "C",
  "C#",
  "Db",
  "D",
  "D#",
  "Eb",
  "E",
  "F",
  "F#",
  "Gb",
  "G",
  "G#",
  "Ab",
  "A",
  "A#",
  "Bb",
  "B",
] as const;
export const KeyName = z.enum(KEY_NAMES);
export type KeyName = z.infer<typeof KeyName>;

/** Bar length in ticks = beatsPerBar × PPQ × 4 / beatUnit (4/4 → 192, 6/8 → 144, 3/4 → 144). */
export const Meter = z.strictObject({
  beatsPerBar: z.int().min(1).max(16),
  beatUnit: z.literal([2, 4, 8]),
});
export type Meter = z.infer<typeof Meter>;

/**
 * Swing amount on 8th notes: 0 = straight, 1 = full triplet feel (the off-beat 8th
 * moves from 24 to 32 ticks after the beat). Applied at schedule time; stored data
 * stays straight. Later (additive): widen to `number | { amount; subdivision: 8 | 16 }`.
 */
export const Swing = z.number().min(0).max(1);
export type Swing = z.infer<typeof Swing>;

/** How chords become notes. Applied at play time (voice-lead-loop depends on playback order). */
export const Voicing = z.enum(["root", "voice-lead", "voice-lead-loop"]);
export type Voicing = z.infer<typeof Voicing>;

// ─────────────────────────────────────────────────────────────────────────────
// Harmony: chords as Roman numerals
// ─────────────────────────────────────────────────────────────────────────────

export const Degree = z.literal([1, 2, 3, 4, 5, 6, 7]);
export type Degree = z.infer<typeof Degree>;
/** ♭ / natural / ♯ relative to the major scale. */
export const Accidental = z.literal([-1, 0, 1]);
export type Accidental = z.infer<typeof Accidental>;

/** Scale degree of the current key, e.g. ♭VII = { degree: 7, accidental: -1 }. */
export const ScaleStep = z.strictObject({
  degree: Degree,
  accidental: Accidental.optional(), // omitted = 0
});
export type ScaleStep = z.infer<typeof ScaleStep>;

/** v1's full set, unchanged. Minor-ish (for bass phrases): minor, m7, dim, m7b5, dim7, mMaj7. */
export const ChordQuality = z.enum([
  "major",
  "minor",
  "maj7",
  "m7",
  "dom7",
  "dim",
  "aug",
  "sus2",
  "sus4",
  "m7b5",
  "dim7",
  "mMaj7",
  "dom7sus4",
]);
export type ChordQuality = z.infer<typeof ChordQuality>;

/** A chord placed on the timeline. `start` is relative to its section. */
export const ChordEvent = z.strictObject({
  start: Tick,
  duration: Duration,
  root: ScaleStep,
  quality: ChordQuality,
  /** Slash chord / inversion: the bass note as a scale step, e.g. IV/I. Omitted = chord root. */
  bass: ScaleStep.optional(),
});
export type ChordEvent = z.infer<typeof ChordEvent>;

// ─────────────────────────────────────────────────────────────────────────────
// Notes: pitch relative to the chord or key (tagged union)
// ─────────────────────────────────────────────────────────────────────────────

export const ChordTone = z.literal([1, 3, 5, 7, 9, 11, 13]);
export type ChordTone = z.infer<typeof ChordTone>;

/** Octaves up/down from the part's register. Omitted = 0. */
export const Octave = z.int().min(-2).max(2);

export const Pitch = z.discriminatedUnion("kind", [
  /** Tone of the chord sounding at this note's start. 1 = root (v1 bass R/3/5). */
  z.strictObject({ kind: z.literal("chordTone"), tone: ChordTone, octave: Octave.optional() }),
  /** Scale degree of the current key. */
  z.strictObject({ kind: z.literal("scaleDegree"), step: ScaleStep, octave: Octave.optional() }),
  /** Semitones above the key's tonic (0–11); `octave` moves it further. */
  z.strictObject({
    kind: z.literal("chromatic"),
    semitones: z.int().min(0).max(11),
    octave: Octave.optional(),
  }),
]);
export type Pitch = z.infer<typeof Pitch>;

export const NoteEvent = z.strictObject({
  start: Tick,
  duration: Duration,
  pitch: Pitch,
  // Later (additive): velocity?: number
});
export type NoteEvent = z.infer<typeof NoteEvent>;

/**
 * Pitched parts of a section, keyed by name. Only `bass` exists today; a melody or
 * second line is added later as a new optional key (additive).
 */
export const Parts = z.strictObject({
  bass: z.array(NoteEvent),
});
export type Parts = z.infer<typeof Parts>;

// Registers (where relative pitches land) are fixed per role and not stored in
// docs. See data-model.md → Semantics.

// ─────────────────────────────────────────────────────────────────────────────
// Drums
// ─────────────────────────────────────────────────────────────────────────────

/** v1's drum set plus clap. */
export const DrumInstrument = z.enum([
  "kick",
  "snare",
  "hat",
  "hatOpen",
  "crash",
  "ride",
  "rideBell",
  "tom",
  "tom2",
  "clap",
]);
export type DrumInstrument = z.infer<typeof DrumInstrument>;

/**
 * Hit start ticks per instrument: sorted, unique. Any subdivision works (ticks, not
 * grid slots). Later (additive): widen to `(Tick | { start: Tick; velocity: number })[]`.
 */
export const DrumHits = z.partialRecord(DrumInstrument, z.array(Tick));
export type DrumHits = z.infer<typeof DrumHits>;

// ─────────────────────────────────────────────────────────────────────────────
// Roles and channels
// ─────────────────────────────────────────────────────────────────────────────

/** What an instrument plays. New parts would widen this (additive). */
export const Role = z.enum(["chords", "bass", "drums"]);
export type Role = z.infer<typeof Role>;
/** Mixer channels: every role plus recorded loops. */
export const Channel = z.enum([...Role.options, "loops"]);
export type Channel = z.infer<typeof Channel>;

// ─────────────────────────────────────────────────────────────────────────────
// Sound: instruments are data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Built-in patch ids: v1's sounds (the defaults). `pad-v1` and `bass-v1` are `Patch`
 * data (`BUILTIN_PATCHES` in `model/patches.ts`); `kit-v1` is code. Built-ins are
 * frozen: a new sound gets a new id, so saved songs never change how they sound.
 */
export const BuiltinPatchId = z.enum([
  "pad-v1",
  "bass-v1",
  "kit-v1",
  "piano-v1",
  "epiano-fm-v1",
  "bass-electric-v1",
]);
export type BuiltinPatchId = z.infer<typeof BuiltinPatchId>;

/** The role each built-in patch plays. A patch can only be used for its own role. */
export const BUILTIN_PATCH_ROLE: Record<BuiltinPatchId, "chords" | "bass" | "drums"> = {
  "pad-v1": "chords",
  "bass-v1": "bass",
  "kit-v1": "drums",
  "piano-v1": "chords",
  "epiano-fm-v1": "chords",
  "bass-electric-v1": "bass",
};

/** Either a built-in, or a custom patch embedded in `Song.patches`. */
export const PatchRef = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin"), id: BuiltinPatchId }),
  z.strictObject({ kind: z.literal("custom"), id: PatchId }),
]);
export type PatchRef = z.infer<typeof PatchRef>;

/** Roles a patch can play. Drums use built-in kits only (custom kits: later, additive). */
export const PatchRole = z.enum(["chords", "bass"]);
export type PatchRole = z.infer<typeof PatchRole>;

/** Seconds, 0…max. */
const seconds = (max: number) => z.number().min(0).max(max);

/** Amplitude envelope. Times in seconds; sustain is a level (0–1). */
export const Envelope = z.strictObject({
  attack: seconds(10),
  decay: seconds(10),
  sustain: z.number().min(0).max(1),
  release: seconds(10),
});
export type Envelope = z.infer<typeof Envelope>;

/** Basic waveforms. Later (additive): `voices` / `spread` for detuned sounds, FM/AM types. */
export const Oscillator = z.strictObject({
  type: z.enum(["sine", "triangle", "sawtooth", "square"]),
});
export type Oscillator = z.infer<typeof Oscillator>;

/**
 * A 12 dB/octave filter. With an `envelope`, the cutoff starts at `frequency` and
 * sweeps up by `octaves` at the envelope's peak (a classic synth-bass "pluck").
 */
export const Filter = z.strictObject({
  type: z.enum(["lowpass", "highpass", "bandpass"]),
  /** Cutoff in Hz (the envelope's base when it has one). */
  frequency: z.number().min(20).max(20000),
  /** Resonance. */
  q: z.number().min(0.1).max(20),
  envelope: z.strictObject({ ...Envelope.shape, octaves: z.number().min(0).max(8) }).optional(),
});
export type Filter = z.infer<typeof Filter>;

/**
 * Effects, applied in order after the sound source. Only reverb so far; new kinds
 * (delay, chorus, …) widen this union.
 */
export const Effect = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("reverb"),
    /** Seconds for the tail to fade out (to −60 dB). */
    decay: z.number().min(0.1).max(10),
    /** Dry/wet mix, 0 = dry, 1 = all reverb. */
    wet: z.number().min(0).max(1),
  }),
]);
export type Effect = z.infer<typeof Effect>;

/** Output level in dB, relative to the role's channel. */
const Volume = z.number().min(-40).max(6);

/**
 * Sample sets are referenced by id only: audio never goes in a song or a link.
 * The registry (`model/sampleSets.ts`) holds where each set's files are, which
 * notes were sampled and its credit line. Sets are never removed or changed once
 * shipped (a new recording gets a new id), so this list only grows.
 */
export const SAMPLE_SET_IDS: readonly string[] = Object.keys(SAMPLE_SETS);
export const SampleSetId = idString()
  .refine((id) => SAMPLE_SET_IDS.includes(id), {
    error: (iss) =>
      SAMPLE_SET_IDS.length === 0
        ? "no sample sets are available yet"
        : `unknown sample set "${String(iss.input)}" (available: ${SAMPLE_SET_IDS.join(", ")})`,
  })
  .brand<"SampleSetId">();
export type SampleSetId = z.infer<typeof SampleSetId>;

/**
 * An instrument as data. `role` says what it may play: `chords` plays polyphonically,
 * `bass` monophonically (a new note cuts the previous one, like parts). Registers
 * are fixed per role (see Semantics), not part of the patch.
 */
export const Patch = z.discriminatedUnion("kind", [
  /** A synthesizer: one oscillator, an amplitude envelope, an optional filter. */
  z.strictObject({
    kind: z.literal("synth"),
    role: PatchRole,
    oscillator: Oscillator,
    envelope: Envelope,
    filter: Filter.optional(),
    effects: z.array(Effect).max(4).optional(),
    volume: Volume,
  }),
  /**
   * A sampled instrument: notes between the sampled ones are pitched from the
   * nearest sample. Plays a fallback synth (the role's default patch) until the
   * set has loaded, or if it fails to.
   */
  z.strictObject({
    kind: z.literal("sampler"),
    role: PatchRole,
    set: SampleSetId,
    /** Fade-in / fade-out in seconds. Omitted = the set's own. */
    attack: seconds(10).optional(),
    release: seconds(10).optional(),
    effects: z.array(Effect).max(4).optional(),
    volume: Volume,
  }),
]);
export type Patch = z.infer<typeof Patch>;

/** v1's sounds: the instrument for a role a doc doesn't name. */
export const DEFAULT_INSTRUMENTS: Record<Role, PatchRef> = {
  chords: { kind: "builtin", id: "pad-v1" },
  bass: { kind: "builtin", id: "bass-v1" },
  drums: { kind: "builtin", id: "kit-v1" },
};

/** One patch per role; a role left out plays its default. */
export const InstrumentMap = keyedMap(Role, PatchRef, DEFAULT_INSTRUMENTS);
export type InstrumentMap = z.infer<typeof InstrumentMap>;

// ─────────────────────────────────────────────────────────────────────────────
// Styles: the generator's input data
// ─────────────────────────────────────────────────────────────────────────────

/** v1's seven. */
export const BuiltinStyleId = z.enum([
  "pop",
  "funk",
  "ballad",
  "rock",
  "shuffle",
  "funk16",
  "britpop",
]);
export type BuiltinStyleId = z.infer<typeof BuiltinStyleId>;
export const Variant = z.enum(["simple", "busy"]);
export type Variant = z.infer<typeof Variant>;
/** v1's options. */
export const BarsPerChord = z.literal([1, 2, 4]);
export type BarsPerChord = z.infer<typeof BarsPerChord>;

/** Built-in now; custom styles are an open question (a `kind: "custom"` member is additive). */
export const StyleRef = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("builtin"), id: BuiltinStyleId }),
]);
export type StyleRef = z.infer<typeof StyleRef>;

/**
 * One style: a one-bar 4/4 drum pattern and bass phrase per variant. Uses the same
 * shapes as songs (ticks, chord-tone pitches), so a generated section is these
 * patterns repeated per bar. Bass picks `major` or `minor` by the sounding chord's
 * quality. Built-ins: core/styles.ts. Later (additive): `meter?`.
 */
export const StyleDef = z.strictObject({
  id: BuiltinStyleId,
  label: label(40),
  drums: z.record(Variant, DrumHits), // ticks within one 4/4 bar (0–191)
  bass: z.record(Variant, z.strictObject({ major: z.array(NoteEvent), minor: z.array(NoteEvent) })),
});
export type StyleDef = z.infer<typeof StyleDef>;

/** A progression in v1's numeral syntax, e.g. "I V vi IV", "I7:4 IV7:2", "IV/I". Grammar: core/numerals.ts. */
export const Progression = label(400).superRefine((s, ctx) => {
  const parsed = parseProgression(s);
  if (!parsed.ok) for (const message of parsed.errors) ctx.addIssue({ code: "custom", message });
});

/** A generated section must fit `Section.bars` (≤ 64). */
function checkProgressionBars(
  value: { progression: string; barsPerChord: number },
  ctx: z.RefinementCtx,
) {
  const parsed = parseProgression(value.progression);
  if (!parsed.ok) return; // reported by Progression
  const bars = progressionBars(parsed.chords, value.barsPerChord);
  if (bars > MAX_SECTION_BARS) {
    ctx.addIssue({
      code: "custom",
      path: ["progression"],
      message: `is ${bars} bars long; a section can be at most ${MAX_SECTION_BARS}`,
    });
  }
}

/** Everything the generator needs to (re)build a section. Kept on Song sections for "Regenerate". */
export const SectionSeed = z
  .strictObject({
    progression: Progression,
    barsPerChord: BarsPerChord,
    style: StyleRef,
    drums: Variant,
    bass: Variant,
  })
  .superRefine(checkProgressionBars);
export type SectionSeed = z.infer<typeof SectionSeed>;

// ─────────────────────────────────────────────────────────────────────────────
// Cross-field checks shared by both docs
// ─────────────────────────────────────────────────────────────────────────────

type Ctx = z.RefinementCtx;
type Path = (string | number)[];

function checkUniqueIds(ids: readonly string[], path: Path, ctx: Ctx, what: string) {
  const seen = new Set<string>();
  ids.forEach((id, i) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: [...path, i, "id"],
        message: `duplicate ${what} id "${id}"`,
      });
    }
    seen.add(id);
  });
}

function checkArrangement(arrangement: readonly string[], ids: readonly string[], ctx: Ctx) {
  const known = new Set(ids);
  arrangement.forEach((id, i) => {
    if (!known.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: ["arrangement", i],
        message: `no section with id "${id}"`,
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Loops: recorded takes (audio lives on the device, in IndexedDB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A recorded loop on a section. The audio is a `LoopAudio` record in IndexedDB,
 * keyed by `id`; the doc only references it, so takes never travel in links.
 * Every unmuted take on a section plays together (overdub = add a take), from the
 * section's bar 1, each time the section plays. Loops are off while a cycle is on.
 */
export const LoopTake = z.strictObject({
  id: TakeId,
  name: label(40),
  bars: z.int().min(1), // ≤ section bars; starts at bar 1. Later (additive): offset?: Tick
  gain: z.number().min(0).max(1),
  muted: z.boolean().optional(), // omitted = false
  /** What the section was when this was recorded: later changes are flagged, not fixed. */
  recorded: z.strictObject({ key: KeyName, tempo: Bpm, meter: Meter }),
});
export type LoopTake = z.infer<typeof LoopTake>;

/** Take ids unique per section; each take fits its section. */
function checkTakes(
  takes: readonly LoopTake[],
  sectionBars: number,
  path: Path,
  ctx: z.RefinementCtx,
) {
  checkUniqueIds(
    takes.map((t) => t.id),
    [...path, "loops"],
    ctx,
    "take",
  );
  takes.forEach((t, i) => {
    if (t.bars > sectionBars) {
      ctx.addIssue({
        code: "custom",
        path: [...path, "loops", i, "bars"],
        message: `take is ${t.bars} bars; the section has ${sectionBars}`,
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Doc 1: BackingTrack (the recipe)
// ─────────────────────────────────────────────────────────────────────────────

export const BackingSection = z
  .strictObject({
    id: SectionId,
    name: label(40),
    progression: Progression,
    barsPerChord: BarsPerChord,
    // Overrides: omitted = use the BackingTrack value.
    style: StyleRef.optional(),
    drums: Variant.optional(),
    bass: Variant.optional(),
    tempo: Bpm.optional(),
    /** Recorded takes; carried into the generated song's section. Omitted = none. */
    loops: z.array(LoopTake).optional(),
  })
  .superRefine((section, ctx) => {
    checkProgressionBars(section, ctx);
    const parsed = parseProgression(section.progression);
    if (parsed.ok && section.loops) {
      checkTakes(section.loops, progressionBars(parsed.chords, section.barsPerChord), [], ctx);
    }
  });
export type BackingSection = z.infer<typeof BackingSection>;

export const BackingTrack = z
  .strictObject({
    version: z.literal(2),
    kind: z.literal("backingTrack"),
    title: label(80), // = library item name
    key: KeyName,
    tempo: Bpm,
    style: StyleRef,
    drums: Variant,
    bass: Variant,
    voicing: Voicing,
    sections: nonEmpty(BackingSection),
    arrangement: nonEmpty(SectionId), // repeats allowed
    // Always 4/4, straight. Later (additive): meter?, swing?
  })
  .superRefine((bt, ctx) => {
    const ids = bt.sections.map((s) => s.id);
    checkUniqueIds(ids, ["sections"], ctx, "section");
    checkArrangement(bt.arrangement, ids, ctx);
  });
export type BackingTrack = z.infer<typeof BackingTrack>;

// ─────────────────────────────────────────────────────────────────────────────
// Doc 2: Song (what the engine plays)
// ─────────────────────────────────────────────────────────────────────────────

export const SongDefaults = z.strictObject({
  tempo: Bpm,
  meter: Meter,
  swing: Swing,
  voicing: Voicing,
});
export type SongDefaults = z.infer<typeof SongDefaults>;

/** Omitted = inherit from Song.defaults / Song.instruments. */
export const SectionOverrides = z.strictObject({
  tempo: Bpm.optional(),
  meter: Meter.optional(),
  swing: Swing.optional(),
  voicing: Voicing.optional(),
  instruments: z.partialRecord(Role, PatchRef).optional(),
});
export type SectionOverrides = z.infer<typeof SectionOverrides>;

export const Section = z.strictObject({
  id: SectionId,
  name: label(40),
  bars: z.int().min(1).max(MAX_SECTION_BARS),
  overrides: SectionOverrides,
  chords: z.array(ChordEvent), // sorted, non-overlapping, within the section; gaps = no chord
  drums: DrumHits,
  parts: Parts, // each part is monophonic: sorted, unique starts
  loops: z.array(LoopTake), // several = overdub; layered in order
  seed: SectionSeed.optional(), // present if the generator made it
});
export type Section = z.infer<typeof Section>;

export function barLength(meter: Meter): number {
  return (meter.beatsPerBar * PPQ * 4) / meter.beatUnit;
}

function checkSection(section: Section, length: number, path: Path, ctx: Ctx) {
  const issue = (p: Path, message: string) =>
    ctx.addIssue({ code: "custom", path: [...path, ...p], message });

  let prevEnd = 0;
  section.chords.forEach((c, i) => {
    if (i > 0 && c.start < prevEnd) {
      const prev = section.chords[i - 1]!;
      issue(
        ["chords", i, "start"],
        c.start < prev.start
          ? "chords must be sorted by start"
          : `overlaps the previous chord (which ends at tick ${prevEnd})`,
      );
    }
    if (c.start + c.duration > length) {
      issue(
        ["chords", i],
        `ends at tick ${c.start + c.duration}, past the section end (${length})`,
      );
    }
    prevEnd = Math.max(prevEnd, c.start + c.duration);
  });

  for (const [drum, hits] of Object.entries(section.drums)) {
    hits.forEach((t, i) => {
      if (i > 0 && t <= hits[i - 1]!) {
        issue(["drums", drum, i], "hits must be sorted and unique");
      }
      if (t >= length) issue(["drums", drum, i], `tick ${t} is past the section end (${length})`);
    });
  }

  // A part plays one note at a time (a new note cuts the previous), so starts are
  // sorted and unique.
  section.parts.bass.forEach((n, i) => {
    if (i > 0 && n.start <= section.parts.bass[i - 1]!.start) {
      issue(["parts", "bass", i, "start"], "notes must be sorted by start, one note per start");
    }
    if (n.start >= length) {
      issue(["parts", "bass", i, "start"], `tick ${n.start} is past the section end (${length})`);
    }
  });

  checkTakes(section.loops, section.bars, path, ctx);
}

export const Song = z
  .strictObject({
    version: z.literal(2),
    kind: z.literal("song"),
    title: label(80), // = library item name
    key: KeyName,
    ppq: z.literal(PPQ), // self-describing for agents; always 48
    defaults: SongDefaults,
    instruments: InstrumentMap,
    patches: z.record(PatchId, Patch), // custom patches, referenced by `PatchRef` id
    sections: nonEmpty(Section),
    arrangement: nonEmpty(SectionId),
  })
  .superRefine((song, ctx) => {
    const ids = song.sections.map((s) => s.id);
    checkUniqueIds(ids, ["sections"], ctx, "section");
    checkArrangement(song.arrangement, ids, ctx);

    const checkRef = (ref: PatchRef, role: Role, path: Path) => {
      if (ref.kind === "custom") {
        const patch = song.patches[ref.id];
        if (!patch) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `no patch with id "${ref.id}" in patches`,
          });
        } else if (patch.role !== role) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `patch "${ref.id}" is a ${patch.role} patch, not ${role}`,
          });
        }
      }
      if (ref.kind === "builtin" && BUILTIN_PATCH_ROLE[ref.id] !== role) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `"${ref.id}" is a ${BUILTIN_PATCH_ROLE[ref.id]} patch, not ${role}`,
        });
      }
    };
    for (const role of Role.options) checkRef(song.instruments[role], role, ["instruments", role]);

    song.sections.forEach((section, i) => {
      const meter = section.overrides.meter ?? song.defaults.meter;
      checkSection(section, section.bars * barLength(meter), ["sections", i], ctx);
      for (const [role, ref] of Object.entries(section.overrides.instruments ?? {})) {
        checkRef(ref, role as Role, ["sections", i, "overrides", "instruments", role]);
      }
    });
  });
export type Song = z.infer<typeof Song>;

export const Doc = z.discriminatedUnion("kind", [BackingTrack, Song]);
export type Doc = z.infer<typeof Doc>;

// ─────────────────────────────────────────────────────────────────────────────
// Practice (separate from the doc; saved per library item; shareable)
// ─────────────────────────────────────────────────────────────────────────────

/** A custom cycle carries its keys, so "custom with no keys" can't exist. */
export const Cycle = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("fourths") }),
  z.strictObject({ kind: z.literal("fifths") }),
  /** Played as given (absolute keys). */
  z.strictObject({ kind: z.literal("custom"), keys: nonEmpty(KeyName) }),
]);
export type Cycle = z.infer<typeof Cycle>;

export const Advance = z.enum(["auto", "manual"]);
export type Advance = z.infer<typeof Advance>;

/** Nothing muted: the value for a channel a practice doesn't mention. */
export const DEFAULT_MUTES: Record<Channel, boolean> = {
  chords: false,
  bass: false,
  drums: false,
  loops: false,
};

export const Practice = z.strictObject({
  cycle: Cycle,
  advance: Advance,
  mutes: keyedMap(Channel, z.boolean(), DEFAULT_MUTES), // intent ("play without drums"), so shareable
});
export type Practice = z.infer<typeof Practice>;

// ─────────────────────────────────────────────────────────────────────────────
// Share envelope (what a link carries). New blocks can be added later.
// ─────────────────────────────────────────────────────────────────────────────

export const ShareEnvelope = z.strictObject({
  version: z.literal(2),
  doc: Doc,
  practice: Practice.optional(),
  /** Free-text note for humans/agents (fixtures say what they exercise). Ignored by the app. */
  $comment: z.string().optional(),
});
export type ShareEnvelope = z.infer<typeof ShareEnvelope>;

// ─────────────────────────────────────────────────────────────────────────────
// Local only: never shared
// ─────────────────────────────────────────────────────────────────────────────

/** Where a saved item came from. */
export const Origin = z.enum(["created", "shared", "imported"]);
export type Origin = z.infer<typeof Origin>;

const epochMs = z.int().min(0);

export const LibraryItem = z.discriminatedUnion("kind", [
  /** The one reusable quick-jam backing track. */
  z.strictObject({
    kind: z.literal("scratch"),
    id: ItemId,
    doc: BackingTrack,
    practice: Practice,
    updated: epochMs,
    state: z.enum(["pristine", "edited"]), // "edited" → confirm before a starter replaces it
  }),
  z.strictObject({
    kind: z.literal("saved"),
    id: ItemId,
    doc: Doc,
    practice: Practice,
    updated: epochMs,
    origin: Origin,
  }),
]);
export type LibraryItem = z.infer<typeof LibraryItem>;

/** localStorage, one key. Versioned separately from docs so the store can migrate. */
export const LibraryStore = z
  .strictObject({
    version: z.literal(1),
    items: nonEmpty(LibraryItem), // exactly one `scratch`
    currentItemId: ItemId,
  })
  .superRefine((store, ctx) => {
    checkUniqueIds(
      store.items.map((it) => it.id),
      ["items"],
      ctx,
      "item",
    );
    const scratch = store.items.filter((it) => it.kind === "scratch").length;
    if (scratch !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: `needs exactly one scratch item, found ${scratch}`,
      });
    }
    if (!store.items.some((it) => it.id === store.currentItemId)) {
      ctx.addIssue({
        code: "custom",
        path: ["currentItemId"],
        message: `no item with id "${store.currentItemId}"`,
      });
    }
  });
export type LibraryStore = z.infer<typeof LibraryStore>;

export const MixChannel = z.enum([...Channel.options, "master"]);
export type MixChannel = z.infer<typeof MixChannel>;

/** v1's default mix (chords sit lower). */
export const DEFAULT_LEVELS: Record<MixChannel, number> = {
  chords: 50,
  bass: 100,
  drums: 100,
  loops: 100,
  master: 100,
};

export const Mix = z.strictObject({
  levels: keyedMap(MixChannel, z.int().min(0).max(100), DEFAULT_LEVELS),
});
export type Mix = z.infer<typeof Mix>;

export const AppPrefs = z.strictObject({
  version: z.literal(1),
  theme: z.enum(["dark", "light"]),
  keepAwake: z.boolean(),
  loopOffsetMs: z.number(), // device latency compensation for the looper (Milestone 6)
});
export type AppPrefs = z.infer<typeof AppPrefs>;
