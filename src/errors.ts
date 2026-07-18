/**
 * Error classes for this library, replacing ad-hoc `new Error("standard-schema-faker: ...")`
 * throws with a typed hierarchy carrying structured data alongside the message — mirroring
 * `@standard-schema/utils`' own `SchemaError` precedent (a Standard-Schema-ecosystem class that
 * carries `issues` as real data, not just baked into a string) for exactly this kind of thing.
 *
 * The existing helpful message TEXT is unchanged (still prefixed `"standard-schema-faker: ..."`
 * and full of context) — only the THROWN VALUE changes, from a bare `Error` to one of these
 * subclasses, so callers can `catch` and `instanceof`-narrow to the specific failure instead of
 * string-matching `error.message`, and read the structured fields (`issues`, `attempts`,
 * `seed`, `vendor`, `ref`) directly instead of re-parsing them out of the message.
 */

/** Base class for every error this library throws. `catch (e) { if (e instanceof SchemaFakerError) ... }` catches all of them at once. */
export class SchemaFakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaFakerError";
  }
}

/**
 * `strict: true` exhausted its retry budget: every attempt's generated value still failed the
 * schema's own `~standard.validate()`. Thrown by `strict.ts`/index.ts's `generateStrict`.
 */
export class StrictModeError extends SchemaFakerError {
  /** The last attempt's validation issues (whatever shape the vendor's `validate()` returned). */
  readonly issues: readonly unknown[];
  /** How many attempts were made (1 + the configured retry count). */
  readonly attempts: number;
  /** The original base seed the whole retry sequence was derived from. */
  readonly seed: number;

  constructor(message: string, params: { issues: readonly unknown[]; attempts: number; seed: number }) {
    super(message);
    this.name = "StrictModeError";
    this.issues = params.issues;
    this.attempts = params.attempts;
    this.seed = params.seed;
  }
}

/**
 * `strict: true` requires a schema whose `~standard.validate()` resolves SYNCHRONOUSLY (see
 * strict.ts's design-decision doc comment) — thrown when a schema's `validate()` returns a
 * `Promise` instead (e.g. a Zod schema with an async `.refine()`).
 */
export class AsyncValidateError extends SchemaFakerError {
  /** The schema's `~standard.vendor` string (e.g. `"zod"`), or `"unknown vendor"` if absent. */
  readonly vendor: string;

  constructor(message: string, params: { vendor: string }) {
    super(message);
    this.name = "AsyncValidateError";
    this.vendor = params.vendor;
  }
}

/**
 * Could not derive a JSON Schema document for a Standard Schema — thrown by `to-json-schema.ts`
 * for both failure modes it distinguishes: no native `~standard.jsonSchema` surface AND the
 * `@standard-community/standard-json` fallback hasn't been warmed up yet via `prepare()`; or a
 * vendor whose fallback conversion doesn't support the requested `io` projection at all.
 */
export class JsonSchemaConversionError extends SchemaFakerError {
  /** The schema's `~standard.vendor` string (e.g. `"valibot"`), or `"unknown vendor"` if absent. */
  readonly vendor: string;

  constructor(message: string, params: { vendor: string }) {
    super(message);
    this.name = "JsonSchemaConversionError";
    this.vendor = params.vendor;
  }
}

/**
 * An array with `uniqueItems: true` whose item schema's value space is too small to satisfy
 * `minItems` distinct values (e.g. a boolean-item array with `minItems: 5` — only 2 distinct
 * values exist). Thrown by walker.ts's `generateUniqueArray`.
 */
export class UniqueItemsError extends SchemaFakerError {
  constructor(message: string) {
    super(message);
    this.name = "UniqueItemsError";
  }
}

/** A `$ref` pointer the walker could not resolve against the root JSON Schema document. Thrown by walker.ts's `resolveRef`. */
export class UnresolvableRefError extends SchemaFakerError {
  /** The unresolved `$ref` string, e.g. `"#/$defs/Missing"`. */
  readonly ref: string;

  constructor(message: string, params: { ref: string }) {
    super(message);
    this.name = "UnresolvableRefError";
    this.ref = params.ref;
  }
}
