import fc from "fast-check";
import type { JSONSchema } from "../src/types.js";

/**
 * A fast-check arbitrary that generates bounded JSON Schema documents (depth <= 3) covering
 * the supported node kinds: string (length bounds, format, pattern), number/integer
 * (min/max/multipleOf), boolean, enum/const, object (required/optional), array
 * (minItems/maxItems, uniqueItems), anyOf, allOf, nullable (via anyOf null branch).
 *
 * Deliberately excludes: `$ref`/recursive schemas (covered by dedicated recursion tests
 * elsewhere, and awkward to generate+validate generically with Ajv), `not`/`if-then-else`/
 * `patternProperties` (out of v0 scope entirely, so there's nothing to property-test).
 *
 * Patterns are drawn from a small fixed set of hand-picked regexes known to be within the
 * pattern generator's supported subset (see pattern.ts) — an arbitrary *generator of regexes*
 * would risk generating patterns outside that subset, which would test the wrong thing.
 *
 * Depth is tracked explicitly (a plain recursive function taking a `depth` parameter) rather
 * than relying on fast-check's automatic `oneof({ maxDepth })` depth-biasing, which does not
 * reliably propagate through custom `.chain()`/`.map()` composition boundaries (verified by
 * inspection: sampled output exceeded the intended depth cap when using that mechanism).
 */

const SAFE_PATTERNS = ["^[a-z0-9]+$", "^[A-Z]{3}-\\d{4}$", "^(foo|bar|baz)$", "^[a-z]+(-[a-z]+)*$", "^\\d{2,5}$"] as const;

const FORMATS = ["email", "uuid", "date-time", "date", "ipv4"] as const;

/** Safe object property keys: valid JS identifier-ish strings, so dot-path joining (in the
 * walker/overrides) and JSON.stringify round-tripping never see surprising characters. */
const propertyKey = (): fc.Arbitrary<string> => fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,5}$/);

function stringSchema(): fc.Arbitrary<JSONSchema> {
  return fc.oneof(
    fc.tuple(fc.integer({ min: 0, max: 10 }), fc.integer({ min: 0, max: 10 })).map(([a, b]): JSONSchema => {
      const min = Math.min(a, b);
      const max = Math.max(a, b) + 1;
      return { type: "string", minLength: min, maxLength: max };
    }),
    fc.constantFrom(...FORMATS).map((format): JSONSchema => ({ type: "string", format })),
    fc.constantFrom(...SAFE_PATTERNS).map((pattern): JSONSchema => ({ type: "string", pattern })),
    fc.constant<JSONSchema>({ type: "string" }),
  );
}

function numberSchema(): fc.Arbitrary<JSONSchema> {
  return fc.oneof(
    fc.tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 })).map(([a, b]): JSONSchema => {
      const min = Math.min(a, b);
      const max = Math.max(a, b) + 1;
      return { type: "number", minimum: min, maximum: max };
    }),
    fc.constant<JSONSchema>({ type: "number" }),
  );
}

function integerSchema(): fc.Arbitrary<JSONSchema> {
  return fc.oneof(
    fc.tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 })).map(([a, b]): JSONSchema => {
      const min = Math.min(a, b);
      const max = Math.max(a, b) + 1;
      return { type: "integer", minimum: min, maximum: max };
    }),
    fc.tuple(fc.integer({ min: 0, max: 100 }), fc.constantFrom(2, 3, 5, 10)).map(
      ([base, mult]): JSONSchema => ({
        type: "integer",
        minimum: 0,
        maximum: base * mult + mult * 5,
        multipleOf: mult,
      }),
    ),
    fc.constant<JSONSchema>({ type: "integer" }),
  );
}

function booleanSchema(): fc.Arbitrary<JSONSchema> {
  return fc.constant<JSONSchema>({ type: "boolean" });
}

function enumSchema(): fc.Arbitrary<JSONSchema> {
  return fc
    .uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 2, maxLength: 5 })
    .map((values): JSONSchema => ({ enum: values }));
}

function constSchema(): fc.Arbitrary<JSONSchema> {
  return fc.oneof(fc.string({ minLength: 1, maxLength: 8 }), fc.integer(), fc.boolean()).map((value): JSONSchema => ({ const: value }));
}

function leafSchema(): fc.Arbitrary<JSONSchema> {
  return fc.oneof(stringSchema(), numberSchema(), integerSchema(), booleanSchema(), enumSchema(), constSchema());
}

