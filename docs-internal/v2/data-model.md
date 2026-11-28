# Progression v2 — Data Model

Schema: `v2/src/model/schema.ts` (Zod 4; persisted types are inferred from it). Runtime-only types and the engine contract: `v2/src/model/runtime.ts`. Decisions behind it: `decisions.md`.

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
4. `scheduleBar(source, position, scope, prevVoicing)` → `ScheduledBar`: numerals, chord tones, scale degrees and chromatic notes become MIDI (see Semantics), voicing and swing are applied. The bar's `voicing` is the next bar's `prevVoicing`. **Mutes are not applied here.**
5. `nextPosition(source, transport)`: advance mode, a queued `Jump` (next bar), a queued key jump (end of lap).
6. Engine: hands the whole bar to Web Audio 0.2 s before it starts. Each note's `PatchRef` resolves to an `InstrumentSpec` (`core/instruments.ts`), keyed by what it sounds like, so an edited patch is a new instrument from the next bar. Instruments live for the play session; one the song no longer uses is disposed once its last note and tail are over (`instrumentsToDispose`). Channels live for the engine; only events are scheduled. Emits `EngineEvent`s at audible time (`Tone.Draw`) for the UI; each `bar` event carries the `EngineSource` it was scheduled from (including the `doc`), so the player shows what is actually playing, even right after a swap.

Mixer levels and mutes bypass the loop: `setLevels` / `setMutes` change channel gains instantly.

**Recording a take.** `makeLooper` (engine/looper.ts): arm → the engine loops the section → at its bar 1 (`bar` event, with its context `start`) one pass is recorded (`takeShape`) → the audio is saved (`LoopStore.put`, a `LoopAudio` with `bar1Ms` and `takeMs`) → a `recorded` event carries the `LoopTake`, which the app adds with `addTake`. Failures are `RecordError`s; nothing is added.

**Playing takes.** `scheduleBar` lists the takes sounding in each bar (`barInTake`; none while a cycle is on). The engine reads each from a `TakeLibrary` (`unloaded | loading | ready | missing | failed`): the store's audio, decoded once and aligned with the device's offset (`alignTake`). A pass starts at the take's bar 1 (or mid-take on a fresh start) and stops at the next bar if the take stops being scheduled.

**Samples.** ▶ first loads the song's sample sets (`songSampleSets`), waiting up to 1.5 s (`loadingSounds` event; pause or stop cancels). Sets load once per session into a `SampleLibrary` (status: `unloaded | loading | ready | failed`), fetched through the Cache API. Each bar also starts loading any set an edit added.

**Opening in composer.** `generateSong(recipe, styles)` → new saved `LibraryItem` (`origin: "created"`). Nothing links back.

**Regenerate.** `regenerateSection(song, sectionId, seed, styles)` → new `Song`. Keeps the section's id, name, overrides and loops; replaces chords, drums and `parts`. The result is 4/4 (a meter override is set or dropped to match), and takes longer than the new section are shortened to fit.

**Showing.** Screens read view functions (`core/view.ts`): `playerView(doc, practice, position, scope, styles)` gives the key, laps, arrangement, section, settings with their source (`song` or `section`), and chips (numeral, name, bars). They take the doc because a generated song can't tell which backing-track settings were overridden.

**Sharing.** `{ version, doc, practice? }` → `encodeEnvelope`. On open: `decodeEnvelope` → `validateEnvelope` → new saved `LibraryItem` (`origin: "shared"`). Imports are the same with `origin: "imported"`.

## Semantics

- **Bar length** in ticks = `beatsPerBar × 48 × 4 / beatUnit` (4/4 → 192, 3/4 and 6/8 → 144).
- **Tempo** always counts quarter notes per minute, also in 6/8 or 2/2. Seconds per tick = `60 / (bpm × 48)`.
- **Swing** (0–1) delays off-beat 8th notes: 0 = straight, 1 = triplet feel (off-beat at tick 32 of each beat, not 24). Events between the beat and the off-beat scale proportionally. Applied in `scheduleBar`; `ScheduledBar` times may be fractional ticks.
- **Registers** (fixed, v1 parity):
  - Chords: root at or above MIDI 48 (C3), lowered by octaves until the top note is ≤ 76 (E5) for triads / ≤ 72 (C5) for 4-note chords. Voice-leading picks the inversion closest to the previous chord.
  - Chord notes = the register root an octave down, plus the upper voicing. 7th chords are shell voicings (no 5th), as in v1.
  - Bass: two octaves below that chord root. `chordTone` resolves relative to it. `scaleDegree` / `chromatic` resolve relative to the tonic in the bass register (where tone 1 of a I chord lands), so they don't move with the chord. `octave` shifts by 12 per step.
  - Cycle laps stay within a tritone of the first lap's key (−5…+6 semitones), as in v1.
