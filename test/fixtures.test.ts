import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fake } from "../src/index.js";

/**
 * Fixture matrix: one Zod schema per supported JSON Schema node kind. For each, generate
 * with a seed and assert the schema's own `~standard.validate` passes — a
 * "generated-then-validated" strategy.
 */
async function expectValid<T>(schema: z.ZodType<T>, value: unknown) {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    throw new Error(`Validation failed for value ${JSON.stringify(value)}: ${JSON.stringify(result.issues)}`);
  }
}

describe("fixture matrix — v0 node coverage", () => {
  it("string: length bounds", async () => {
    const schema = z.string().min(5).max(12);
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format email", async () => {
    const schema = z.email();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format email across many seeds (regression: default length window must not truncate formatted strings)", async () => {
    for (let seed = 0; seed < 25; seed++) {
      const schema = z.email();
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format uuid", async () => {
    const schema = z.uuid();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format uri/url", async () => {
    const schema = z.url();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format uri/url across many seeds", async () => {
    for (let seed = 0; seed < 25; seed++) {
      const schema = z.url();
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format date-time", async () => {
    const schema = z.iso.datetime();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format date", async () => {
    const schema = z.iso.date();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format ipv4", async () => {
    const schema = z.ipv4();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
  });

  it("string: format ipv6", async () => {
    const schema = z.ipv6();
    for (let seed = 0; seed < 15; seed++) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format hostname (no dedicated zod helper — construct a raw JSON Schema)", async () => {
    // Zod has no z.hostname()-style helper that emits format: "hostname" without also
    // emitting a pattern (which would take priority and mask whether the format-only path
    // works) -- so exercise it directly against the walker with a hand-built schema, then
    // sanity-check the shape with a real hostname regex.
    const { generateFromSchema, defaultBackend } = await import("../src/index.js");
    const schema = { type: "string", format: "hostname" };
    const hostnameRegex = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
    for (let seed = 0; seed < 15; seed++) {
      const backend = defaultBackend.create(seed);
      const value = generateFromSchema(schema, { backend, root: schema, maxDepth: 5, projection: "output" }, "", 0);
      expect(hostnameRegex.test(value as string), `seed ${seed}: ${value}`).toBe(true);
    }
  });

  it("string: format time", async () => {
    const schema = z.iso.time();
    for (let seed = 0; seed < 15; seed++) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format duration", async () => {
    const schema = z.iso.duration();
    for (let seed = 0; seed < 25; seed++) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format base64", async () => {
    const schema = z.base64();
    for (let seed = 0; seed < 25; seed++) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format jwt (structurally valid — header/payload are real base64url JSON)", async () => {
    const schema = z.jwt();
    for (let seed = 0; seed < 25; seed++) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("string: format jwt is deterministic per seed", () => {
    const schema = z.jwt();
    const a = fake(schema, { seed: 42 });
    const b = fake(schema, { seed: 42 });
    expect(a).toBe(b);
  });

  it("string: format iri/iri-reference/uri-reference (no zod helper — hand-built schema, sanity-checked as a valid URL)", async () => {
    const { generateFromSchema, defaultBackend } = await import("../src/index.js");
    for (const format of ["iri", "iri-reference", "uri-reference"]) {
      const schema = { type: "string", format };
      const backend = defaultBackend.create(1);
      const value = generateFromSchema(schema, { backend, root: schema, maxDepth: 5, projection: "output" }, "", 0);
      expect(() => new URL(value as string)).not.toThrow();
    }
  });

  it("integer: min/max/multipleOf", async () => {
    const schema = z.int().min(0).max(100).multipleOf(5);
    const value = fake(schema, { seed: 7 });
    await expectValid(schema, value);
  });

  it("number: exclusiveMin/exclusiveMax", async () => {
    const schema = z.number().gt(0).lt(1);
    const value = fake(schema, { seed: 7 });
    await expectValid(schema, value);
  });

  it("boolean", async () => {
    const schema = z.boolean();
    const value = fake(schema, { seed: 3 });
    await expectValid(schema, value);
  });

  it("enum", async () => {
    const schema = z.enum(["red", "green", "blue"]);
    const value = fake(schema, { seed: 3 });
    await expectValid(schema, value);
  });

  it("const / literal", async () => {
    const schema = z.literal("fixed-value");
    const value = fake(schema, { seed: 3 });
    await expectValid(schema, value);
  });

  it("object: required always, optional by probability", async () => {
    const schema = z.object({
      id: z.string(),
      nickname: z.string().optional(),
    });
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("array: minItems/maxItems default 1-3", async () => {
    const schema = z.array(z.string());
    const value = fake(schema, { seed: 9 });
    expect(value.length).toBeGreaterThanOrEqual(1);
    expect(value.length).toBeLessThanOrEqual(3);
    await expectValid(schema, value);
  });

  it("array: explicit minItems/maxItems", async () => {
    const schema = z.array(z.number()).min(2).max(4);
    const value = fake(schema, { seed: 9 });
    expect(value.length).toBeGreaterThanOrEqual(2);
    expect(value.length).toBeLessThanOrEqual(4);
    await expectValid(schema, value);
  });

  it("array: tuple via prefixItems", async () => {
    const schema = z.tuple([z.string(), z.number(), z.boolean()]);
    const value = fake(schema, { seed: 9 });
    await expectValid(schema, value);
  });

  it("anyOf/union: seeded pick", async () => {
    const schema = z.union([z.string(), z.number(), z.boolean()]);
    for (const seed of [1, 2, 3, 4, 5]) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
    }
  });

  it("allOf: shallow merge (intersection)", async () => {
    const A = z.object({ a: z.string() });
    const B = z.object({ b: z.number() });
    const schema = z.intersection(A, B);
    const value = fake(schema, { seed: 11 });
    await expectValid(schema, value);
  });

  it("nullable: probability of null when allowed", async () => {
    const schema = z.string().nullable();
    let sawNull = false;
    let sawString = false;
    for (let seed = 0; seed < 30; seed++) {
      const value = fake(schema, { seed });
      await expectValid(schema, value);
      if (value === null) sawNull = true;
      else sawString = true;
    }
    expect(sawNull).toBe(true);
    expect(sawString).toBe(true);
  });

  it("$ref/$defs: shared sub-schema via registry", async () => {
    const Address = z.object({ city: z.string() });
    const schema = z.object({ home: Address, work: Address });
    const value = fake(schema, { seed: 12 });
    await expectValid(schema, value);
  });

  it("null type", async () => {
    const schema = z.null();
    const value = fake(schema, { seed: 1 });
    await expectValid(schema, value);
    expect(value).toBeNull();
  });
});
