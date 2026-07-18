import { scope, type } from "arktype";
import * as v from "valibot";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, fake, prepare } from "../src/index.js";
import type { AnySchema } from "../src/types.js";

/**
 * Vendor matrix: the same logical schema, authored independently in Zod v4 (native sync
 * jsonSchema), ArkType (native sync jsonSchema), and Valibot (no native surface as of v1.4 —
 * goes through the `prepare()` + fallback-converter path). For each vendor x node kind:
 * generate with a seed, assert the vendor's OWN `~standard.validate` passes.
 *
 * Runtime findings:
 *   - ArkType 2.2.3: full native `~standard.jsonSchema.{input,output}` surface, synchronous.
 *   - Valibot 1.4.2: `~standard` only exposes `validate` — no native jsonSchema. Requires
 *     `await prepare(schema)` once per process before `fake()` works synchronously for it.
 *   - Zod v4: native, synchronous.
 */

interface VendorCase {
  vendor: string;
  schema: AnySchema;
  validate: (value: unknown) => boolean | Promise<boolean>;
}

beforeAll(async () => {
  // Warm up the fallback converter for every Valibot schema used below. A single `prepare()`
  // call warms the *vendor's* converter for the whole process (see to-json-schema.ts) — one
  // representative schema is enough.
  await prepare(v.object({ id: v.string() }));
});

async function expectValidVendor(kase: VendorCase, value: unknown) {
  const ok = await kase.validate(value);
  if (!ok) {
    throw new Error(`[${kase.vendor}] validation failed for ${JSON.stringify(value)}`);
  }
}

function zodValidate(schema: z.ZodType): (value: unknown) => Promise<boolean> {
  return async (value) => {
    const r = await schema["~standard"].validate(value);
    return !r.issues;
  };
}

function valibotValidate(schema: v.GenericSchema): (value: unknown) => boolean {
  return (value) => v.safeParse(schema, value).success;
}

function arktypeValidate(schema: (value: unknown) => unknown): (value: unknown) => boolean {
  return (value) => !(schema(value) instanceof type.errors);
}

describe("vendor matrix — string: length bounds", () => {
  const cases: VendorCase[] = [
    { vendor: "zod", schema: z.string().min(5).max(12) as unknown as AnySchema, validate: zodValidate(z.string().min(5).max(12)) },
    {
      vendor: "valibot",
      schema: v.pipe(v.string(), v.minLength(5), v.maxLength(12)) as unknown as AnySchema,
      validate: valibotValidate(v.pipe(v.string(), v.minLength(5), v.maxLength(12))),
    },
    {
      vendor: "arktype",
      schema: type("5 <= string <= 12") as unknown as AnySchema,
      validate: arktypeValidate(type("5 <= string <= 12")),
    },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid bounded string`, async () => {
      const value = fake(kase.schema, { seed: 1 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — string: format email", () => {
  const zodEmail = z.email();
  const valibotEmail = v.pipe(v.string(), v.email());
  const arktypeEmail = type("string.email");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodEmail as unknown as AnySchema, validate: zodValidate(zodEmail) },
    { vendor: "valibot", schema: valibotEmail as unknown as AnySchema, validate: valibotValidate(valibotEmail) },
    { vendor: "arktype", schema: arktypeEmail as unknown as AnySchema, validate: arktypeValidate(arktypeEmail) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid email across many seeds`, async () => {
      for (let seed = 0; seed < 15; seed++) {
        const value = fake(kase.schema, { seed });
        await expectValidVendor(kase, value);
      }
    });
  }
});

