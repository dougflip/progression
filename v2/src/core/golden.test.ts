/**
 * Golden output: every fixture played from the top, bar by bar, through the pure
 * core (generateSong → scheduleBar → nextPosition), written to
 * v2/fixtures/golden/<fixture>.txt. A change to these files must be deliberate:
 * review the diff, then `npx vitest run -u` to accept it.
 *
 * Advance is forced to "auto" so every section is heard (manual advance is covered
 * by transport.test.ts); everything else comes from the fixture's practice.
 */
import { describe, expect, it } from "vitest";
import type { EngineSource, ScheduledBar, Transport } from "../model/runtime";
import type { ShareEnvelope, Song } from "../model/schema";
import { formatNumeral } from "./numerals";
import { generateSong } from "./generate";
import { scheduleBar } from "./schedule";
import { DEFAULT_PRACTICE, findSection } from "./settings";
import { STYLES } from "./styles";
import { chordName, midiName, usesFlats } from "./theory";
import { playerView, type Setting } from "./view";
import { nextPosition } from "./transport";

const fixtures = import.meta.glob<ShareEnvelope>("../../fixtures/*.json", {
  import: "default",
  eager: true,
});

type Playing = Extract<Transport, { status: "playing" }>;

function play(env: ShareEnvelope): { source: EngineSource; bars: ScheduledBar[] } {
  const song: Song = env.doc.kind === "song" ? env.doc : generateSong(env.doc, STYLES);
  const source: EngineSource = {
    song,
    practice: { ...(env.practice ?? DEFAULT_PRACTICE), advance: "auto" },
  };
  const lapBars = song.arrangement.reduce((n, id) => n + findSection(song, id).bars, 0);
  const count = Math.min(40, Math.max(8, lapBars + 2));

  const bars: ScheduledBar[] = [];
  let t: Playing = {
    status: "playing",
    scope: { kind: "arrangement" },
    at: { arrIdx: 0, lap: 0, bar: 0 },
  };
  let voicing: number[] | undefined;
  for (let i = 0; i < count; i++) {
    const bar = scheduleBar(source, t.at, t.scope, voicing);
    bars.push(bar);
    voicing = bar.voicing;
    t = nextPosition(source, t);
  }
  return { source, bars };
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, ""));
const pad = (s: string, n: number) => s.padEnd(n);

function format(name: string, { source, bars }: ReturnType<typeof play>): string {
  const lines = [`# ${name}: ${bars.length} bars from the top (advance forced to auto)`, ""];
  bars.forEach((b, i) => {
    const section = findSection(source.song, b.sectionId);
    const flats = usesFlats(b.key);
    const { beatsPerBar, beatUnit } = b.meter;
    lines.push(
      `bar ${i + 1} · ${section.name} [arr ${b.position.arrIdx}] bar ${b.position.bar + 1}/${section.bars}` +
        ` · lap ${b.position.lap} key ${b.key} · ${b.tempo} bpm ${beatsPerBar}/${beatUnit} (${b.length} ticks)`,
    );
    for (const c of b.chords) {
      const chord = section.chords[c.chordIndex]!;
      lines.push(
        `  chord  ${pad(num(c.time), 7)} +${pad(num(c.duration), 7)} ` +
          `${pad(`#${c.chordIndex} ${formatNumeral(chord)}`, 14)} ${pad(chordName(chord, b.key), 9)} ` +
          `${pad(c.midi.map((m) => midiName(m, flats)).join(" "), 18)} ${c.instrument.id}` +
          (c.continued ? "  (held)" : ""),
      );
    }
    for (const n of b.parts.bass) {
      lines.push(
        `  bass   ${pad(num(n.time), 7)} +${pad(num(n.duration), 7)} ${pad(midiName(n.midi, flats), 5)} ${n.instrument.id}`,
      );
    }
    const hits = new Map<string, string[]>();
    for (const h of b.drums) hits.set(h.drum, [...(hits.get(h.drum) ?? []), num(h.time)]);
    for (const [drum, times] of hits) {
      const id = b.drums.find((h) => h.drum === drum)!.instrument.id;
      lines.push(`  ${pad(drum, 8)} ${pad(times.join(" "), 40)} ${id}`);
    }
    for (const l of b.loops) {
      lines.push(`  loop   ${l.takeId} gain ${l.gain} bar ${l.barInTake + 1}/${l.bars}`);
    }
    if (b.voicing) lines.push(`  voicing → ${b.voicing.map((m) => midiName(m, flats)).join(" ")}`);
  });
  return lines.join("\n") + "\n";
}

