# Progression v2 — Data Model

Types: `model.ts` (draft spec, type-checked, including the engine contract). Decisions behind it: `decisions.md`.

## Layers

| Layer    | Types                                                                     | Persisted         | Shared in links                 |
| -------- | ------------------------------------------------------------------------- | ----------------- | ------------------------------- |
| Doc      | `BackingTrack` \| `Song`                                                  | library           | ✅ `envelope.doc`               |
| Practice | `Practice`                                                                | library, per item | ✅ optional `envelope.practice` |
| Device   | `LibraryStore`, `Mix`, `AppPrefs` (localStorage); `LoopAudio` (IndexedDB) | ✅                | ❌                              |
| Runtime  | `Transport`, `Position`, `Jump`, `ScheduledBar`, `EngineEvent`            | ❌                | ❌                              |

- Only `ShareEnvelope` crosses the device boundary. The schema validates it on every way in: links, imports, agent output.
- A `Song` is the only thing the engine plays. A `BackingTrack` reaches the engine through `generateSong`.
- Docs and practice are immutable values. Edits create new objects, which the library autosaves.

## How data moves

**Editing.** UI → new doc/practice object → saved into the open `LibraryItem`. The engine isn't told; it pulls.

**Playing.** At each bar boundary the engine calls the `EngineSource` getter it was given (`setSource`), so edits land on the next bar. All steps are pure until the last:

1. Source: `song = item.doc` (a `Song`), or `generateSong(item.doc, styles)` (a `BackingTrack`), plus `item.practice`. With immutable values this is a reference, not a copy.
2. `effectiveSettings(song, sectionId)`: section override ?? song default.
3. `key = lapKeys(song, practice)[lap % n]`.
4. `scheduleBar(source, position, scope, prevVoicing)` → `ScheduledBar`: numerals, chord tones, scale degrees and chromatic notes become MIDI (see Semantics), voicing and swing are applied. **Mutes are not applied here.**
5. `nextPosition(source, transport)`: advance mode, a queued `Jump` (next bar), a queued key jump (end of lap).
6. Engine: hands the bar to Tone with about a bar of lookahead. Instruments and channels are long-lived; only events are scheduled. Emits `EngineEvent`s at audible time (`Tone.Draw`) for the UI.

Mixer levels and mutes bypass the loop: `setLevels` / `setMutes` change channel gains instantly.

**Opening in composer.** `generateSong(recipe, styles)` → new saved `LibraryItem` (`origin: "created"`). Nothing links back.

**Regenerate.** `regenerateSection(section, seed, styles)` keeps id, name and loops; replaces chords, drums and `parts`.

**Sharing.** `{ version, doc, practice? }` → `encodeEnvelope`. On open: `decodeEnvelope` → `validateEnvelope` → new saved `LibraryItem` (`origin: "shared"`). Imports are the same with `origin: "imported"`.

## Semantics

- **Bar length** in ticks = `beatsPerBar × 48 × 4 / beatUnit` (4/4 → 192, 3/4 and 6/8 → 144).
- **Tempo** always counts quarter notes per minute, also in 6/8 or 2/2. Seconds per tick = `60 / (bpm × 48)`.
- **Swing** (0–1) delays off-beat 8th notes: 0 = straight, 1 = triplet feel (off-beat at tick 32 of each beat, not 24). Events between the beat and the off-beat scale proportionally. Applied in `scheduleBar`; `ScheduledBar` times may be fractional ticks.
- **Registers** (fixed, v1 parity):
  - Chords: root at or above MIDI 48 (C3), lowered by octaves until the top note is ≤ 76 (E5) for triads / ≤ 72 (C5) for 4-note chords. Voice-leading picks the inversion closest to the previous chord.
  - Bass: two octaves below that chord root. `chordTone` / `scaleDegree` / `chromatic` resolve relative to it; `octave` shifts by 12 per step.
- **Slash chords** (`ChordEvent.bass`): the bass part's root becomes that scale step; the chord voicing is unchanged.
- **Bass phrases** in styles use `major` or `minor` by the sounding chord: minor, m7, dim, m7b5, dim7, mMaj7 → `minor`; everything else → `major`.
- **Cycle laps**: `fourths` / `fifths` start from the song key (12 laps); `custom` plays its keys as given. A lap ends when the arrangement completes (or the section, when looping one section or in manual advance with a key jump queued).

## Validation rules

Field-level ranges are in `model.ts` comments. Cross-field rules the Zod schema enforces (`.superRefine`):

