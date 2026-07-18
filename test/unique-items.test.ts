import { describe, expect, it } from "vitest";
import { defaultBackend, generateFromSchema } from "../src/index.js";
import type { JSONSchema } from "../src/types.js";
import type { WalkContext } from "../src/walker.js";

// (WalkContext is an internal type, imported directly from its module rather than the
// package's public index.ts, which intentionally does not re-export it.)

/**
 * `uniqueItems: true` dedupe strategy: on a collision, re-roll a bounded
 * number of times; if still colliding and `minItems` is already satisfied, shrink the array
 * to what was collected; if `minItems` isn't satisfiable (item schema's cardinality is too
 * small), throw a clear error. Exercised directly against the walker (`generateFromSchema`)
 * with hand-built JSON Schema, since neither Zod v4 nor Valibot currently expose a
 * `uniqueItems`-emitting API — this is a JSON-Schema-level keyword, testable independent of
 * any particular vendor.
 */

function ctxFor(schema: JSONSchema, seed: number): WalkContext {
  return { backend: defaultBackend.create(seed), root: schema, maxDepth: 5, projection: "output" };
}

describe("uniqueItems", () => {
  it("generates a unique array when the item schema has ample cardinality", () => {
    const schema: JSONSchema = {
      type: "array",
      items: { type: "string", minLength: 5, maxLength: 10 },
      minItems: 5,
      maxItems: 5,
      uniqueItems: true,
    };
    for (let seed = 0; seed < 20; seed++) {
      const value = generateFromSchema(schema, ctxFor(schema, seed), "", 0) as unknown[];
      expect(value).toHaveLength(5);
      expect(new Set(value).size).toBe(5);
    }
  });

  it("shrinks the array when the item schema's cardinality is smaller than the rolled count, but minItems still permits it", () => {
    // Boolean items: only 2 distinct values exist. minItems: 1 permits shrinking to 1 or 2.
    const schema: JSONSchema = {
      type: "array",
      items: { type: "boolean" },
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
    };
    for (let seed = 0; seed < 30; seed++) {
      const value = generateFromSchema(schema, ctxFor(schema, seed), "", 0) as unknown[];
      expect(value.length).toBeGreaterThanOrEqual(1);
      expect(value.length).toBeLessThanOrEqual(2);
      expect(new Set(value).size).toBe(value.length);
    }
  });

  it("throws a clear error when minItems cannot be satisfied (boolean array, minItems: 5, uniqueItems: true)", () => {
    const schema: JSONSchema = {
      type: "array",
      items: { type: "boolean" },
      minItems: 5,
      maxItems: 5,
      uniqueItems: true,
    };
    expect(() => generateFromSchema(schema, ctxFor(schema, 1), "", 0)).toThrow(/could not generate 5 unique items/);
  });

  it("throws a clear error naming the constraint for a const-item array (cardinality 1) with minItems: 2", () => {
    const schema: JSONSchema = {
      type: "array",
      items: { const: "only-one-value" },
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
    };
    expect(() => generateFromSchema(schema, ctxFor(schema, 1), "", 0)).toThrow(/uniqueItems/);
  });

  it("without uniqueItems, duplicates are allowed (sanity check the flag actually gates behavior)", () => {
    const schema: JSONSchema = {
      type: "array",
      items: { type: "boolean" },
      minItems: 5,
      maxItems: 5,
    };
    // Should not throw even though only 2 distinct boolean values exist.
    const value = generateFromSchema(schema, ctxFor(schema, 1), "", 0) as unknown[];
    expect(value).toHaveLength(5);
  });

  it("is deterministic: same seed -> same unique array", () => {
    const schema: JSONSchema = {
      type: "array",
      items: { type: "string", minLength: 5, maxLength: 10 },
      minItems: 4,
      maxItems: 4,
      uniqueItems: true,
    };
    const a = generateFromSchema(schema, ctxFor(schema, 42), "", 0);
    const b = generateFromSchema(schema, ctxFor(schema, 42), "", 0);
    expect(a).toEqual(b);
  });
});
