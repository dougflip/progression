/**
 * progression-core.ts
 * Pure music theory layer — no DOM, no audio, no runtime dependencies.
 */

import { STYLE_OPTIONS, BASS_OPTIONS, DRUM_OPTIONS, VOICING_OPTIONS, STYLES } from "./styles.js";

// ─── Types ───────────────────────────────────────────────────────────────────

// Per-loop metadata — see docs-internal/looper.html#multi-loop-model. Capped at
// length 1 on Section.loops until Phase 3 lifts it.
export interface LoopRef {
  id: string;
  label?: string;
  capturedBars: number;
  volume: number;
  muted: boolean;
  compression: number;
  highpass: boolean;
  limiter: boolean;
}

export interface Section {
  progression: string;
  loops: LoopRef[];
}

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

export interface ChordVoicing {
  notes: string[];
  upperVoicing: number[];
  bassRoot: string;
  bassThird: string;
  bassFifth: string;
  isMinor: boolean;
  root: number;
  quality: ChordQuality;
}

export type ParsedChord = ChordVoicing & {
  token: string;
  numeral: string;
  bars: number;
};

export type SongChord = ParsedChord & {
  sectionIndex: number;
  posIndex: number;
  chipIndex: number;
};

export type BassStep = "R" | "3" | "5" | 0;
export type DrumStep = 0 | 1;

// prettier-ignore
export type DrumPattern = [
  DrumStep, DrumStep, DrumStep, DrumStep,
  DrumStep, DrumStep, DrumStep, DrumStep,
  DrumStep, DrumStep, DrumStep, DrumStep,
  DrumStep, DrumStep, DrumStep, DrumStep,
];

// prettier-ignore
export type BassPattern = [
  BassStep, BassStep, BassStep, BassStep,
  BassStep, BassStep, BassStep, BassStep,
  BassStep, BassStep, BassStep, BassStep,
  BassStep, BassStep, BassStep, BassStep,
];

export interface StyleBassPhrase {
  major: BassPattern;
  minor: BassPattern;
}

export interface StyleVariant {
  kick?: DrumPattern;
  snare?: DrumPattern;
  hat?: DrumPattern;
  hatOpen?: DrumPattern;
  crash?: DrumPattern;
  ride?: DrumPattern;
  rideBell?: DrumPattern;
  tom?: DrumPattern;
  tom2?: DrumPattern;
  bass: StyleBassPhrase;
}

export interface StyleDef {
  simple: StyleVariant;
  busy: StyleVariant;
}

export interface MixSettings {
  chordVol: number;
  bassVol: number;
  drumVol: number;
  masterVol: number;
  chordsOn: boolean;
  bassOn: boolean;
  drumsOn: boolean;
}

export interface ChordTickEvent {
  chipIndex: number;
  posIndex: number;
  sectionIndex: number;
  sectionChanged: boolean;
  resolvedChipNames: string[];
  resolvedKey: string;
  bars: number;
  sectionTokens: string[] | null;
  lapIndex: number;
}

export type LooperState = "idle" | "arming" | "recording";

export interface AudioStartOpts {
  chordSequence: SongChord[];
  tempo: number;
  style: StyleDef;
  bassVariant: string;
  drumVariant: string;
  voicing: string;
  advance: string;
  startPosIndex: number;
  startChipIndex: number;
  startLapIndex: number;
  key: string;
  cycle: string;
  customCycleKeys: string[];
  mix: MixSettings;
  sectionLoops: (LoopRef | null)[];
  onChordTick: (ev: ChordTickEvent) => void;
  onBeatTick: (beat: number) => void;
  onBarTick: (bar: number) => void;
  onLooperStateChange: (state: LooperState) => void;
  onSectionLoopChanged: (sectionIndex: number, loop: LoopRef | null) => void;
}

export interface AudioRebuildOpts {
  chordSequence: SongChord[];
  style: StyleDef;
  bassVariant: string;
  drumVariant: string;
  voicing: string;
  key: string;
  cycle: string;
  customCycleKeys: string[];
  sectionLoops: (LoopRef | null)[];
}

export interface AudioEngine {
  isPlaying(): boolean;
  start(opts: AudioStartOpts): Promise<void>;
  stop(): void;
  rebuild(opts: AudioRebuildOpts): void;
  setTempo(bpm: number): void;
  setVolume(channel: "chords" | "bass" | "drums" | "master", value: number): void;
  setMute(channel: "chords" | "bass" | "drums", muted: boolean): void;
  setAdvance(mode: string): void;
  queueJump(posIndex: number): void;
  cancelJump(): void;
  queueKeyJump(lapIndex: number): void;
  cancelKeyJump(): void;
  getPendingJump(): number | null;
  getPendingKeyJump(): number | null;
  armLoopRecording(muteDuringRecording: boolean): Promise<void>;
  cancelLoopRecording(): void;
  deleteLoop(sectionIndex: number): void;
  getLooperState(): LooperState;
  // 2d: full LoopRef per section (not just ids) — the engine needs each
  // section's own mix settings to apply at swap time, since there's still
  // only one shared player/effects chain (see docs-internal/looper.html#phases).
  setSectionLoops(loops: (LoopRef | null)[]): void;
  copyLoop(id: string): Promise<string | null>;
  sweepOrphanedLoops(keepIds: string[]): Promise<void>;
  setLoopOffsetMs(ms: number): void;
}

export interface PlaybackSettings {
  key: string;
  tempo: number;
  bars: number;
  cycle: string;
  customCycleKeys: string[];
  style: string;
  bass: string;
  drums: string;
  voicing: string;
  advance: string;
}

export interface AppState {
  playback: PlaybackSettings;
  mix: MixSettings;
  sections: Section[];
  arrangement: string;
  activeSection: number;
}

export type PresetState = Omit<AppState, "activeSection">;

export type AppStatePartial = {
  playback?: Partial<PlaybackSettings>;
  mix?: Partial<MixSettings>;
  sections?: Section[];
  arrangement?: string;
  activeSection?: number;
};

export interface UserPreset {
  id: string;
  name: string;
  state: PresetState;
}

