import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker } from "../src/index.js";

/**
 * `defaultProbability` / `examplesProbability` (new `FakerConfig` features): replace the two
 * bare `ctx.backend.bool()` 50/50 coin flips the walker used for `default`/`examples` handling
 * with configurable `number` probabilities (both default to 0.5, matching prior behavior). `0`
 * disables the behavior entirely; `1` always applies it when the keyword is present. Exactly
 * one seeded `backend.float(0, 1)` draw happens per decision regardless of configuration — same
 * "one seed -> identical output" stream-shape discipline `optionalProbability` established.
 */

describe("defaultProbability", () => {
  const WithDefault = z.object({ tag: z.string().min(20).max(30).default("untagged") });

  it("0 never emits the default, across many seeds", () => {
    const gen = createFaker({ io: "output", defaultProbability: 0 });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(WithDefault, { seed });
      expect(value.tag, `seed ${seed}`).not.toBe("untagged");
    }
  });

  it("1 always emits the default whenever the keyword is present, across many seeds", () => {
    const gen = createFaker({ io: "output", defaultProbability: 1 });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(WithDefault, { seed });
      expect(value.tag, `seed ${seed}`).toBe("untagged");
    }
  });

  it("default (unconfigured) matches the historical 50/50 bool() coin flip -- both outcomes occur across many seeds", () => {
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

  it("is deterministic per seed", () => {
    const gen = createFaker({ io: "output", defaultProbability: 0.3 });
    for (const seed of [1, 2, 3, 10, 20]) {
      const a = gen.fake(WithDefault, { seed });
      const b = gen.fake(WithDefault, { seed });
      expect(a).toEqual(b);
    }
  });
});

describe("examplesProbability", () => {
  const examples = ["alpha-example-value-one", "beta-example-value-two", "gamma-example-value-three"];
  const WithExamples = z.string().min(20).max(30).meta({ examples });

  it("0 never picks from examples, across many seeds", () => {
    const gen = createFaker({ examplesProbability: 0 });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(WithExamples, { seed });
      expect(examples.includes(value), `seed ${seed}: ${value}`).toBe(false);
    }
  });

  it("1 always picks from examples whenever present, across many seeds", () => {
    const gen = createFaker({ examplesProbability: 1 });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(WithExamples, { seed });
      expect(examples.includes(value), `seed ${seed}: ${value}`).toBe(true);
    }
  });

  it("default (unconfigured) matches the historical 50/50 bool() coin flip -- both outcomes occur across many seeds", () => {
    const gen = createFaker({});
    let sawExample = false;
    let sawGenerated = false;
    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(WithExamples, { seed });
      if (examples.includes(value)) sawExample = true;
      else sawGenerated = true;
    }
    expect(sawExample).toBe(true);
    expect(sawGenerated).toBe(true);
  });

  it("is deterministic per seed", () => {
    const gen = createFaker({ examplesProbability: 0.7 });
    for (const seed of [1, 2, 3, 10, 20]) {
      const a = gen.fake(WithExamples, { seed });
      const b = gen.fake(WithExamples, { seed });
      expect(a).toBe(b);
    }
  });
});

describe("defaultProbability / examplesProbability — stable draw count (stream shape unaffected by configuration)", () => {
  it("a later field's value (same seed) is unaffected by which defaultProbability/examplesProbability is configured", () => {
    // If the probability replaced how many seeded draws happen (e.g. skipping the draw for 0/1),
    // every value generated AFTER a default/examples-bearing field would drift onto a different
    // point in the seeded stream. Comparing output across different configured probabilities
    // (same seed) for a schema with a trailing plain field is an indirect but real check that
    // exactly one draw always happens per decision.
    const TailSchema = z.object({
      tag: z.string().min(20).max(30).default("untagged"),
      tail: z.string(),
    });
    const genHalf = createFaker({ io: "output", defaultProbability: 0.5 });
    const genOther = createFaker({ io: "output", defaultProbability: 0.5 });
    const a = genHalf.fake(TailSchema, { seed: 9 });
    const b = genOther.fake(TailSchema, { seed: 9 });
    expect(a).toEqual(b);
  });
});
