/**
 * Built-in styles, ported from v1's STYLES (all seven). Each variant is one 4/4 bar
 * written as 16 sixteenth-note steps: drums `x` = hit; bass `R`/`3`/`5` = chord tone
 * (an 8th-note long, as in v1), `.` = rest. `STYLES` holds them in the schema's
 * `StyleDef` shape (ticks, chord-tone pitches). parity.test.ts checks them against v1.
 */

import type {
  BuiltinStyleId,
  DrumHits,
  DrumInstrument,
  NoteEvent,
  StyleDef,
  Variant,
} from "../model/schema";

const STEP = 12; // a 16th note in ticks
const BASS_NOTE = 24; // v1 plays every bass step as an 8th note

interface VariantSteps {
  drums: Partial<Record<DrumInstrument, string>>;
  major: string;
  minor: string;
}

const STEPS: Record<BuiltinStyleId, Record<Variant, VariantSteps>> = {
  pop: {
    simple: {
      drums: {
        kick: "x.......x.......",
        snare: "....x.......x...",
        hat: "x.x.x.x.x.x.x.x.",
      },
      major: "R...R...5...R...",
      minor: "R...R...R...R...",
    },
    busy: {
      drums: {
        kick: "x.x.......x.x...",
        snare: "....x....x..x...",
        hat: "x.x.x.x.x.x.x.x.",
        hatOpen: ".......x.......x",
      },
      major: "R...5...3...5.R.",
      minor: "R...5...3...5.R.",
    },
  },
  funk: {
    simple: {
      drums: {
        kick: "x.....x...x...x.",
        snare: "....x.......x...",
        hat: "x.x.x.xxx.x.x.xx",
      },
      major: "R.....R...R...5.",
      minor: "R.....R...R...R.",
    },
    busy: {
      drums: {
        kick: "x..x..x...x...x.",
        snare: "....x.......x...",
        tom: "..x.......x.....",
        ride: "x...x...x...x...",
      },
      major: "R..R..R..3.R.3.5",
      minor: "R..R..R..3.R.3.R",
    },
  },
  ballad: {
    simple: {
      drums: {
        kick: "x...............",
        snare: "........x.......",
        ride: "x...x...x...x...",
      },
      major: "R.......5.......",
      minor: "R.......R.......",
    },
    busy: {
      drums: {
        kick: "x.....x.x.....x.",
        snare: "........x.......",
        hat: "x.x.x.x.x.x.x.x.",
        hatOpen: ".......x........",
      },
      major: "R.......3.5.3.R.",
      minor: "R.......3.5.3.R.",
    },
  },
  rock: {
    simple: {
      drums: {
        kick: "x.....x.x.......",
        snare: "....x.......x...",
        hat: "x.x.x.x.x.x.x.x.",
      },
      major: "R.....R.R...5...",
      minor: "R.....R.R...R...",
    },
    busy: {
      drums: {
        kick: "x.....x.x...x.x.",
        snare: "....x.......x...",
        hat: "x.x.x.x.x.x.x.x.",
        hatOpen: ".......x.......x",
      },
      major: "R.R.3.R.R.R.5.3.",
      minor: "R.R.3.R.R.R.5.3.",
    },
  },
  shuffle: {
    simple: {
      drums: {
        kick: "x.....x...x.....",
        snare: "....x.......x..x",
        hat: "x.x.x.x.x.x.x.xx",
      },
      major: "R.....R...R.....",
      minor: "R.....R...R.....",
    },
    busy: {
      drums: {
        kick: "x.....x...x.....",
        snare: "....x.......x..x",
        hat: "x.x.x.x.x.x.x..x",
        hatOpen: "..............x.",
        rideBell: "x...x...x...x...",
      },
      major: "R.....5...R.R.3.",
      minor: "R.....5...R.R.3.",
    },
  },
  funk16: {
    simple: {
      drums: {
        kick: "x.....xx..xx....",
        snare: "....x.......x...",
        hat: "xxxxxxxxxxxxxxxx",
      },
      major: "R.....RR..RR....",
      minor: "R.....RR..RR....",
    },
    busy: {
      drums: {
        kick: "x.....xx..xx....",
        snare: "....x.......x...",
        hat: "xxxxxxxxxxxxxxxx",
        rideBell: "x.....xx..xx....",
      },
      major: "R.....55..RR....",
      minor: "R.....55..RR....",
    },
  },
  britpop: {
    simple: {
      drums: {
        kick: "x.....x.x.x.....",
        snare: "....x..x.x..x.xx",
        hat: "x.x.x.x.x.x.x.x.",
        hatOpen: "...............x",
      },
      major: "R.....R.R.R.....",
      minor: "R.....5.5.3.3.R.",
    },
    busy: {
      drums: {
        kick: "x.....x.x.x.....",
        snare: "....x..x.x..x.xx",
        hat: "x.x.x.x.x.x.x.x.",
        hatOpen: "...............x",
        rideBell: "x...x...x...x...",
      },
      major: "R.....5.5.3.3.R.",
      minor: "R.....5.5.3.3.R.",
    },
  },
};

export const STYLE_LABELS: Record<BuiltinStyleId, string> = {
  pop: "Pop",
  funk: "Funk",
  ballad: "Ballad",
  rock: "Rock",
  shuffle: "Shuffle",
  funk16: "Funk 16th",
  britpop: "Britpop",
};

function hits(steps: string): number[] {
  return [...steps].flatMap((c, i) => (c === "x" ? [i * STEP] : []));
}

function phrase(steps: string): NoteEvent[] {
  return [...steps].flatMap((c, i): NoteEvent[] => {
    if (c === ".") return [];
    const tone = c === "R" ? 1 : c === "3" ? 3 : 5;
    return [{ start: i * STEP, duration: BASS_NOTE, pitch: { kind: "chordTone", tone } }];
  });
}

function toStyleDef(id: BuiltinStyleId): StyleDef {
  const variant = (v: Variant) => {
    const s = STEPS[id][v];
    const drums: DrumHits = {};
    for (const [drum, steps] of Object.entries(s.drums) as [DrumInstrument, string][]) {
      drums[drum] = hits(steps);
    }
    return { drums, bass: { major: phrase(s.major), minor: phrase(s.minor) } };
  };
  const simple = variant("simple");
  const busy = variant("busy");
  return {
    id,
    label: STYLE_LABELS[id],
    drums: { simple: simple.drums, busy: busy.drums },
    bass: { simple: simple.bass, busy: busy.bass },
  };
}

export type Styles = Readonly<Record<BuiltinStyleId, StyleDef>>;

export const STYLES: Styles = {
  pop: toStyleDef("pop"),
  funk: toStyleDef("funk"),
  ballad: toStyleDef("ballad"),
  rock: toStyleDef("rock"),
  shuffle: toStyleDef("shuffle"),
  funk16: toStyleDef("funk16"),
  britpop: toStyleDef("britpop"),
};