const MAX_SCHEMA_DEPTH = 3;

/** Builds a bounded-depth schema arbitrary. `depth` counts down; at 0, only leaf schemas are produced. */
function schemaAtDepth(depth: number): fc.Arbitrary<JSONSchema> {
  if (depth <= 0) return leafSchema();

  const child = () => schemaAtDepth(depth - 1);

  const objectSchema: fc.Arbitrary<JSONSchema> = fc
    .array(fc.tuple(propertyKey(), fc.boolean()), { minLength: 1, maxLength: 4 })
    .chain((entries) => {
      const uniqueEntries = Array.from(new Map(entries.map(([k, req]) => [k, req])).entries());
      return fc.tuple(...uniqueEntries.map(() => child())).map((propSchemas): JSONSchema => {
        const properties: Record<string, JSONSchema> = {};
        const required: string[] = [];
        uniqueEntries.forEach(([key, isRequired], i) => {
          const propSchema = propSchemas[i];
          if (!propSchema) {
            // Unreachable: `propSchemas` is built from `fc.tuple(...uniqueEntries.map(...))`,
            // so it always has exactly `uniqueEntries.length` elements -- guarded explicitly
            // rather than asserted, so a future refactor that breaks this pairing fails loudly.
            throw new Error(`arbitrary-schema: internal error -- missing generated schema for property "${key}" at index ${i}`);
          }
          properties[key] = propSchema;
          if (isRequired) required.push(key);
        });
        return {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          additionalProperties: false,
        };
      });
    });

  const arraySchema: fc.Arbitrary<JSONSchema> = fc
    .tuple(child(), fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), fc.boolean())
    .map(([itemSchema, a, b, uniqueItems]): JSONSchema => {
      const minItems = Math.min(a, b);
      const maxItems = Math.max(a, b) + 1;
      return { type: "array", items: itemSchema, minItems, maxItems, uniqueItems };
    });

  const anyOfSchema: fc.Arbitrary<JSONSchema> = fc
    .array(child(), { minLength: 2, maxLength: 3 })
    .map((branches): JSONSchema => ({ anyOf: branches }));

  const nullableSchema: fc.Arbitrary<JSONSchema> = child().map((inner): JSONSchema => ({ anyOf: [inner, { type: "null" }] }));

  const allOfSchema: fc.Arbitrary<JSONSchema> = fc
    .tuple(
      fc.dictionary(propertyKey(), fc.oneof(stringSchema(), integerSchema()), { minKeys: 1, maxKeys: 2 }),
      fc.dictionary(propertyKey(), fc.oneof(stringSchema(), integerSchema()), { minKeys: 1, maxKeys: 2 }),
    )
    .map(([a, b]): JSONSchema => {
      // Prefix each branch's keys distinctly ("A"/"B") so the two branches can never share a
      // property key. JSON Schema's `allOf` validates the instance against each branch
      // independently, so two facts break down if branches share a key with DIFFERENT
      // constraints (the walker's shallow-merge picks one, last-write-wins, which then
      // fails the other branch's independent check under a strict oracle like Ajv) or if
      // both branches close with `additionalProperties: false` over disjoint keys (each
      // branch then rejects the other's fields — confirmed to reproduce even with Zod's own
      // native jsonSchema output for z.intersection(objA, objB), a well-known JSON-Schema-
      // composition limitation, not a walker bug). Disjoint, unprefixed-`additionalProperties`
      // branches are the subset of allOf schemas that genuinely have valid values, which is
      // what this arbitrary needs to stay within for a meaningful oracle comparison.
      const prefixed = (obj: Record<string, JSONSchema>, prefix: string): Record<string, JSONSchema> =>
        Object.fromEntries(Object.entries(obj).map(([k, v]) => [`${prefix}${k}`, v]));
      const propsA = prefixed(a, "A");
      const propsB = prefixed(b, "B");
      return {
        allOf: [
          { type: "object", properties: propsA, required: Object.keys(propsA) },
          { type: "object", properties: propsB, required: Object.keys(propsB) },
        ],
      };
    });

  return fc.oneof(leafSchema(), objectSchema, arraySchema, anyOfSchema, nullableSchema, allOfSchema);
}

export function arbitrarySchema(): fc.Arbitrary<JSONSchema> {
  return schemaAtDepth(MAX_SCHEMA_DEPTH).map((s) => ({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...s,
  }));
}
