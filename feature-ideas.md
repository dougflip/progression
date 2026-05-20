# Feature Ideas

## Song Sections

Instead of a single progression allow for an array of progressions.
You could also provide a pre-defined sequence for the sections: AABA for example.

#### Claude's thoughts

This pulls the app from "practice loop" toward "song player". Honest question: do you ever leave loop-mode while practicing? If most of your time is the loop, sections add UI weight without
 proportional value. If you do want it, the lightweight version is a few progression text fields plus a sequence string ("A A B A") — not a section editor.

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

## Auth and Preset Persistence

I've used [instantdb](https://www.instantdb.com/) for other apps as a lightweight db.
We could offer (optional) auth and when auth'd persist presets to the db.
This enables access across devices.
Instantdb can work with plain JS and provides helpers for auth.
https://www.instantdb.com/docs/start-vanilla

#### Claude thoughts

Copy-share-link already does cross-device transfer with zero infra. Auth pays off only when the user has 20+ presets they actually rely on. Revisit when that pain materializes.

## Higher Quality Sounds

Worth exploring samples or other ways to produce better sounding progressions?

#### Claude's thoughts

The current synths are functional but tiring over a long session. Salamander Grand piano samples (~few MB, public domain) via Tone.js Sampler would transform chord/bass feel. Drums could
stay synthesized. Moderate work.

## Other Time Signatures

This is a lower priority for sure.
The main goal of this repo is as a practice tool and we can accomplish that in 4/4.
Still, allowing for different time signatures opens the door to more practice scenarios.

#### Claude's thoughts

You called it. 4/4 covers practice. Adding 3/4 / 6/8 / 5/4 means reworking bass and drum patterns. Don't.

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
