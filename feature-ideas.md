# Feature Ideas

## Tap Tempo

Ability to tap tempo.
Likely both in setup and in the player pills.

## Major vs Minor key

Right now all key selection is assumed to be major.
It would be nice to specify major vs minor and then roman numerals are resolved against it.

## Extended Voicings

Right now, we support major, minor, and 7 chords.
We should expand to support b3 b6 b7 etc.
Maybe there is a good resource that lists common chords which we should support?

### Claude's Thoughts

Impacted areas (all in progression-core.js except noted):

1. QUALITY_INTERVALS (~line 75) — add interval arrays for each new type (e.g. dim: [0,3,6], sus4: [0,5,7], etc.)
2. QUALITY_IS_MINOR (~line 87) — add false/true entries per new quality (used by bass pattern selection)
3. QUALITY_DISPLAY (~line 91) — add display strings (e.g. dim7: 'dim7', aug: 'aug')
4. suffixToQuality() (~line 217) — map new suffix strings to qualities; add symbol aliases here too (° → dim, ø → m7b5, + → aug) — essentially free once the quality exists
5. @typedef ChordQuality (~line 10) — expand the union type

progression-audio.js and index.html need no changes — they consume ChordQuality generically.

Known bass issues to fix before shipping — both bassThird and bassFifth in makeChord() are hardcoded rather than derived from QUALITY_INTERVALS:

- dim, aug, m7b5, dim7: bassFifth is hardcoded +7; should be +6 (dim) or +8 (aug)
- sus2, sus4, 7sus4: bassThird is hardcoded to isMinor ? 3 : 4; sus chords have no third (+2 or +5 instead)

Real fix: derive both bassThird and bassFifth from QUALITY_INTERVALS[quality] rather than the isMinor shortcut.

Remaining questions:

1. For Roman numerals, idim vs Idim — should case still matter (root degree), with suffix overriding quality? Or should dim/aug/sus always force a specific base?
2. ° in the URL encodes as %C2%B0 — acceptable, or prefer always using the plain-text dim/aug as canonical with symbols as input aliases only?
3. mMaj7 — camelCase is the most common notation but mmaj7 or mM7 also appear. Which spellings to accept?

## External (Foot) Controller Support

It would be nice to have at least basic support for a foot controller.
Some ideas:

- Start/stop playback
- Cycle through user presets
- Cycle through "loop modes" for the current progression
- A "loop mode" where you only advance to the next chord after a foot press
- In cycle 4/5 only advancing to the next "key" after press
- In cycle 4/5 being able to go backwards on press (to retry a key)
- Restarting the progression on foot press (similar to stop and start I guess)
- A mode where you have A/B progressions and can trigger the next one via foot press
- Other ideas?

We need to research what features are needed in a footswitch to make this work.
Different requirements for desktop vs mobile? Linux vs macOS vs Windows?
Bluetooth or wired?
MIDI controller preferred?

#### Claude's thoughts

The "advance-on-press" cycle mode is the real prize: nail ii-V-I in C, foot press to move to G. But before wiring MIDI, pilot the UX with a keyboard shortcut or on-screen "Next key" button.
 If the feature is good, then invest in Web MIDI integration. Web MIDI works in Chrome/Edge but not Safari; iOS is rough. I'd target one specific switch (iRig Blueboard, AirTurn) rather
than aim for universal.

## Higher Quality Sounds

Worth exploring samples or other ways to produce better sounding progressions?

#### Claude's thoughts

The current synths are functional but tiring over a long session. Salamander Grand piano samples (~few MB, public domain) via Tone.js Sampler would transform chord/bass feel. Drums could
stay synthesized. Moderate work.

## Beats per Chord

We already allow this syntax `"I:2"` to say play the I chord for 2 bars.
Maybe we could extend that a little to allow for beats?
Something like `"I:2b"` to indicate for 2 beats?
Unfortunate that beats and bars both start with b so may need to thin more.
One use case is a progression with a resolution or leading tone,
for example a IV to a minor iv chord.
Not high priority, again, not necessary for most practicing but could be cool
and don't want to lose track of it.

#### Claude's thoughts

Cleanest API IMO: use fractions, not a b suffix. V:0.5 reads naturally as "half a bar". Tone.js already accepts fractional time. Defer until you actually want IV→iv resolutions.

## Cross-cutting observations

- (2) and the "step mode" inside (1) share the same primitive: "advance to next thing on trigger". Build that abstraction once.
- (7) plays cleanly with (5) — fractional durations don't care about sound quality.
- None of these break URL/state schema badly except (1) sections. If you ever do sections, plan the URL migration carefully.

## Auth and Preset Persistence

I've used [instantdb](https://www.instantdb.com/) for other apps as a lightweight db.
We could offer (optional) auth and when auth'd persist presets to the db.
This enables access across devices.
Instantdb can work with plain JS and provides helpers for auth.
https://www.instantdb.com/docs/start-vanilla

#### Claude thoughts

Copy-share-link already does cross-device transfer with zero infra. Auth pays off only when the user has 20+ presets they actually rely on. Revisit when that pain materializes.

## Other Time Signatures

This is a lower priority for sure.
The main goal of this repo is as a practice tool and we can accomplish that in 4/4.
Still, allowing for different time signatures opens the door to more practice scenarios.

#### Claude's thoughts

You called it. 4/4 covers practice. Adding 3/4 / 6/8 / 5/4 means reworking bass and drum patterns. Don't.