- **Ids**: unique within their collection (section ids per doc, take ids per section).
- **Arrangement**: every entry references an existing section.
- **Chords**: sorted by `start`; no overlaps; `start + duration ≤` section length (`bars ×` bar length of the section's effective meter).
- **Drums**: per instrument, sorted, unique, every tick `<` section length.
- **Parts**: every note `start <` section length (a note may ring past the end).
- **Loops**: `take.bars ≤ section.bars`.
- **Instruments**: every `PatchRef` with `kind: "custom"` resolves to a key in `song.patches`; each patch's `role` matches the role it's used for.
- **BackingTrack**: every `progression` parses to ≥ 1 chord.
- **Ticks** are integers ≥ 0; durations > 0. Any tick is valid (the UI snaps; triplets need e.g. 16).
- **Strings** are trimmed and non-empty.
- **LibraryStore**: exactly one `scratch` item; `currentItemId` exists.

## Screen → data trace

| UI                                  | Fields                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Player: key                         | `doc.key`; while cycling `lapKeys(...)[position.lap]`                                             |
| Player: section + settings, • marks | `arrangement[arrIdx]` → `Section.name`; `effectiveSettings` (override present → •)                |
| Player: chord chips, active chip    | `Section.chords` (numeral + resolved name); active = `chord` event's `chordIndex`                 |
| Player: bar dots / beat dots        | `ChordEvent.duration`, `Meter`; active = `bar` / `beat` events                                    |
| Play pills (backing)                | `BackingTrack.style/drums/bass/voicing/tempo`                                                     |
| Play pills (song)                   | `Song.defaults.tempo/swing/voicing`                                                               |
| Practice row                        | `Practice.cycle` (custom keys inside it), `Practice.advance`                                      |
| SONG scrubber                       | `doc.arrangement`; current = `Transport.at.arrIdx`; dashed = `Transport.jump` (`kind: "section"`) |
| Chip cue outline                    | `Transport.jump` (`kind: "chord"`) or `Transport.cue` / paused `at` → every chord in that bar     |
| KEY scrubber                        | `lapKeys(...)`; dashed = `Transport.keyJump`                                                      |
| ■ / ▶ / ❚❚, "Paused · bar 3"        | `Transport.status`, `at` / `cue`                                                                  |
| Mix sheet                           | checkboxes → `Practice.mutes`; sliders → `Mix.levels`                                             |
| Backing edit: sections, overrides   | `BackingSection.*` (an override is a present field)                                               |
| Backing edit: arrangement           | `BackingTrack.arrangement`                                                                        |
| Song overview: cards                | `Section.name/bars/chords`, `overrides`, `loops.length`                                           |
| Instruments sheet                   | `Song.instruments` (`PatchRef`s), `Song.patches`                                                  |
| Section editor: chord lane          | `Section.chords[]` (ticks, snapped to 24)                                                         |
| Section editor: drum lanes          | `Section.drums[instrument]` (ticks, snapped to 12)                                                |
| Section editor: bass lane           | `Section.parts.bass[]` (`pitch.kind = "chordTone"`)                                               |
| Section editor: loops               | `Section.loops[]`; audio = `LoopAudio` by take id                                                 |
| Section editor: regenerate          | `Section.seed`                                                                                    |
| Section editor: looping             | `Transport.scope` (`kind: "section"`)                                                             |
| Section settings                    | `Section.overrides`                                                                               |
| Library                             | `LibraryStore.items`; name = `doc.title`; badges = `doc.kind`, `origin`, `practice.cycle`         |
| Scratch "replace?" confirm          | `LibraryItem.state` (`kind: "scratch"`)                                                           |
| Share sheet                         | `ShareEnvelope`; toggle includes `practice`                                                       |

## Choices made in the model

- **Zod 4 is the schema.** Types are inferred from it (no drift), it validates at runtime, and `z.toJSONSchema()` produces the agent skill's docs.
- **Additive-only evolution within version 2:** add optional fields or widen unions; never rename, remove or narrow. Planned additions that already fit this rule:
  - `NoteEvent.velocity?`
  - drum hits widen from `Tick` to `Tick | { start, velocity }`
  - new keys in `Section.parts` (melody, second line), widening `Role`
  - `LoopTake.offset?`; `BackingTrack.meter?` / `swing?`; `register?`; swing widening to `{ amount, subdivision }`
- **TypeScript patterns** (see the header of `model.ts`): discriminated unions for every "kind" (`LibraryItem.kind`, `PatchRef`, `StyleRef`, `Cycle`, `Jump`, `PlayScope`, `Transport.status`, `Pitch`); branded ids; `NonEmpty` where empty is invalid; `DeepReadonly` inputs; exhaustive switches.
- **`Cycle` carries its custom keys**, so "custom with no keys" can't exist. Trade-off: switching the cycle away from custom drops the list from the saved data; the editing UI can remember it for the session.
- **`Transport` is a union on `status`**: paused always has a position, playing may have queued jumps, stopped may have a cue. `scope` (whole arrangement vs one section) survives pause/stop.
- **The engine pulls** its source at bar boundaries rather than being pushed edits.
- **Optional = inherit.** No `null`s, so an override is simply a field that's present.
- **Chord qualities are v1's full set** (13). Keys keep their spelling (`F#` vs `Gb`). No `mode` field: `i`, `♭III`, `♭VI` cover minor tunes.
- **`ppq` is in the song** even though it's always 48, so an agent reading the JSON knows the unit.
- **Storage is versioned** (`LibraryStore.version`, `AppPrefs.version`) separately from docs, so local formats can migrate.

## Deferred (don't guess; defined in the named milestone)

- **Milestone 5:** the patch vocabulary (`Patch.synth`: oscillator/effect types, params, ranges), sample-set shape, and the built-in patch registry beyond the three v1 defaults. Until then `Song.patches` must be `{}`.
- **Milestone 6:** loop recording details beyond `LoopTake` / `LoopAudio` (latency compensation, count-in).
- **Open question:** custom styles (v1's user-authored patterns). `StyleRef` only has `kind: "builtin"` today; a `kind: "custom"` member would be an additive widening.
