import { describe, expect, it } from "vitest";
import type { StyleDef } from "./progression-core";
import {
  CUSTOM_STYLE_INSTRUMENTS,
  type CustomStyleDef,
  cycleBassStep,
  customStyleIdFromRef,
  deleteCustomStyle,
  draftToStyleVariant,
  fillBlankVariantFromOther,
  getCustomStyles,
  isBlankStyleVariantDraft,
  isCustomStyleRef,
  makeBlankStyleVariantDraft,
  resolveStyleDef,
  saveCustomStyle,
  styleVariantToDraft,
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

// prettier-ignore
const EXAMPLE_CUSTOM_STYLE: CustomStyleDef = {
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

describe("makeBlankStyleVariantDraft", () => {
  it("has all-zero 16-step patterns for every instrument and bass", () => {
    const draft = makeBlankStyleVariantDraft();
    CUSTOM_STYLE_INSTRUMENTS.forEach((inst) => {
      expect(draft[inst]).toEqual(Array.from({ length: 16 }, () => 0));
    });
    expect(draft.bass).toEqual(Array.from({ length: 16 }, () => 0));
  });
});

describe("styleVariantToDraft", () => {
  it("fills in a blank pattern for an instrument missing from the variant", () => {
    const draft = styleVariantToDraft({
      kick: EXAMPLE_CUSTOM_STYLE.simple.kick!,
      bass: EXAMPLE_CUSTOM_STYLE.simple.bass,
    });
    expect(draft.kick).toEqual(EXAMPLE_CUSTOM_STYLE.simple.kick);
    expect(draft.snare).toEqual(Array.from({ length: 16 }, () => 0));
  });

  it("takes the major bass pattern, not minor", () => {
    const major = ["R", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
    const minor = ["3", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
    const draft = styleVariantToDraft({
      bass: { major: [...major], minor: [...minor] },
    });
    expect(draft.bass).toEqual(major);
    expect(draft.bass).not.toEqual(minor);
  });
});

describe("draftToStyleVariant", () => {
  it("expands the single bass pattern into identical major/minor copies", () => {
    const draft = styleVariantToDraft(EXAMPLE_CUSTOM_STYLE.simple);
    const variant = draftToStyleVariant(draft);
    expect(variant.bass.major).toEqual(draft.bass);
    expect(variant.bass.minor).toEqual(draft.bass);
    expect(variant.bass.major).not.toBe(variant.bass.minor); // independent copies, not aliased
  });

  it("round-trips drum patterns unchanged", () => {
    const draft = styleVariantToDraft(EXAMPLE_CUSTOM_STYLE.simple);
    const variant = draftToStyleVariant(draft);
    expect(variant.kick).toEqual(EXAMPLE_CUSTOM_STYLE.simple.kick);
  });
});

describe("cycleBassStep", () => {
  it("cycles R -> 3 -> 5 -> rest -> R", () => {
    expect(cycleBassStep("R")).toBe("3");
    expect(cycleBassStep("3")).toBe("5");
    expect(cycleBassStep("5")).toBe(0);
    expect(cycleBassStep(0)).toBe("R");
  });
});

describe("isBlankStyleVariantDraft", () => {
  it("is true for a fresh blank draft", () => {
    expect(isBlankStyleVariantDraft(makeBlankStyleVariantDraft())).toBe(true);
  });

  it("is false once any single drum cell is set", () => {
    const draft = makeBlankStyleVariantDraft();
    draft.kick[0] = 1;
    expect(isBlankStyleVariantDraft(draft)).toBe(false);
  });

  it("is false once any single bass cell is set", () => {
    const draft = makeBlankStyleVariantDraft();
    draft.bass[0] = "R";
    expect(isBlankStyleVariantDraft(draft)).toBe(false);
  });
});

describe("fillBlankVariantFromOther", () => {
  it("mirrors busy into simple when simple was never touched", () => {
    const busy = styleVariantToDraft(EXAMPLE_CUSTOM_STYLE.busy);
    const result = fillBlankVariantFromOther({ simple: makeBlankStyleVariantDraft(), busy });
    expect(result.simple).toEqual(busy);
    expect(result.simple).not.toBe(busy); // independent copy, not aliased
  });

  it("mirrors simple into busy when busy was never touched", () => {
    const simple = styleVariantToDraft(EXAMPLE_CUSTOM_STYLE.simple);
    const result = fillBlankVariantFromOther({ simple, busy: makeBlankStyleVariantDraft() });
    expect(result.busy).toEqual(simple);
    expect(result.busy).not.toBe(simple);
  });

  it("leaves both untouched when both are blank", () => {
    const draft = { simple: makeBlankStyleVariantDraft(), busy: makeBlankStyleVariantDraft() };
    expect(fillBlankVariantFromOther(draft)).toBe(draft);
  });

  it("leaves both untouched when both already have content", () => {
    const draft = {
      simple: styleVariantToDraft(EXAMPLE_CUSTOM_STYLE.simple),
      busy: styleVariantToDraft(EXAMPLE_CUSTOM_STYLE.busy),
    };
    expect(fillBlankVariantFromOther(draft)).toBe(draft);
  });
});
