# Issues and Fixes

## Key vs customCycleKeys

state.playback.key is doing double duty: it's both "the single key for Loop/4ths/5ths" and "the home key of the custom sequence." The fix from before enforces key === customCycleKeys[0] whenever cycle === 'custom', because that's required for correct playback (the shift math is relative to customCycleKeys[0]). But that means the moment you flip the Loop pill to Custom, key gets forced back to customCycleKeys[0] — silently overwriting whatever key you'd set while in Loop mode, even though customCycleKeys itself wasn't touched. That's exactly what you're seeing: your "C" from step 2 gets clobbered by the re-sync in step 3.

Example URL to reproduce:

```
http://localhost:5173/progression/?key=C&tempo=85&bars=2&cycle=custom&customKeys=A%2CD%2CG&style=funk&bass=busy&drums=simple&voicing=voice-lead-loop&section=I&arrangement=&activeSection=1&advance=auto&chordVol=50&bassVol=100&drumVol=100&masterVol=100&chordsOn=1&bassOn=1&drumsOn=1&presetId=builtin-cycle-4ths
```

## User preset ids can collide

`saveUserPreset` generates ids with `Date.now().toString(36)` (progression-core.ts). Two presets saved within the same millisecond get the _same_ id — found while writing a default-preset test that called `saveUserPreset` twice back-to-back and got identical ids back. In the app this needs a fast double-click on "Save as new preset" plus a rename/re-save, so it's unlikely in practice, but it's a latent correctness gap: whichever preset is looked up by that id second (e.g. `deleteUserPreset`, `renameUserPreset`, a stored `defaultPresetId` pointer) will silently act on the wrong one. Worth swapping for something collision-resistant (e.g. `crypto.randomUUID()`) next time this file is touched.

## Unsaved loops (and other state) can be silently lost

`isDirty()` (progression-core.ts) returns `false` outright when nothing is loaded — `baseline` is null, so it early-returns before comparing anything. That means a brand-new song with recorded loops shows zero indication of being unsaved: no asterisk on the preset button, no signal at all. Loops only persist by riding along in a saved preset's `Section.loops` (they deliberately don't travel through the URL — see docs-internal/looper.html#persistence), so a refresh, tab close, or loading a different preset before hitting "Save as" orphans the recorded audio's IndexedDB row with no path back to it. Found while running through the 3a (GC sweep) manual test scenarios — lost several recordings this way in the process.

Candidate fixes, roughly in priority order:

1. Fix `isDirty()` to also report dirty when there's preset-worthy state (e.g. sections with loops) but no preset is loaded — the actual gap today, not just the asterisk's visibility.
2. Add a `beforeunload` guard gated on that fixed dirty state — a native "leave site? unsaved changes" browser prompt fires at the exact moment (refresh/close/navigate) the recording would otherwise be lost, which a passive UI indicator can't do since you're not looking at it in that moment. Needs to gate strictly on "there's real unsaved state," or it'll fire too often and become noise.
3. Autosave draft slot — persist live `AppState` (loops included) to its own localStorage key, independent of named presets, merged back in on boot the same way `mergeSectionLoops` already does for a loaded preset. Closes the gap completely, even if the user never hits Save, but it's a second persistence channel with the same boot-ordering trap 2b already hit once (`mergeSectionLoops` exists because of that bug), so it needs care.
4. Silently overwrite the currently _loaded_ preset after each capture — cheapest option, but only helps if you started from a saved preset; does nothing for a brand-new unsaved song, which is the riskier case.
5. Stronger visual indicator (more than a `*`) — a reasonable complement, but wouldn't have prevented this on its own, since the failure mode is "not looking at the button when you navigate away."