- **Chord tones**: 1/3/5/7 come from the quality (sus chords: 3 = the suspended note; triads: 7 = maj7 for major, ♭7 for minor/aug/sus, °7 for dim); 9/11/13 are natural extensions. A `chordTone` note where no chord sounds is skipped. _Differs from v1:_ v1's bass read "5" from the shell voicing, so it played the 7th on maj7/m7/dom7 chords; v2 plays the fifth.
- **Slash chords** (`ChordEvent.bass`): bass tone 1 becomes the slash note, the nearest one to the chord's bass root (−5…+6 semitones); other tones and the chord voicing are unchanged.
- **Held chords**: a chord is struck once and rings for its duration. A bar it continues into lists it with `continued: true`; the engine strikes it only when playback starts or jumps into that bar.
- **Voicing modes**: `root` never voice-leads; `voice-lead` leads from the previous chord across laps; `voice-lead-loop` starts fresh on the first bar of each lap (v1).
- **Bass phrases** in styles use `major` or `minor` by the sounding chord: minor, m7, dim, m7b5, dim7, mMaj7 → `minor`; everything else → `major`.
- **Cycle laps**: `fourths` / `fifths` start from the song key (12 laps), spelled with flats for fourths and sharps for fifths (v1); `custom` plays its keys as given. Chord names follow the lap key's spelling. A lap ends when the arrangement completes (or the section, when looping one section or in manual advance with a key jump queued). A queued section jump lands when the current section ends; a chord jump at the next bar. If that bar also ended a lap, the lap still advances.
- **Patches**: `chords` patches play polyphonically, `bass` monophonically (a new note cuts the previous one). A synth's filter is 12 dB/octave; with an envelope its cutoff sweeps from `frequency` up `octaves` at the envelope's peak. Effects run in order after the source; reverb is v1's (a synchronous noise impulse with 10 ms pre-delay, equal-power wet/dry). A sampler pitches each note from the nearest sampled note; until its set loads (or if it fails) it plays the role's default patch.
- **Generator**: a section's chords last their `:bars` or bars-per-chord; each bar repeats the style's one-bar drums and the bass phrase for the chord sounding in that bar.

## Validation rules

Field-level ranges are in `schema.ts`. Objects are strict (unknown keys are rejected, so agent typos fail loudly). Cross-field rules the Zod schema enforces (`.superRefine`):

