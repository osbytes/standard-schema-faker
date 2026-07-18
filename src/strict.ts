import { AsyncValidateError } from "./errors.js";
import { deriveSeed } from "./rng.js";
import type { AnySchema } from "./types.js";

const DEFAULT_STRICT_RETRIES = 5;

/**
 * `strict: true` correctness strategy: run `schema['~standard'].validate(value)` on the
 * generated value; on failure, retry generation N times with deterministically re-derived
 * seeds, then throw an error containing the validator's issue list.
 *
 * This catches refinements/transforms/cross-field checks that JSON Schema can't express
 * (custom `.refine()`, brands, etc.) — the walker only ever sees the *structural* JSON Schema
 * projection, so a value can be structurally valid yet still fail a vendor's own refinements.
 *
 * ## The async-validate design decision
 *
 * `StandardSchemaV1.Props.validate` is typed `(value) => Result | Promise<Result>` — a vendor
 * MAY validate asynchronously (e.g. a schema with `.refine(async (v) => ...)`). `fake()`/
 * `fakeMany()` stay fully synchronous (same reasoning as `prepare()` for JSON Schema
 * conversion). Rather than fork the public API into sync/async variants for `strict` alone,
 * this module always calls `validate()` and inspects the *immediate* return value:
 *
 *   - If it's a `Result` (not a `Promise`/thenable), proceed synchronously — this is the case
 *     for every vendor tested (Zod v4, Valibot, ArkType) with ordinary (non-async) schemas.
 *   - If it's a `Promise` (a Zod schema with an async `.refine()` does return a real `Promise`
 *     from `validate()`), throw a clear, synchronous error explaining that `strict` mode
 *     requires a vendor/schema whose `validate()` resolves synchronously, naming the vendor.
 *     We do NOT silently await it (that would make `fake()` async only sometimes, depending on
 *     schema shape — worse than a clear upfront error) and we do NOT provide a parallel async
 *     `fake()` (that would fork the public API's synchronous contract).
 */
export function validateStrict(schema: AnySchema, value: unknown): { ok: true } | { ok: false; issues: readonly unknown[] } {
  const vendor = (schema["~standard"] as { vendor?: string }).vendor ?? "unknown vendor";
  const result = schema["~standard"].validate(value);

  if (isPromiseLike(result)) {
    throw new AsyncValidateError(
      `standard-schema-faker: strict mode requires a schema whose ~standard.validate() ` +
        `resolves synchronously (vendor: "${vendor}"). This schema's validate() returned a ` +
        `Promise — likely an async refinement/transform (e.g. .refine(async (v) => ...) in ` +
        `Zod). fake()/fakeMany() are always synchronous per design, so strict mode cannot ` +
        `await it. Options: remove the async refinement for fake-data generation, validate ` +
        `the result yourself after a non-strict fake() call, or drop strict: true.`,
      { vendor },
    );
  }

  if (!result.issues) return { ok: true };
  return { ok: false, issues: result.issues };
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * Re-derives a deterministic sub-seed from a base seed + discriminator, so a whole sequence
 * (a strict-mode retry attempt, or a `fakeMany` batch item that needs its own retry sequence)
 * stays reproducible from the original `baseSeed`.
 */
export function strictRetrySeed(baseSeed: number, discriminator: string | number): number {
  return deriveSeed(baseSeed, `strict-retry-${discriminator}`);
}

export { DEFAULT_STRICT_RETRIES };
