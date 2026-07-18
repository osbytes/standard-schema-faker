import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, fake, fakeMany } from "../src/index.js";

const ComplexSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  age: z.int().min(18).max(99),
  tags: z.array(z.string()).max(3),
  role: z.enum(["admin", "user", "guest"]),
  nickname: z.string().optional(),
  address: z
    .object({
      city: z.string(),
      zip: z.string().min(5).max(5),
    })
    .nullable(),
});

describe("determinism", () => {
  it("fake(schema, {seed}) deep-equals across two fresh calls", () => {
    const a = fake(ComplexSchema, { seed: 42 });
    const b = fake(ComplexSchema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("fake(schema, {seed}) deep-equals across two fresh createFaker() instances", () => {
    const genA = createFaker();
    const genB = createFaker();
    const a = genA.fake(ComplexSchema, { seed: 123 });
    const b = genB.fake(ComplexSchema, { seed: 123 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different values", () => {
    const a = fake(ComplexSchema, { seed: 1 });
    const b = fake(ComplexSchema, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it("fakeMany is deterministic as a whole sequence", () => {
    const a = fakeMany(ComplexSchema, 10, { seed: 42 });
    const b = fakeMany(ComplexSchema, 10, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("fakeMany produces a sequence of differing items (not the same value repeated)", () => {
    const items = fakeMany(z.int().min(0).max(1_000_000), 20, { seed: 42 });
    const uniqueCount = new Set(items).size;
    expect(uniqueCount).toBeGreaterThan(1);
  });

  it("fakeMany(schema, n) length matches n", () => {
    const items = fakeMany(z.string(), 5, { seed: 1 });
    expect(items).toHaveLength(5);
  });

  it("random (unseeded) calls are not required to match, but each is internally valid", async () => {
    const a = fake(ComplexSchema);
    const result = await ComplexSchema["~standard"].validate(a);
    expect(result.issues).toBeUndefined();
  });
});
