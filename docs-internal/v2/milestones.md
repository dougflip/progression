# Progression v2 — Milestones

Engine first. Build only the UI needed to **see and hear** the engine; songs come from hand-written fixtures (written by agents or by hand), not editing screens. Editing UI comes last, once the engine is full-featured. The mockup (`mockup.html`) stays the UI spec.

Related: `decisions.md`, `data-model.md`, `v2/src/model/schema.ts`.

## Ground rules (every milestone)

- **Fixtures are the input.** `v2/fixtures/*.json` are `ShareEnvelope`s. Every fixture is validated by the Zod schema in tests, and each one says what it exercises (a top-level `"$comment"` the schema ignores). Fixtures are frozen once committed (hash in `v2/fixtures/frozen.json`): add a new one rather than editing an old one.
- **Pure first.** Anything that turns data into data (generator, `scheduleBar`, transport rules) is a pure function with unit tests, before it is wired to Tone.
- **Golden tests.** Each fixture has stored expected output (e.g. the `ScheduledBar`s for its first N bars). A change that alters them must be deliberate.
- **Timing tests.** Engine timing is verified by rendering offline (`Tone.Offline`, faster than real time) and measuring when notes actually start: no drift over long runs, edits land on the next bar.
- **Listen checks.** Tests can't judge sound. Each milestone ends with a short numbered list for you to listen to (per AGENTS.md: you do manual testing).
- **Performance budget.** The engine bench shows how much is scheduled ahead and how long each bar takes to schedule. Target: about one bar of lookahead, and scheduling a bar costs a few ms on a phone.
- **Player UI is real.** The chips, scrubbers and transport built for the bench are the play view's components, not throwaway.
- **Shipping.** Each milestone is a PR into `main`. v2 lives in `v2/` and is served at `/progression/v2/`, so v1 is unaffected. `npm run check` and `npm run test:quiet` pass before every commit.

## 1. Foundation

**Goal:** v2 exists, deploys next to v1, and has a validated data format.

- `v2/index.html` as a second Vite entry → `/progression/v2/`. v1's service worker excludes `/v2/` (`navigateFallbackDenylist`).
- React + TypeScript (strict, same settings as v1), sharing v1's tooling (Vite, Vitest, oxlint, oxfmt).
- Zod 4 schema (`v2/src/model/schema.ts`); types inferred from it. Runtime-only types in `runtime.ts`. `model.ts` is retired.
- `encodeEnvelope` / `decodeEnvelope` / `validateEnvelope`.
- First fixtures: v1's five starters, plus a song with overrides, slash chords and every pitch kind.

**Tests:** every fixture validates; invalid docs are rejected with readable errors; encode → decode round-trips; additive-evolution guard (old fixtures must keep validating).
**You'll check:** `/progression/v2/` loads on GitHub Pages while v1 still works and still installs as an app.

## 2. Pure core

**Goal:** everything between "a doc" and "a bar of notes" works, with no audio.

- Numeral parsing (v1 syntax, all 13 qualities, slash chords), chord naming per key spelling.
- `generateSong` / `regenerateSection` (styles, simple/busy variants).
- `effectiveSettings`, `lapKeys`, voicings (root, voice-lead, voice-lead-loop).
- `scheduleBar`: chords, chord-tone / scale-degree / chromatic notes, drums, loops → `ScheduledBar` (mutes stay out: they're channel gains).
- Transport rules: `nextPosition`, `clampPosition`, `changeScope`, queued jumps (next bar), key jumps (end of lap), manual advance.
- View data for the UI (`playerView`, `sectionSettings`): everything the player shows, with override sources.

**Tests:** golden `ScheduledBar`s and player views for every fixture (`v2/fixtures/golden/`); parity checks against v1 where behaviour should match (chord names, voicings, bass patterns); transport rules as small, table-driven tests.
**You'll check:** nothing to hear yet. A short review of the golden output for one fixture.

## 3. Engine + bench

**Goal:** hear a fixture play, bar by bar, rock solid.

- Tone engine: schedules one bar at a time from current data; long-lived synths and channels; the data snapshot refreshes only at bar boundaries.
- Transport: play, pause (keeps the bar), stop, chord and section jumps, key jumps.
- **Engine bench** page: fixture picker, player header (key, chips, beat dots), SONG/KEY scrubbers, transport, a JSON panel, **"swap to fixture B at the next bar"** (stands in for a live edit), performance readout.
- v1's current synth sounds as defaults.

**Tests:** offline-render timing (onsets on the grid, no drift over 100+ bars, a swap lands exactly at the next bar, pause/resume lands on the bar start); scheduled-ahead stays about one bar.
**You'll check:** each starter plays and sounds like v1; swap mid-song; pause/resume; jumps; a long run on your phone with the screen on.

## 4. Engine complete

**Goal:** every engine feature from the decisions, driven by fixtures.

- Practice: cycle (4ths, 5ths, custom), advance auto/manual, mutes.
- Mixer: levels and mutes apply instantly.
- Per-section overrides: tempo changes, voicing, instruments.
- Swing; 8th-note and sub-bar chord changes; triplets; meters other than 4/4.

**Tests:** fixtures for each feature with golden output; timing tests for tempo changes, swing and odd meters.
**You'll check:** the one-chord drill in 4ths with repeat/skip; a song with a tempo change; swing; a 3/4 and a 6/8 fixture.

## 5. Sound

**Goal:** instruments are data and sound good.

- Sampled bass and keys (CC-licensed sets), lazily loaded and cached at runtime (not precached at install).
- Data-defined synth patches (oscillator, envelope, filter, effects), built-ins by id and custom patches embedded in the song.

**Tests:** every built-in patch validates and builds; sample loading and fallback-to-synth behaviour; patch changes take effect at the next bar.
**You'll check:** each patch, on phone speakers and headphones; first-load time on a slow connection.

## 6. Looper

**Goal:** first-class looper on the v2 engine.

- Starts with a spike: mic latency and compensation, count-in, recording aligned to section boundaries.
- Takes per section, stacked takes (overdub), stored in IndexedDB and referenced by id.
- Recording-only UI on the bench (arm, record, mute or delete take).

**Tests:** take alignment against rendered output; IndexedDB storage and cleanup when a song is deleted.
**You'll check:** record, overdub and play back on phone and laptop; latency feel.

## 7. Agent skill

**Goal:** natural language → a song that opens in the app.

- Schema docs generated from Zod (`z.toJSONSchema()`) plus a short authoring guide with examples (the fixtures).
- A script: validate JSON → encode → print the `/progression/v2/?s=…` link.
- A Claude skill that uses both.

**Tests:** every fixture round-trips through the script; the skill's examples validate.
**You'll check:** ask for a few songs in plain English and open the links.

## 8. UI

**Goal:** the app from the mockup, on top of a finished engine.

- Play view (home), Mix, Share.
- Library: Scratch, starters, import, shared links, autosave.
- Backing-track editing; then the composer (song overview, section editor, Regenerate, instruments).

**Tests:** component tests for the editing screens; e2e tests for the main flows (v1's Playwright setup).
**You'll check:** the mockup's flows on phone and laptop.
