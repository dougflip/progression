/**
 * progression-core.ts
 * Pure music theory layer — no DOM, no audio, no runtime dependencies.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Section {
  progression: string;
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

export interface StyleBassPhrase {
  major: BassStep[];
  minor: BassStep[];
}

export interface StyleDrumPhrase {
  simple: number[];
  busy: number[];
}

export interface StyleDef {
  kick: StyleDrumPhrase;
  snare: StyleDrumPhrase;
  hat: StyleDrumPhrase;
  bass: {
    simple: StyleBassPhrase;
    busy: StyleBassPhrase;
  };
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

export interface AudioStartOpts {
  chordSequence: SongChord[];
  tempo: number;
  style: StyleDef;
  bassVariant: string;
  voicing: string;
  advance: string;
  startPosIndex: number;
  startChipIndex: number;
  startLapIndex: number;
  key: string;
  cycle: string;
  customCycleKeys: string[];
  mix: MixSettings;
  onChordTick: (ev: ChordTickEvent) => void;
  onBeatTick: (beat: number) => void;
  onBarTick: (bar: number) => void;
}

export interface AudioRebuildOpts {
  chordSequence: SongChord[];
  style: StyleDef;
  bassVariant: string;
  voicing: string;
  key: string;
  cycle: string;
  customCycleKeys: string[];
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
}

export interface PlaybackSettings {
  key: string;
  tempo: number;
  bars: number;
  cycle: string;
  customCycleKeys: string[];
  style: string;
  bass: string;
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
  state: AppState;
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
  none: "Loop",
  "4ths": "Cycle 4ths",
  "5ths": "Cycle 5ths",
  custom: "Custom",
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

export const STYLE_OPTIONS = ["pop", "funk", "ballad", "rock"] as const;
export const STYLE_LABELS: Record<string, string> = {
  pop: "Pop",
  funk: "Funk",
  ballad: "Ballad",
  rock: "Rock",
};
export const BASS_OPTIONS = ["simple", "busy"] as const;
export const BASS_LABELS: Record<string, string> = { simple: "Simple", busy: "Busy" };
export const VOICING_OPTIONS = ["root", "voice-lead", "voice-lead-loop"] as const;
export const VOICING_PILL_LABELS: Record<string, string> = {
  root: "Root",
  "voice-lead": "Lead",
  "voice-lead-loop": "Lead/loop",
};

// ─── Style Patterns ──────────────────────────────────────────────────────────

// 16-step patterns (one bar of 16th notes).
// Drums: 1 = hit, 0 = rest.
// Bass: 'R' = root, '3' = third, '5' = fifth, 0 = rest.
export const STYLES: Record<string, StyleDef> = {
  pop: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      busy: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      busy: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    },
    hat: {
      simple: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, "R", 0, 0, 0, "5", 0, 0, 0, "R", 0, 0, 0],
        minor: ["R", 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0],
      },
      busy: {
        major: ["R", 0, 0, 0, "5", 0, 0, 0, "3", 0, 0, 0, "5", 0, "R", 0],
        minor: ["R", 0, 0, 0, "5", 0, 0, 0, "3", 0, 0, 0, "5", 0, "R", 0],
      },
    },
  },
  funk: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      busy: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      busy: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    },
    hat: {
      simple: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0, "5", 0],
        minor: ["R", 0, 0, 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0, "R", 0],
      },
      busy: {
        major: ["R", 0, 0, "R", 0, 0, "R", 0, 0, "3", 0, "R", 0, "3", 0, "5"],
        minor: ["R", 0, 0, "R", 0, 0, "R", 0, 0, "3", 0, "R", 0, "3", 0, "R"],
      },
    },
  },
  ballad: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      busy: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      busy: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    },
    hat: {
      simple: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      busy: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, 0, 0, 0, 0, "5", 0, 0, 0, 0, 0, 0, 0],
        minor: ["R", 0, 0, 0, 0, 0, 0, 0, "R", 0, 0, 0, 0, 0, 0, 0],
      },
      busy: {
        major: ["R", 0, 0, 0, 0, 0, 0, 0, "3", 0, "5", 0, "3", 0, "R", 0],
        minor: ["R", 0, 0, 0, 0, 0, 0, 0, "3", 0, "5", 0, "3", 0, "R", 0],
      },
    },
  },
  rock: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      busy: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      busy: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    },
    hat: {
      simple: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, 0, 0, "R", 0, "R", 0, 0, 0, "5", 0, 0, 0],
        minor: ["R", 0, 0, 0, 0, 0, "R", 0, "R", 0, 0, 0, "R", 0, 0, 0],
      },
      busy: {
        major: ["R", 0, "R", 0, "3", 0, "R", 0, "R", 0, "R", 0, "5", 0, "3", 0],
        minor: ["R", 0, "R", 0, "3", 0, "R", 0, "R", 0, "R", 0, "5", 0, "3", 0],
      },
    },
  },
};

// ─── Built-in Presets ────────────────────────────────────────────────────────

export const PRESETS: Array<{ label: string; state: AppStatePartial }> = [
  {
    label: "I vi ii V",
    state: {
      sections: [{ progression: "I vi ii V" }],
      arrangement: "",
      playback: { cycle: "none" },
    },
  },
  {
    label: "12-bar blues",
    state: {
      sections: [{ progression: "I7:4 IV7:2 I7:2 V7:1 IV7:1 I7:1 V7:1" }],
      arrangement: "",
      playback: { cycle: "none", tempo: 120, style: "rock" },
    },
  },
  {
    label: "Sample Song",
    state: {
      sections: [
        { progression: "I V vi IV" },
        { progression: "IV V I vi" },
        { progression: "ii V I I" },
      ],
      arrangement: "1 2 1 2 3 2",
      playback: { cycle: "none", tempo: 120, style: "pop" },
    },
  },
  {
    label: "Cycle 4ths",
    state: { sections: [{ progression: "I" }], arrangement: "", playback: { cycle: "4ths" } },
  },
  {
    label: "Cycle 5ths",
    state: { sections: [{ progression: "I" }], arrangement: "", playback: { cycle: "5ths" } },
  },
];

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
  sections: [{ progression: "I vi ii V" }],
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
    ? rawSections.map((prog) => ({ progression: prog }))
    : DEFAULTS.sections;
  const rawActive = num("activeSection", DEFAULTS.activeSection);

  return {
    playback: {
      key: (VALID_KEYS as readonly string[]).includes(key) ? key : DEFAULTS.playback.key,
      tempo: Math.max(40, Math.min(220, num("tempo", DEFAULTS.playback.tempo))),
      bars: (BARS_OPTIONS as readonly number[]).includes(bars) ? bars : DEFAULTS.playback.bars,
      cycle: (CYCLE_OPTIONS as readonly string[]).includes(cycle) ? cycle : DEFAULTS.playback.cycle,
      customCycleKeys,
      style: (STYLE_OPTIONS as readonly string[]).includes(style) ? style : DEFAULTS.playback.style,
      bass: (BASS_OPTIONS as readonly string[]).includes(bass) ? bass : DEFAULTS.playback.bass,
      voicing: (VOICING_OPTIONS as readonly string[]).includes(voicing)
        ? voicing
        : DEFAULTS.playback.voicing,
      advance: ["auto", "manual"].includes(advance) ? advance : DEFAULTS.playback.advance,
    },
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

// ─── Player Factory ──────────────────────────────────────────────────────────

const PRESETS_STORAGE_KEY = "progression-presets-v2";

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

  function _notify(): void {
    config.onStateChange({
      ..._state,
      playback: { ..._state.playback },
      mix: { ..._state.mix },
    });
  }

  function _setPlayback(partial: Partial<PlaybackSettings>): void {
    _state = { ..._state, playback: { ..._state.playback, ...partial } };
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
          voicing: _state.playback.voicing,
          key: _state.playback.key,
          cycle: _state.playback.cycle,
          customCycleKeys: _state.playback.customCycleKeys,
        });
      } catch (e) {
        config.onError?.(`Rebuild error: ${(e as Error).message}`);
      }
    }, 250);
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
      voicing: _state.playback.voicing,
      advance: _state.playback.advance,
      startPosIndex,
      startChipIndex,
      startLapIndex,
      key: _state.playback.key,
      cycle: _state.playback.cycle,
      customCycleKeys: _state.playback.customCycleKeys,
      mix: { ..._state.mix },
      onChordTick: (ev) => {
        _lastChordPos = { posIndex: ev.posIndex, chipIndex: ev.chipIndex, lapIndex: ev.lapIndex };
        if (ev.sectionChanged) _state.activeSection = ev.sectionIndex + 1;
        config.onChordTick(ev);
      },
      onBeatTick: config.onBeatTick,
      onBarTick: config.onBarTick,
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
      return JSON.parse(config.load(PRESETS_STORAGE_KEY) ?? "[]") as UserPreset[];
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
      _setStructural({ sections: [..._state.sections, { progression: "" }] });
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
      _pausedAt = null;
      _state = {
        playback: { ...DEFAULTS.playback, ...presetState.playback },
        mix:
          presetState.mix !== undefined
            ? { ...DEFAULTS.mix, ...presetState.mix }
            : { ..._state.mix },
        sections: presetState.sections ?? DEFAULTS.sections,
        arrangement: presetState.arrangement ?? DEFAULTS.arrangement,
        activeSection: presetState.activeSection ?? DEFAULTS.activeSection,
      };
      _notify();
      if (!config.audio?.isPlaying()) return;
      config.audio.setTempo(_state.playback.tempo);
      config.audio.setAdvance(_state.playback.advance);
      _scheduleRebuild();
    },

    getUserPresets: _getUserPresets,

    saveUserPreset(name: string): string {
      const id = Date.now().toString(36);
      config.persist(
        PRESETS_STORAGE_KEY,
        JSON.stringify([
          ..._getUserPresets(),
          {
            id,
            name,
            state: { ..._state, playback: { ..._state.playback }, mix: { ..._state.mix } },
          },
        ]),
      );
      return id;
    },

    renameUserPreset(id: string, name: string): void {
      config.persist(
        PRESETS_STORAGE_KEY,
        JSON.stringify(_getUserPresets().map((p) => (p.id === id ? { ...p, name } : p))),
      );
    },

    deleteUserPreset(id: string): void {
      config.persist(
        PRESETS_STORAGE_KEY,
        JSON.stringify(_getUserPresets().filter((p) => p.id !== id)),
      );
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
  };
}
