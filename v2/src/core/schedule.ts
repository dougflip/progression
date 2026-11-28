/**
 * scheduleBar: song + practice + position → one bar of concrete events. Pure.
 *
 * Pitches (see data-model.md → Semantics):
 * - Chords: root = lap tonic + scale step, voiced by voicing.ts.
 * - Bass register: two octaves below the chord's register root (v1).
 *   - chordTone: relative to that bass root. In a slash chord, tone 1 is the slash
 *     note, the nearest one to the bass root (−5…+6 semitones); other tones stay
 *     with the chord.
 *     Skipped where no chord is sounding.
 *   - scaleDegree / chromatic: relative to the tonic in the bass register (where
 *     chordTone 1 of a I chord lands), so they don't move with the chord.
 *   - `octave` adds 12 per step.
 * - Parts are monophonic: a note is cut where the next one starts (within the section).
 * - Swing moves off-beat 8ths later within each quarter note, counted from the bar start.
 *
 * Voicing: `prevVoicing` is the previous bar's `voicing` output. `voice-lead-loop`
 * starts fresh on the first bar of each lap; `root` never voice-leads.
 */

import { barLength, type ChordEvent, type Pitch, type SectionId, type Tick } from "../model/schema";
import type { DeepReadonly } from "../model/types";
import type {
  EngineSource,
  PlayScope,
  Position,
  ScheduledBar,
  ScheduledChord,
  ScheduledHit,
  ScheduledNote,
} from "../model/runtime";
import { effectiveSettings, findSection, lapKeys, tonicMidi } from "./settings";
import { DrumInstrument } from "../model/schema";
import { chordToneSemitones, mod12, stepSemitones } from "./theory";
import { registerRoot, voiceChord } from "./voicing";

type R<T> = DeepReadonly<T>;

/** The section a position plays: the arrangement entry, or the looped section. */
export function sectionIdAt(source: EngineSource, at: Position, scope: PlayScope): SectionId {
  if (scope.kind === "section") return scope.sectionId;
  const id = source.song.arrangement[at.arrIdx];
  if (id === undefined) throw new Error(`no arrangement entry ${at.arrIdx}`);
  return id;
}

/** True on the first bar of a cycle lap. */
export function isLapStart(at: Position, scope: PlayScope): boolean {
  return at.bar === 0 && (scope.kind === "section" || at.arrIdx === 0);
}

/**
 * Swing: within each quarter note (48 ticks), the off-beat 8th (24) moves to
 * 24 + 8 × amount; times in between scale proportionally.
 */
export function swingTick(t: number, amount: number): number {
  if (amount === 0) return t;
  const beat = Math.floor(t / 48) * 48;
  const x = t - beat;
  const off = 24 + 8 * amount;
  return beat + (x <= 24 ? (x * off) / 24 : off + ((x - 24) * (48 - off)) / 24);
}

export function scheduleBar(
  source: EngineSource,
  at: Position,
  scope: PlayScope,
  prevVoicing?: readonly number[],
): ScheduledBar {
  const { song, practice } = source;
  const sectionId = sectionIdAt(source, at, scope);
  const section = findSection(song, sectionId);
  if (at.bar < 0 || at.bar >= section.bars) {
    throw new Error(`bar ${at.bar} is outside section "${sectionId}" (${section.bars} bars)`);
  }
  const settings = effectiveSettings(song, sectionId);
  const keys = lapKeys(song, practice);
  const key = keys[at.lap % keys.length]!;
  const tonic = tonicMidi(keys, at.lap);
  const length = barLength(settings.meter);
  const barStart = at.bar * length;
  const barEnd = barStart + length;
  const swing = (t: Tick) => swingTick(t - barStart, settings.swing);

  const rootMidi = (c: R<ChordEvent>) => tonic + stepSemitones(c.root);

  // Chords: every chord sounding in this bar. One that started earlier is `continued`.
  let voicing =
    settings.voicing === "root" || (settings.voicing === "voice-lead-loop" && isLapStart(at, scope))
      ? undefined
      : prevVoicing;
  const chords: ScheduledChord[] = [];
  section.chords.forEach((c, chordIndex) => {
    const end = c.start + c.duration;
    if (end <= barStart || c.start >= barEnd) return;
    const voiced = voiceChord(rootMidi(c), c.quality, voicing);
    if (settings.voicing !== "root") voicing = voiced.upper;
    const start = Math.max(c.start, barStart);
    const time = swing(start);
    chords.push({
      time,
      duration: swing(end) - time,
      chordIndex,
      midi: voiced.midi,
      instrument: settings.instruments.chords,
      continued: c.start < barStart,
    });
  });

  // Bass: notes starting in this bar.
  const tonicBass = registerRoot(tonic, "major") - 24;
  const chordAt = (t: Tick) => section.chords.find((c) => c.start <= t && t < c.start + c.duration);
  const resolve = (pitch: R<Pitch>, t: Tick): number | undefined => {
    const octave = 12 * (pitch.octave ?? 0);
    switch (pitch.kind) {
      case "chordTone": {
        const c = chordAt(t);
        if (!c) return undefined;
        const bassRoot = registerRoot(rootMidi(c), c.quality) - 24;
        if (pitch.tone === 1 && c.bass) {
          const up = mod12(stepSemitones(c.bass) - stepSemitones(c.root));
          return bassRoot + (up > 6 ? up - 12 : up) + octave;
        }
        return bassRoot + chordToneSemitones(c.quality, pitch.tone) + octave;
      }
      case "scaleDegree":
        return tonicBass + stepSemitones(pitch.step) + octave;
      case "chromatic":
        return tonicBass + pitch.semitones + octave;
    }
  };
  // Parts are monophonic: a note is cut short where the next one starts.
  const bass: ScheduledNote[] = [];
  const notes = section.parts.bass;
  notes.forEach((n, i) => {
    if (n.start < barStart || n.start >= barEnd) return;
    const midi = resolve(n.pitch, n.start);
    if (midi === undefined) return;
    const next = notes[i + 1]?.start;
    const end = next === undefined ? n.start + n.duration : Math.min(n.start + n.duration, next);
    const time = swing(n.start);
    bass.push({ time, duration: swing(end) - time, midi, instrument: settings.instruments.bass });
  });

  // Drums: hits in this bar, by time then kit order.
  const drums: ScheduledHit[] = [];
  for (const drum of DrumInstrument.options) {
    for (const t of section.drums[drum] ?? []) {
      if (t >= barStart && t < barEnd) {
        drums.push({ time: swing(t), drum, instrument: settings.instruments.drums });
      }
    }
  }
  const kitOrder = (d: string) => DrumInstrument.options.indexOf(d as DrumInstrument);
  drums.sort((a, b) => a.time - b.time || kitOrder(a.drum) - kitOrder(b.drum));

  // Loops: unmuted takes still running in this bar. Off while a cycle is on: a take
  // is recorded in one key and would clash with the others.
  const loops =
    source.practice.cycle.kind === "none"
      ? section.loops
          .filter((t) => !t.muted && at.bar < t.bars)
          .map((t) => ({ takeId: t.id, gain: t.gain, bars: t.bars, barInTake: at.bar }))
      : [];

  const bar: ScheduledBar = {
    position: { ...at },
    sectionId,
    key,
    tempo: settings.tempo,
    meter: { ...settings.meter },
    length,
    chords,
    parts: { bass },
    drums,
    loops,
  };
  if (voicing) bar.voicing = [...voicing];
  return bar;
}
