/** The pure core: everything between "a doc" and "a bar of notes". */

import type { Transforms } from "../model/runtime";
import { generateSong, regenerateSection } from "./generate";
import { scheduleBar } from "./schedule";
import { effectiveSettings, lapKeys } from "./settings";
import { clampPosition, nextPosition } from "./transport";

/** Type-checks the implementations against the `Transforms` contract. */
export const CORE: Transforms = {
  generateSong,
  regenerateSection,
  effectiveSettings,
  lapKeys,
  scheduleBar,
  nextPosition,
  clampPosition,
};

export { STYLES } from "./styles";
export { DEFAULT_PRACTICE } from "./settings";
export { changeScope } from "./transport";
export {
  playerView,
  sectionSettings,
  type PlayerView,
  type ChipView,
  type SectionSettings,
} from "./view";
