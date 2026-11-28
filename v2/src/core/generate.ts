/**
 * The generator: BackingTrack (recipe) → Song. Pure.
 *
 * A generated section is 4/4. Each chord lasts its `:bars` or the section's
 * bars-per-chord; every bar repeats the style's one-bar drum pattern and the bass
 * phrase for the chord sounding at that bar (`major` or `minor` by its quality).
 */

import {
  PPQ,
  type BackingTrack,
  type ChordEvent,
  type DrumHits,
  type NoteEvent,
  type Section,
  type SectionId,
  type LoopTake,
  type SectionSeed,
  type Song,
} from "../model/schema";
import { freezeInDev, type DeepReadonly } from "../model/types";
import { parseProgression } from "./numerals";
import { DEFAULT_INSTRUMENTS, findSection } from "./settings";
import type { Styles } from "./styles";
import { MINORISH } from "./theory";

type R<T> = DeepReadonly<T>;

const FOUR_FOUR = { beatsPerBar: 4, beatUnit: 4 } as const;
const BAR = 4 * PPQ;

/** Chords, drums and bass for one section, from its seed. */
export function buildSection(
  id: SectionId,
  name: string,
  seed: R<SectionSeed>,
  styles: Styles,
): Section {
  const parsed = parseProgression(seed.progression);
  if (!parsed.ok) throw new Error(`invalid progression: ${parsed.errors.join("; ")}`);
  const style = styles[seed.style.id];

  const chords: ChordEvent[] = [];
  const bass: NoteEvent[] = [];
  let bar = 0;
  for (const c of parsed.chords) {
    const bars = c.bars ?? seed.barsPerChord;
    const chord: ChordEvent = {
      start: bar * BAR,
      duration: bars * BAR,
      root: c.root,
      quality: c.quality,
    };
    if (c.bass) chord.bass = c.bass;
    chords.push(chord);
    const phrase = style.bass[seed.bass][MINORISH[c.quality] ? "minor" : "major"];
    for (let b = bar; b < bar + bars; b++) {
      for (const n of phrase) bass.push({ ...n, start: b * BAR + n.start });
    }
    bar += bars;
  }

  const drums: DrumHits = {};
  for (const [drum, hits] of Object.entries(style.drums[seed.drums])) {
    drums[drum as keyof DrumHits] = Array.from({ length: bar }, (_, b) =>
      hits.map((t) => b * BAR + t),
    ).flat();
  }

  return {
    id,
    name,
    bars: bar,
    overrides: {},
    chords,
    drums,
    parts: { bass },
    loops: [],
    seed: structuredClone(seed) as SectionSeed,
  };
}

const cache = new WeakMap<object, WeakMap<object, Song>>();

/**
 * Recipe → song. Called at every bar while a backing track plays, so results are
 * cached by input identity. Inputs are immutable and so is the result (frozen in
 * dev builds); "Open in composer" saves it as is, edits make new objects.
 */
export function generateSong(bt: R<BackingTrack>, styles: Styles): Song {
  let byStyles = cache.get(bt);
  const hit = byStyles?.get(styles);
  if (hit) return hit;

  const song: Song = {
    version: 2,
    kind: "song",
    title: bt.title,
    key: bt.key,
    ppq: PPQ,
    defaults: { tempo: bt.tempo, meter: { ...FOUR_FOUR }, swing: 0, voicing: bt.voicing },
    instruments: structuredClone(DEFAULT_INSTRUMENTS),
    patches: {},
    sections: bt.sections.map((s) => {
      const seed: SectionSeed = {
        progression: s.progression,
        barsPerChord: s.barsPerChord,
        style: { ...(s.style ?? bt.style) },
        drums: s.drums ?? bt.drums,
        bass: s.bass ?? bt.bass,
      };
      const section = buildSection(s.id, s.name, seed, styles);
      if (s.tempo !== undefined) section.overrides.tempo = s.tempo;
      if (s.loops) section.loops = structuredClone(s.loops) as LoopTake[]; // recorded takes ride along
      return section;
    }) as Song["sections"],
    arrangement: [...bt.arrangement],
  };

  freezeInDev(song);
  if (!byStyles) cache.set(bt, (byStyles = new WeakMap()));
  byStyles.set(styles, song);
  return song;
}

/**
 * Composer "Regenerate": rebuilds one section's chords, drums and bass from a seed.
 * Keeps id, name, overrides and loops. The result is 4/4, so a meter override is
 * set or removed to make that true. Loop takes longer than the new section are
 * shortened to fit (their audio is kept).
 */
export function regenerateSection(
  song: R<Song>,
  sectionId: SectionId,
  seed: R<SectionSeed>,
  styles: Styles,
): Song {
  const old = findSection(song, sectionId);
  const next = buildSection(old.id, old.name, seed, styles);
  const overrides = structuredClone(old.overrides) as Section["overrides"];
  const d = song.defaults.meter;
  if (d.beatsPerBar === 4 && d.beatUnit === 4) delete overrides.meter;
  else overrides.meter = { ...FOUR_FOUR };
  next.overrides = overrides;
  next.loops = old.loops.map((t) => ({ ...t, bars: Math.min(t.bars, next.bars) }));

  const copy = structuredClone(song) as Song;
  copy.sections = copy.sections.map((s) => (s.id === sectionId ? next : s)) as Song["sections"];
  return copy;
}
