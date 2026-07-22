import { describe, expect, it } from "vitest";
import type { StyleDef } from "./progression-core";
import {
  EXAMPLE_CUSTOM_STYLE,
  deleteCustomStyle,
  getCustomStyles,
  saveCustomStyle,
  toStyleDef,
  updateCustomStyle,
} from "./custom-styles";

function makeMockStorage() {
  const store = new Map<string, string>();
  return {
    persist: (key: string, value: string) => store.set(key, value),
    load: (key: string) => store.get(key) ?? null,
  };
}

describe("toStyleDef", () => {
  it("converts a CustomStyleDef into a playable StyleDef", () => {
    // Assigning to an explicitly StyleDef-typed const proves this satisfies
    // AudioStartOpts.style at compile time, with zero engine changes.
    const resolved: StyleDef = toStyleDef(EXAMPLE_CUSTOM_STYLE);

    expect(resolved.simple.bass.major).toHaveLength(16);
    expect(resolved.busy.bass.minor).toHaveLength(16);
    expect(resolved.simple.kick).toEqual(EXAMPLE_CUSTOM_STYLE.simple.kick);
  });

  it("strips identity and multi-bar metadata, keeping only simple/busy", () => {
    const resolved = toStyleDef(EXAMPLE_CUSTOM_STYLE);

    expect(Object.keys(resolved).sort()).toEqual(["busy", "simple"]);
  });
});

describe("custom style storage", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(getCustomStyles(makeMockStorage())).toEqual([]);
  });

  it("returns an empty array instead of throwing on corrupt JSON", () => {
    const storage = makeMockStorage();
    storage.persist("progression-custom-styles-v1", "{not valid json");

    expect(getCustomStyles(storage)).toEqual([]);
  });

  it("round-trips a saved style through JSON", () => {
    const storage = makeMockStorage();
    const { id: _id, ...draft } = EXAMPLE_CUSTOM_STYLE;

    const created = saveCustomStyle(storage, draft);

    expect(created.id).toBeTruthy();
    expect(getCustomStyles(storage)).toEqual([created]);
  });

  it("updates only the targeted style, leaving others untouched", () => {
    const storage = makeMockStorage();
    const { id: _id, ...draft } = EXAMPLE_CUSTOM_STYLE;
    const a = saveCustomStyle(storage, { ...draft, name: "A" });
    const b = saveCustomStyle(storage, { ...draft, name: "B" });

    updateCustomStyle(storage, a.id, { name: "A renamed" });

    const styles = getCustomStyles(storage);
    expect(styles.find((s) => s.id === a.id)?.name).toBe("A renamed");
    expect(styles.find((s) => s.id === b.id)?.name).toBe("B");
  });

  it("deletes only the targeted style, leaving others untouched", () => {
    const storage = makeMockStorage();
    const { id: _id, ...draft } = EXAMPLE_CUSTOM_STYLE;
    const a = saveCustomStyle(storage, { ...draft, name: "A" });
    const b = saveCustomStyle(storage, { ...draft, name: "B" });

    deleteCustomStyle(storage, a.id);

    const styles = getCustomStyles(storage);
    expect(styles.map((s) => s.id)).toEqual([b.id]);
  });
});
