/**
 * custom-styles.ts
 * User-authored styles — same StyleVariant/StyleBassPhrase shape as the
 * built-in styles (see styles.ts), plus identity and multi-bar-readiness
 * metadata. See docs-internal/custom-styles.html for the full feature plan.
 */

import type { PlayerConfig, StyleDef, StyleVariant } from "./progression-core.js";

export interface CustomStyleDef {
  id: string;
  name: string;
  stepsPerBar: number; // always 16 today; carried for future multi-bar patterns
  bars: number; // always 1 today
  simple: StyleVariant;
  busy: StyleVariant;
}

export function toStyleDef(custom: CustomStyleDef): StyleDef {
  return { simple: custom.simple, busy: custom.busy };
}

// ─── Storage ─────────────────────────────────────────────────────────────────
// Mirrors saveUserPreset/_getUserPresets/deleteUserPreset in progression-core.ts:
// same JSON-array-under-one-key shape, same persist/load callback pair (so this
// stays as storage-agnostic as the rest of the app), same id convention. A pure
// storage operation — no playback-state coupling. Deleting the style currently
// selected during playback is Phase 3's concern (resolveStyleDef time), not
// this one — nothing points playback.style at a custom id until Phase 3 exists.

type StorageConfig = Pick<PlayerConfig, "persist" | "load">;

const CUSTOM_STYLES_STORAGE_KEY = "progression-custom-styles-v1";

export function getCustomStyles(storage: StorageConfig): CustomStyleDef[] {
  try {
    return JSON.parse(storage.load(CUSTOM_STYLES_STORAGE_KEY) ?? "[]") as CustomStyleDef[];
  } catch {
    return [];
  }
}

export function saveCustomStyle(
  storage: StorageConfig,
  def: Omit<CustomStyleDef, "id">,
): CustomStyleDef {
  // Date.now().toString(36) alone (saveUserPreset's scheme) collides when two
  // styles are saved within the same millisecond — demonstrated by the update/
  // delete tests below before this suffix was added. A short random suffix is
  // enough entropy to rule that out without pulling in crypto.randomUUID().
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const created: CustomStyleDef = { ...def, id };
  storage.persist(
    CUSTOM_STYLES_STORAGE_KEY,
    JSON.stringify([...getCustomStyles(storage), created]),
  );
  return created;
}

export function updateCustomStyle(
  storage: StorageConfig,
  id: string,
  patch: Partial<Omit<CustomStyleDef, "id">>,
): void {
  const styles = getCustomStyles(storage).map((s) => (s.id === id ? { ...s, ...patch } : s));
  storage.persist(CUSTOM_STYLES_STORAGE_KEY, JSON.stringify(styles));
}

export function deleteCustomStyle(storage: StorageConfig, id: string): void {
  storage.persist(
    CUSTOM_STYLES_STORAGE_KEY,
    JSON.stringify(getCustomStyles(storage).filter((s) => s.id !== id)),
  );
}

// prettier-ignore
export const EXAMPLE_CUSTOM_STYLE: CustomStyleDef = {
  id: "example",
  name: "My Bossa Groove",
  stepsPerBar: 16,
  bars: 1,
  simple: {
    kick:  [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    bass: {
      major: ["R",0,0,0, 0,0,"5",0, "R",0,0,0, 0,0,"5",0],
      minor: ["R",0,0,0, 0,0,"5",0, "R",0,0,0, 0,0,"5",0],
    },
  },
  busy: {
    kick:  [1,0,0,1, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hat:   [1,0,1,0, 1,0,1,1, 1,0,1,0, 1,0,1,1],
    bass: {
      major: ["R",0,"5",0, "3",0,"5",0, "R",0,"5",0, "3",0,"5",0],
      minor: ["R",0,"5",0, "3",0,"5",0, "R",0,"5",0, "3",0,"5",0],
    },
  },
};
