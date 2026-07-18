import { Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { fake, prepare } from "../src/index.js";

/**
 * Effect Schema — best-effort support. Findings from runtime verification:
 *
 *   - Effect 3.22's `~standard` surface (via `Schema.standardSchemaV1(...)`) does NOT expose
 *     a native `jsonSchema` converter — only `validate`. Same situation as Valibot: requires
 *     `await prepare(schema)` once, then `fake()` works synchronously from the fallback
 *     converter's warmed cache.
 *   - The fallback (`@standard-community/standard-json`) targets draft-07 for Effect (not
 *     draft-2020-12) — within spec ("accept draft-07"). This surfaced a real walker gap: v0
 *     only handled draft-2020-12 tuples (`prefixItems`); draft-07 tuples use an array-valued
 *     `items` keyword instead. Fixed in `walker.ts`'s `generateArray` (now checks both forms).
 *   - Recursive Effect schemas (`Schema.suspend`) throw `Missing annotation ... requires an
 *     "identifier" annotation` from the converter unless every recursive member schema is
 *     given `.annotations({ identifier: '...' })`. This is a real Effect/converter
 *     requirement, not a gap in this library — documented here and in README as a
 *     vendor-specific gotcha (mirrors Valibot's "use v.lazy(), not a getter" gotcha).
 *
 * No shim was needed beyond the draft-07 tuple fix above (which benefits every vendor
 * targeting draft-07, not just Effect) — so Effect is included in the vendor matrix as
 * best-effort rather than being scoped out.
 */

describe("Effect Schema — best-effort", () => {
  beforeAll(async () => {
    await prepare(Schema.standardSchemaV1(Schema.Struct({ id: Schema.String })));
  });

  it("generates a valid struct with required + optional fields", async () => {
    const EffectStruct = Schema.standardSchemaV1(
      Schema.Struct({
        id: Schema.String,
        age: Schema.optional(Schema.Number),
      }),
    );
    for (let seed = 0; seed < 8; seed++) {
      const value = fake(EffectStruct, { seed });
      const result = await EffectStruct["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(result.issues)}`).toBeUndefined();
    }
  });

  it("generates a valid tuple (draft-07 array-valued `items`)", async () => {
    const EffectTuple = Schema.standardSchemaV1(Schema.Tuple(Schema.String, Schema.Number, Schema.Boolean));
    const value = fake(EffectTuple, { seed: 1 });
    expect(value).toHaveLength(3);
    expect(typeof value[0]).toBe("string");
    expect(typeof value[1]).toBe("number");
    expect(typeof value[2]).toBe("boolean");
    const result = await EffectTuple["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("generates a valid literal-union enum member", async () => {
    const EffectEnum = Schema.standardSchemaV1(Schema.Literal("admin", "user", "guest"));
    const value = fake(EffectEnum, { seed: 3 });
    expect(["admin", "user", "guest"]).toContain(value);
    const result = await EffectEnum["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("respects maxDepth for a recursive schema (requires explicit `identifier` annotations)", async () => {
    interface Category {
      name: string;
      subcategories: readonly Category[];
    }
    const Category = Schema.Struct({
      name: Schema.String,
      subcategories: Schema.Array(Schema.suspend((): Schema.Schema<Category> => Category).annotations({ identifier: "Category" })),
    }).annotations({ identifier: "Category" });
    const EffectCategory = Schema.standardSchemaV1(Category);

    expect(() => fake(EffectCategory, { seed: 1 })).not.toThrow();
    const value = fake(EffectCategory, { seed: 1 });
    const result = await EffectCategory["~standard"].validate(value);
    expect(result.issues, JSON.stringify(result.issues)).toBeUndefined();
  });
});
