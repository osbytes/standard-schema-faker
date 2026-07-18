import { toJsonSchema as fallbackToJsonSchema } from "@standard-community/standard-json";
import { JsonSchemaConversionError } from "./errors.js";
import type { AnySchema, JSONSchema, Projection } from "./types.js";

const TARGET = "draft-2020-12" as const;

/** Shape of the (optional) native `~standard.jsonSchema` surface, per the StandardJSONSchemaV1 spec. */
interface StandardJSONSchemaCapableProps {
  vendor?: string;
  jsonSchema?: {
    input: (options: { target: string }) => JSONSchema;
    output: (options: { target: string }) => JSONSchema;
  };
}

/**
 * Converts a Standard Schema to JSON Schema (draft-2020-12) via:
 *
 *   1. Feature-detect the native `~standard.jsonSchema.{input,output}({ target })` surface
 *      (the `StandardJSONSchemaV1` spec — https://standardschema.dev/json-schema). This path
 *      is synchronous for every vendor that implements it natively: Zod v4 and ArkType 2.2+
 *      do; Valibot 1.4 and Effect 3.22 do not — see `prepare()` below.
 *   2. Fall back to `@standard-community/standard-json`'s `toJsonSchema`.
 *   3. If neither works, throw a clear error naming the vendor.
 *
 * `@standard-community/standard-json`'s `toJsonSchema` is a "quansync" function — its *first*
 * call for a given vendor must go through the `async` path because it dynamically `import()`s
 * the vendor-specific converter module (e.g. `@valibot/to-json-schema`) before it can populate
 * its internal sync-mode cache. Calling `.sync()` cold throws `Unsupported schema vendor
 * "<vendor>"`. Once warmed (one `await` call for that vendor, anywhere in the process),
 * `.sync()` works for the rest of the process lifetime (confirmed for valibot and effect).
 * `prepare(schema)` below is exactly that one-time async warm-up, so `fake()`/`fakeMany()`
 * themselves stay fully synchronous.
 */
/**
 * Vendors whose fallback-converter integration ignores the input/output projection entirely:
 * Effect Schema's shim is `(schema) => JSONSchema.make(schema)` — no projection parameter
 * exists at all, so `use: 'input'` could silently produce the *output* shape instead, a silent
 * correctness bug rather than a clear thrown error. Listed by vendor name (from
 * `~standard.vendor`) rather than detected structurally, since there's no reliable runtime
 * signal otherwise.
 */
const FALLBACK_VENDORS_WITHOUT_PROJECTION = new Set(["effect"]);

export function toJsonSchemaSync(schema: AnySchema, projection: Projection): JSONSchema {
  const props = schema["~standard"] as StandardJSONSchemaCapableProps;
  const vendor = props.vendor ?? "unknown vendor";

  if (props.jsonSchema && typeof props.jsonSchema[projection] === "function") {
    // The native `~standard.jsonSchema` surface itself can throw synchronously for a schema
    // shape it can't represent in JSON Schema at all: Zod v4's own converter throws a plain
    // `Error("Map cannot be represented in JSON Schema")` /
    // `Error("Set cannot be represented in JSON Schema")` for `z.map()`/`z.set()` (neither has
    // a JSON Schema equivalent -- JSON has no map/set primitive, only objects/arrays). Rewrap
    // rather than let the vendor's bare `Error` propagate unwrapped, so callers get the same
    // typed, `instanceof`-narrowable `JsonSchemaConversionError` this library uses everywhere
    // else for "couldn't get a JSON Schema for this schema" — the vendor's own message is
    // preserved verbatim inside it, just given a name and a `vendor` field to match on.
    try {
      return props.jsonSchema[projection]({ target: TARGET });
    } catch (nativeError) {
      throw new JsonSchemaConversionError(
        `standard-schema-faker: could not derive a JSON Schema for vendor "${vendor}" — its ` +
          `native ~standard.jsonSchema surface threw: ${nativeError instanceof Error ? nativeError.message : String(nativeError)}. ` +
          `This usually means the schema uses a construct with no JSON Schema equivalent (e.g. ` +
          `a Map or Set — JSON has no map/set primitive). Model the field as an array or a ` +
          `plain object/record instead, or use \`overrides\` to supply a value for it directly.`,
        { vendor },
      );
    }
  }

  if (projection === "input" && FALLBACK_VENDORS_WITHOUT_PROJECTION.has(vendor)) {
    throw new JsonSchemaConversionError(
      `standard-schema-faker: io: 'input' is not supported for vendor "${vendor}" — its ` +
        `JSON Schema fallback conversion does not distinguish input from output (it always ` +
        `produces one shape). Use the default io: 'output', or switch to a vendor with a ` +
        `native ~standard.jsonSchema surface (Zod v4, ArkType) for input/output projection.`,
      { vendor },
    );
  }

  // Fallback: @standard-community/standard-json. Succeeds synchronously only if the vendor's
  // converter has already been warmed up via `prepare(schema)` (or any prior async call for
  // that vendor) earlier in the process. Cold, it throws — see the doc comment above.
  //
  // `typeMode` is Valibot's (beta) option name for input/output projection in
  // `@valibot/to-json-schema` — NOT part of the StandardJSONSchemaV1 spec, since this is the
  // fallback path, not the native one. Harmless to pass for other fallback vendors that don't
  // recognize it (Effect's shim takes no options at all and ignores everything past `schema`).
  try {
    return fallbackToJsonSchema.sync(schema, { target: TARGET, typeMode: projection }) as JSONSchema;
  } catch (fallbackError) {
    throw new JsonSchemaConversionError(
      `standard-schema-faker: could not derive a JSON Schema for vendor "${vendor}". ` +
        `It does not implement the native ~standard.jsonSchema surface (StandardJSONSchemaV1), ` +
        `and the @standard-community/standard-json fallback has not been warmed up for this ` +
        `vendor yet (${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}). ` +
        `Call \`await prepare(schema)\` once (e.g. at startup) before using fake()/fakeMany() ` +
        `synchronously with this vendor. See https://standardschema.dev/json-schema for the ` +
        `spec vendors should implement natively instead.`,
      { vendor },
    );
  }
}

/**
 * Warms up the `@standard-community/standard-json` fallback converter for a given schema's
 * vendor, so that subsequent synchronous `fake()`/`fakeMany()` calls for that vendor succeed.
 *
 * Only needed for vendors that do NOT implement the native `~standard.jsonSchema` surface
 * (Valibot, Effect Schema). Vendors with a native surface (Zod v4, ArkType) never need this —
 * `prepare()` is a safe no-op for them (the native path is checked first and short-circuits
 * before the fallback is ever touched).
 *
 * This is the one deliberate async touchpoint in the library, by design: it exists so the
 * hot path (`fake`/`fakeMany`) can stay fully synchronous.
 *
 * @example
 * ```ts
 * import { prepare, fake } from 'standard-schema-faker'
 * import * as v from 'valibot'
 *
 * const User = v.object({ id: v.string() })
 * await prepare(User)       // one-time async warm-up
 * const user = fake(User)   // sync from here on, for any Valibot schema in this process
 * ```
 */
export async function prepare(schema: AnySchema): Promise<void> {
  const props = schema["~standard"] as StandardJSONSchemaCapableProps;
  if (props.jsonSchema && typeof props.jsonSchema.output === "function") {
    // Native surface — nothing to warm up.
    return;
  }
  await fallbackToJsonSchema(schema, { target: TARGET });
}
