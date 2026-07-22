import { describe, expect, it } from "vitest";
import type { StyleDef } from "./progression-core";
import {
  EXAMPLE_CUSTOM_STYLE,
  customStyleIdFromRef,
  deleteCustomStyle,
  getCustomStyles,
  isCustomStyleRef,
  resolveStyleDef,
  saveCustomStyle,
  toCustomStyleId,
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

describe("custom style id refs", () => {
  it("round-trips an id through toCustomStyleId/customStyleIdFromRef", () => {
    expect(customStyleIdFromRef(toCustomStyleId("abc123"))).toBe("abc123");
  });

  it("recognizes a custom ref vs. a plain built-in name", () => {
    expect(isCustomStyleRef(toCustomStyleId("abc123"))).toBe(true);
    expect(isCustomStyleRef("funk")).toBe(false);
  });
});

describe("resolveStyleDef", () => {
  const builtins = {
    funk: { simple: EXAMPLE_CUSTOM_STYLE.simple, busy: EXAMPLE_CUSTOM_STYLE.busy },
  };
  const fallback: StyleDef = {
    simple: EXAMPLE_CUSTOM_STYLE.busy,
    busy: EXAMPLE_CUSTOM_STYLE.simple,
  };

  it("resolves a built-in name directly", () => {
    expect(resolveStyleDef("funk", [], builtins, fallback)).toBe(builtins["funk"]);
  });

  it("falls back for an unknown built-in name", () => {
    expect(resolveStyleDef("nonexistent", [], builtins, fallback)).toBe(fallback);
  });

  it("resolves a custom ref to the matching custom style", () => {
    const ref = toCustomStyleId(EXAMPLE_CUSTOM_STYLE.id);
    const resolved = resolveStyleDef(ref, [EXAMPLE_CUSTOM_STYLE], builtins, fallback);
    expect(resolved).toEqual(toStyleDef(EXAMPLE_CUSTOM_STYLE));
  });

  it("falls back when a custom ref's id isn't found locally", () => {
    // e.g. a shared URL from a device that doesn't have this custom style saved
    const ref = toCustomStyleId("does-not-exist");
    expect(resolveStyleDef(ref, [EXAMPLE_CUSTOM_STYLE], builtins, fallback)).toBe(fallback);
  });
});
