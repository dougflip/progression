/** Type utilities shared by the model. */

/** Mapped type, so arrays and tuples (incl. `NonEmpty`) keep their shape. */
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

/** At least one element. Matches what Zod's `.nonempty()` infers. */
export type NonEmpty<T> = [T, ...T[]];

/** Exhaustive-switch guard: `default: return assertNever(x)`. */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
}
