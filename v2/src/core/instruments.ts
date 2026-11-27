/**
 * Instruments, as data: which sound a role plays, what identifies it, which
 * sample sets a song needs, and when a replaced instrument may be disposed. Pure;
 * the engine builds Tone nodes from `InstrumentSpec`s.
 */

import { BUILTIN_PATCHES } from "../model/patches";
import type { SampleSet } from "../model/sampleSets";
import {
  Role,
  type Patch,
  type PatchRef,
  type PatchRole,
  type SampleSetId,
  type Song,
} from "../model/schema";
import { assertNever, type DeepReadonly } from "../model/types";

type R<T> = DeepReadonly<T>;

/** What the engine builds for a role: a drum kit (code) or a patch (data). */
export type InstrumentSpec =
  | { kind: "kit"; id: "kit-v1" }
  | { kind: "patch"; role: PatchRole; patch: R<Patch> };

/** Resolves a role's `PatchRef` against the song. Throws on refs validation rejects. */
export function instrumentSpec(song: R<Song>, role: Role, ref: R<PatchRef>): InstrumentSpec {
  const patch = resolvePatch(song, ref);
  switch (role) {
    case "drums":
      if (patch !== "kit-v1") throw new Error(`drums need a kit, not ${describe(ref)}`);
      return { kind: "kit", id: "kit-v1" };
    case "chords":
    case "bass":
      if (patch === "kit-v1" || patch.role !== role) {
        throw new Error(`${describe(ref)} can't play ${role}`);
      }
      return { kind: "patch", role, patch };
    default:
      return assertNever(role);
  }
}

function resolvePatch(song: R<Song>, ref: R<PatchRef>): R<Patch> | "kit-v1" {
  switch (ref.kind) {
    case "builtin":
      return ref.id === "kit-v1" ? "kit-v1" : BUILTIN_PATCHES[ref.id];
    case "custom": {
      const patch = song.patches[ref.id];
      if (!patch) throw new Error(`no patch with id "${ref.id}" in patches`);
      return patch;
    }
    default:
      return assertNever(ref);
  }
}

const describe = (ref: R<PatchRef>) => `${ref.kind} patch "${ref.id}"`;

/**
 * Identifies an instrument by what it sounds like, not by its ref: editing a
 * custom patch gives a new key (a new instrument from the next bar), and two refs
 * to identical patches share one.
 */
export function instrumentKey(spec: InstrumentSpec): string {
  switch (spec.kind) {
    case "kit":
      return `kit:${spec.id}`;
    case "patch":
      return `patch:${spec.role}:${stableJson(spec.patch)}`;
    default:
      return assertNever(spec);
  }
}

/** JSON with object keys sorted, so equal patches give equal strings. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Every role's refs in the song: the defaults plus each section's overrides. */
function songRefs(song: R<Song>): { role: Role; ref: R<PatchRef> }[] {
  return [
    ...Role.options.map((role) => ({ role, ref: song.instruments[role] })),
    ...song.sections.flatMap((s) =>
      Role.options.flatMap((role) => {
        const ref = s.overrides.instruments?.[role];
        return ref ? [{ role, ref }] : [];
      }),
    ),
  ];
}

/** Keys of every instrument the song can play. Anything else is a replaced instrument. */
export function songInstrumentKeys(song: R<Song>): Set<string> {
  return new Set(
    songRefs(song).map(({ role, ref }) => instrumentKey(instrumentSpec(song, role, ref))),
  );
}

/** Sample sets the song's instruments use (each once). Load them before playing. */
export function songSampleSets(song: R<Song>): SampleSetId[] {
  const ids = new Set<SampleSetId>();
  for (const { role, ref } of songRefs(song)) {
    const spec = instrumentSpec(song, role, ref);
    if (spec.kind === "patch" && spec.patch.kind === "sampler") ids.add(spec.patch.set);
  }
  return [...ids];
}

/** Longest a kit hit rings (v1's crash sample, with room to spare). */
const KIT_TAIL = 4;

/**
 * Seconds an instrument may still sound after its last note ends: the release
 * plus every effect's tail. After that it is silent and may be disposed.
 */
export function tailSeconds(
  spec: InstrumentSpec,
  sets: Readonly<Record<string, SampleSet>>,
): number {
  switch (spec.kind) {
    case "kit":
      return KIT_TAIL;
    case "patch": {
      const p = spec.patch;
      const release = ((): number => {
        switch (p.kind) {
          case "synth":
            return Math.max(p.envelope.release, p.filter?.envelope?.release ?? 0);
          case "sampler":
            return p.release ?? sets[p.set]?.release ?? 0;
          default:
            return assertNever(p);
        }
      })();
      return release + (p.effects ?? []).reduce((sum, e) => sum + effectTail(e), 0);
    }
    default:
      return assertNever(spec);
  }
}

function effectTail(effect: R<NonNullable<Patch["effects"]>[number]>): number {
  switch (effect.kind) {
    case "reverb":
      return effect.decay;
    default:
      return assertNever(effect.kind); // one-member union: narrow on the tag
  }
}

/** How long an instrument has been used for, as the engine tracks it. */
export interface InstrumentUse {
  key: string;
  /** Context time its last scheduled note ends. */
  lastEnd: number;
  /** `tailSeconds` of its spec. */
  tail: number;
}

/**
 * Instruments to dispose: no longer in the song and silent by `now`. An
 * instrument the song still uses (e.g. another section's override) is kept, so
 * switching sections never rebuilds it.
 */
export function instrumentsToDispose(
  uses: readonly InstrumentUse[],
  inSong: ReadonlySet<string>,
  now: number,
): string[] {
  return uses.filter((u) => !inSong.has(u.key) && u.lastEnd + u.tail < now).map((u) => u.key);
}