- **Ids**: unique within their collection (section ids per doc, take ids per section).
- **Arrangement**: every entry references an existing section.
- **Chords**: sorted by `start`; no overlaps; `start + duration ≤` section length (`bars ×` bar length of the section's effective meter).
- **Drums**: per instrument, sorted, unique, every tick `<` section length.
- **Parts**: sorted by `start`, one note per start (parts are monophonic: a note is cut where the next starts); every note `start <` section length (a note may ring past the end).
- **Loops**: take ids unique per section; `take.bars ≤ section.bars` (a backing section's bars come from its progression).
- **Instruments**: a built-in patch is only used for its own role (`pad-v1` chords, `bass-v1` bass, `kit-v1` drums); every `PatchRef` with `kind: "custom"` resolves to a key in `song.patches` whose `role` matches. Custom patches can't play drums.
- **Patches**: parameter ranges in `schema.ts` (times 0–10 s, volume −40…+6 dB, filter 20–20000 Hz, ≤ 4 effects); a sampler's `set` must be a known sample set.
- **Progressions** (`BackingSection`, `SectionSeed`): every token parses (`[b#]NUMERAL[suffix][/[b#]NUMERAL][:bars]`, grammar in `core/numerals.ts`), `:bars` is 1–16, and the generated section is ≤ 64 bars.
- **Ticks** are integers ≥ 0; durations > 0. Any tick is valid (the UI snaps; triplets need e.g. 16).
- **Strings** are trimmed and non-empty.
- **LibraryStore**: exactly one `scratch` item; `currentItemId` exists.

## Screen → data trace

| UI                                | Fields                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Player header, scrubbers (static) | `playerView(...)`: `key`, `keys`/`lap`, `arrangement`/`arrIdx`, `section`, `settings` (`from: "section"` → •), `chips` |
| Player: active chip / bar / beat  | engine events: `chord` (`chordIndex`), `bar`, `beat`; dots = `chip.bars`, `meter`                                      |
| Play pills (backing)              | `BackingTrack.style/drums/bass/voicing/tempo`                                                                          |
| Play pills (song)                 | `Song.defaults.tempo/swing/voicing`                                                                                    |
| Practice row                      | `Practice.cycle` (custom keys inside it), `Practice.advance`                                                           |
| SONG scrubber                     | `doc.arrangement`; current = `Transport.at.arrIdx`; dashed = `Transport.jump` (`kind: "section"`)                      |
| Chip cue outline                  | `Transport.jump` (`kind: "chord"`) or `Transport.cue` / paused `at` → every chord in that bar                          |
| KEY scrubber                      | `lapKeys(...)`; dashed = `Transport.keyJump`                                                                           |
| ■ / ▶ / ❚❚, "Paused · bar 3"      | `Transport.status`, `at` / `cue`                                                                                       |
| Mix sheet                         | checkboxes → `Practice.mutes`; sliders → `Mix.levels`                                                                  |
| Backing edit: sections, overrides | `BackingSection.*` (an override is a present field)                                                                    |
| Backing edit: arrangement         | `BackingTrack.arrangement`                                                                                             |
| Song overview: cards              | `Section.name/bars/chords`, `overrides`, `loops.length`                                                                |
| Instruments sheet                 | `Song.instruments` (`PatchRef`s), `Song.patches`                                                                       |
| Section editor: chord lane        | `Section.chords[]` (ticks, snapped to 24)                                                                              |
| Section editor: drum lanes        | `Section.drums[instrument]` (ticks, snapped to 12)                                                                     |
| Section editor: bass lane         | `Section.parts.bass[]` (`pitch.kind = "chordTone"`)                                                                    |
| Section editor: loops             | `Section.loops[]`; audio = `LoopAudio` by take id                                                                      |
| Section editor: regenerate        | `Section.seed`                                                                                                         |
| Section editor: looping           | `Transport.scope` (`kind: "section"`)                                                                                  |
| Section settings                  | `Section.overrides`                                                                                                    |
| Library                           | `LibraryStore.items`; name = `doc.title`; badges = `doc.kind`, `origin`, `practice.cycle`                              |
| Scratch "replace?" confirm        | `LibraryItem.state` (`kind: "scratch"`)                                                                                |
| Share sheet                       | `ShareEnvelope`; toggle includes `practice`                                                                            |

## Choices made in the model

- **Zod 4 is the schema.** Types are inferred from it (no drift), it validates at runtime, and `z.toJSONSchema()` produces the agent skill's docs.
- **Maps keyed by role or channel** (`Song.instruments`, `Practice.mutes`, `Mix.levels`) accept any subset of keys: a missing key takes its default (`DEFAULT_INSTRUMENTS`, `DEFAULT_MUTES`, `DEFAULT_LEVELS`), an unknown key is rejected, and parsed values always have every key. That's what keeps adding a role or channel additive: docs saved before it lack the key.
- **Additive-only evolution within version 2:** add optional fields or widen unions; never rename, remove or narrow. Planned additions that already fit this rule:
  - `NoteEvent.velocity?`
  - drum hits widen from `Tick` to `Tick | { start, velocity }`
  - new keys in `Section.parts` (melody, second line), widening `Role`
  - `LoopTake.offset?`; `BackingTrack.meter?` / `swing?`; `register?`; swing widening to `{ amount, subdivision }`
- **TypeScript patterns** (see the header of `schema.ts`): discriminated unions for every "kind" (`LibraryItem.kind`, `PatchRef`, `StyleRef`, `Cycle`, `Jump`, `PlayScope`, `Transport.status`, `Pitch`); branded ids; `NonEmpty` where empty is invalid; `DeepReadonly` inputs; exhaustive switches.
- **`Cycle` carries its custom keys**, so "custom with no keys" can't exist. Trade-off: switching the cycle away from custom drops the list from the saved data; the editing UI can remember it for the session.
- **`Transport` is a union on `status`**: paused always has a position, playing may have queued jumps, stopped may have a cue. `scope` (whole arrangement vs one section) survives pause/stop.
- **The engine pulls** its source at bar boundaries rather than being pushed edits.
- **Optional = inherit.** No `null`s, so an override is simply a field that's present.
- **Chord qualities are v1's full set** (13). Keys keep their spelling (`F#` vs `Gb`). No `mode` field: `i`, `♭III`, `♭VI` cover minor tunes.
- **`ppq` is in the song** even though it's always 48, so an agent reading the JSON knows the unit.
- **Storage is versioned** (`LibraryStore.version`, `AppPrefs.version`) separately from docs, so local formats can migrate.

## Deferred (don't guess; defined in the named milestone)

- **More sounds:** a real Rhodes (samples with a clear licence, or an FM oscillator kind for a synth one), upright bass, organ.
- **Custom drum kits** (a `PatchRole` of `drums`), and more effect and oscillator kinds: additive widenings.
- **Open question:** custom styles (v1's user-authored patterns). `StyleRef` only has `kind: "builtin"` today; a `kind: "custom"` member would be an additive widening.
