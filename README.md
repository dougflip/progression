# Chord Progression Player

A small single-page web app for practicing.

1. Define a progression, see [features](./features.md)
2. Click play to loop playback of that progression (chords, bass, drums)
3. Practice triads, scales, voice leading, etc

## Run

No build step. Open `index.html` directly in a browser, or serve the folder locally:

```
npx serve
```

## Features

See [features](./features.md) for mor details.

## Stack

Plain HTML + [Tone.js](https://tonejs.github.io/) loaded from a CDN. All logic lives in `index.html`.