describe("vendor matrix — string: format uuid", () => {
  const zodUuid = z.uuid();
  const valibotUuid = v.pipe(v.string(), v.uuid());
  const arktypeUuid = type("string.uuid");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodUuid as unknown as AnySchema, validate: zodValidate(zodUuid) },
    { vendor: "valibot", schema: valibotUuid as unknown as AnySchema, validate: valibotValidate(valibotUuid) },
    { vendor: "arktype", schema: arktypeUuid as unknown as AnySchema, validate: arktypeValidate(arktypeUuid) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid uuid`, async () => {
      const value = fake(kase.schema, { seed: 1 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — integer: min/max/multipleOf", () => {
  const zodInt = z.int().min(0).max(100).multipleOf(5);
  const valibotInt = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100), v.multipleOf(5));
  const arktypeInt = type("0 <= number.integer <= 100 % 5");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodInt as unknown as AnySchema, validate: zodValidate(zodInt) },
    { vendor: "valibot", schema: valibotInt as unknown as AnySchema, validate: valibotValidate(valibotInt) },
    { vendor: "arktype", schema: arktypeInt as unknown as AnySchema, validate: arktypeValidate(arktypeInt) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid bounded multiple-of integer`, async () => {
      const value = fake(kase.schema, { seed: 7 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — number: exclusive bounds", () => {
  const zodNum = z.number().gt(0).lt(1);
  const valibotNum = v.pipe(v.number(), v.gtValue(0), v.ltValue(1));
  const arktypeNum = type("0 < number < 1");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodNum as unknown as AnySchema, validate: zodValidate(zodNum) },
    { vendor: "valibot", schema: valibotNum as unknown as AnySchema, validate: valibotValidate(valibotNum) },
    { vendor: "arktype", schema: arktypeNum as unknown as AnySchema, validate: arktypeValidate(arktypeNum) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid exclusively-bounded number`, async () => {
      const value = fake(kase.schema, { seed: 7 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — boolean", () => {
  const cases: VendorCase[] = [
    { vendor: "zod", schema: z.boolean() as unknown as AnySchema, validate: zodValidate(z.boolean()) },
    { vendor: "valibot", schema: v.boolean() as unknown as AnySchema, validate: valibotValidate(v.boolean()) },
    { vendor: "arktype", schema: type("boolean") as unknown as AnySchema, validate: arktypeValidate(type("boolean")) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid boolean`, async () => {
      const value = fake(kase.schema, { seed: 3 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — enum", () => {
  const zodEnum = z.enum(["red", "green", "blue"]);
  const valibotEnum = v.picklist(["red", "green", "blue"]);
  const arktypeEnum = type('"red"|"green"|"blue"');

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodEnum as unknown as AnySchema, validate: zodValidate(zodEnum) },
    { vendor: "valibot", schema: valibotEnum as unknown as AnySchema, validate: valibotValidate(valibotEnum) },
    { vendor: "arktype", schema: arktypeEnum as unknown as AnySchema, validate: arktypeValidate(arktypeEnum) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid enum member`, async () => {
      const value = fake(kase.schema, { seed: 3 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — object: required + optional", () => {
  const zodObj = z.object({ id: z.string(), nickname: z.string().optional() });
  const valibotObj = v.object({ id: v.string(), nickname: v.optional(v.string()) });
  const arktypeObj = type({ id: "string", "nickname?": "string" });

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodObj as unknown as AnySchema, validate: zodValidate(zodObj) },
    { vendor: "valibot", schema: valibotObj as unknown as AnySchema, validate: valibotValidate(valibotObj) },
    { vendor: "arktype", schema: arktypeObj as unknown as AnySchema, validate: arktypeValidate(arktypeObj) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid object across many seeds (optional inclusion varies)`, async () => {
      for (let seed = 0; seed < 8; seed++) {
        const value = fake(kase.schema, { seed });
        await expectValidVendor(kase, value);
      }
    });
  }
});

describe("vendor matrix — array: default bounds + explicit bounds", () => {
  const zodArr = z.array(z.string()).min(2).max(4);
  const valibotArr = v.pipe(v.array(v.string()), v.minLength(2), v.maxLength(4));
  const arktypeArr = type("2 <= string[] <= 4");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodArr as unknown as AnySchema, validate: zodValidate(zodArr) },
    { vendor: "valibot", schema: valibotArr as unknown as AnySchema, validate: valibotValidate(valibotArr) },
    { vendor: "arktype", schema: arktypeArr as unknown as AnySchema, validate: arktypeValidate(arktypeArr) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid bounded array`, async () => {
      // `kase.schema` is `AnySchema` (deliberately widened — see `VendorCase`, this whole
      // file's premise is handling logically-equivalent-but-concretely-different vendor
      // schemas uniformly), so `fake()` can't infer more than `unknown` here; the known shape
      // (`string[]`) is asserted back explicitly, same pattern as golden-cross-vendor.test.ts.
      const value = fake(kase.schema, { seed: 9 }) as string[];
      expect(value.length).toBeGreaterThanOrEqual(2);
      expect(value.length).toBeLessThanOrEqual(4);
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — tuple (prefixItems / draft-07 items array)", () => {
  const zodTuple = z.tuple([z.string(), z.number(), z.boolean()]);
  const valibotTuple = v.tuple([v.string(), v.number(), v.boolean()]);
  const arktypeTuple = type(["string", "number", "boolean"]);

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodTuple as unknown as AnySchema, validate: zodValidate(zodTuple) },
    { vendor: "valibot", schema: valibotTuple as unknown as AnySchema, validate: valibotValidate(valibotTuple) },
    { vendor: "arktype", schema: arktypeTuple as unknown as AnySchema, validate: arktypeValidate(arktypeTuple) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid 3-tuple`, async () => {
      const value = fake(kase.schema, { seed: 9 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — anyOf/union", () => {
  const zodUnion = z.union([z.string(), z.number(), z.boolean()]);
  const valibotUnion = v.union([v.string(), v.number(), v.boolean()]);
  const arktypeUnion = type("string|number|boolean");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodUnion as unknown as AnySchema, validate: zodValidate(zodUnion) },
    { vendor: "valibot", schema: valibotUnion as unknown as AnySchema, validate: valibotValidate(valibotUnion) },
    { vendor: "arktype", schema: arktypeUnion as unknown as AnySchema, validate: arktypeValidate(arktypeUnion) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid union member across many seeds`, async () => {
      for (let seed = 0; seed < 8; seed++) {
        const value = fake(kase.schema, { seed });
        await expectValidVendor(kase, value);
      }
    });
  }
});

describe("vendor matrix — allOf/intersection: shallow merge", () => {
  const zodIntersect = z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }));
  const valibotIntersect = v.intersect([v.object({ a: v.string() }), v.object({ b: v.number() })]);
  const arktypeIntersect = type({ a: "string" }).and(type({ b: "number" }));

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodIntersect as unknown as AnySchema, validate: zodValidate(zodIntersect) },
    { vendor: "valibot", schema: valibotIntersect as unknown as AnySchema, validate: valibotValidate(valibotIntersect) },
    { vendor: "arktype", schema: arktypeIntersect as unknown as AnySchema, validate: arktypeValidate(arktypeIntersect) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates a valid merged intersection`, async () => {
      const value = fake(kase.schema, { seed: 11 });
      await expectValidVendor(kase, value);
    });
  }
});

describe("vendor matrix — nullable", () => {
  const zodNullable = z.string().nullable();
  const valibotNullable = v.nullable(v.string());
  const arktypeNullable = type("string|null");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodNullable as unknown as AnySchema, validate: zodValidate(zodNullable) },
    { vendor: "valibot", schema: valibotNullable as unknown as AnySchema, validate: valibotValidate(valibotNullable) },
    { vendor: "arktype", schema: arktypeNullable as unknown as AnySchema, validate: arktypeValidate(arktypeNullable) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} sometimes generates null, sometimes a string, always valid`, async () => {
      let sawNull = false;
      let sawOther = false;
      for (let seed = 0; seed < 30; seed++) {
        const value = fake(kase.schema, { seed });
        await expectValidVendor(kase, value);
        if (value === null) sawNull = true;
        else sawOther = true;
      }
      expect(sawNull).toBe(true);
      expect(sawOther).toBe(true);
    });
  }
});

describe("vendor matrix — recursive schema respects maxDepth", () => {
  interface Category {
    name: string;
    subcategories: Category[];
  }

  const ZodCategory: z.ZodType<Category> = z.object({
    name: z.string(),
    subcategories: z.lazy(() => z.array(ZodCategory)),
  });

  // Valibot: MUST use v.lazy() for recursion, not a getter — a getter-based recursive object
  // literal crashes @standard-community/standard-json's fallback converter with a stack
  // overflow (verified at runtime; documented in README as a Valibot-specific gotcha).
  const ValibotCategory: v.GenericSchema<Category> = v.object({
    name: v.string(),
    subcategories: v.lazy(() => v.array(ValibotCategory)),
  });

  const ArktypeCategory = scope({
    Category: { name: "string", subcategories: "Category[]" },
  }).export().Category;

  const cases: VendorCase[] = [
    { vendor: "zod", schema: ZodCategory as unknown as AnySchema, validate: zodValidate(ZodCategory) },
    { vendor: "valibot", schema: ValibotCategory as unknown as AnySchema, validate: valibotValidate(ValibotCategory) },
    {
      vendor: "arktype",
      schema: ArktypeCategory as unknown as AnySchema,
      validate: arktypeValidate(ArktypeCategory),
    },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} terminates recursion at maxDepth without a stack overflow`, async () => {
      expect(() => fake(kase.schema, { seed: 1 })).not.toThrow();
      const value = fake(kase.schema, { seed: 1 });
      await expectValidVendor(kase, value);
    });
  }
});

/**
 * Cross-vendor coverage for features that had been tested almost exclusively
 * against Zod: schema-form `additionalProperties` (`z.record`/dictionary generation),
 * ctx-based `overrides`, and `pattern` x length re-roll. (`defaultHeuristics`/FHIR
 * `ContactPoint`/`finalize`/`optionalProbability` cross-vendor coverage lives in
 * `test/faker/cross-vendor.test.ts`, since those features are defined in the
 * `standard-schema-faker/faker` subpath, not the root entry.)
 *
 * VENDOR DIVERGENCE FOUND (record/dictionary emission shape) — the open-ended dictionary case
 * (`propertyNames` + schema-form `additionalProperties`, no declared `properties`) round-trips
 * through all three vendors' JSON Schema output identically enough for this walker's existing
 * `generateAdditionalProperties` logic to handle uniformly. The CLOSED enum-key-set variant
 * (Zod's `z.record(z.enum([...]), V)`, detected via `propertyNames.enum` + every enum value
 * ALSO listed in the object's own `required`) is Zod-SPECIFIC: neither Valibot nor ArkType can
 * even construct the equivalent schema as a "record" at all —
 *
 *   - Valibot: `v.record(v.picklist([...]), V)` is accepted at schema-construction time but
 *     its `@valibot/to-json-schema` conversion THROWS: `The "record" schema with the
 *     "picklist" schema for the key cannot be converted to JSON Schema.` (verified at runtime).
 *   - ArkType: a literal-key-union `Record` (`type("Record<'a'|'b', string>")`) is rejected at
 *     schema-construction time itself: `Index keys "a", "b" should be specified as named
 *     props.` — ArkType's own design pushes a closed key set toward a plain object with named
 *     properties instead, which this walker already handles as ordinary declared
 *     `properties` (not the `additionalProperties` codepath at all).
 *
 * So the closed-key-set `additionalProperties` codepath (`generateAdditionalProperties`'s
 * `enumKeys?.every((k) => required.has(k))` branch) is exercised ONLY by Zod, structurally —
 * not a gap in this library, a genuine difference in what "a record with a closed key set"
 * even MEANS across these three vendors' own schema-authoring surfaces. ArkType's plain
 * `additionalProperties` form (both `Record<string, V>` and an index-signature object) also
 * emits NO `propertyNames` at all (unlike Zod/Valibot, which both emit `propertyNames:
 * {type: 'string'}` even for the unconstrained case) — verified this doesn't matter to
 * `generateAdditionalPropertyKey` (absent `propertyNames` falls through to its plain-word
 * default), but it's a real, observable JSON Schema shape difference worth documenting.
 */
describe("cross-vendor — record/dictionary (schema-form additionalProperties)", () => {
  const zodRecord = z.record(z.string(), z.number().min(0).max(100));
  const valibotRecord = v.record(v.string(), v.pipe(v.number(), v.minValue(0), v.maxValue(100)));
  const arktypeRecord = type("Record<string, 0 <= number <= 100>");

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodRecord as unknown as AnySchema, validate: zodValidate(zodRecord) },
    { vendor: "valibot", schema: valibotRecord as unknown as AnySchema, validate: valibotValidate(valibotRecord) },
    { vendor: "arktype", schema: arktypeRecord as unknown as AnySchema, validate: arktypeValidate(arktypeRecord) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor} generates at least one entry, every value within bounds, vendor validate passes`, async () => {
      for (let seed = 0; seed < 15; seed++) {
        const value = fake(kase.schema, { seed }) as Record<string, number>;
        const keys = Object.keys(value);
        expect(keys.length, `seed ${seed}: ${JSON.stringify(value)}`).toBeGreaterThanOrEqual(1);
        for (const key of keys) {
          expect(value[key]).toBeGreaterThanOrEqual(0);
          expect(value[key]).toBeLessThanOrEqual(100);
        }
        await expectValidVendor(kase, value);
      }
    });
  }

  it("determinism holds identically for every vendor's record schema", () => {
    for (const kase of cases) {
      const a = fake(kase.schema, { seed: 42 });
      const b = fake(kase.schema, { seed: 42 });
      expect(a, kase.vendor).toEqual(b);
    }
  });
});

describe("cross-vendor — ctx-based overrides (sibling-aware correlation)", () => {
  // Same "kind decides value's shape" correlation `overrides.test.ts` exercises against Zod
  // only -- ported to Valibot and ArkType.
  function correlatedGen() {
    return {
      overrides: (ctx: { key: string; siblings: Record<string, unknown> }) => {
        if (ctx.key !== "value") return undefined;
        if (ctx.siblings.kind === "a") return "override-for-a";
        if (ctx.siblings.kind === "b") return "override-for-b";
        return undefined;
      },
    };
  }

  const zodSchema = z.object({ kind: z.enum(["a", "b"]), value: z.string() });
  const valibotSchema = v.object({ kind: v.picklist(["a", "b"]), value: v.string() });
  const arktypeSchema = type({ kind: "'a'|'b'", value: "string" });

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodSchema as unknown as AnySchema, validate: zodValidate(zodSchema) },
    { vendor: "valibot", schema: valibotSchema as unknown as AnySchema, validate: valibotValidate(valibotSchema) },
    { vendor: "arktype", schema: arktypeSchema as unknown as AnySchema, validate: arktypeValidate(arktypeSchema) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor}: override reads ctx.siblings.kind (the actual generated sibling value), vendor validate passes`, async () => {
      const gen = createFaker(correlatedGen());
      for (let seed = 0; seed < 10; seed++) {
        const value = gen.fake(kase.schema, { seed }) as { kind: "a" | "b"; value: string };
        expect(value.value).toBe(value.kind === "a" ? "override-for-a" : "override-for-b");
        await expectValidVendor(kase, value);
      }
    });
  }
});

