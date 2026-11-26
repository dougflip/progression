/**
 * Transport rules: where playback goes after each bar. Pure.
 *
 * - A lap ends when the arrangement completes (auto advance), or at the end of the
 *   section when looping one section. In manual advance the section repeats and the
 *   lap ends only when a key jump is queued.
 * - At the end of a lap the key moves to the next lap, or to a queued key jump.
 * - A queued section jump waits for the current section to finish, then lands on
 *   the target's first bar (like cueing "chorus next" mid-verse).
 * - A queued chord jump lands at the next bar, on the chord's bar.
 * - A landing jump replaces where playback would have gone; a lap that ended still ends.
 */

import type { Song } from "../model/schema";
import type { DeepReadonly } from "../model/types";
import type { EngineSource, PlayScope, Position, Transport } from "../model/runtime";
import { sectionIdAt } from "./schedule";
import { findSection, lapKeys } from "./settings";

type Playing = Extract<Transport, { status: "playing" }>;

export function nextPosition(source: EngineSource, transport: Playing): Playing {
  const { song, practice } = source;
  const { at, scope, jump, keyJump } = transport;
  const laps = lapKeys(song, practice).length;
  const section = findSection(song, sectionIdAt(source, at, scope));
  const endOfSection = at.bar + 1 >= section.bars;
  const manual = practice.advance === "manual";

  let next: Position;
  let lapEnded = false;
  if (!endOfSection) {
    next = { ...at, bar: at.bar + 1 };
  } else if (scope.kind === "section") {
    next = { ...at, bar: 0 };
    lapEnded = !manual || keyJump !== undefined;
  } else if (manual) {
    next = { ...at, bar: 0 };
    lapEnded = keyJump !== undefined;
  } else {
    const last = at.arrIdx + 1 >= song.arrangement.length;
    next = { ...at, arrIdx: last ? 0 : at.arrIdx + 1, bar: 0 };
    lapEnded = last;
  }

  if (lapEnded) next.lap = keyJump !== undefined ? keyJump % laps : (at.lap + 1) % laps;
  const lands = jump !== undefined && (jump.kind === "chord" || endOfSection);
  if (jump && lands) {
    next =
      jump.kind === "section"
        ? { ...next, arrIdx: jump.arrIdx, bar: 0 }
        : { ...next, arrIdx: jump.arrIdx, bar: jump.bar };
  }

  const result: Playing = { status: "playing", scope, at: next };
  if (jump && !lands) result.jump = jump;
  if (keyJump !== undefined && !lapEnded) result.keyJump = keyJump;
  return result;
}

/**
 * A saved position made invalid by edits is clamped, never discarded: a missing
 * arrangement entry → the first; a bar past the end → bar 0.
 */
export function clampPosition(song: DeepReadonly<Song>, at: Position, scope: PlayScope): Position {
  const arrIdx = at.arrIdx >= 0 && at.arrIdx < song.arrangement.length ? at.arrIdx : 0;
  const sectionId = scope.kind === "section" ? scope.sectionId : song.arrangement[arrIdx]!;
  const section = song.sections.find((s) => s.id === sectionId) ?? song.sections[0]!;
  const bar = at.bar >= 0 && at.bar < section.bars ? at.bar : 0;
  return { arrIdx, lap: Math.max(0, at.lap), bar };
}

/**
 * Where playback stands after switching scope (e.g. the section editor's loop toggle).
 * - Into a section loop: same bar if the section has it, else bar 0. `arrIdx` is kept
 *   so leaving the loop can return to the same arrangement entry.
 * - Out of a section loop: back to `at.arrIdx` if that entry is the looped section,
 *   otherwise the section's first arrangement entry (the first entry if it isn't in
 *   the arrangement). The bar is kept when it fits.
 */
export function changeScope(
  song: DeepReadonly<Song>,
  at: Position,
  from: PlayScope,
  to: PlayScope,
): Position {
  if (to.kind === "section") return clampPosition(song, at, to);
  if (from.kind === "arrangement") return clampPosition(song, at, to);
  const arrIdx =
    song.arrangement[at.arrIdx] === from.sectionId
      ? at.arrIdx
      : Math.max(0, song.arrangement.indexOf(from.sectionId));
  return clampPosition(song, { ...at, arrIdx }, to);
}
