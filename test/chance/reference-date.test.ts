import { describe, expect, it } from "vitest";
import { z } from "zod";
import { chanceBackend, chanceHeuristics, REFERENCE_DATE } from "../../src/chance/index.js";
import { createFaker } from "../../src/index.js";

/**
 * `referenceDate` threaded through `chanceBackend` — every relative-date value this backend
 * produces is derived from a seeded integer draw over an explicit `[windowStart, windowEnd]`
 * window anchored to `options?.referenceDate ?? REFERENCE_DATE` (see chance/index.ts's `create`),
 * never `chance`'s own un-seeded "now"-relative helpers. Mirrors
 * test/faker/reference-date.test.ts's structure.
 */

describe("chanceBackend — referenceDate", () => {
  it("defaults to REFERENCE_DATE: no-bounds date() stays <= REFERENCE_DATE", () => {
    for (let seed = 0; seed < 20; seed++) {
      const instance = chanceBackend.create(seed);
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
    }
  });

  it("a custom referenceDate shifts no-bounds date()/date-time format, still <= referenceDate", () => {
    const referenceDate = new Date("2010-06-15T00:00:00.000Z");
    for (let seed = 0; seed < 20; seed++) {
      const instance = chanceBackend.create(seed, { referenceDate });
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeLessThanOrEqual(referenceDate.getTime());

      const dateTime = instance.string({ format: "date-time" });
      const parsed = Date.parse(dateTime);
      expect(parsed, `seed ${seed}: ${dateTime}`).toBeLessThanOrEqual(referenceDate.getTime());
    }
  });

  it("same seed + same referenceDate => deterministic", () => {
    const referenceDate = new Date("2016-04-04T00:00:00.000Z");
    const a = chanceBackend.create(11, { referenceDate }).date();
    const b = chanceBackend.create(11, { referenceDate }).date();
    expect(a.getTime()).toBe(b.getTime());
  });

  it("same seed, different referenceDate => generally shifts output", () => {
    const a = chanceBackend.create(5, { referenceDate: new Date("2005-01-01T00:00:00.000Z") }).date();
    const b = chanceBackend.create(5, { referenceDate: new Date("2020-01-01T00:00:00.000Z") }).date();
    expect(a.getTime()).not.toBe(b.getTime());
  });
});

describe("chanceHeuristics — createdAt/birthDate honor a configured referenceDate", () => {
  const Schema = z.object({
    createdAt: z.string(),
    birthDate: z.string(),
  });

  it("createdAt/birthDate stay <= a configured referenceDate", () => {
    const referenceDate = new Date("2012-01-01T00:00:00.000Z");
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics, referenceDate });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(Date.parse(value.createdAt), `seed ${seed}: ${value.createdAt}`).toBeLessThanOrEqual(referenceDate.getTime());
      expect(Date.parse(value.birthDate), `seed ${seed}: ${value.birthDate}`).toBeLessThanOrEqual(referenceDate.getTime());
    }
  });

  it("defaults (no referenceDate) stay <= REFERENCE_DATE, unchanged from before this feature", () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(Date.parse(value.createdAt)).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
      expect(Date.parse(value.birthDate)).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
    }
  });

  it("same seed + same referenceDate => deterministic", () => {
    const referenceDate = new Date("2019-07-07T00:00:00.000Z");
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics, referenceDate });
    const a = gen.fake(Schema, { seed: 4 });
    const b = gen.fake(Schema, { seed: 4 });
    expect(a).toEqual(b);
  });
});
