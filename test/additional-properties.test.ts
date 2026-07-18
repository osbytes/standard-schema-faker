import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fake } from "../src/index.js";

/**
 * `additionalProperties` schema-form generation: `z.record(K, V)` must generate a real
 * open-ended dictionary rather than `{}`. Zod v4's own `~standard.jsonSchema` output for
 * `z.record(...)`, verified at runtime:
 *
 *   - `z.record(z.string(), V)` -> `{type: 'object', propertyNames: {type: 'string'},
 *     additionalProperties: <V schema>}` — no `properties` keyword at all.
 *   - `z.record(z.string().regex(p), V)` -> same, `propertyNames` also carries `pattern: p`.
 *   - `z.record(z.enum([...]), V)` -> `propertyNames` carries `enum: [...]`, AND every enum
 *     value is also listed in the object's own top-level `required` — Zod's way of saying
 *     "this is a closed, exhaustive key set" (a fixed-shape object wearing
 *     `additionalProperties` syntax), not an open-ended dictionary.
 */
describe("additionalProperties: z.record(z.string(), V) — open-ended dictionary", () => {
  it("generates at least 1 entry, every value matching V's schema", async () => {
    const schema = z.record(z.string(), z.number().min(0).max(100));
    for (let seed = 0; seed < 20; seed++) {
      const value = fake(schema, { seed });
      const keys = Object.keys(value);
      expect(keys.length, `seed ${seed}: ${JSON.stringify(value)}`).toBeGreaterThanOrEqual(1);
      for (const key of keys) {
        expect(typeof value[key]).toBe("number");
        expect(value[key]).toBeGreaterThanOrEqual(0);
        expect(value[key]).toBeLessThanOrEqual(100);
      }
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("keys are non-empty plain strings when propertyNames has no pattern/format/enum", () => {
    const schema = z.record(z.string(), z.boolean());
    for (let seed = 0; seed < 10; seed++) {
      const value = fake(schema, { seed });
      for (const key of Object.keys(value)) {
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic: same seed -> deep-equal output", () => {
    const schema = z.record(z.string(), z.number());
    const a = fake(schema, { seed: 42 });
    const b = fake(schema, { seed: 42 });
    expect(a).toEqual(b);
  });
});

describe("additionalProperties: z.record(z.string().regex(pattern), V) — keys honor the pattern", () => {
  it("every generated key matches the propertyNames pattern, and passes validate()", async () => {
    const schema = z.record(z.string().regex(/^[a-z]{3,6}$/), z.number());
    for (let seed = 0; seed < 20; seed++) {
      const value = fake(schema, { seed });
      const keys = Object.keys(value);
      expect(keys.length, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      for (const key of keys) {
        expect(/^[a-z]{3,6}$/.test(key), `seed ${seed}: key "${key}"`).toBe(true);
      }
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });
});

describe("additionalProperties: z.record(z.enum([...]), V) — closed key set, not open-ended", () => {
  it("generates EXACTLY the enum keys, no more, no fewer, across many seeds", async () => {
    const schema = z.record(z.enum(["phone", "email", "fax"]), z.string());
    for (let seed = 0; seed < 20; seed++) {
      const value = fake(schema, { seed });
      expect(Object.keys(value).sort(), `seed ${seed}`).toEqual(["email", "fax", "phone"]);
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("each enum key's value matches V's own schema", () => {
    const schema = z.record(z.enum(["a", "b"]), z.number().min(10).max(20));
    const value = fake(schema, { seed: 1 });
    expect(value.a).toBeGreaterThanOrEqual(10);
    expect(value.a).toBeLessThanOrEqual(20);
    expect(value.b).toBeGreaterThanOrEqual(10);
    expect(value.b).toBeLessThanOrEqual(20);
  });
});

describe("additionalProperties: declared properties are never overwritten by synthesized keys", () => {
  it("a schema with both declared properties AND additionalProperties keeps the declared ones intact", async () => {
    // z.object({...}).catchall(V) is Zod's way of adding additionalProperties to an object
    // that also has its own declared properties.
    const schema = z.object({ id: z.string() }).catchall(z.number());
    for (let seed = 0; seed < 15; seed++) {
      const value = fake(schema, { seed });
      expect(typeof value.id).toBe("string");
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });
});

describe("additionalProperties: an object WITHOUT additionalProperties still generates no extra keys (regression guard)", () => {
  it("a plain z.object() never synthesizes keys beyond its declared properties", () => {
    const schema = z.object({ id: z.string(), name: z.string() });
    for (let seed = 0; seed < 15; seed++) {
      const value = fake(schema, { seed });
      expect(Object.keys(value).sort()).toEqual(["id", "name"]);
    }
  });
});
