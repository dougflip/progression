# Chord Progression Player

Progression is a backing-track tool for musicians.
Enter a chord progression, set your key and tempo,
and loop it while you practice scales, solos, or chord shapes.

App: https://dougflip.github.io/progression
Docs: https://dougflip.github.io/progression/docs.html

## Local Development

```sh
# switch to proper node
nvm use

# install deps
npm i

# run the dev server
npm run dev

# run static analysis checks against the code
npm run check

# format the code
npm run format
```

## Tests

Unit tests cover music theory logic and run via Vitest:

```sh
npm test
```

E2E snapshot tests run in Docker using Playwright (Chrome, desktop + mobile viewports).
Snapshots are always generated inside the container for consistent rendering across environments
and are committed to `e2e/tests/snapshots/`.

```sh
# run e2e tests
npm run e2e

# regenerate snapshots after an intentional UI change
npm run e2e:update-snapshots
```

## Stack

HTML + CSS + JS + [Tone.js](https://tonejs.github.io/)
