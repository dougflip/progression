import { describe, expect, it } from "vitest";
import type { StyleDef } from "./progression-core";
import { EXAMPLE_CUSTOM_STYLE, toStyleDef } from "./custom-styles";

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
