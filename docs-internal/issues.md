# Issues and Fixes

## Key vs customCycleKeys

state.playback.key is doing double duty: it's both "the single key for Loop/4ths/5ths" and "the home key of the custom sequence." The fix from before enforces key === customCycleKeys[0] whenever cycle === 'custom', because that's required for correct playback (the shift math is relative to customCycleKeys[0]). But that means the moment you flip the Loop pill to Custom, key gets forced back to customCycleKeys[0] — silently overwriting whatever key you'd set while in Loop mode, even though customCycleKeys itself wasn't touched. That's exactly what you're seeing: your "C" from step 2 gets clobbered by the re-sync in step 3.

Example URL to reproduce:

```
http://localhost:5173/progression/?key=C&tempo=85&bars=2&cycle=custom&customKeys=A%2CD%2CG&style=funk&bass=busy&drums=simple&voicing=voice-lead-loop&section=I&arrangement=&activeSection=1&advance=auto&chordVol=50&bassVol=100&drumVol=100&masterVol=100&chordsOn=1&bassOn=1&drumsOn=1&presetId=builtin-cycle-4ths
```