export interface PlayerConfig {
  audio?: AudioEngine;
  persist: (key: string, value: string) => void;
  load: (key: string) => string | null;
  onStateChange: (state: AppState) => void;
  onPlaybackChange: (playing: boolean, reason?: string) => void;
  onChordTick: (ev: ChordTickEvent) => void;
  onBeatTick: (beat: number) => void;
  onBarTick: (bar: number) => void;
  onLooperStateChange: (state: LooperState) => void;
  onError?: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const BARS_OPTIONS = [1, 2, 4] as const;
export const MAX_BARS = 16;
export const MAX_CHORDS = 24;

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const;

export const ROMAN: Record<string, number> = {
  I: 0,
  II: 1,
  III: 2,
  IV: 3,
  V: 4,
  VI: 5,
  VII: 6,
  i: 0,
  ii: 1,
  iii: 2,
  iv: 3,
  v: 4,
  vi: 5,
  vii: 6,
};

export const KEY_MIDI: Record<string, number> = {
  C: 60,
  "C#": 61,
  Db: 61,
  D: 62,
  "D#": 63,
  Eb: 63,
  E: 64,
  F: 65,
  "F#": 66,
  Gb: 66,
  G: 67,
  "G#": 68,
  Ab: 68,
  A: 69,
  "A#": 70,
  Bb: 70,
  B: 71,
};

export const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
export const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;
export const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb"]);

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORD_NAME_RE = /^([A-G])([#b]?)(.*)$/;
const NOTE_RE = /^([A-G])([#b]?)(-?\d+)$/;

export const CYCLE_SEMIS = { none: 0, "4ths": 5, "5ths": 7 };
export const CYCLE_OPTIONS = ["none", "4ths", "5ths", "custom"] as const;
export const CYCLE_LABELS: Record<string, string> = {
  none: "🔄 Loop",
  "4ths": "🔄 Cycle 4",
  "5ths": "🔄 Cycle 5",
  custom: "🔄 Custom",
};

export function getShiftsForCycle(cycle: string, customCycleKeys: string[]): number[] {
  if (cycle === "4ths") return Array.from({ length: 12 }, (_, i) => 5 * i);
  if (cycle === "5ths") return Array.from({ length: 12 }, (_, i) => 7 * i);
  if (cycle === "custom" && customCycleKeys.length > 0) {
    const firstKey = customCycleKeys[0]!;
    const base = KEY_MIDI[firstKey] ?? 0;
    return customCycleKeys.map((k) => (KEY_MIDI[k] ?? 0) - base);
  }
  return [0];
}

// Custom-cycle shifts are relative to customCycleKeys[0] (see getShiftsForCycle above), and every
// resolved key is `key` + shift — so `key` must equal customCycleKeys[0] or every lap resolves
// against the wrong home key. Called wherever playback state can be constructed or mutated.
export function normalizePlaybackForCycle(playback: PlaybackSettings): PlaybackSettings {
  if (playback.cycle === "custom" && playback.customCycleKeys.length > 0) {
    return { ...playback, key: playback.customCycleKeys[0]! };
  }
  return playback;
}

const ROMAN_NUMERALS = [
  "III",
  "VII",
  "iii",
  "vii",
  "II",
  "IV",
  "VI",
  "ii",
  "iv",
  "vi",
  "I",
  "V",
  "i",
  "v",
] as const;

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  // 7ths omit the 5th (jazz shell voicing) — bass + chord context imply it
  maj7: [0, 4, 11],
  m7: [0, 3, 10],
  dom7: [0, 4, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  mMaj7: [0, 3, 7, 11],
  dom7sus4: [0, 5, 7, 10],
};

const QUALITY_IS_MINOR: Record<ChordQuality, boolean> = {
  major: false,
  minor: true,
  dim: true,
  aug: false,
  sus2: false,
  sus4: false,
  maj7: false,
  m7: true,
  dom7: false,
  m7b5: true,
  dim7: true,
  mMaj7: true,
  dom7sus4: false,
};

export const QUALITY_DISPLAY: Record<ChordQuality, string> = {
  major: "",
  minor: "m",
  dim: "dim",
  aug: "aug",
  sus2: "sus2",
  sus4: "sus4",
  maj7: "maj7",
  m7: "m7",
  dom7: "7",
  m7b5: "m7b5",
  dim7: "dim7",
  mMaj7: "mMaj7",
  dom7sus4: "7sus4",
};

// ─── Style Patterns ──────────────────────────────────────────────────────────

export {
  STYLE_OPTIONS,
  type StyleOption,
  STYLE_LABELS,
  BASS_OPTIONS,
  type BassOption,
  BASS_LABELS,
  DRUM_OPTIONS,
  type DrumOption,
  DRUM_LABELS,
  VOICING_OPTIONS,
  type VoicingOption,
  VOICING_PILL_LABELS,
  STYLES,
} from "./styles.js";

// ─── Token utilities ─────────────────────────────────────────────────────────

export function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean).slice(0, MAX_CHORDS);
}

function parseRoman(token: string): { numeral: string; suffix: string; flat: boolean } | null {
  const flat = token.startsWith("b");
  const rest = flat ? token.slice(1) : token;
  for (const r of ROMAN_NUMERALS) {
    if (rest.startsWith(r)) return { numeral: r, suffix: rest.slice(r.length), flat };
  }
  return null;
}

function suffixToQuality(suffix: string, isLowerCase: boolean): ChordQuality | null {
  if (suffix === "") return isLowerCase ? "minor" : "major";
  if (suffix === "m") return "minor";
  if (suffix === "maj7") return "maj7";
  if (suffix === "m7") return "m7";
  if (suffix === "7") return isLowerCase ? "m7" : "dom7";
  if (suffix === "dim" || suffix === "°") return "dim";
  if (suffix === "aug" || suffix === "+") return "aug";
  if (suffix === "sus2") return "sus2";
  if (suffix === "sus4") return "sus4";
  if (suffix === "m7b5" || suffix === "ø") return "m7b5";
  if (suffix === "dim7" || suffix === "°7") return "dim7";
  if (suffix === "mMaj7") return "mMaj7";
  if (suffix === "7sus4") return "dom7sus4";
  return null;
}

// ─── Note / MIDI utilities ───────────────────────────────────────────────────

export function midiToNote(m: number): string {
  return SHARP_NAMES[m % 12]! + (Math.floor(m / 12) - 1);
}

export function clampShift(shift: number): number {
  const s = ((shift % 12) + 12) % 12;
  return s > 6 ? s - 12 : s;
}

export function transposeNote(noteName: string, semis: number): string {
  if (!semis) return noteName;
  const m = NOTE_RE.exec(noteName);
  if (!m) return noteName;
  const letter = m[1]!;
  const acc = m[2]!;
  const octave = m[3]!;
  const acci = acc === "#" ? 1 : acc === "b" ? -1 : 0;
  const midi = (PITCH_CLASS[letter] ?? 0) + acci + (parseInt(octave, 10) + 1) * 12 + semis;
  return SHARP_NAMES[((midi % 12) + 12) % 12]! + (Math.floor(midi / 12) - 1);
}

// ─── Key / cycle display utilities ───────────────────────────────────────────

export function cycleUsesFlats(
  cycle: string,
  key: string,
  targetPc: number | null = null,
): boolean {
  if (cycle === "4ths") return true;
  if (cycle === "5ths") return false;
  if (cycle === "custom" && targetPc !== null) return FLAT_KEYS.has(FLAT_NAMES[targetPc]!);
  return FLAT_KEYS.has(key);
}

export function resolvedChordName(
  numeral: string,
  shift: number,
  key: string,
  cycle: string,
): string {
  const targetPc =
    cycle === "custom" ? (((((KEY_MIDI[key] ?? 0) % 12) + shift) % 12) + 12) % 12 : null;
  const useFlats = cycleUsesFlats(cycle, key, targetPc);
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;

  const roman = parseRoman(numeral);
  if (roman && roman.numeral in ROMAN) {
    const isLowerCase = roman.numeral === roman.numeral.toLowerCase();
    const quality = suffixToQuality(roman.suffix, isLowerCase);
    if (quality) {
      const degree = ROMAN[roman.numeral]!;
      const semis = (MAJOR_SCALE[degree] ?? 0) - (roman.flat ? 1 : 0);
      const rootPc = ((((KEY_MIDI[key] ?? 0) + semis + shift) % 12) + 12) % 12;
      return names[rootPc]! + QUALITY_DISPLAY[quality];
    }
  }

  const m = CHORD_NAME_RE.exec(numeral);
  if (m) {
    const letter = m[1]!;
    const acc = m[2]!;
    const suffix = m[3]!;
    if (suffixToQuality(suffix, false) === null) return "?";
    if (shift === 0) return numeral;
    const acci = acc === "#" ? 1 : acc === "b" ? -1 : 0;
    const pc = ((((PITCH_CLASS[letter] ?? 0) + acci + shift) % 12) + 12) % 12;
    return names[pc]! + suffix;
  }
  return "?";
}

export function isAbsoluteChord(numeral: string): boolean {
  return !(numeral in ROMAN) && /^[A-G]/.test(numeral);
}

export function getResolvedChipNames(state: AppState, lapIndex: number): string[] {
  const progStr = state.sections[state.activeSection - 1]?.progression ?? "";
  const tokens = tokenize(progStr);
  const shift =
    getShiftsForCycle(state.playback.cycle, state.playback.customCycleKeys)[lapIndex] ?? 0;
  return tokens.map((t) => {
    const { numeral } = parseToken(t, state.playback.bars);
    return resolvedChordName(numeral, shift, state.playback.key, state.playback.cycle);
  });
}

export function resolvedKeyName(key: string, shift: number, cycle: string): string {
  const baseKeyPc = (KEY_MIDI[key] ?? 0) % 12;
  const curPc = (((baseKeyPc + shift) % 12) + 12) % 12;
  const targetPc = cycle === "custom" ? curPc : null;
  const names = cycleUsesFlats(cycle, key, targetPc) ? FLAT_NAMES : SHARP_NAMES;
  return names[curPc]!;
}

// ─── Chord building ──────────────────────────────────────────────────────────

export function makeChord(
  root: number,
  quality: ChordQuality,
  prevUpper: number[] | null = null,
): ChordVoicing {
  const intervals = QUALITY_INTERVALS[quality];
  const topMax = intervals.length > 3 ? 72 : 76;
  let r = root;
  while (r + (intervals[intervals.length - 1] ?? 0) > topMax && r > 48) r -= 12;

  let chordNotes: number[];
  if (prevUpper) {
    const candidates: number[][] = [];
    for (let inv = 0; inv < intervals.length; inv++) {
      let notes: number[] = [];
      for (let i = 0; i < intervals.length; i++) {
        const idx = (inv + i) % intervals.length;
        const oct = inv + i >= intervals.length ? 12 : 0;
        notes.push(r + (intervals[idx] ?? 0) + oct);
      }
      while ((notes[notes.length - 1] ?? 0) > topMax) notes = notes.map((n) => n - 12);
      candidates.push(notes);
    }
    let best = candidates[0]!;
    let bestScore = Infinity;
    for (const cand of candidates) {
      let score = 0;
      for (let i = 0; i < cand.length; i++) score += Math.abs((cand[i] ?? 0) - (prevUpper[i] ?? 0));
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    chordNotes = best;
  } else {
    chordNotes = intervals.map((iv) => r + iv);
  }

  const chordBass = r - 12;
  const synthBass = r - 24;
  const isMinor = QUALITY_IS_MINOR[quality];
  return {
    notes: [chordBass, ...chordNotes].map(midiToNote),
    upperVoicing: chordNotes,
    bassRoot: midiToNote(synthBass),
    bassThird: midiToNote(synthBass + (intervals[1] ?? 0)),
    bassFifth: midiToNote(synthBass + (intervals[2] ?? 0)),
    isMinor,
    root,
    quality,
  };
}

export function buildChord(token: string, keyMidi: number): ChordVoicing {
  const roman = parseRoman(token);
  if (roman && roman.numeral in ROMAN) {
    const isLowerCase = roman.numeral === roman.numeral.toLowerCase();
    const quality = suffixToQuality(roman.suffix, isLowerCase);
    if (quality) {
      const degree = ROMAN[roman.numeral]!;
      const semis = (MAJOR_SCALE[degree] ?? 0) - (roman.flat ? 1 : 0);
      return makeChord(keyMidi + semis, quality);
    }
  }
  const m = CHORD_NAME_RE.exec(token);
  if (m) {
    const letter = m[1]!;
    const acc = m[2]!;
    const suffix = m[3]!;
    const quality = suffixToQuality(suffix, false);
    if (quality) {
      const acci = acc === "#" ? 1 : acc === "b" ? -1 : 0;
      const pc = ((((PITCH_CLASS[letter] ?? 0) + acci) % 12) + 12) % 12;
      return makeChord(60 + pc, quality);
    }
  }
  throw new Error(`Unknown chord: ${token}`);
}

// ─── Progression parsing ─────────────────────────────────────────────────────

export function parseToken(token: string, defaultBars: number): { numeral: string; bars: number } {
  const parts = token.split(":");
  const numeral = parts[0]!;
  const durStr = parts[1];
  let bars = defaultBars;
  if (durStr !== undefined) {
    const n = parseInt(durStr, 10);
    if (Number.isFinite(n) && n > 0) bars = Math.min(n, MAX_BARS);
  }
  return { numeral, bars };
}

export function parseProgression(input: string, key: string, defaultBars: number): ParsedChord[] {
  const keyMidi = KEY_MIDI[key]!;
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error("Progression is empty");
  return tokens.map((t) => {
    const { numeral, bars } = parseToken(t, defaultBars);
    return { token: t, numeral, bars, ...buildChord(numeral, keyMidi) };
  });
}

export function parseArrangement(str: string, count: number): number[] {
  const out: number[] = [];
  for (const tok of str.trim().split(/\s+/).filter(Boolean)) {
    const parts = tok.split(":");
    const refStr = parts[0]!;
    const repStr = parts[1];
    const ref = parseInt(refStr, 10);
    if (!Number.isInteger(ref) || ref < 1 || ref > count) continue;
    const reps = repStr === undefined ? 1 : parseInt(repStr, 10);
    if (!Number.isInteger(reps) || reps < 1) continue;
    for (let i = 0; i < reps && out.length < 16; i++) out.push(ref);
  }
  return out;
}

export function resolvePlayOrder(sections: Section[], arrangement: string): number[] {
  const count = sections.length;
  if (count < 2) return [];
  const validRefs = sections
    .map((s, i) => (tokenize(s.progression).length > 0 ? i + 1 : null))
    .filter((v): v is number => v !== null);
  if (validRefs.length < 2) return [];
  const parsed = parseArrangement(arrangement, count).filter((ref) => validRefs.includes(ref));
  return parsed.length ? parsed : validRefs;
}

export function buildSongChords(
  sections: Section[],
  arrangementStr: string,
  key: string,
  bars: number,
): SongChord[] {
  const count = sections.length;
  const parsed = parseArrangement(arrangementStr, count);
  const order = parsed.length ? parsed : Array.from({ length: count }, (_, i) => i + 1);
  const chords: SongChord[] = [];
  order.forEach((ref, posIndex) => {
    const sec = sections[ref - 1];
    if (!sec) return;
    const secChords = parseProgression(sec.progression, key, bars);
    secChords.forEach((c, chipIndex) => {
      chords.push({ ...c, sectionIndex: ref - 1, posIndex, chipIndex });
    });
  });
  return chords;
}

// ─── Arrangement mutation helpers ────────────────────────────────────────────

export function remapArrangementDelete(str: string, deletedIdx: number): string {
  const deleted = deletedIdx + 1;
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const parts = tok.split(":");
      const refStr = parts[0]!;
      const repStr = parts[1];
      const ref = parseInt(refStr, 10);
      if (!Number.isInteger(ref)) return tok;
      if (ref === deleted) return null;
      const newRef = ref > deleted ? ref - 1 : ref;
      return repStr !== undefined ? `${newRef}:${repStr}` : String(newRef);
    })
    .filter((v): v is string => v !== null)
    .join(" ");
}

export function remapArrangementSwap(str: string, idxA: number, idxB: number): string {
  const a = idxA + 1,
    b = idxB + 1;
  return str
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const parts = tok.split(":");
      const refStr = parts[0]!;
      const repStr = parts[1];
      const ref = parseInt(refStr, 10);
      if (!Number.isInteger(ref)) return tok;
      const newRef = ref === a ? b : ref === b ? a : ref;
      return repStr !== undefined ? `${newRef}:${repStr}` : String(newRef);
    })
    .join(" ");
}