describe("cross-vendor — pattern x length re-roll", () => {
  const zodPattern = z
    .string()
    .regex(/^[a-z]+$/)
    .min(5)
    .max(8);
  const valibotPattern = v.pipe(v.string(), v.regex(/^[a-z]+$/), v.minLength(5), v.maxLength(8));
  const arktypePattern = type(/^[a-z]{5,8}$/);

  const cases: VendorCase[] = [
    { vendor: "zod", schema: zodPattern as unknown as AnySchema, validate: zodValidate(zodPattern) },
    { vendor: "valibot", schema: valibotPattern as unknown as AnySchema, validate: valibotValidate(valibotPattern) },
    { vendor: "arktype", schema: arktypePattern as unknown as AnySchema, validate: arktypeValidate(arktypePattern) },
  ];

  for (const kase of cases) {
    it(`${kase.vendor}: generated string satisfies BOTH the pattern and the length bound, vendor validate passes`, async () => {
      for (let seed = 0; seed < 20; seed++) {
        const value = fake(kase.schema, { seed }) as string;
        expect(value.length, `seed ${seed}: "${value}"`).toBeGreaterThanOrEqual(5);
        expect(value.length, `seed ${seed}: "${value}"`).toBeLessThanOrEqual(8);
        expect(/^[a-z]+$/.test(value), `seed ${seed}: "${value}"`).toBe(true);
        await expectValidVendor(kase, value);
      }
    });
  }
});
