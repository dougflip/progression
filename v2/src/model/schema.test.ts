import { describe, expect, it } from "vitest";
import frozen from "../../fixtures/frozen.json";
import { validateEnvelope } from "./envelope";
import { LibraryStore, type ShareEnvelope } from "./schema";

const raw = import.meta.glob<string>("../../fixtures/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
const fixtures = Object.entries(raw)
  .map(([path, text]) => ({ name: path.split("/").pop()!, text }))
  .filter((f) => f.name !== "frozen.json");

const fixture = (name: string) =>
  JSON.parse(fixtures.find((f) => f.name === name)!.text) as ShareEnvelope;

/** Validate, expecting failure; returns the error lines. */
function errorsFor(input: unknown): string[] {
  const result = validateEnvelope(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

/** Deep-clones a fixture, applies `edit`, and returns the error lines. */
function errorsAfter(name: string, edit: (env: any) => void): string[] {
  const env = structuredClone(fixture(name));
  edit(env);
  return errorsFor(env);
}

describe("fixtures", () => {
  it("exist", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixtures)("$name validates unchanged and says what it exercises", ({ text }) => {
    const input = JSON.parse(text);
    const result = validateEnvelope(input);
    expect(result.ok ? [] : result.errors).toEqual([]);
    // Parsing is validation only: nothing stripped, defaulted or transformed.
    expect(result.ok && result.value).toEqual(input);
    expect(input.$comment).toEqual(expect.any(String));
  });

  // Additive-evolution guard: a committed fixture is never edited or removed, so it
  // stands in for a doc someone saved. If the schema stops accepting it, that's a
  // breaking change. Add new fixtures (and their hashes) instead of editing old ones.
  it.each(fixtures)(
    "$name is frozen (listed in frozen.json with a matching hash)",
    async ({ name, text }) => {
      const canonical = JSON.stringify(JSON.parse(text)); // formatting-insensitive
      const hash = await sha256(canonical);
      expect(frozen, `add "${name}": "${hash}" to frozen.json`).toHaveProperty([name], hash);
    },
  );

  it("every frozen fixture still exists", () => {
    expect(Object.keys(frozen).sort()).toEqual(fixtures.map((f) => f.name).sort());
  });
});

describe("invalid docs are rejected with readable errors", () => {
  const SONG = "song-overrides-slash-pitches.json";
  const BT = "starter-otherside.json";

  it.each<[string, string, (env: any) => void, string]>([
    ["wrong version", BT, (e) => (e.version = 1), "version: Invalid input: expected 2"],
    ["unknown key (agent typo)", BT, (e) => (e.doc.tempoo = 90), 'doc: Unrecognized key: "tempoo"'],
    ["tempo out of range", BT, (e) => (e.doc.tempo = 300), "doc.tempo: Too big"],
    [
      "untrimmed title",
      BT,
      (e) => (e.doc.title = " Otherside"),
      "doc.title: must not have leading",
    ],
    ["empty sections", BT, (e) => (e.doc.sections = []), "doc.sections: Too small"],
    [
      "bad numeral",
      BT,
      (e) => (e.doc.sections[0].progression = "I Q vi"),
      '"Q" is not a Roman-numeral chord',
    ],
    [
      "duplicate section id",
      BT,
      (e) => (e.doc.sections[1].id = "verse"),
      'doc.sections[1].id: duplicate section id "verse"',
    ],
    [
      "dangling arrangement",
      BT,
      (e) => e.doc.arrangement.push("outro"),
      'doc.arrangement[8]: no section with id "outro"',
    ],
    ["bad id characters", BT, (e) => (e.doc.sections[0].id = "a b"), "doc.sections[0].id: ids are"],
    [
      "unknown pitch kind",
      SONG,
      (e) => (e.doc.sections[0].parts.bass[0].pitch = { kind: "midi", note: 40 }),
      "doc.sections[0].parts.bass[0].pitch.kind",
    ],
    [
      "fractional tick",
      SONG,
      (e) => (e.doc.sections[0].chords[0].duration = 191.5),
      "doc.sections[0].chords[0].duration: Invalid input: expected int",
    ],
    [
      "zero duration",
      SONG,
      (e) => (e.doc.sections[0].chords[0].duration = 0),
      "doc.sections[0].chords[0].duration: Too small",
    ],
    [
      "chords out of order",
      SONG,
      (e) => e.doc.sections[0].chords.reverse(),
      "chords must be sorted by start",
    ],
    [
      "overlapping chords",
      SONG,
      (e) => (e.doc.sections[0].chords[0].duration = 200),
      "doc.sections[0].chords[1].start: overlaps the previous chord",
    ],
    // The bridge is 2 bars of 3/4 (its meter override) = 288 ticks, not 384.
    [
      "chord past section end (overridden meter)",
      SONG,
      (e) => (e.doc.sections[1].chords[1].duration = 192),
      "doc.sections[1].chords[1]: ends at tick 336, past the section end (288)",
    ],
    [
      "drum hits unsorted",
      SONG,
      (e) => (e.doc.sections[0].drums.crash = [96, 0]),
      "doc.sections[0].drums.crash[1]: hits must be sorted and unique",
    ],
    [
      "drum hit past end",
      SONG,
      (e) => (e.doc.sections[1].drums.kick = [0, 288]),
      "doc.sections[1].drums.kick[1]: tick 288 is past the section end (288)",
    ],
    [
      "note past end",
      SONG,
      (e) => (e.doc.sections[0].parts.bass[0].start = 768),
      "doc.sections[0].parts.bass[0].start: tick 768 is past",
    ],
    [
      "take longer than section",
      SONG,
      (e) => e.doc.sections[1].loops.push({ id: "t1", name: "Take 1", bars: 3, gain: 1 }),
      "doc.sections[1].loops[0].bars: take is 3 bars; the section has 2",
    ],
    [
      "unresolved custom patch",
      SONG,
      (e) => (e.doc.instruments.bass = { kind: "custom", id: "fat" }),
      'doc.instruments.bass: no patch with id "fat"',
    ],
    [
      "custom patches before Milestone 5",
      SONG,
      (e) => (e.doc.patches = { fat: { kind: "synth" } }),
      "doc.patches.fat: custom patches are not supported yet",
    ],
    [
      "custom cycle without keys",
      SONG,
      (e) => (e.practice.cycle = { kind: "custom", keys: [] }),
      "practice.cycle.keys: Too small",
    ],
    ["missing mute channel", SONG, (e) => delete e.practice.mutes.loops, "practice.mutes.loops"],
  ])("%s", (_label, name, edit, expected) => {
    const errors = errorsAfter(name, edit);
    expect(errors.join("\n")).toContain(expected);
  });

  it("non-objects", () => {
    expect(errorsFor(null)).toEqual(["(root): Invalid input: expected object, received null"]);
    expect(errorsFor("hello")[0]).toMatch(/^\(root\): /);
  });

  it("reports every problem, not just the first", () => {
    const errors = errorsAfter(BT, (e) => {
      e.doc.tempo = 1;
      e.doc.key = "H";
    });
    expect(errors).toHaveLength(2);
  });
});

describe("LibraryStore", () => {
  const doc = fixture("starter-i-vi-ii-v.json").doc;
  const practice = {
    cycle: { kind: "none" },
    advance: "auto",
    mutes: { chords: false, bass: false, drums: false, loops: false },
  };
  const scratch = { kind: "scratch", id: "scratch", doc, practice, updated: 0, state: "pristine" };
  const saved = { kind: "saved", id: "s1", doc, practice, updated: 0, origin: "shared" };

  it("accepts one scratch item and a known current item", () => {
    const store = { version: 1, items: [scratch, saved], currentItemId: "s1" };
    expect(LibraryStore.safeParse(store).success).toBe(true);
  });

  it("rejects zero or two scratch items, and a missing current item", () => {
    const issues = (store: unknown) =>
      LibraryStore.safeParse(store).error?.issues.map((i) => i.message) ?? [];
    expect(issues({ version: 1, items: [saved], currentItemId: "s1" })).toEqual([
      "needs exactly one scratch item, found 0",
    ]);
    expect(
      issues({ version: 1, items: [scratch, { ...scratch, id: "x" }], currentItemId: "x" }),
    ).toEqual(["needs exactly one scratch item, found 2"]);
    expect(issues({ version: 1, items: [scratch], currentItemId: "s1" })).toEqual([
      'no item with id "s1"',
    ]);
  });
});

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