// ─── App State ───────────────────────────────────────────────────────────────

export const VALID_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export const DEFAULTS: AppState = {
  playback: {
    key: "C",
    tempo: 85,
    bars: 2,
    cycle: "none",
    customCycleKeys: [],
    style: "funk",
    bass: "busy",
    drums: "simple",
    voicing: "voice-lead-loop",
    advance: "auto",
  },
  mix: {
    chordVol: 50,
    bassVol: 100,
    drumVol: 100,
    masterVol: 100,
    chordsOn: true,
    bassOn: true,
    drumsOn: true,
  },
  sections: [{ progression: "I vi ii V", loops: [] }],
  arrangement: "",
  activeSection: 1,
};

// ─── URL serialization ───────────────────────────────────────────────────────

export function parseUrl(searchString: string): AppState {
  const p = new URLSearchParams(searchString);
  const num = (k: string, def: number): number => {
    const v = parseInt(p.get(k) ?? "", 10);
    return Number.isFinite(v) ? v : def;
  };
  const bool = (k: string, def: boolean): boolean => {
    const v = p.get(k);
    if (v === "1") return true;
    if (v === "0") return false;
    return def;
  };
  const str = (k: string, def: string): string => p.get(k) ?? def;

  const key = str("key", DEFAULTS.playback.key);
  const bars = num("bars", DEFAULTS.playback.bars);
  const cycle = str("cycle", DEFAULTS.playback.cycle);
  const style = str("style", DEFAULTS.playback.style);
  const bass = str("bass", DEFAULTS.playback.bass);
  const drums = str("drums", DEFAULTS.playback.drums);
  const voicing = str("voicing", DEFAULTS.playback.voicing);
  const advance = str("advance", DEFAULTS.playback.advance);
  const rawCustomKeys = str("customKeys", "");
  const customCycleKeys = rawCustomKeys
    ? rawCustomKeys
        .split(",")
        .map((k) => k.trim())
        .filter((k): k is string => (VALID_KEYS as readonly string[]).includes(k))
    : [];
  const rawSections = p.getAll("section");
  const sections = rawSections.length
    ? rawSections.map((prog) => ({ progression: prog, loops: [] }))
    : DEFAULTS.sections;
  const rawActive = num("activeSection", DEFAULTS.activeSection);

  return {
    playback: normalizePlaybackForCycle({
      key: (VALID_KEYS as readonly string[]).includes(key) ? key : DEFAULTS.playback.key,
      tempo: Math.max(40, Math.min(220, num("tempo", DEFAULTS.playback.tempo))),
      bars: (BARS_OPTIONS as readonly number[]).includes(bars) ? bars : DEFAULTS.playback.bars,
      cycle: (CYCLE_OPTIONS as readonly string[]).includes(cycle) ? cycle : DEFAULTS.playback.cycle,
      customCycleKeys,
      style: (STYLE_OPTIONS as readonly string[]).includes(style) ? style : DEFAULTS.playback.style,
      bass: (BASS_OPTIONS as readonly string[]).includes(bass) ? bass : DEFAULTS.playback.bass,
      drums: (DRUM_OPTIONS as readonly string[]).includes(drums) ? drums : DEFAULTS.playback.drums,
      voicing: (VOICING_OPTIONS as readonly string[]).includes(voicing)
        ? voicing
        : DEFAULTS.playback.voicing,
      advance: ["auto", "manual"].includes(advance) ? advance : DEFAULTS.playback.advance,
    }),
    mix: {
      chordVol: num("chordVol", DEFAULTS.mix.chordVol),
      bassVol: num("bassVol", DEFAULTS.mix.bassVol),
      drumVol: num("drumVol", DEFAULTS.mix.drumVol),
      masterVol: num("masterVol", DEFAULTS.mix.masterVol),
      chordsOn: bool("chordsOn", DEFAULTS.mix.chordsOn),
      bassOn: bool("bassOn", DEFAULTS.mix.bassOn),
      drumsOn: bool("drumsOn", DEFAULTS.mix.drumsOn),
    },
    sections,
    arrangement: str("arrangement", DEFAULTS.arrangement),
    activeSection:
      Number.isInteger(rawActive) && rawActive >= 1 && rawActive <= sections.length ? rawActive : 1,
  };
}

