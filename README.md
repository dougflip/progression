# Chord Progression Player

A tiny single-page web app for practicing. Pick a key, type a Roman-numeral progression, and get a looping backing track — chords, bass, and drums — to practice triads, scales, and improv over.

I use it as a practice tool for triads on guitar. I'll usually pick a progression that has both major and minor chords to practice different inversions across different string sets.

## Run

No build step. Open `index.html` directly in a browser, or serve the folder locally:

```
npx serve
```

Click **Play** to start — browsers require a user gesture before audio.

## Usage

- Pick a key and tempo.
- Type a progression as space-separated Roman numerals. Uppercase = major, lowercase = minor (e.g. `I vi ii V`, `ii V I`, `i iv v`).
- Toggle/mix the individual parts (chords, bass, drums) to taste.

## Stack

Plain HTML + [Tone.js](https://tonejs.github.io/) loaded from a CDN. All logic lives in `index.html`.