/** The player view at the first bar of each arrangement entry (and lap 1 while cycling). */
function formatViews(name: string, env: ShareEnvelope): string {
  const practice = env.practice ?? DEFAULT_PRACTICE;
  const scope = { kind: "arrangement" } as const;
  const first = playerView(env.doc, practice, { arrIdx: 0, lap: 0, bar: 0 }, scope, STYLES);
  const laps = first.keys.length > 1 ? [0, 1] : [0];
  const lines = [`# ${name}: player view at the start of each arrangement entry`, ""];
  lines.push(`${first.title} (${first.kind}) · keys ${first.keys.join(" ")}`);
  lines.push(`arrangement: ${first.arrangement.map((e) => `${e.arrIdx}:${e.name}`).join(" ")}`);
  for (const lap of laps) {
    first.arrangement.forEach(({ arrIdx }) => {
      const v = playerView(env.doc, practice, { arrIdx, lap, bar: 0 }, scope, STYLES);
      const settings = Object.entries(v.settings)
        .filter(([k]) => k !== "kind")
        .map(([k, s]) => {
          if (k === "instruments") {
            const roles = Object.entries(s as Record<string, Setting<{ id: string }>>);
            return `instruments(${roles.map(([r, i]) => `${r}=${i.value.id}${mark(i)}`).join(" ")})`;
          }
          return `${k}=${show((s as Setting<unknown>).value)}${mark(s as Setting<unknown>)}`;
        });
      lines.push("");
      lines.push(
        `[arr ${arrIdx}] ${v.section.name} · lap ${v.lap} key ${v.key} · ${v.section.bars} bars of ${v.barLength} ticks`,
      );
      lines.push(`  settings: ${settings.join(" ")}`);
      for (const c of v.chips) {
        lines.push(
          `  chip #${c.chordIndex} ${c.numeral.padEnd(8)} ${c.name.padEnd(9)} bars ${c.bars.join(",")}`,
        );
      }
    });
  }
  return lines.join("\n") + "\n";
}

const mark = (s: Setting<unknown>) => (s.from === "section" ? " •" : "");
const show = (v: unknown): string =>
  typeof v === "object" && v !== null
    ? "id" in v
      ? String(v.id)
      : "beatsPerBar" in v && "beatUnit" in v
        ? `${String(v.beatsPerBar)}/${String(v.beatUnit)}`
        : JSON.stringify(v)
    : String(v);

describe("golden player views", () => {
  const entries = Object.entries(fixtures)
    .filter(([path]) => !path.endsWith("/frozen.json"))
    .map(([path, env]) => ({
      name: path
        .split("/")
        .pop()!
        .replace(/\.json$/, ""),
      env,
    }));

  it.each(entries)("$name", async ({ name, env }) => {
    await expect(formatViews(name, env)).toMatchFileSnapshot(
      `../../fixtures/golden/${name}.view.txt`,
    );
  });
});

describe("golden ScheduledBars", () => {
  const entries = Object.entries(fixtures)
    .filter(([path]) => !path.endsWith("/frozen.json"))
    .map(([path, env]) => ({
      name: path
        .split("/")
        .pop()!
        .replace(/\.json$/, ""),
      env,
    }));

  it.each(entries)("$name", async ({ name, env }) => {
    await expect(format(name, play(env))).toMatchFileSnapshot(`../../fixtures/golden/${name}.txt`);
  });
});
