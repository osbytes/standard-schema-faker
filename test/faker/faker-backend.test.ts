import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultHeuristics, fakerBackend } from "../../src/faker/index.js";
import { createFaker } from "../../src/index.js";

/**
 * `fakerBackend` — a `GeneratorBackend` implementation over `@faker-js/faker`. Re-runs a
 * subset of core's fixture matrix against fakerBackend to confirm validation still passes,
 * plus determinism checks specific to this backend.
 */
describe("fakerBackend — fixture matrix subset", () => {
  const gen = createFaker({ backend: fakerBackend });

  it("string: format email", async () => {
    const schema = z.email();
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}`).toBeUndefined();
    }
  });

  it("string: format uuid", async () => {
    const schema = z.uuid();
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}`).toBeUndefined();
    }
  });

  it("string: format uri/url", async () => {
    const schema = z.url();
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}`).toBeUndefined();
    }
  });

  it("string: format date-time", async () => {
    const schema = z.iso.datetime();
    const value = gen.fake(schema, { seed: 1 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("string: format date", async () => {
    const schema = z.iso.date();
    const value = gen.fake(schema, { seed: 1 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("string: format ipv4", async () => {
    const schema = z.ipv4();
    const value = gen.fake(schema, { seed: 1 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("string: format ipv6", async () => {
    const schema = z.ipv6();
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}`).toBeUndefined();
    }
  });

  it("string: format time", async () => {
    const schema = z.iso.time();
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}`).toBeUndefined();
    }
  });

  it("string: format duration", async () => {
    const schema = z.iso.duration();
    for (let seed = 0; seed < 25; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("string: format base64", async () => {
    const schema = z.base64();
    for (let seed = 0; seed < 25; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("string: format jwt", async () => {
    const schema = z.jwt();
    for (let seed = 0; seed < 25; seed++) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(value)}`).toBeUndefined();
    }
  });

  it("string: format jwt is deterministic per seed", () => {
    const schema = z.jwt();
    const a = gen.fake(schema, { seed: 42 });
    const b = gen.fake(schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("string: unformatted, honors min/maxLength bounds", () => {
    const schema = z.string().min(20).max(30);
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(schema, { seed });
      expect(value.length).toBeGreaterThanOrEqual(20);
      expect(value.length).toBeLessThanOrEqual(30);
    }
  });

  it("integer: min/max/multipleOf", async () => {
    const schema = z.int().min(0).max(100).multipleOf(5);
    const value = gen.fake(schema, { seed: 7 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("number: exclusive bounds", async () => {
    const schema = z.number().gt(0).lt(1);
    const value = gen.fake(schema, { seed: 7 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("boolean", async () => {
    const schema = z.boolean();
    const value = gen.fake(schema, { seed: 3 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("enum", async () => {
    const schema = z.enum(["red", "green", "blue"]);
    const value = gen.fake(schema, { seed: 3 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("object: required + optional, array, nested", async () => {
    const schema = z.object({
      id: z.uuid(),
      email: z.email(),
      age: z.int().min(18).max(99),
      tags: z.array(z.string()).max(3),
      nickname: z.string().optional(),
    });
    for (const seed of [1, 2, 3, 4, 5]) {
      const value = gen.fake(schema, { seed });
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(result.issues)}`).toBeUndefined();
    }
  });

  it("string: pattern (bounded randexp-style, reused from core)", () => {
    const schema = z.string().regex(/^\d{3}-\d{3}-\d{4}$/);
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      expect(/^\d{3}-\d{3}-\d{4}$/.test(value), `seed ${seed}: ${value}`).toBe(true);
    }
  });
});

describe("fakerBackend — never truncates a formatted value to satisfy length bounds", () => {
  // A `format` must win over min/maxLength, since truncating/padding a formatted value
  // (email, uuid, url, ip, date string) corrupts it.
  const gen = createFaker({ backend: fakerBackend });

  it("email stays a valid, untruncated email even though the walker synthesizes no length bound for it", async () => {
    const schema = z.email();
    for (let seed = 0; seed < 25; seed++) {
      const value = gen.fake(schema, { seed });
      expect(value).toContain("@");
      const result = await schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${value}`).toBeUndefined();
    }
  });

  it("uuid is always the full 36-character shape, never clamped", () => {
    const schema = z.uuid();
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(schema, { seed });
      expect(value).toHaveLength(36);
    }
  });
});

describe("fakerBackend — pattern respects length bounds via re-roll, never crops", () => {
  // Same behavior as core's default-backend.ts: `pattern` and `minLength`/`maxLength` are
  // independent, simultaneous JSON Schema constraints -- ignoring the length bounds whenever a
  // pattern is present (json-schema-faker's most-reported bug class) produces values that
  // match the pattern but violate the schema's own length bounds.
  const gen = createFaker({ backend: fakerBackend });

  it("a variable-length quantifier pattern (a+) converges to a value within a tight maxLength for MOST seeds (best-effort re-roll, not a guarantee)", () => {
    // `a+` can generate 1..MAX_UNBOUNDED_REPS (10) characters -- only 3 of those 10 lengths
    // satisfy min(1).max(3), so convergence within the retry budget is likely but not
    // guaranteed for every seed. Every value must still match the pattern itself regardless.
    const schema = z.string().min(1).max(3).regex(/^a+$/);
    let withinWindow = 0;
    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(schema, { seed });
      expect(/^a+$/.test(value), `seed ${seed}: "${value}" must always match the pattern itself`).toBe(true);
      if (value.length >= 1 && value.length <= 3) withinWindow++;
    }
    expect(withinWindow, "a solid majority of seeds should converge within the retry budget").toBeGreaterThan(15);
  });

  it("an impossible pattern/length combination does not loop forever, and never truncates the pattern match", () => {
    const schema = z
      .string()
      .max(3)
      .regex(/^a{10}$/);
    const start = Date.now();
    const value = gen.fake(schema, { seed: 1 });
    expect(Date.now() - start, "must not hang/loop forever").toBeLessThan(1000);
    expect(value).toBe("aaaaaaaaaa"); // unchanged -- still matches the pattern, still 10 chars
  });
});

describe("fakerBackend — determinism (within this @faker-js/faker version)", () => {
  it("same seed -> same output, two fresh calls", () => {
    const gen = createFaker({ backend: fakerBackend });
    const Schema = z.object({
      id: z.uuid(),
      email: z.email(),
      age: z.int().min(18).max(99),
      tags: z.array(z.string()).max(3),
    });

    const a = gen.fake(Schema, { seed: 42 });
    const b = gen.fake(Schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("same seed -> same output, two fresh createFaker() instances", () => {
    const genA = createFaker({ backend: fakerBackend });
    const genB = createFaker({ backend: fakerBackend });
    const Schema = z.array(z.string()).min(3).max(3);

    const a = genA.fake(Schema, { seed: 123 });
    const b = genB.fake(Schema, { seed: 123 });
    expect(a).toEqual(b);
  });

  it("fakeMany is deterministic as a whole sequence", () => {
    const gen = createFaker({ backend: fakerBackend });
    const Schema = z.string();

    const a = gen.fakeMany(Schema, 10, { seed: 42 });
    const b = gen.fakeMany(Schema, 10, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different values", () => {
    const gen = createFaker({ backend: fakerBackend });
    const Schema = z.object({ id: z.uuid(), email: z.email() });

    const a = gen.fake(Schema, { seed: 1 });
    const b = gen.fake(Schema, { seed: 2 });
    expect(a).not.toEqual(b);
  });
});

describe("fakerBackend — dates are anchored to a fixed reference point, not Date.now()", () => {
  // faker.date.anytime()/past()/recent()/soon()/birthdate() all default their `refDate` option
  // to the real WALL-CLOCK time when omitted -- so the exact same seed would otherwise produce
  // a DIFFERENT date depending on which day/hour the process happened to run, silently
  // violating "same seed -> identical output" (mirrors faker-js/faker#1870, an unresolved
  // upstream issue, and zod-mock's own open "Generate all Dates in a stable way" feature
  // request).
  //
  // Every relative-date call in this package now passes an explicit, FIXED refDate (or
  // equivalent {from,to} bounds) -- see index.ts's REFERENCE_DATE. The decisive test isn't
  // "two calls in the same test run match" (that would pass even with the bug, since Date.now()
  // barely moves between two calls milliseconds apart) -- it's that every date produced falls
  // within a FIXED window that has NOTHING to do with when the test suite happens to run.
  const FIXED_WINDOW_START = new Date("1900-01-01T00:00:00.000Z").getTime();
  const REFERENCE_DATE = new Date("2025-01-01T00:00:00.000Z").getTime();

  it("BackendInstance.date() with no bounds stays within the fixed window across many seeds", () => {
    for (let seed = 0; seed < 30; seed++) {
      const instance = fakerBackend.create(seed);
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeGreaterThanOrEqual(FIXED_WINDOW_START);
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeLessThanOrEqual(REFERENCE_DATE);
    }
  });

  it("format: date-time (the anytime()-equivalent format) stays within the fixed window", () => {
    for (let seed = 0; seed < 20; seed++) {
      const instance = fakerBackend.create(seed);
      const dateTimeValue = instance.string({ format: "date-time" });
      const parsed = Date.parse(dateTimeValue);
      expect(Number.isNaN(parsed), `seed ${seed}: ${dateTimeValue}`).toBe(false);
      expect(parsed, `seed ${seed}: ${dateTimeValue}`).toBeGreaterThanOrEqual(FIXED_WINDOW_START);
      expect(parsed, `seed ${seed}: ${dateTimeValue}`).toBeLessThanOrEqual(REFERENCE_DATE);
    }
  });

  it("format: date stays within the fixed window (year component only)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const instance = fakerBackend.create(seed);
      const dateValue = instance.string({ format: "date" });
      const year = Number(dateValue.slice(0, 4));
      expect(year, `seed ${seed}: ${dateValue}`).toBeGreaterThanOrEqual(1900);
      expect(year, `seed ${seed}: ${dateValue}`).toBeLessThanOrEqual(2025);
    }
  });

  it("format: time produces a valid HH:MM:SS string regardless of when the test runs", () => {
    for (let seed = 0; seed < 10; seed++) {
      const instance = fakerBackend.create(seed);
      const timeValue = instance.string({ format: "time" });
      expect(timeValue, `seed ${seed}`).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
  });

  it("two backend instances with the same seed produce deep-equal dates (basic determinism, still holds)", () => {
    const a = fakerBackend.create(7).date();
    const b = fakerBackend.create(7).date();
    expect(a).toEqual(b);
  });

  it("defaultHeuristics' createdAt/updatedAt/deletedAt/birthDate are also anchored (not Date.now())", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Schema = z.object({
      createdAt: z.string(),
      updatedAt: z.string(),
      deletedAt: z.string(),
      birthDate: z.string(),
    });

    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const [field, raw] of Object.entries(value)) {
        const parsed = Date.parse(raw);
        expect(Number.isNaN(parsed), `seed ${seed}, ${field}: ${raw}`).toBe(false);
        expect(parsed, `seed ${seed}, ${field}: ${raw}`).toBeLessThanOrEqual(REFERENCE_DATE);
      }
    }
  });

  it("createdAt/updatedAt/birthDate are deterministic across two fresh generator instances (same seed)", () => {
    const gen1 = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const gen2 = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Schema = z.object({ createdAt: z.string(), updatedAt: z.string(), birthDate: z.string() });

    const a = gen1.fake(Schema, { seed: 99 });
    const b = gen2.fake(Schema, { seed: 99 });
    expect(a).toEqual(b);
  });
});
