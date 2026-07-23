/**
 * custom-styles.ts
 * User-authored styles — same StyleVariant/StyleBassPhrase shape as the
 * built-in styles (see styles.ts), plus identity and multi-bar-readiness
 * metadata. See docs-internal/custom-styles.html for the full feature plan.
 */

import type {
  BassPattern,
  BassStep,
  DrumPattern,
  PlayerConfig,
  StyleDef,
  StyleVariant,
} from "./progression-core.js";

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

// ─── Playback resolution ─────────────────────────────────────────────────────
// playback.style stays a plain string (same field, no new AppState shape) —
// a custom selection is disambiguated from a built-in name with this prefix.

export const CUSTOM_STYLE_PREFIX = "custom:";

export function toCustomStyleId(id: string): string {
  return `${CUSTOM_STYLE_PREFIX}${id}`;
}

export function isCustomStyleRef(styleId: string): boolean {
  return styleId.startsWith(CUSTOM_STYLE_PREFIX);
}

export function customStyleIdFromRef(styleId: string): string {
  return styleId.slice(CUSTOM_STYLE_PREFIX.length);
}

export function resolveStyleDef(
  styleId: string,
  customStyles: CustomStyleDef[],
  builtins: Record<string, StyleDef>,
  fallback: StyleDef,
): StyleDef {
  if (isCustomStyleRef(styleId)) {
    const found = customStyles.find((s) => s.id === customStyleIdFromRef(styleId));
    return found ? toStyleDef(found) : fallback; // e.g. a shared URL from a device without it
  }
  return builtins[styleId] ?? fallback;
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

// ─── Editor support ──────────────────────────────────────────────────────────
// The grid editor (Phase 4) only shows ONE bass row per variant, not
// major/minor sub-tabs (see the "Bass major/minor" decision in the design
// doc) — so the in-editor draft shape carries a single BassPattern, expanded
// to {major, minor} copies only when converted back to a real StyleVariant.

export const CUSTOM_STYLE_INSTRUMENTS = [
  "kick",
  "snare",
  "hat",
  "hatOpen",
  "crash",
  "ride",
  "rideBell",
  "tom",
  "tom2",
] as const;

export type CustomStyleInstrument = (typeof CUSTOM_STYLE_INSTRUMENTS)[number];

export const CUSTOM_STYLE_INSTRUMENT_LABELS: Record<CustomStyleInstrument, string> = {
  kick: "Kick",
  snare: "Snare",
  hat: "Hat",
  hatOpen: "Hat (Open)",
  crash: "Crash",
  ride: "Ride",
  rideBell: "Ride Bell",
  tom: "Tom 1",
  tom2: "Tom 2",
};

export type StyleVariantDraft = Record<CustomStyleInstrument, DrumPattern> & { bass: BassPattern };

// prettier-ignore
function blankDrumPattern(): DrumPattern {
  return [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
}

// prettier-ignore
function blankBassPattern(): BassPattern {
  return [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
}

export function makeBlankStyleVariantDraft(): StyleVariantDraft {
  const draft = {} as StyleVariantDraft;
  CUSTOM_STYLE_INSTRUMENTS.forEach((inst) => {
    draft[inst] = blankDrumPattern();
  });
  draft.bass = blankBassPattern();
  return draft;
}

// Loading an existing style into the editor: missing instruments become
// blank rows (matches how built-ins already omit unused instruments), and
// only the major bass pattern is shown — if major/minor genuinely differ
// (some built-ins do, e.g. a trailing note that resolves differently), the
// minor-specific version is not recoverable through this single-row editor.
export function styleVariantToDraft(variant: StyleVariant): StyleVariantDraft {
  const draft = {} as StyleVariantDraft;
  CUSTOM_STYLE_INSTRUMENTS.forEach((inst) => {
    draft[inst] = variant[inst] ?? blankDrumPattern();
  });
  draft.bass = variant.bass.major;
  return draft;
}

export function draftToStyleVariant(draft: StyleVariantDraft): StyleVariant {
  const { bass, ...drums } = draft;
  // Independent copies, not a shared reference — see the "Bass major/minor"
  // decision in the design doc: a future "edit minor separately" feature
  // needs a real, independently-mutable array here, not an alias of major.
  return { ...drums, bass: { major: [...bass] as BassPattern, minor: [...bass] as BassPattern } };
}

export function isBlankStyleVariantDraft(draft: StyleVariantDraft): boolean {
  return (
    CUSTOM_STYLE_INSTRUMENTS.every((inst) => draft[inst].every((step) => step === 0)) &&
    draft.bass.every((step) => step === 0)
  );
}

export function cloneStyleVariantDraft(draft: StyleVariantDraft): StyleVariantDraft {
  const cloned = {} as StyleVariantDraft;
  CUSTOM_STYLE_INSTRUMENTS.forEach((inst) => {
    cloned[inst] = [...draft[inst]] as DrumPattern;
  });
  cloned.bass = [...draft.bass] as BassPattern;
  return cloned;
}

export function styleVariantDraftsEqual(a: StyleVariantDraft, b: StyleVariantDraft): boolean {
  return (
    CUSTOM_STYLE_INSTRUMENTS.every((inst) => a[inst].every((step, i) => step === b[inst][i])) &&
    a.bass.every((step, i) => step === b.bass[i])
  );
}

// Fixes the "silent variant" trap: a brand-new style starts both Simple and
// Busy blank, and it's easy to only fill in whichever tab happened to be
// open, leaving the other silent at playback — the more likely to bite since
// DEFAULTS.playback.bass is "busy", not "simple". Rather than mirroring once
// at the first save and letting the two drift apart on every edit after
// that, a variant that was linked (blank, or equal to the other) when the
// editor was *opened* keeps mirroring its twin on every save, as long as
// only one side was actually edited this session — so a player who only
// ever wants to maintain a single pattern never has to duplicate an edit by
// hand. Edit both sides in the same sitting and neither counts as "the
// untouched one," so nothing is forced; from then on the two are
// independently forked (comparing unequal at the next open) and stay that
// way. `original` is a snapshot of the draft as it was when the editor
// opened (blank drafts, for a style that's never been saved) — not the
// persisted value — so this measures edits made *this session*, regardless
// of how the two variants got to their starting state.
export function resolveLinkedVariants(
  current: { simple: StyleVariantDraft; busy: StyleVariantDraft },
  original: { simple: StyleVariantDraft; busy: StyleVariantDraft },
): { simple: StyleVariantDraft; busy: StyleVariantDraft } {
  const wasLinked = styleVariantDraftsEqual(original.simple, original.busy);
  const simpleTouched = !styleVariantDraftsEqual(current.simple, original.simple);
  const busyTouched = !styleVariantDraftsEqual(current.busy, original.busy);
  if (wasLinked && simpleTouched && !busyTouched) {
    return { simple: current.simple, busy: cloneStyleVariantDraft(current.simple) };
  }
  if (wasLinked && busyTouched && !simpleTouched) {
    return { simple: cloneStyleVariantDraft(current.busy), busy: current.busy };
  }
  return current;
}

export function cycleBassStep(step: BassStep): BassStep {
  const order: BassStep[] = ["R", "3", "5", 0];
  return order[(order.indexOf(step) + 1) % order.length]!;
}
