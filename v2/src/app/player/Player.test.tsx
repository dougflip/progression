/**
 * Player components rendered to HTML (no DOM needed) for every fixture: they
 * render, show the view's data, and mark the right chips and segments.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { generateSong } from "../../core/generate";
import { DEFAULT_PRACTICE } from "../../core/settings";
import { STYLES } from "../../core/styles";
import { playerView } from "../../core/view";
import { validateEnvelope } from "../../model/envelope";
import type { ShareEnvelope } from "../../model/schema";
import { PlayerHeader, Scrubbers, TransportButtons } from "./Player";

const files = import.meta.glob<unknown>("../../../fixtures/*.json", {
  import: "default",
  eager: true,
});
const fixtures = Object.entries(files)
  .filter(([p]) => !p.endsWith("/frozen.json"))
  .map(([p, raw]) => {
    const r = validateEnvelope(raw);
    if (!r.ok) throw new Error(p);
    return { name: p.split("/").pop()!, env: r.value as ShareEnvelope };
  });

const ARR = { kind: "arrangement" } as const;
const noop = () => {};

describe("PlayerHeader", () => {
  it.each(fixtures)("renders every arrangement entry of $name", ({ env }) => {
    const song = env.doc.kind === "song" ? env.doc : generateSong(env.doc, STYLES);
    song.arrangement.forEach((_, arrIdx) => {
      const view = playerView(
        env.doc,
        env.practice ?? DEFAULT_PRACTICE,
        { arrIdx, lap: 0, bar: 0 },
        ARR,
        STYLES,
      );
      const html = renderToStaticMarkup(
        <PlayerHeader view={view} activeChord={0} beat={1} cued={new Set([0])} onChip={noop} />,
      );
      expect(html).toContain(`<span class="key-pill">${view.key}</span>`);
      expect(html).toContain(`<b>${view.section.name}</b>`);
      for (const c of view.chips) expect(html).toContain(`<span class="name">${c.name}</span>`);
      expect(html.match(/class="beat-dot/g)).toHaveLength(view.meter.beatsPerBar);
      expect(html.match(/class="beat-dot active"/g)).toHaveLength(1);
    });
  });

  it("marks section overrides, the active chip, cued chips and bar progress", () => {
    const env = fixtures.find((f) => f.name === "song-overrides-slash-pitches.json")!.env;
    const view = playerView(env.doc, env.practice!, { arrIdx: 1, lap: 0, bar: 1 }, ARR, STYLES);
    const html = renderToStaticMarkup(
      <PlayerHeader
        view={view}
        activeChord={1}
        beat={undefined}
        cued={new Set([0])}
        onChip={noop}
      />,
    );
    expect(html).toContain('class="eff ovr" title="Section override">♩ 100</span>');
    expect(html).toContain('class="eff ovr" title="Section override"> 3/4</span>');
    expect(html).toContain('class="chip active "');
    expect(html).toContain('class="chip  cued"');
    expect(html).toContain('<span class="key-lap">1/3</span>'); // custom cycle of three keys
  });
});

describe("Scrubbers and transport", () => {
  const env = fixtures.find((f) => f.name === "starter-cycle-4ths.json")!.env;
  const view = playerView(env.doc, env.practice!, { arrIdx: 0, lap: 2, bar: 0 }, ARR, STYLES);

  it("shows the key scrubber while cycling, with the current and queued keys", () => {
    const html = renderToStaticMarkup(
      <Scrubbers
        view={view}
        showCurrent
        queuedSection={undefined}
        queuedKey={4}
        onSection={noop}
        onKey={noop}
      />,
    );
    expect(html).toContain("Key</span>");
    expect(html).not.toContain("Song</span>"); // one arrangement entry
    expect(html).toContain('class="seg-btn current ">Bb</button>');
    expect(html).toContain('class="seg-btn  queued">Ab</button>');
  });

  it("shows play or pause, and the position", () => {
    const html = renderToStaticMarkup(
      <TransportButtons
        playing
        canStop
        position="Verse · bar 2/4"
        onPlay={noop}
        onStop={noop}
        onMix={noop}
      />,
    );
    expect(html).toContain('class="play on"');
    expect(html).toContain("❚❚");
    expect(html).toContain("Verse · bar 2/4");
  });
});
