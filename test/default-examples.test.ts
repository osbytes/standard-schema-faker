import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, fake } from "../src/index.js";

/**
 * `default` / `examples` node kinds:
 *   - `default`: in the `output` projection, prefer the declared default some of the time
 *     (seeded probability).
 *   - `examples`: when present, pick from examples with some probability (free realism).
 * Both are seeded coin flips through the shared backend instance, so behavior is
 * deterministic per seed (same seed -> same choice) while varying across seeds.
 */
describe("default keyword", () => {
  const WithDefault = z.object({ tag: z.string().min(20).max(30).default("untagged") });

  it("output projection sometimes uses the declared default, sometimes generates normally, across seeds", () => {
    const gen = createFaker({ io: "output" });
    let sawDefault = false;
    let sawGenerated = false;
    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(WithDefault, { seed });
      if (value.tag === "untagged") sawDefault = true;
      else sawGenerated = true;
    }
    expect(sawDefault).toBe(true);
    expect(sawGenerated).toBe(true);
  });

  it("is deterministic per seed: same seed always makes the same default-vs-generated choice", () => {
    const gen = createFaker({ io: "output" });
    for (const seed of [1, 2, 3, 4, 5, 10, 20]) {
      const a = gen.fake(WithDefault, { seed });
      const b = gen.fake(WithDefault, { seed });
      expect(a).toEqual(b);
    }
  });

  it("input projection does not prefer the default (the field is simply optional there)", () => {
    // `io: 'input'` never hits the `ctx.projection === 'output'` branch that prefers
    // `default`, so the default value itself should never appear as a *generated* value where
    // the underlying type wouldn't naturally produce it — here, a 20-30 char random string
    // essentially never equals the literal "untagged" (9 chars) by chance.
    const gen = createFaker({ io: "input" });
    let sawLiteralDefaultValue = false;
    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(WithDefault, { seed });
      if (value.tag === "untagged") sawLiteralDefaultValue = true;
    }
    expect(sawLiteralDefaultValue).toBe(false);
  });
});

describe("examples keyword", () => {
  // Example values must themselves satisfy the schema's own constraints (minLength: 20) for
  // the "every generated value passes validate()" test below to be meaningful.
  const examples = ["alpha-example-value-one", "beta-example-value-two", "gamma-example-value-three"];
  const WithExamples = z.string().min(20).max(30).meta({ examples });

  it("sometimes picks from examples, sometimes generates normally, across seeds", () => {
    let sawExample = false;
    let sawGenerated = false;
    for (let seed = 0; seed < 40; seed++) {
      const value = fake(WithExamples, { seed });
      if (examples.includes(value)) sawExample = true;
      else sawGenerated = true;
    }
    expect(sawExample).toBe(true);
    expect(sawGenerated).toBe(true);
  });

  it("is deterministic per seed", () => {
    for (const seed of [1, 2, 3, 4, 5, 10, 20]) {
      const a = fake(WithExamples, { seed });
      const b = fake(WithExamples, { seed });
      expect(a).toBe(b);
    }
  });

  it("every generated value (example or not) passes the schema's own validate()", async () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = fake(WithExamples, { seed });
      const result = await WithExamples["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });
});
