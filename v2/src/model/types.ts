/** Type utilities shared by the model. */

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/**
 * Mapped type, so arrays and tuples (incl. `NonEmpty`) keep their shape.
 * Primitives pass through first, so branded ids (`string & brand`) stay strings.
 */
export type DeepReadonly<T> = T extends Primitive
  ? T
  : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** At least one element. Matches what Zod's `.nonempty()` infers. */
export type NonEmpty<T> = [T, ...T[]];

/** Exhaustive-switch guard: `default: return assertNever(x)`. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}

/** Freezes a value and everything inside it. Returns the same value. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * Dev builds (and tests) freeze docs as they enter the app, so changing one in
 * place throws instead of silently breaking caches and the engine's snapshots.
 * Production skips the cost.
 */
export const freezeInDev: <T>(value: T) => T =
  // `import.meta.env` only exists under Vite; plain Node scripts (e.g. the agent tool) skip freezing.
  import.meta.env?.DEV ? deepFreeze : (v) => v;
