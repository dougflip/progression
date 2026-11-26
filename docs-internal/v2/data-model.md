# Progression v2 — Data Model

Types: `model.ts` (draft spec, type-checked). Decisions behind it: `decisions.md`.

## Layers

| Layer    | Types                                                    | Persisted                | Shared in links                 |
| -------- | -------------------------------------------------------- | ------------------------ | ------------------------------- |
| Doc      | `BackingTrack` \| `Song`                                 | library                  | ✅ `envelope.doc`               |
| Practice | `Practice`                                               | library, per item        | ✅ optional `envelope.practice` |
| Device   | `LibraryItem`, `Mix`, `AppPrefs`, loop audio (IndexedDB) | localStorage / IndexedDB | ❌                              |
| Runtime  | `Transport`, `Position`, `ScheduledBar`                  | ❌                       | ❌                              |

- Only `ShareEnvelope` crosses the device boundary. The schema validates it on every way in: links, imports, agent output.
- A `Song` is the only thing the engine plays. A `BackingTrack` reaches the engine through `generateSong`.

## How data moves

**Editing.** UI → edit the open item's doc or practice in place (autosave) → mark the engine dirty.

**Playing.** One loop, once per bar, all pure except the last step:

1. `song = item.doc` (a `Song`), or `generateSong(item.doc)` (a `BackingTrack`). Refreshed only at bar boundaries, which is why edits land on the next bar.
2. `effectiveSettings(song, sectionId)`: section override ?? song default.
3. `key = lapKeys(song, practice)[lap % n]`.
4. `scheduleBar(song, practice, position, transport)` → `ScheduledBar`. This is where numerals, chord tones and scale degrees become MIDI, voicing and swing are applied, and muted roles are dropped.
5. `nextPosition(...)`: advance mode, a queued jump (next bar), a queued key (end of lap).
6. Engine: hand the bar's events to Tone, keeping only about a bar of lookahead. Instruments are long-lived; only events are scheduled.

Mixer levels and mutes skip this loop. They're channel gains, applied instantly.

**Opening in composer.** `generateSong(recipe)` → new `LibraryItem` with that `Song`. Nothing links back.

**Regenerate.** `regenerateSection(section, seed)` keeps id, name and loops, and replaces chords, drums and bass.

**Sharing.** `{ version, doc, practice? }` → `encodeEnvelope`. On open: `decodeEnvelope` → `validateEnvelope` → new `LibraryItem` (`origin: "shared"`).

## Screen → data trace

| UI                                  | Fields                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Player: key                         | `doc.key`; while cycling `lapKeys(...)[position.lap]`                                |
| Player: section + settings, • marks | `arrangement[arrIdx]` → `Section.name`; `effectiveSettings` (override present → •)   |
| Player: chord chips                 | `Section.chords` → `root` + `quality` (numeral), resolved with the current key       |
| Player: bar dots / beat dots        | `ChordEvent.duration` / `Meter`, position tick (runtime)                             |
| Play pills (backing)                | `BackingTrack.style/drums/bass/voicing/tempo`                                        |
| Play pills (song)                   | `Song.defaults.tempo/swing/voicing`                                                  |
| Practice row                        | `Practice.cycle/customKeys/advance`                                                  |
| SONG scrubber                       | `doc.arrangement`; current = `Transport.at.arrIdx`; dashed = `Transport.jump`        |
| KEY scrubber                        | `lapKeys(...)`; dashed = `Transport.keyJump`                                         |
| ■ / ▶ / ❚❚, "Paused · bar 3"        | `Transport.status`, `Transport.at`                                                   |
| Mix sheet                           | mutes → `Practice.mutes`; sliders → `Mix`                                            |
| Backing edit: sections, overrides   | `BackingSection.*` (an override is just a present field)                             |
| Backing edit: arrangement           | `BackingTrack.arrangement`                                                           |
| Song overview: cards                | `Section.name/bars/chords`, `overrides`, `loops.length`                              |
| Instruments sheet                   | `Song.instruments` (refs), `Song.patches` (custom)                                   |
| Section editor: chord lane          | `Section.chords[]` (`start/duration` in ticks, snapped to 24)                        |
| Section editor: drum lanes          | `Section.drums[instrument]` (ticks, snapped to 12)                                   |
| Section editor: bass lane           | `Section.parts.bass[]` (`pitch.kind = chordTone`)                                    |
| Section editor: loops               | `Section.loops[]`; audio by `LoopTake.audio`                                         |
| Section editor: regenerate          | `Section.seed`                                                                       |
| Section settings                    | `Section.overrides`                                                                  |
| Library                             | `LibraryItem[]`; name = `doc.title`; badges = `doc.kind`, `origin`, `practice.cycle` |
| Share sheet                         | `ShareEnvelope`; toggle includes `practice`                                          |

## Choices made in the model

- **Zod 4 is the schema.** Types are inferred from it (no drift), it validates at runtime, and `z.toJSONSchema()` produces the agent skill's docs.
- **Additive-only evolution within version 2:** add optional fields or widen unions; never rename, remove or narrow. Every saved doc stays valid. Planned additions that already fit this rule:
  - `NoteEvent.velocity?`
  - drum hits widen from `Tick` to `Tick | { start, velocity }`
  - new keys in `Section.parts` (melody, second line)
  - `LoopTake.offset?` (takes start at bar 1 today)
- **Optional = inherit.** No `null`s, so an override is simply a field that's present. (The mockup used `null`; the model drops it.)
- **Chord qualities are v1's full set** (13). The mockup only modelled 6.
- **Slash chords:** optional `ChordEvent.bass` (a scale step).
- **Pitched parts live in `Section.parts`** (`bass` only today), so new parts are new keys rather than a breaking change.
- **Keys keep their spelling** (`F#` vs `Gb`); it decides sharps vs flats in chord names.
- **Minor keys / modes:** no `mode` field. Numerals relative to the major key (`i`, `♭III`, `♭VI`) cover minor tunes.
- **Drums are tick lists per instrument**: compact, any subdivision.
- **Patch params are open records** (`params: Record<string, number>`); the schema validates them per oscillator/effect type.
- **`ppq` is in the song** even though it's always 48, so an agent reading the JSON knows the unit.
- **`Transport` is a tagged union**, so a "paused" transport always has a position and a "stopped" one never does.
