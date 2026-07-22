/**
 * custom-styles.ts
 * User-authored styles — same StyleVariant/StyleBassPhrase shape as the
 * built-in styles (see styles.ts), plus identity and multi-bar-readiness
 * metadata. See docs-internal/custom-styles.html for the full feature plan.
 */

import type { StyleDef, StyleVariant } from "./progression-core.js";

export interface CustomStyleDef {
  id: string;
  name: string;
  stepsPerBar: number; // always 16 today; carried for future multi-bar patterns
  bars: number; // always 1 today
  simple: StyleVariant;
  busy: StyleVariant;
}

export function toStyleDef(custom: CustomStyleDef): StyleDef {
  return { simple: custom.simple, busy: custom.busy };
}

// prettier-ignore
export const EXAMPLE_CUSTOM_STYLE: CustomStyleDef = {
  id: "example",
  name: "My Bossa Groove",
  stepsPerBar: 16,
  bars: 1,
  simple: {
    kick:  [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    bass: {
      major: ["R",0,0,0, 0,0,"5",0, "R",0,0,0, 0,0,"5",0],
      minor: ["R",0,0,0, 0,0,"5",0, "R",0,0,0, 0,0,"5",0],
    },
  },
  busy: {
    kick:  [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1],
    bass: {
      major: ["R",0,"5",0, "3",0,"5",0, "R",0,"5",0, "3",0,"5",0],
      minor: ["R",0,"5",0, "3",0,"5",0, "R",0,"5",0, "3",0,"5",0],
    },
  },
};
