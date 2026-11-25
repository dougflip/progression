# Progression v2 — Decisions

Latest decisions only. Rewrite in place as understanding changes; don't append history.
Background and goals: `version-2.md`.

## Modes

- Two modes, two UIs, one playback engine.
  - **Backing track**: quick. Edit a small `BackingTrack` recipe (progression, key, tempo, style).
  - **Composer**: detailed. Edit a full `Song` directly.
- The engine only plays `Song`. A `BackingTrack` is converted to a `Song` by a generator at playback time.
- "Open in composer" saves the generated `Song` for editing. One-way: nothing syncs back to the recipe.
- Composer can re-run the generator on a single section ("regenerate"), which explicitly overwrites it.

## Data model

- The whole app state is plain, serializable data, described by one schema.
- The schema is the single source for TS types, runtime validation, and agent-facing docs (Zod or JSON Schema — TBD).
- The format carries a version field (`version: 2`) from day one.
- Clean break from v1: no v1 URL/preset import.
- Settings cascade: song defaults → section overrides (style, tempo, meter, instruments). Finer-grained overrides can come later.

## Time

- Model supports any meter; build 4/4 straight first.
- Meter lives on the section (`beatsPerBar`, `beatUnit`).
- All positions and lengths are integer ticks at a fixed PPQ (48 per quarter: divisible by 2, 3, 4, 6 → 8ths, 16ths, triplets).
- Chords are `{ start, duration }` in ticks, not grid slots. The first UI snaps chords to 8ths and drums to 16ths.
- Swing is a playback setting applied at schedule time; the stored data stays straight.

## Pitch

- Songs stay key-agnostic: Roman numerals for chords, no absolute pitches stored.
- A note's pitch is a tagged union, resolved to MIDI by the engine:
  - chord tone (root, 3rd, 5th, 7th, …) — what v1 bass uses
  - scale degree (relative to the key)
  - chromatic semitone offset (relative to the key)
- The UI may expose only chord tones at first; the model and engine support all three.

## Sound

- Instruments are data: either a sampler (sample set reference) or a synth patch (oscillator, envelope, filter, effects as JSON).
- v1's sounds become the default patches.
- Synth patches are meant to be authored mostly by an agent ("natural language → patch"), with user controls optional.
- Samples for bass/keys/synth are lazy-loaded and cached at runtime, not precached at install.

## Playback engine

- **Lesson from v1:** pre-scheduling many events with Tone (pre-baked multi-lap `Tone.Part`/`Sequence`) made the app sluggish (see `e8c63c5`).
- Schedule just-in-time: at each bar boundary (or a short lookahead window), schedule only the next bar's events from the current song state.
- Edits take effect at the next bar boundary (or downbeat/section, whichever is simplest). Instant updates aren't required.
  - This replaces v1's rebuild/teardown complexity. There's nothing to cancel and rebuild; the next bar just reads new data.
- Instrument nodes (synths, samplers, channels) are long-lived and survive edits; only events are rescheduled.
  - v1 lesson: disposing the synth on rebuild cut off ringing notes (`c43e200`).
- Don't use Tone containers that snapshot data at construction (`Tone.Sequence` captures step values once).
- Timing logic (song + position → events for a bar) is a pure function, unit-tested without Tone.

## Looper

- Loops belong to sections. A section holds a list of takes, so overdub = add a take.
- Audio is stored in IndexedDB; the song references takes by ID. Audio never goes in the song data or the URL.
- Export is deferred. The model must not block either option:
  - **Share a recording**: `Tone.Recorder` on the master output → audio file. Likely first.
  - **Share the project**: one file bundling song JSON + loop audio, imported by the recipient.
  - On mobile, both go through the Web Share API (file sharing).

## UI

- A framework renders the UI from the state data (React likely; Preact if bytes matter).
- Keep v1's headless pattern: core state + engine have no framework dependency.

## Agent workflow

- The agent is an outside tool (e.g. Claude with a skill), not an in-app feature. No backend, no API keys.
- The skill uses the schema docs to produce `Song` / `BackingTrack` JSON.
- A script validates the JSON and encodes it into a URL that opens the app in that state.
- The app also accepts pasted/imported JSON as a fallback for long URLs.

## URL state

- Whole state goes in one compressed param: JSON → deflate (`CompressionStream`) → base64url.
- Not in the URL: loop audio, cached samples, device/app preferences (theme, keep-awake).

## Deployment

- v2 lives on `main` in its own source folder, served at `/progression/v2/` via a second Vite entry point.
  - GitHub Pages only deploys `main`, and a long-lived branch would drift from v1 fixes and dependabot updates.
- The v1 service worker (scope `/progression/`) also covers `/progression/v2/`.
  - Exclude v2 from v1's navigation fallback (`navigateFallbackDenylist`), or give v2 its own scope or manifest.

## Open questions

- Schema tooling: Zod vs JSON Schema.
- Exact swing parameters (amount, which subdivision).
- Export format and order (recording vs project bundle).
- Practical URL size limit and when to fall back to JSON import.
- Where an edit takes effect (next bar vs next downbeat vs next section) for each kind of change.
