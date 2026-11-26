/** Practice editing rules: cycle changes and custom key lists. Pure. */

import { KeyName, type Cycle, type Practice } from "../model/schema";
import type { DeepReadonly, NonEmpty } from "../model/types";

export type KeyListResult = { ok: true; keys: NonEmpty<KeyName> } | { ok: false; error: string };

/**
 * Reads a custom cycle's keys from text, e.g. "A E D G", "bb, f#", "E♭ B♭".
 * Case-insensitive; ♭/♯ are accepted; spelling is kept (F# and Gb differ).
 */
export function parseKeyList(text: string): KeyListResult {
  const tokens = text
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: "enter at least one key, e.g. A E D G" };
  const keys: KeyName[] = [];
  for (const t of tokens) {
    const name = t[0]!.toUpperCase() + t.slice(1).toLowerCase();
    const parsed = KeyName.safeParse(name);
    if (!parsed.success) return { ok: false, error: `"${t}" is not a key` };
    keys.push(parsed.data);
  }
  return { ok: true, keys: keys as NonEmpty<KeyName> };
}

export type CycleKind = Cycle["kind"];

/**
 * A practice with a new cycle. `custom` needs its keys (the UI remembers the list
 * while another cycle is chosen, since the saved data drops it).
 */
export function withCycle(
  practice: DeepReadonly<Practice>,
  kind: CycleKind,
  customKeys?: NonEmpty<KeyName>,
): Practice {
  const base = structuredClone(practice) as Practice;
  switch (kind) {
    case "none":
    case "fourths":
    case "fifths":
      return { ...base, cycle: { kind } };
    case "custom":
      if (!customKeys) throw new Error("a custom cycle needs its keys");
      return { ...base, cycle: { kind, keys: [...customKeys] as NonEmpty<KeyName> } };
  }
}
