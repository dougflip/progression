/**
 * Share links: ShareEnvelope ⇄ URL param. JSON → deflate-raw → base64url.
 * Every way in (links, imports, agent output) goes through `validateEnvelope`.
 */

import { z } from "zod";
import { ShareEnvelope } from "./schema";
import type { DeepReadonly } from "./types";

export type ValidationResult = { ok: true; value: ShareEnvelope } | { ok: false; errors: string[] };

/** Schema validation with one readable line per problem, e.g. `doc.sections[0].bars: …`. */
export function validateEnvelope(input: unknown): ValidationResult {
  const result = ShareEnvelope.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, errors: result.error.issues.map(formatIssue) };
}

function formatIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length ? z.core.toDotPath(issue.path) : "(root)";
  return `${path}: ${issue.message}`;
}

export async function encodeEnvelope(env: DeepReadonly<ShareEnvelope>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(env));
  const compressed = await pipe(bytes, new CompressionStream("deflate-raw"));
  return toBase64Url(compressed);
}

/** Returns untrusted data: always follow with `validateEnvelope`. Throws on a malformed param. */
export async function decodeEnvelope(param: string): Promise<unknown> {
  const bytes = await pipe(fromBase64Url(param), new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("not a base64url string");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
