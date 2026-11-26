import { describe, expect, it } from "vitest";
import { decodeEnvelope, encodeEnvelope, validateEnvelope } from "./envelope";

const fixtures = import.meta.glob<unknown>("../../fixtures/*.json", {
  import: "default",
  eager: true,
});
const envelopes = Object.entries(fixtures)
  .filter(([path]) => !path.endsWith("/frozen.json"))
  .map(([path, env]) => ({ name: path.split("/").pop()!, env }));

describe("encode → decode", () => {
  it.each(envelopes)("round-trips $name", async ({ env }) => {
    const param = await encodeEnvelope(validated(env));
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/); // URL-safe, no padding
    const decoded = await decodeEnvelope(param);
    expect(decoded).toEqual(env);
    expect(validateEnvelope(decoded).ok).toBe(true);
  });

  it("compresses (a starter fits comfortably in a URL)", async () => {
    const otherside = envelopes.find((e) => e.name === "starter-otherside.json")!.env;
    const param = await encodeEnvelope(validated(otherside));
    expect(param.length).toBeLessThan(JSON.stringify(otherside).length);
    expect(param.length).toBeLessThan(1000);
  });

  it("handles non-ASCII text", async () => {
    const env = structuredClone(validated(envelopes[0]!.env));
    env.doc.title = "♫ Café — 日本";
    expect(await decodeEnvelope(await encodeEnvelope(env))).toEqual(env);
  });
});

describe("decodeEnvelope rejects malformed params", () => {
  it.each([
    ["not base64url", "abc$def"],
    ["not deflate data", "aGVsbG8"],
    ["empty", ""],
  ])("%s", async (_label, param) => {
    await expect(decodeEnvelope(param)).rejects.toThrow();
  });
});

function validated(input: unknown) {
  const result = validateEnvelope(input);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.value;
}
