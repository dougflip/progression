/**
 * Small pure rules the player components share: which position to show, which
 * chips are cued, the position line. Kept out of the components so they're tested.
 */

import type { ChipView, PlayerView } from "../../core/view";
import type { Position, Transport } from "../../model/runtime";

export const TOP: Position = { arrIdx: 0, lap: 0, bar: 0 };

/** The position the player shows: the audible bar while playing, else where ▶ starts. */
export function shownPosition(transport: Transport, audible: Position | undefined): Position {
  switch (transport.status) {
    case "playing":
      return audible ?? transport.at;
    case "paused":
      return transport.at;
    case "stopped":
      return transport.cue ?? TOP;
  }
}

/** The bar a jump or cue will land on in the shown section, if any. */
export function cuedBar(transport: Transport, view: PlayerView): number | undefined {
  switch (transport.status) {
    case "playing": {
      const j = transport.jump;
      if (j?.kind !== "chord") return undefined;
      return view.arrIdx === undefined || j.arrIdx === view.arrIdx ? j.bar : undefined;
    }
    case "paused":
      return transport.at.bar;
    case "stopped":
      return transport.cue?.bar;
  }
}

/** Jumps land on a bar, so every chord sounding in that bar is outlined. */
export function cuedChips(transport: Transport, view: PlayerView): Set<number> {
  const bar = cuedBar(transport, view);
  return new Set(
    bar === undefined
      ? []
      : view.chips.filter((c) => c.bars.includes(bar)).map((c) => c.chordIndex),
  );
}

/** Which of a chip's bar-progress dots is current (−1 when the bar isn't in the chip). */
export function chipBarIndex(chip: ChipView, bar: number): number {
  return chip.bars.indexOf(bar);
}

/** The action bar's position line, e.g. "Paused · Verse · bar 3". */
export function positionText(transport: Transport, view: PlayerView): string {
  const where = `${view.section.name} · bar ${view.section.bar + 1}/${view.section.bars}`;
  switch (transport.status) {
    case "playing":
      return where;
    case "paused":
      return `Paused · ${where}`;
    case "stopped":
      return transport.cue ? `Starts at · ${where}` : "Stopped";
  }
}
