/**
 * styles.ts
 * Drum and bass patterns for each style and variant.
 * 16-step arrays (one bar of 16th notes).
 *   Drums: 1 = hit, 0 = rest
 *   Bass:  'R' = root, '3' = third, '5' = fifth, 0 = rest
 */

import type { StyleDef } from "./progression-core.js";

export const STYLE_OPTIONS = ["pop", "funk", "ballad", "rock"] as const;
export type StyleOption = (typeof STYLE_OPTIONS)[number];
export const STYLE_LABELS: Record<StyleOption, string> = {
  pop: "⭐ Pop",
  funk: "🕺 Funk",
  ballad: "🌙 Ballad",
  rock: "⚡ Rock",
};

export const BASS_OPTIONS = ["simple", "busy"] as const;
export type BassOption = (typeof BASS_OPTIONS)[number];
export const BASS_LABELS: Record<BassOption, string> = { simple: "🎸 Simple", busy: "🎸 Busy" };

export const DRUM_OPTIONS = ["simple", "busy"] as const;
export type DrumOption = (typeof DRUM_OPTIONS)[number];
export const DRUM_LABELS: Record<DrumOption, string> = { simple: "🥁 Simple", busy: "🥁 Busy" };

export const VOICING_OPTIONS = ["root", "voice-lead", "voice-lead-loop"] as const;
export type VoicingOption = (typeof VOICING_OPTIONS)[number];
export const VOICING_PILL_LABELS: Record<VoicingOption, string> = {
  root: "🎵 Root",
  "voice-lead": "🎵 Lead",
  "voice-lead-loop": "🎵 Lead/loop",
};

export const STYLES: Record<string, StyleDef> = {
  pop: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      busy: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      busy: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    },
    hat: {
      simple: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    openHat: {
      busy: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, "R", 0, 0, 0, "5", 0, 0, 0, "R", 0, 0, 0],
        minor: ["R", 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0],
      },
      busy: {
        major: ["R", 0, 0, 0, "5", 0, 0, 0, "3", 0, 0, 0, "5", 0, "R", 0],
        minor: ["R", 0, 0, 0, "5", 0, 0, 0, "3", 0, 0, 0, "5", 0, "R", 0],
      },
    },
  },
  funk: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
      busy: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      busy: [0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
    },
    hat: {
      simple: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    openHat: {
      simple: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
      busy: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0, "5", 0],
        minor: ["R", 0, 0, 0, 0, 0, "R", 0, 0, 0, "R", 0, 0, 0, "R", 0],
      },
      busy: {
        major: ["R", 0, 0, "R", 0, 0, "R", 0, 0, "3", 0, "R", 0, "3", 0, "5"],
        minor: ["R", 0, 0, "R", 0, 0, "R", 0, 0, "3", 0, "R", 0, "3", 0, "R"],
      },
    },
  },
  ballad: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      busy: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      busy: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    },
    hat: {
      simple: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    openHat: {
      simple: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
      busy: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    },
    ride: {
      simple: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, 0, 0, 0, 0, "5", 0, 0, 0, 0, 0, 0, 0],
        minor: ["R", 0, 0, 0, 0, 0, 0, 0, "R", 0, 0, 0, 0, 0, 0, 0],
      },
      busy: {
        major: ["R", 0, 0, 0, 0, 0, 0, 0, "3", 0, "5", 0, "3", 0, "R", 0],
        minor: ["R", 0, 0, 0, 0, 0, 0, 0, "3", 0, "5", 0, "3", 0, "R", 0],
      },
    },
  },
  rock: {
    kick: {
      simple: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      busy: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    },
    snare: {
      simple: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      busy: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0],
    },
    hat: {
      simple: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      busy: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    },
    crash: {
      busy: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    clap: {
      busy: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    },
    tom: {
      busy: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    },
    tom2: {
      busy: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    },
    bass: {
      simple: {
        major: ["R", 0, 0, 0, 0, 0, "R", 0, "R", 0, 0, 0, "5", 0, 0, 0],
        minor: ["R", 0, 0, 0, 0, 0, "R", 0, "R", 0, 0, 0, "R", 0, 0, 0],
      },
      busy: {
        major: ["R", 0, "R", 0, "3", 0, "R", 0, "R", 0, "R", 0, "5", 0, "3", 0],
        minor: ["R", 0, "R", 0, "3", 0, "R", 0, "R", 0, "R", 0, "5", 0, "3", 0],
      },
    },
  },
};
