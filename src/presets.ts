import type { AppStatePartial } from "./progression-core.js";

export interface BuiltinPreset {
  label: string;
  state: AppStatePartial;
}

export const PRESETS: BuiltinPreset[] = [
  {
    label: "I vi ii V",
    state: {
      sections: [{ progression: "I vi ii V" }],
      arrangement: "",
      playback: { cycle: "none" },
    },
  },
  {
    label: "Cycle 4ths",
    state: { sections: [{ progression: "I" }], arrangement: "", playback: { cycle: "4ths" } },
  },
  {
    label: "Cycle 5ths",
    state: { sections: [{ progression: "I" }], arrangement: "", playback: { cycle: "5ths" } },
  },
  {
    label: "12-bar blues",
    state: {
      sections: [{ progression: "I7:4 IV7:2 I7:2 V7:1 IV7:1 I7:1 V7:1" }],
      arrangement: "",
      playback: { cycle: "none", tempo: 120, style: "rock" },
    },
  },
  {
    label: "♫ Otherside",
    state: {
      sections: [
        { progression: "vi IV I V" },
        { progression: "vi iii vi iii vi iii V vi:2" },
        { progression: "iii:2 I:2" },
      ],
      arrangement: "1 1 2:2 1:2 3:2",
      playback: {
        cycle: "none",
        tempo: 100,
        bars: 1,
        style: "rock",
        bass: "simple",
        drums: "simple",
        voicing: "voice-lead-loop",
        advance: "auto",
      },
      mix: {
        chordVol: 50,
        bassVol: 100,
        drumVol: 100,
        masterVol: 100,
        chordsOn: true,
        bassOn: true,
        drumsOn: true,
      },
    },
  },
];