export function serializeUrl(state: AppState): string {
  const p = new URLSearchParams();
  p.set("key", state.playback.key);
  p.set("tempo", String(state.playback.tempo));
  p.set("bars", String(state.playback.bars));
  p.set("cycle", state.playback.cycle);
  if (state.playback.customCycleKeys.length)
    p.set("customKeys", state.playback.customCycleKeys.join(","));
  p.set("style", state.playback.style);
  p.set("bass", state.playback.bass);
  p.set("drums", state.playback.drums);
  p.set("voicing", state.playback.voicing);
  state.sections.forEach((sec) => p.append("section", sec.progression));
  p.set("arrangement", state.arrangement);
  p.set("activeSection", String(state.activeSection));
  p.set("advance", state.playback.advance);
  p.set("chordVol", String(state.mix.chordVol));
  p.set("bassVol", String(state.mix.bassVol));
  p.set("drumVol", String(state.mix.drumVol));
  p.set("masterVol", String(state.mix.masterVol));
  p.set("chordsOn", state.mix.chordsOn ? "1" : "0");
  p.set("bassOn", state.mix.bassOn ? "1" : "0");
  p.set("drumsOn", state.mix.drumsOn ? "1" : "0");
  return p.toString();
}

// ─── Looper utilities ────────────────────────────────────────────────────────

