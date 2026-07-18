import { type } from "arktype";
import * as v from "valibot";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { fake, prepare } from "../src/index.js";
import type { AnySchema } from "../src/types.js";

/**
 * Golden cross-vendor fixture: the same logical schema, authored
 * independently in Zod v4, Valibot, and ArkType, should produce STRUCTURALLY equivalent
 * output for the same seed — same keys, same shapes (types/lengths/ranges honored), even
 * though the underlying JSON Schema documents the three vendors emit are not byte-identical
 * (e.g. ArkType omits a redundant `type: "string"` alongside `enum`, doesn't emit
 * `additionalProperties: false`; property key order in the JSON Schema's `properties` object
 * differs). Those representational differences mean we do NOT assert exact value equality —
 * only what's truly invariant given a shared logical schema: the same set of keys, the same
 * JS type per key, and each value satisfying the same bounds/membership constraints.
 */

interface Fixture {
  id: string;
  age: number;
  active: boolean;
  role: "admin" | "user";
}

const ZodFixture = z.object({
  id: z.string().min(3).max(3),
  age: z.int().min(0).max(100),
  active: z.boolean(),
  role: z.enum(["admin", "user"]),
});

const ValibotFixture = v.object({
  id: v.pipe(v.string(), v.minLength(3), v.maxLength(3)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100)),
  active: v.boolean(),
  role: v.picklist(["admin", "user"]),
});

const ArktypeFixture = type({
  id: "3 <= string <= 3",
  age: "0 <= number.integer <= 100",
  active: "boolean",
  role: '"admin"|"user"',
});

const vendors: Array<{ name: string; schema: AnySchema }> = [
  { name: "zod", schema: ZodFixture as unknown as AnySchema },
  { name: "valibot", schema: ValibotFixture as unknown as AnySchema },
  { name: "arktype", schema: ArktypeFixture as unknown as AnySchema },
];

describe("golden cross-vendor fixture", () => {
  // Vitest runs each test file in its own module context, so the fallback converter's
  // vendor-warm-up cache from other test files does not carry over here — Valibot needs its
  // own `prepare()` call in this file too.
  beforeAll(async () => {
    await prepare(ValibotFixture as unknown as AnySchema);
  });

  // `vendors` is deliberately typed `AnySchema` (widened) so all three vendors' concretely
  // different schema types can be handled uniformly in one array — `fake()`'s inference can't
  // recover more than `unknown` from that widened type, same as any consumer intentionally
  // erasing a schema's concrete type (e.g. storing heterogeneous schemas in one collection).
  // The known `Fixture` shape is asserted back here via `as Fixture`, not because inference
  // failed, but because this test's whole premise is "same LOGICAL schema, different vendor
  // types" — there's no single concrete `S` for `Projected<S, P>` to infer from an
  // intentionally-erased-type array.
  it("all three vendors produce the same key set", () => {
    const keysPerVendor = vendors.map(({ name, schema }) => ({
      name,
      keys: Object.keys(fake(schema, { seed: 42 }) as Fixture).sort(),
    }));
    const [first, ...rest] = keysPerVendor;
    if (!first) throw new Error("golden-cross-vendor: `vendors` must not be empty");
    for (const other of rest) {
      expect(other.keys, `${other.name} vs ${first.name}`).toEqual(first.keys);
    }
  });

  it("all three vendors produce values with the same JS type per key", () => {
    for (const seed of [1, 2, 3, 42]) {
      const values = vendors.map(({ name, schema }) => ({ name, value: fake(schema, { seed }) as Fixture }));
      const [first, ...rest] = values;
      if (!first) throw new Error("golden-cross-vendor: `vendors` must not be empty");
      for (const other of rest) {
        expect(typeof other.value.id, `id type (seed ${seed}, ${other.name})`).toBe(typeof first.value.id);
        expect(typeof other.value.age, `age type (seed ${seed}, ${other.name})`).toBe(typeof first.value.age);
        expect(typeof other.value.active, `active type (seed ${seed}, ${other.name})`).toBe(typeof first.value.active);
        expect(typeof other.value.role, `role type (seed ${seed}, ${other.name})`).toBe(typeof first.value.role);
      }
    }
  });

  it("all three vendors honor the same bounds/membership constraints, every seed", () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 42, 100]) {
      for (const { name, schema } of vendors) {
        const value = fake(schema, { seed }) as Fixture;
        expect(value.id, `${name} id length`).toHaveLength(3);
        expect(value.age, `${name} age lower bound`).toBeGreaterThanOrEqual(0);
        expect(value.age, `${name} age upper bound`).toBeLessThanOrEqual(100);
        expect(Number.isInteger(value.age), `${name} age is integer`).toBe(true);
        expect(typeof value.active, `${name} active is boolean`).toBe("boolean");
        expect(["admin", "user"], `${name} role membership`).toContain(value.role);
      }
    }
  });

  it("each vendor is internally deterministic (same seed -> same value, re-derived independently)", () => {
    for (const { schema } of vendors) {
      const a = fake(schema, { seed: 7 });
      const b = fake(schema, { seed: 7 });
      expect(a).toEqual(b);
    }
  });
});
