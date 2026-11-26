import { describe, expect, it } from "vitest";
import otherside from "../../../fixtures/starter-otherside.json";
import { DEFAULT_PRACTICE } from "../../core/settings";
import { STYLES } from "../../core/styles";
import { playerView } from "../../core/view";
import type { Transport } from "../../model/runtime";
import { BackingTrack } from "../../model/schema";
import { cuedChips, positionText, shownPosition, TOP } from "./derive";

const doc = BackingTrack.parse(otherside.doc);
const ARR = { kind: "arrangement" } as const;
// Chorus (arr 2): vi iii vi iii vi iii V vi:2 → 9 bars, chip 7 spans bars 7–8.
const chorus = (bar: number) =>
  playerView(doc, DEFAULT_PRACTICE, { arrIdx: 2, lap: 0, bar }, ARR, STYLES);

describe("shownPosition", () => {
  it("is the audible bar while playing, else where ▶ starts", () => {
    const at = { arrIdx: 1, lap: 0, bar: 2 };
    expect(shownPosition({ status: "playing", scope: ARR, at: TOP }, at)).toEqual(at);
    expect(shownPosition({ status: "paused", scope: ARR, at }, undefined)).toEqual(at);
    expect(shownPosition({ status: "stopped", scope: ARR, cue: at }, undefined)).toEqual(at);
    expect(shownPosition({ status: "stopped", scope: ARR }, undefined)).toEqual(TOP);
  });
});

describe("cuedChips", () => {
  it("outlines every chord in a queued chord jump's bar, in the shown entry only", () => {
    const playing = (arrIdx: number): Transport => ({
      status: "playing",
      scope: ARR,
      at: { arrIdx: 2, lap: 0, bar: 0 },
      jump: { kind: "chord", arrIdx, bar: 8, chordIndex: 7 },
    });
    expect([...cuedChips(playing(2), chorus(0))]).toEqual([7]);
    expect([...cuedChips(playing(3), chorus(0))]).toEqual([]);
  });

  it("outlines the paused or cued bar's chords", () => {
    expect([
      ...cuedChips({ status: "paused", scope: ARR, at: { arrIdx: 2, lap: 0, bar: 3 } }, chorus(3)),
    ]).toEqual([3]);
    expect([...cuedChips({ status: "stopped", scope: ARR }, chorus(0))]).toEqual([]);
  });

  it("ignores section jumps", () => {
    const t: Transport = {
      status: "playing",
      scope: ARR,
      at: TOP,
      jump: { kind: "section", arrIdx: 2 },
    };
    expect(cuedChips(t, chorus(0)).size).toBe(0);
  });
});

describe("positionText", () => {
  it.each<[Transport, string]>([
    [{ status: "playing", scope: ARR, at: TOP }, "Chorus · bar 4/9"],
    [{ status: "paused", scope: ARR, at: TOP }, "Paused · Chorus · bar 4/9"],
    [{ status: "stopped", scope: ARR, cue: TOP }, "Starts at · Chorus · bar 4/9"],
    [{ status: "stopped", scope: ARR }, "Stopped"],
  ])("%j", (t, text) => {
    expect(positionText(t, chorus(3))).toBe(text);
  });
});