/**
 * Trims/pads a single channel's samples to exactly `targetLength`, shifted by
 * `offsetSamples` — a manual latency-compensation nudge, since mic input
 * latency isn't something we can measure automatically. Positive shifts the
 * loop's content earlier (skips leading latency in the source); negative
 * shifts it later (pads the front with silence).
 */
export function alignAndTrimSamples(
  data: Float32Array,
  targetLength: number,
  offsetSamples = 0,
): Float32Array {
  const out = new Float32Array(targetLength);
  const srcStart = Math.max(0, offsetSamples);
  const srcEnd = Math.min(data.length, targetLength + offsetSamples);
  if (srcEnd <= srcStart) return out;
  out.set(data.subarray(srcStart, srcEnd), srcStart - offsetSamples);
  return out;
}

// ─── Player Factory ──────────────────────────────────────────────────────────

const PRESETS_STORAGE_KEY = "progression-presets-v2";
const DEFAULT_PRESET_STORAGE_KEY = "progression-default-preset-v1";

type PausedAt = { posIndex: number; chipIndex: number; lapIndex: number };

export function makeProgressionPlayer(config: PlayerConfig) {
  let _state: AppState = {
    playback: { ...DEFAULTS.playback },
    mix: { ...DEFAULTS.mix },
    sections: [...DEFAULTS.sections],
    arrangement: DEFAULTS.arrangement,
    activeSection: DEFAULTS.activeSection,
  };
  let _lastChordPos: PausedAt = { posIndex: 0, chipIndex: 0, lapIndex: 0 };
  let _pausedAt: PausedAt | null = null;
  let _loadedPreset: UserPreset | null = null;
  let _loadedBuiltinPreset: { id: string; label: string; state: PresetState } | null = null;

  function _toPresetState(s: PresetState): PresetState {
    return {
      playback: { ...s.playback },
      mix: { ...s.mix },
      sections: s.sections,
      arrangement: s.arrangement,
    };
  }

  function _applyPresetState(presetState: AppStatePartial): void {
    _pausedAt = null;
    _state = {
      playback: normalizePlaybackForCycle({ ...DEFAULTS.playback, ...presetState.playback }),
      mix:
        presetState.mix !== undefined ? { ...DEFAULTS.mix, ...presetState.mix } : { ..._state.mix },
      sections: presetState.sections ?? DEFAULTS.sections,
      arrangement: presetState.arrangement ?? DEFAULTS.arrangement,
      activeSection: _state.activeSection,
    };
  }

  function _afterPresetApply(): void {
    _notify();
    if (!config.audio?.isPlaying()) return;
    config.audio.setTempo(_state.playback.tempo);
    config.audio.setAdvance(_state.playback.advance);
    _scheduleRebuild();
  }

  function _notify(): void {
    config.onStateChange({
      ..._state,
      playback: { ..._state.playback },
      mix: { ..._state.mix },
    });
  }

  function _setPlayback(partial: Partial<PlaybackSettings>): void {
    _state = {
      ..._state,
      playback: normalizePlaybackForCycle({ ..._state.playback, ...partial }),
    };
    if (_pausedAt !== null && ("cycle" in partial || "customCycleKeys" in partial)) {
      _pausedAt = null;
    }
    _notify();
    if (!config.audio?.isPlaying()) return;
    if ("tempo" in partial) config.audio.setTempo(_state.playback.tempo);
    if ("advance" in partial) config.audio.setAdvance(_state.playback.advance);
    if (
      "key" in partial ||
      "bars" in partial ||
      "style" in partial ||
      "bass" in partial ||
      "drums" in partial ||
      "voicing" in partial ||
      "cycle" in partial ||
      "customCycleKeys" in partial
    )
      _scheduleRebuild();
  }

  function _setMix(partial: Partial<MixSettings>): void {
    _state = { ..._state, mix: { ..._state.mix, ...partial } };
    _notify();
    if (!config.audio?.isPlaying()) return;
    if ("chordVol" in partial) config.audio.setVolume("chords", _state.mix.chordVol);
    if ("bassVol" in partial) config.audio.setVolume("bass", _state.mix.bassVol);
    if ("drumVol" in partial) config.audio.setVolume("drums", _state.mix.drumVol);
    if ("masterVol" in partial) config.audio.setVolume("master", _state.mix.masterVol);
    if ("chordsOn" in partial) config.audio.setMute("chords", !_state.mix.chordsOn);
    if ("bassOn" in partial) config.audio.setMute("bass", !_state.mix.bassOn);
    if ("drumsOn" in partial) config.audio.setMute("drums", !_state.mix.drumsOn);
  }

  function _setStructural(
    partial: Partial<Pick<AppState, "sections" | "arrangement" | "activeSection">>,
  ): void {
    _state = { ..._state, ...partial };
    if (_pausedAt !== null && ("sections" in partial || "arrangement" in partial)) {
      _pausedAt = null;
    }
    _notify();
    if (!config.audio?.isPlaying()) return;
    if ("sections" in partial || "arrangement" in partial) _scheduleRebuild();
  }

  let _rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  function _scheduleRebuild(): void {
    clearTimeout(_rebuildTimer ?? undefined);
    _rebuildTimer = setTimeout(() => {
      try {
        const chords = buildSongChords(
          _state.sections,
          _state.arrangement,
          _state.playback.key,
          _state.playback.bars,
        );
        config.audio!.rebuild({
          chordSequence: chords,
          style: STYLES[_state.playback.style]!,
          bassVariant: _state.playback.bass,
          drumVariant: _state.playback.drums,
          voicing: _state.playback.voicing,
          key: _state.playback.key,
          cycle: _state.playback.cycle,
          customCycleKeys: _state.playback.customCycleKeys,
          sectionLoops: _sectionLoops(),
        });
      } catch (e) {
        config.onError?.(`Rebuild error: ${(e as Error).message}`);
      }
    }, 250);
  }

  function _sectionLoops(): (LoopRef | null)[] {
    return _state.sections.map((s) => s.loops[0] ?? null);
  }

  // 3a: everything a loop id must be reachable from to survive the sweep —
  // live state plus every saved preset (builtin presets never carry loops,
  // see presets.ts, so they're not part of the reachable set). The engine
  // owns IndexedDB and does the actual deleting; only this side can see
  // presets, so it computes what to keep.
  function _referencedLoopIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of _state.sections) for (const l of s.loops) ids.add(l.id);
    for (const p of _getUserPresets())
      for (const s of p.state.sections) for (const l of s.loops) ids.add(l.id);
    return ids;
  }

  function _sweepLoopGc(): void {
    void config.audio?.sweepOrphanedLoops([..._referencedLoopIds()]);
  }

  // Writes a loop directly onto a known section — the engine tells us exactly
  // which one (it tracks section position itself), so unlike 2a there's no
  // guessing via activeSection. No rebuild, no _setStructural (this never
  // changes what's audible).
  function _setSectionLoop(sectionIndex: number, loop: LoopRef | null): void {
    _state = {
      ..._state,
      sections: _state.sections.map((s, i) =>
        i === sectionIndex ? { ...s, loops: loop ? [loop] : [] } : s,
      ),
    };
    _notify();
    config.audio?.setSectionLoops(_sectionLoops());
  }

  // 2d: the Mix sheet's per-loop controls (volume/mute/compression/highpass/
  // limiter) — route through this rather than the engine-only bypass the
  // single-loop version used, so a mixer edit persists onto the section (and
  // rides along in presets) the same way updateSection() does for progression
  // text. No-ops if the section has no loop yet — there's nothing to edit.
  function _updateSectionLoop(sectionIndex: number, partial: Partial<LoopRef>): void {
    const loop = _state.sections[sectionIndex]?.loops[0];
    if (!loop) return;
    _setSectionLoop(sectionIndex, { ...loop, ...partial });
  }

  async function _startPlayback(): Promise<void> {
    const order = resolvePlayOrder(_state.sections, _state.arrangement);
    const chords = buildSongChords(
      _state.sections,
      _state.arrangement,
      _state.playback.key,
      _state.playback.bars,
    );
    let startPosIndex = 0;
    let startLapIndex = 0;
    let startChipIndex = 0;
    if (_pausedAt !== null) {
      startPosIndex = _pausedAt.posIndex;
      startChipIndex = _pausedAt.chipIndex;
      startLapIndex = _pausedAt.lapIndex;
      _pausedAt = null;
    } else if (order.length >= 2) {
      const idx = order.findIndex((ref) => ref === _state.activeSection);
      startPosIndex = idx >= 0 ? idx : 0;
    }

    await config.audio!.start({
      chordSequence: chords,
      tempo: _state.playback.tempo,
      style: STYLES[_state.playback.style]!,
      bassVariant: _state.playback.bass,
      drumVariant: _state.playback.drums,
      voicing: _state.playback.voicing,
      advance: _state.playback.advance,
      startPosIndex,
      startChipIndex,
      startLapIndex,
      key: _state.playback.key,
      cycle: _state.playback.cycle,
      customCycleKeys: _state.playback.customCycleKeys,
      mix: { ..._state.mix },
      sectionLoops: _sectionLoops(),
      onChordTick: (ev) => {
        _lastChordPos = { posIndex: ev.posIndex, chipIndex: ev.chipIndex, lapIndex: ev.lapIndex };
        if (ev.sectionChanged) _state.activeSection = ev.sectionIndex + 1;
        config.onChordTick(ev);
      },
      onBeatTick: config.onBeatTick,
      onBarTick: config.onBarTick,
      onLooperStateChange: config.onLooperStateChange,
      onSectionLoopChanged: _setSectionLoop,
    });

    config.onPlaybackChange(true);
    _notify();
  }

  function _pausePlayback(): void {
    _pausedAt = { ..._lastChordPos };
    config.audio!.stop();
    config.onPlaybackChange(false, "pause");
    _notify();
  }

  function _stopPlayback(): void {
    _pausedAt = null;
    const order = resolvePlayOrder(_state.sections, _state.arrangement);
    _state = { ..._state, activeSection: order.length > 0 ? order[0]! : 1 };
    config.audio!.stop();
    config.onPlaybackChange(false);
    _notify();
  }

  function _getUserPresets(): UserPreset[] {
    try {
      const presets = JSON.parse(config.load(PRESETS_STORAGE_KEY) ?? "[]") as UserPreset[];
      // Presets saved before Section.loops existed (pre-2026-07-09) have no
      // .loops key at all — backfill here, the one place stale localStorage
      // JSON enters the typed state, so every consumer downstream can rely
      // on it being an array.
      return presets.map((p) => ({
        ...p,
        state: {
          ...p.state,
          sections: (p.state.sections ?? []).map((s) => ({ ...s, loops: s.loops ?? [] })),
        },
      }));
    } catch {
      return [];
    }
  }

  return {
    getState: (): AppState => ({
      ..._state,
      playback: { ..._state.playback },
      mix: { ..._state.mix },
    }),

    setPlayback: (partial: Partial<PlaybackSettings>): void => _setPlayback(partial),
    setMix: (partial: Partial<MixSettings>): void => _setMix(partial),
    setArrangement: (arrangement: string): void => _setStructural({ arrangement }),

    applyUrl(searchString: string): void {
      _state = parseUrl(searchString);
      _notify();
    },

    serializeUrl: (): string => serializeUrl(_state),

    // ── Sections ──────────────────────────────────────────────────────────

    addSection(): void {
      if (_state.sections.length >= 6) return;
      _setStructural({ sections: [..._state.sections, { progression: "", loops: [] }] });
    },

    removeSection(index: number): void {
      if (_state.sections.length <= 1) return;
      const sections = _state.sections.filter((_, i) => i !== index);
      const arrangement = remapArrangementDelete(_state.arrangement, index);
      _setStructural({
        sections,
        arrangement,
        activeSection: Math.min(_state.activeSection, sections.length),
      });
      _sweepLoopGc();
    },

    moveSection(index: number, direction: "up" | "down"): void {
      const sections = [..._state.sections];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= sections.length) return;
      [sections[index], sections[target]] = [sections[target]!, sections[index]!];
      const arrangement = remapArrangementSwap(_state.arrangement, index, target);
      let { activeSection } = _state;
      if (activeSection === index + 1) activeSection = target + 1;
      else if (activeSection === target + 1) activeSection = index + 1;
      _setStructural({ sections, arrangement, activeSection });
    },

    setCycle(cycle: string): void {
      if (cycle === "custom" && !_state.playback.customCycleKeys.length) {
        _setPlayback({ cycle, customCycleKeys: [_state.playback.key] });
      } else {
        _setPlayback({ cycle });
      }
    },

    updateSection(index: number, progression: string): void {
      const sections = _state.sections.map((s, i) => (i === index ? { ...s, progression } : s));
      _setStructural({ sections });
    },

    // ── Presets ───────────────────────────────────────────────────────────

    loadPreset(presetState: AppStatePartial): void {
      _loadedPreset = null;
      _loadedBuiltinPreset = null;
      _applyPresetState(presetState);
      _afterPresetApply();
    },

    loadUserPreset(preset: UserPreset): void {
      _loadedPreset = preset;
      _loadedBuiltinPreset = null;
      _applyPresetState(preset.state);
      _afterPresetApply();
    },

    loadBuiltinPreset(id: string, label: string, state: AppStatePartial): void {
      _loadedPreset = null;
      _applyPresetState(state);
      _loadedBuiltinPreset = { id, label, state: _toPresetState(_state) };
      _afterPresetApply();
    },

    setLoadedUserPresetContext(preset: UserPreset): void {
      _loadedPreset = preset;
      _loadedBuiltinPreset = null;
    },

    setLoadedBuiltinPresetContext(id: string, label: string, state: AppStatePartial): void {
      _loadedPreset = null;
      _loadedBuiltinPreset = {
        id,
        label,
        state: {
          playback: normalizePlaybackForCycle({ ...DEFAULTS.playback, ...state.playback }),
          mix: state.mix !== undefined ? { ...DEFAULTS.mix, ...state.mix } : { ...DEFAULTS.mix },
          sections: state.sections ?? DEFAULTS.sections,
          arrangement: state.arrangement ?? DEFAULTS.arrangement,
        },
      };
    },

    // Backfills loops onto the current (URL-derived) sections, matching by
    // index — loops never travel through the URL, so a boot that resolves
    // presetId via setLoaded*PresetContext (context/dirty-check bookkeeping
    // only, no state re-apply) would otherwise leave a saved preset's loops
    // missing on a plain refresh. Only touches .loops; everything else
    // (progression, and whatever the URL already resolved) is left alone.
    mergeSectionLoops(sections: Section[]): void {
      _state = {
        ..._state,
        sections: _state.sections.map((s, i) => ({ ...s, loops: sections[i]?.loops ?? s.loops })),
      };
      _notify();
      config.audio?.setSectionLoops(_sectionLoops());
    },

    getUserPresets: _getUserPresets,

    getLoadedPreset: (): UserPreset | null => _loadedPreset,

    getLoadedBuiltinName: (): string | null => _loadedBuiltinPreset?.label ?? null,

    getLoadedPresetId: (): string | null => _loadedPreset?.id ?? _loadedBuiltinPreset?.id ?? null,

    isDirty(): boolean {
      const baseline = _loadedPreset?.state ?? _loadedBuiltinPreset?.state ?? null;
      if (!baseline) return false;
      return JSON.stringify(_toPresetState(_state)) !== JSON.stringify(_toPresetState(baseline));
    },

    // "Save As" forks a new song — it should get its own independent copy of
    // each loop, not share the original's IndexedDB row (deleting one would
    // silently break the other). Copies before snapshotting, into both live
    // state and the saved preset, so the session you land in after Save As
    // is already using the new copies, not the old ids.
    async saveUserPreset(name: string): Promise<string> {
      const sections = await Promise.all(
        _state.sections.map(async (s) => {
          const loop = s.loops[0];
          if (!loop) return s;
          const newId = await config.audio?.copyLoop(loop.id);
          return { ...s, loops: newId ? [{ ...loop, id: newId }] : [] };
        }),
      );
      _state = { ..._state, sections };
      _notify();
      config.audio?.setSectionLoops(_sectionLoops());
      const id = Date.now().toString(36);
      const preset: UserPreset = { id, name, state: _toPresetState(_state) };
      config.persist(PRESETS_STORAGE_KEY, JSON.stringify([..._getUserPresets(), preset]));
      _loadedPreset = preset;
      return id;
    },

    overwriteUserPreset(id: string): void {
      const state = _toPresetState(_state);
      const presets = _getUserPresets().map((p) => (p.id === id ? { ...p, state } : p));
      config.persist(PRESETS_STORAGE_KEY, JSON.stringify(presets));
      _loadedPreset = presets.find((p) => p.id === id) ?? null;
      _sweepLoopGc();
    },

    revertPreset(): void {
      const baseline = _loadedPreset?.state ?? _loadedBuiltinPreset?.state;
      if (!baseline) return;
      _applyPresetState(baseline);
      _afterPresetApply();
    },

    renameUserPreset(id: string, name: string): void {
      config.persist(
        PRESETS_STORAGE_KEY,
        JSON.stringify(_getUserPresets().map((p) => (p.id === id ? { ...p, name } : p))),
      );
      if (_loadedPreset?.id === id) _loadedPreset = { ..._loadedPreset, name };
    },

    deleteUserPreset(id: string): void {
      config.persist(
        PRESETS_STORAGE_KEY,
        JSON.stringify(_getUserPresets().filter((p) => p.id !== id)),
      );
      if (_loadedPreset?.id === id) _loadedPreset = null;
      if (config.load(DEFAULT_PRESET_STORAGE_KEY) === id) {
        config.persist(DEFAULT_PRESET_STORAGE_KEY, "");
      }
      _sweepLoopGc();
    },

    getDefaultPresetId: (): string | null => config.load(DEFAULT_PRESET_STORAGE_KEY) || null,

    setDefaultPresetId: (id: string | null): void => {
      config.persist(DEFAULT_PRESET_STORAGE_KEY, id ?? "");
    },

    // ── Playback ──────────────────────────────────────────────────────────

    togglePlay(): Promise<void> {
      if (!config.audio) return Promise.resolve();
      if (config.audio.isPlaying()) {
        _pausePlayback();
        return Promise.resolve();
      }
      return _startPlayback().catch((e) => {
        config.onError?.(`Playback error: ${(e as Error).message}`);
      });
    },

    stop(): void {
      if (!config.audio) return;
      _stopPlayback();
    },

    seekToLap(lapIndex: number): void {
      _pausedAt =
        _pausedAt !== null ? { ..._pausedAt, lapIndex } : { posIndex: 0, chipIndex: 0, lapIndex };
      _notify();
    },

    seekToPos(posIndex: number): void {
      const lapIndex = _pausedAt !== null ? _pausedAt.lapIndex : 0;
      _pausedAt = { posIndex, chipIndex: 0, lapIndex };
      const order = resolvePlayOrder(_state.sections, _state.arrangement);
      const section = order[Math.min(posIndex, order.length - 1)];
      if (section !== undefined) _setStructural({ activeSection: section });
      else _notify();
    },

    seekToChip(posIndex: number, chipIndex: number): void {
      const lapIndex = _pausedAt !== null ? _pausedAt.lapIndex : 0;
      _pausedAt = { posIndex, chipIndex, lapIndex };
      _notify();
    },

    isPaused: (): boolean => _pausedAt !== null,

    queueJump(posIndex: number): void {
      config.audio?.queueJump(posIndex);
    },

    cancelJump(): void {
      config.audio?.cancelJump();
    },

    queueKeyJump(lapIndex: number): void {
      config.audio?.queueKeyJump(lapIndex);
    },

    cancelKeyJump(): void {
      config.audio?.cancelKeyJump();
    },

    getPendingJump: (): number | null => config.audio?.getPendingJump() ?? null,
    getPendingKeyJump: (): number | null => config.audio?.getPendingKeyJump() ?? null,

    // ── Looper (spike) ────────────────────────────────────────────────────
    armLoopRecording(muteDuringRecording: boolean): Promise<void> {
      if (!config.audio) return Promise.resolve();
      return config.audio.armLoopRecording(muteDuringRecording).catch((e) => {
        config.onError?.(`Loop recording error: ${(e as Error).message}`);
      });
    },

    cancelLoopRecording(): void {
      config.audio?.cancelLoopRecording();
    },

    deleteLoop(sectionIndex: number): void {
      config.audio?.deleteLoop(sectionIndex);
      _setSectionLoop(sectionIndex, null);
      _sweepLoopGc();
    },

    getLooperState: (): LooperState => config.audio?.getLooperState() ?? "idle",

    setLoopOffsetMs(ms: number): void {
      config.audio?.setLoopOffsetMs(ms);
    },

    setLoopVolume(sectionIndex: number, value: number): void {
      _updateSectionLoop(sectionIndex, { volume: value });
    },

    setLoopMuted(sectionIndex: number, muted: boolean): void {
      _updateSectionLoop(sectionIndex, { muted });
    },

    setLoopCompression(sectionIndex: number, amount: number): void {
      _updateSectionLoop(sectionIndex, { compression: amount });
    },

    setLoopHighpass(sectionIndex: number, enabled: boolean): void {
      _updateSectionLoop(sectionIndex, { highpass: enabled });
    },

    setLoopLimiter(sectionIndex: number, enabled: boolean): void {
      _updateSectionLoop(sectionIndex, { limiter: enabled });
    },
  };
}
