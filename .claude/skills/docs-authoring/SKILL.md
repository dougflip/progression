---
name: docs-authoring
description: >
  Guidelines for authoring and editing docs.html — the public-facing reference
  for the Progression app. Use this skill whenever adding documentation for a
  new feature, editing existing sections in docs.html, or reviewing whether
  docs.html needs updating after a code change. Load this before touching
  docs.html so the output stays consistent with existing patterns.
---

## Behavior over implementation details

Document what something does for the user, not how it works internally. Specific values (ranges, counts, timeouts) become stale the moment a feature changes.

**Before:** "A slider from 40–220 BPM with a Tap tempo button. Tap at least twice to set; taps older than 2 seconds reset the calculation."
**After:** "A tempo slider with a Tap tempo button — tap the beat to detect tempo."

**Before:** "bar-progress dots appear below it when Bars per chord is set to 2 or 4."
**After:** "bar-progress dots appear below it when Bars per chord is greater than 1."

**Before:** "Define your own key sequence — up to 12 keys in any order."
**After:** "Define your own key sequence in any order."

Exception: syntax reference tables (like Progression syntax) need exact values — they're a lookup tool, not prose.

---

## Every section must be URL-addressable

Every `h2` and `h3` in the Reference tab gets an `id` and an inline `#` copy button. This lets users share direct links to specific features.

```html
<h2 id="loop-modes">
  Loop modes
  <button class="anchor-copy" data-id="loop-modes" title="Copy link to this section">#</button>
</h2>
```

Tab routing is automatic — JS walks up the DOM to find the parent `.tab-panel`, so any new `id` is instantly deep-linkable with no registration needed.

Sub-sections get anchors too — not just top-level sections (e.g. `#loop-4ths`, `#style-pop`).

---

## Link into the app wherever possible

The app is fully URL-addressable. Use that. Any feature being described can have a live link that opens the app in a state that demonstrates it.

Use minimal params — only set what's relevant to the feature. Let the app's defaults handle the rest.

```html
<a href="./?cycle=4ths" class="try-link">Try Cycle 4ths →</a>
<a href="./?style=ballad&tempo=65" class="try-link">Try Ballad →</a>
```

For complex features (sections, arrangement), use a richer URL that tells a real musical story:

```html
<a
  href="./?key=C&tempo=100&bars=1&cycle=none&style=rock&bass=simple&voicing=voice-lead-loop&section=vi+IV+I+V&section=vi+iii+vi+iii+vi+iii+V+vi%3A2&section=iii%3A2+I%3A2&arrangement=1+1+2%3A2+1%3A2+3%3A2&advance=auto&chordVol=50&bassVol=100&drumVol=100&masterVol=100&chordsOn=1&bassOn=1&drumsOn=1"
  class="try-link"
  >Try 3-section song →</a
>
```

For syntax tables, make the example itself the link:

```html
<!-- Before -->
<td><code>I</code> <code>IV</code> <code>V</code></td>

<!-- After -->
<td><a href="./?section=I+IV+V" class="try-link">I IV V →</a></td>
```

---

## Internal cross-linking

Link section names to their Reference anchors when mentioned elsewhere — especially in Quick Start steps and feature descriptions.

```html
<a href="#loop-modes">cycle the keys</a> <a href="#progression-syntax">per-chord bar notation</a>
```

Readout pill names in the Playback screen section should each link to their respective Setup sections:

```html
<a href="#style-bass">Style</a>, <a href="#style-bass">Bass</a>, <a href="#voicing">Voicing</a>,
<a href="#bars">Bars</a>, <a href="#tempo">BPM</a>, <a href="#loop-modes">Loop mode</a>
```

---

## Tone and concision

- Write for a musician first, not a developer.
- Describe what the user _experiences_, not what the code does.
- For simple options (Style, Bass, Voicing modes), one sentence is enough — the try-it link does the rest.

**Before:** "More motion, weaves in chord tones (root, 3rd, 5th). The 3rd adapts to chord quality."
**After:** "More motion than Simple."

**Before:** "The full app state syncs to the URL automatically..."
**After:** "Every change you make is reflected in the URL — key, progression, tempo, mix, and more. Use **Copy share link** in Setup to copy it and share or bookmark your exact setup."

---

## Reference tab order

The Reference tab mirrors the app's UI structure:

1. **Playback screen** — everything visible without opening a drawer
2. **Setup** — follows the drawer's group order: Loop modes → Style & Bass → Voicing → Progression syntax → Sections → Presets → App settings
3. **Mix**

Progression syntax lives inside Setup / Progression (before Sections) — new users aren't hit with a dense table immediately, but it's close to where they'll need it.

---

## URL encoding in app links

- Spaces between chord tokens: use `+` (`section=I+IV+V`)
- The `:` in per-chord bar notation: use `%3A` (`I%3A4`)
- The `+` in augmented chord notation (`I+`): use `Iaug` instead to avoid ambiguity

---

## What belongs in Reference vs Quick Start

**Quick Start** — get the user playing in under a minute. No feature depth, just enough to start. Links to Reference for anything deeper.

**Reference** — complete feature guide, mirrors the UI. Every feature, every option, with a live app link where it makes sense.

Don't duplicate content between the two. Quick Start links to Reference; Reference doesn't link back to Quick Start.
