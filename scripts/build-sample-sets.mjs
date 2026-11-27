#!/usr/bin/env node
/**
 * Builds v2's sample sets (public/v2/samples/<set>/<midi>.ogg) from their
 * original downloads, so every shipped file can be rebuilt and traced back.
 *
 * Usage:
 *   node scripts/build-sample-sets.mjs <sources-dir> [set-id ...]
 *
 * <sources-dir> holds each archive below, unpacked (the `dir` of each recipe).
 * Needs ffmpeg (trim, fade) and oggenc from vorbis-tools (encode):
 *   brew install ffmpeg vorbis-tools
 *
 * Each note: leading silence removed (so the sound starts on time), cut to
 * `seconds` with a fade-out, encoded as Ogg Vorbis (the format of v1's drums).
 * The registry entry for each set lives in v2/src/model/sampleSets.ts; a test
 * checks every file it names exists.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** MIDI → "C4" style (sharps; MIDI 60 = C4). */
const noteName = (midi) => `${NOTE[midi % 12]}${Math.floor(midi / 12) - 1}`;
const range = (from, to, step) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Every shipped set. `file(midi)` is the source file for that note, inside `dir`. */
const RECIPES = [
  {
    id: "bass-electric-v1",
    archive:
      "https://github.com/freepats/electric-bass-YR/releases/download/2019-09-30/FingerBassYR-SFZ+FLAC-20190930.7z",
    dir: "FingerBassYR SFZ+FLAC-20190930",
    // Recorded chromatically E1–D#2 only; higher notes are pitched up from D#2.
    notes: range(28, 39, 1),
    file: (midi) => `samples/finger/${NOTE[midi % 12]}.flac`,
    seconds: 3,
    fade: 0.3,
    quality: 4,
    credit:
      "Finger Bass YR by Andrea Biasior (Yamaha RBX), FreePats project, CC0 1.0. https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html",
  },
  {
    id: "piano-v1",
    archive:
      "https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3+20161209_44khz16bit.tar.xz",
    dir: "SalamanderGrandPianoV3_44.1khz16bit",
    // Sampled in minor thirds from A0; velocity layer 10 of 16 (medium-loud).
    notes: range(36, 84, 3),
    file: (midi) => `44.1khz16bit/${noteName(midi)}v10.wav`,
    seconds: 5,
    fade: 0.8,
    quality: 4,
    credit:
      "Salamander Grand Piano V3 by Alexander Holm (Yamaha C5), CC BY 3.0. https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html",
  },
  {
    id: "epiano-fm-v1",
    archive:
      "https://github.com/freepats/fm-piano1/releases/download/2019-09-16/FM-Piano1-SFZ+FLAC-20190916.7z",
    dir: "FM-Piano1 SFZ+FLAC-20190916",
    // Sampled every 6 semitones (C and F#); the middle velocity layer (80).
    notes: range(36, 84, 6),
    file: (midi) => `samples/${noteName(midi)}v80.flac`,
    seconds: 4,
    fade: 0.6,
    quality: 4,
    credit:
      'FM Synthesized Piano #1 by Roberto (DX7 "E. Piano 1" via Hexter), FreePats project, CC0 1.0. https://freepats.zenvoid.org/ElectricPiano/synthesized-piano.html',
  },
];

const [sourcesDir, ...only] = process.argv.slice(2);
if (!sourcesDir) {
  console.error("usage: node scripts/build-sample-sets.mjs <sources-dir> [set-id ...]");
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
const tmp = mkdtempSync(join(tmpdir(), "sample-sets-"));
try {
  for (const r of RECIPES.filter((r) => only.length === 0 || only.includes(r.id))) {
    const out = join("public", "v2", "samples", r.id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    let bytes = 0;
    for (const midi of r.notes) {
      const src = join(sourcesDir, r.dir, r.file(midi));
      const wav = join(tmp, `${midi}.wav`);
      const ogg = join(out, `${midi}.ogg`);
      const filter = [
        "silenceremove=start_periods=1:start_threshold=-60dB",
        `atrim=0:${r.seconds}`,
        `afade=t=out:st=${r.seconds - r.fade}:d=${r.fade}`,
      ].join(",");
      // No metadata: oggenc warns about the LIST chunk ffmpeg would write.
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        src,
        "-af",
        filter,
        "-ar",
        "44100",
        "-map_metadata",
        "-1",
        "-fflags",
        "+bitexact",
        wav,
      ]);
      run("oggenc", ["--quiet", "-q", String(r.quality), "-o", ogg, wav]);
      bytes += statSync(ogg).size;
    }
    writeFileSync(join(out, "CREDITS.txt"), `${r.credit}\nSource archive: ${r.archive}\n`);
    console.log(`${r.id}: ${r.notes.length} notes, ${(bytes / 1024).toFixed(0)} KiB`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
