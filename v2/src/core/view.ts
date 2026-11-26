/**
 * View data: what screens show, derived from docs by pure functions. The UI
 * renders these and holds no music logic of its own (names, numerals, overrides,
 * bar spans). Golden-tested alongside the scheduled bars.
 */

import {
  barLength,
  type BackingTrack,
  type Bpm,
  type Doc,
  type KeyName,
  type Meter,
  type PatchRef,
  type Practice,
  type Role,
  type SectionId,
  type Song,
  type StyleRef,
  type Swing,
  type Variant,
  type Voicing,
} from "../model/schema";
import type { PlayScope, Position } from "../model/runtime";
import type { DeepReadonly, NonEmpty } from "../model/types";
import { generateSong } from "./generate";
import { formatNumeral } from "./numerals";
import { effectiveSettings, findSection, lapKeys } from "./settings";
import { sectionIdAt } from "./schedule";
import type { Styles } from "./styles";
import { chordName } from "./theory";

type R<T> = DeepReadonly<T>;

/** A resolved setting and where it comes from: the doc's value, or this section's override. */
export interface Setting<T> {
  value: T;
  from: "song" | "section";
}

const setting = <T>(override: T | undefined, base: T): Setting<T> =>
  override === undefined ? { value: base, from: "song" } : { value: override, from: "section" };

/** What a section plays with, by doc kind: the settings that doc's UI shows. */
export type SectionSettings =
  | {
      kind: "backingTrack";
      style: Setting<R<StyleRef>>;
      drums: Setting<Variant>;
      bass: Setting<Variant>;
      tempo: Setting<Bpm>;
      voicing: Setting<Voicing>; // song-level only in backing tracks
    }
  | {
      kind: "song";
      tempo: Setting<Bpm>;
      meter: Setting<R<Meter>>;
      swing: Setting<Swing>;
      voicing: Setting<Voicing>;
      instruments: Record<Role, Setting<R<PatchRef>>>;
    };

export function sectionSettings(doc: R<Doc>, sectionId: SectionId): SectionSettings {
  if (doc.kind === "backingTrack") return backingSettings(doc, sectionId);
  const o = findSection(doc, sectionId).overrides;
  const d = doc.defaults;
  const instrument = (role: Role) => setting(o.instruments?.[role], doc.instruments[role]);
  return {
    kind: "song",
    tempo: setting(o.tempo, d.tempo),
    meter: setting(o.meter, d.meter),
    swing: setting(o.swing, d.swing),
    voicing: setting(o.voicing, d.voicing),
    instruments: {
      chords: instrument("chords"),
      bass: instrument("bass"),
      drums: instrument("drums"),
    },
  };
}

function backingSettings(bt: R<BackingTrack>, sectionId: SectionId): SectionSettings {
  const s = bt.sections.find((x) => x.id === sectionId);
  if (!s) throw new Error(`no section with id "${sectionId}"`);
  return {
    kind: "backingTrack",
    style: setting(s.style, bt.style),
    drums: setting(s.drums, bt.drums),
    bass: setting(s.bass, bt.bass),
    tempo: setting(s.tempo, bt.tempo),
    voicing: { value: bt.voicing, from: "song" },
  };
}

/** One chord chip. */
export interface ChipView {
  chordIndex: number;
  numeral: string; // "ii7", "bVII", "IV/I"
  name: string; // in the shown key: "Dm7", "Bb", "F/C"
  start: number; // ticks in the section
  duration: number;
  /** Bars of the section this chord sounds in (0-based): bar-progress dots, cue outlines. */
  bars: number[];
}

export interface PlayerView {
  title: string;
  kind: Doc["kind"];
  /** The key now (the lap's key while cycling). */
  key: KeyName;
  /** KEY scrubber: every lap's key, and the current lap. */
  keys: NonEmpty<KeyName>;
  lap: number;
  /** SONG scrubber: the arrangement, and the current entry (undefined while looping one section). */
  arrangement: { arrIdx: number; sectionId: SectionId; name: string }[];
  arrIdx: number | undefined;
  section: { id: SectionId; name: string; bars: number; bar: number };
  settings: SectionSettings;
  meter: R<Meter>;
  barLength: number;
  chips: ChipView[];
}

/** Everything the player header, scrubbers and chips show at a position. */
export function playerView(
  doc: R<Doc>,
  practice: R<Practice>,
  at: Position,
  scope: PlayScope,
  styles: Styles,
): PlayerView {
  const song: R<Song> = doc.kind === "song" ? doc : generateSong(doc, styles);
  const sectionId = sectionIdAt({ song, practice }, at, scope);
  const section = findSection(song, sectionId);
  const keys = lapKeys(song, practice);
  const key = keys[at.lap % keys.length]!;
  const meter = effectiveSettings(song, sectionId).meter;
  const length = barLength(meter);
  const lastBar = (end: number) => Math.ceil(end / length) - 1;

  return {
    title: song.title,
    kind: doc.kind,
    key,
    keys: [...keys] as NonEmpty<KeyName>,
    lap: at.lap % keys.length,
    arrangement: song.arrangement.map((id, arrIdx) => ({
      arrIdx,
      sectionId: id,
      name: findSection(song, id).name,
    })),
    arrIdx: scope.kind === "arrangement" ? at.arrIdx : undefined,
    section: { id: section.id, name: section.name, bars: section.bars, bar: at.bar },
    settings: sectionSettings(doc, sectionId),
    meter,
    barLength: length,
    chips: section.chords.map((c, chordIndex) => {
      const first = Math.floor(c.start / length);
      const last = Math.min(lastBar(c.start + c.duration), section.bars - 1);
      return {
        chordIndex,
        numeral: formatNumeral(c),
        name: chordName(c, key),
        start: c.start,
        duration: c.duration,
        bars: Array.from({ length: last - first + 1 }, (_, i) => first + i),
      };
    }),
  };
}
