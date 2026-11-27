import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRACTICE } from "../../core/settings";
import { DEFAULT_LEVELS, type Practice } from "../../model/schema";
import { MixSheet, PracticeRow } from "./Practice";

const noop = () => {};

describe("PracticeRow", () => {
  it("shows the cycle and advance; custom keys only for a custom cycle", () => {
    const off = renderToStaticMarkup(<PracticeRow practice={DEFAULT_PRACTICE} onChange={noop} />);
    expect(off).toContain('<option value="none" selected="">Off</option>');
    expect(off).toContain("⏭️ Auto");
    expect(off).not.toContain('aria-label="Keys to cycle through"');

    const custom: Practice = {
      ...DEFAULT_PRACTICE,
      cycle: { kind: "custom", keys: ["G", "D", "A"] },
      advance: "manual",
    };
    const html = renderToStaticMarkup(<PracticeRow practice={custom} onChange={noop} />);
    expect(html).toContain('value="G D A"');
    expect(html).toContain("⏭️ Manual");
  });
});

describe("MixSheet", () => {
  const mutes = { ...DEFAULT_PRACTICE.mutes, bass: true };

  it("shows levels and mute checkboxes (checked = playing)", () => {
    const html = renderToStaticMarkup(
      <MixSheet
        levels={DEFAULT_LEVELS}
        mutes={mutes}
        showLoops={false}
        onLevels={noop}
        onMutes={noop}
        onClose={noop}
      />,
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(2); // bass muted
    expect(html).toContain('aria-label="Chords level" value="50"');
    expect(html).not.toContain("Loops");
  });

  it("shows the loops level for songs", () => {
    const html = renderToStaticMarkup(
      <MixSheet
        levels={DEFAULT_LEVELS}
        mutes={mutes}
        showLoops
        onLevels={noop}
        onMutes={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain("Loops");
  });
});
