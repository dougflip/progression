# Features

## Playback

- Looping backing track with chords, bass, and drums.
- Single Play/Stop toggle button. Spacebar also works when no input is focused.
- 12 major keys. Tempo 40–220 BPM.
- Default 2 bars per chord; can be set to 1, 2, or 4.
- Visual feedback while playing: chord chips highlight in turn, beat dots pulse on each quarter note, and bar dots inside the active chip show position within multi-bar chords.

## Main player controls

The most-used settings are tappable directly on the main screen — no need to open Setup. All changes apply live during playback.

- Tap the **key heading** to reveal an inline key picker.
- Tap the **BPM** to open a tempo popover with a slider and ± nudge buttons.
- Tap **style**, **bars**, or **loop mode** pills to cycle through their options.

## Progression syntax

The progression input accepts space-separated tokens:

- **Roman numerals**: `I`, `vi`, `ii V I`. Uppercase = major triad, lowercase = minor.
- **Absolute chord names**: `C`, `Am`, `F#`, `Bbm`. Use `m` suffix for minor.
- **7th chords**: `Imaj7`, `V7`, `iim7`, `Cmaj7`, `G7`, `Dm7`. On Roman numerals, bare `7` follows case (`V7` = dom7, `v7` = m7).
- **Mix both** in one progression if you want.
- **Per-chord duration**: append `:n` for n bars (`V:4`, `Am:1`). Omitted = uses bars-per-chord default.
- **Repeat tokens** to extend (`I I vi V` = two bars of I then default-duration vi and V).

Chord chips show the resolved chord names below each token (or the literal name for absolute chords). The current chord highlights during playback. Very long progressions and oversized `:n` values are silently capped.

## Loop modes

- **Loop** — repeat the progression in the configured key.
- **Cycle 4ths** — play the progression in 12 keys, ascending by perfect fourths.
- **Cycle 5ths** — same, ascending by perfect fifths.

Cycle mode applies to any progression — `ii V I` through all 12 keys, `I` through 12 keys (= the circle itself), or whatever shape you want. The displayed key updates per lap. Spelling uses flats in 4ths, sharps in 5ths. Pitch is octave-clamped so the cycle doesn't keep climbing into screech range.

## Style

Drum and bass feel. All 4/4.

- **Pop** — straight and steady.
- **Funk** — syncopated, tighter pocket.
- **Ballad** — half-time feel, sparse — pairs well with slow tempos.
- **Rock** — driving 8ths, heavier kick.

## Built-in presets

Quick-load chips for common shapes:

- Progressions: `I V vi IV`, `I vi ii V`, `ii V I`, `iim7 V7 Imaj7` (jazz ii-V-I), `I IV V`, `i iv v`, 12-bar blues.
- Cycle starters: Cycle 4ths/5ths in major or minor (each just loads `I` or `i` with the matching loop mode).

Clicking a preset overrides progression and loop mode but preserves your key, tempo, volumes, mutes.

## Saved presets

User-defined presets persist in `localStorage`:

- **+ Save current** snapshots the entire current state (everything you can configure).
- **Inline rename** — pencil icon opens an edit input; Enter or blur commits, Escape cancels.
- **Delete** — × button removes the preset.
- Saved presets live above the built-in chips since they're accessed more.

## URL sharing

The full state syncs to the URL automatically (debounced). Every relevant setting is included:

- key, tempo, bars, loop mode, progression
- all four volumes (chords/bass/drums/master) and three mute flags

A **Copy share link** button in Setup copies the canonical URL. Anyone opening it gets the same setup. Reload preserves state. Play state and keep-screen-on are intentionally not included.

## Mix

Bottom sheet with per-instrument rows (mute + volume) and a master volume. Changes apply live.

## Setup

Bottom sheet for everything else: key, tempo, bars-per-chord, loop mode, progression input, presets, saved presets, theme, keep-screen-on, copy share link.

## Theme

Light / Dark toggle in Setup. Defaults to dark. Stored per-device in `localStorage` (not in URL or saved presets — it's a device preference, not session config). Applied before first paint so there's no flash on load.

## Mobile / UX

- Bottom action bar: Setup · Play/Stop · Mix. Thumb-reachable.
- Bottom sheet drawers for Setup and Mix — audio keeps playing while open. Sheet headers stay pinned while content scrolls.
- Safe-area inset aware.
- Keep-screen-on uses the Wake Lock API while playing.
- iOS audio session set to `playback` so the silent switch doesn't mute output.
