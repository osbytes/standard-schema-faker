import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultHeuristics, fakerBackend, REFERENCE_DATE } from "../../src/faker/index.js";
import { createFaker } from "../../src/index.js";

/**
 * `referenceDate` threaded through `fakerBackend` -- `faker.setDefaultRefDate(options
 * ?.referenceDate ?? REFERENCE_DATE)` is called once per `.create(seed, options)`, so every
 * relative-date faker method this instance's methods call (`anytime`/`past`/`recent`/`soon`/
 * `birthdate`) inherits it automatically, no per-call refDate argument needed.
 */

describe("fakerBackend — referenceDate", () => {
  it("defaults to REFERENCE_DATE: no-bounds date() stays <= REFERENCE_DATE", () => {
    for (let seed = 0; seed < 20; seed++) {
      const instance = fakerBackend.create(seed);
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
    }
  });

  it("a custom referenceDate shifts no-bounds date()/date-time format, still <= referenceDate", () => {
    const referenceDate = new Date("2010-06-15T00:00:00.000Z");
    for (let seed = 0; seed < 20; seed++) {
      const instance = fakerBackend.create(seed, { referenceDate });
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeLessThanOrEqual(referenceDate.getTime());

      const dateTime = instance.string({ format: "date-time" });
      const parsed = Date.parse(dateTime);
      expect(parsed, `seed ${seed}: ${dateTime}`).toBeLessThanOrEqual(referenceDate.getTime());
    }
  });

  it("same seed + same referenceDate => deterministic", () => {
    const referenceDate = new Date("2016-04-04T00:00:00.000Z");
    const a = fakerBackend.create(11, { referenceDate }).date();
    const b = fakerBackend.create(11, { referenceDate }).date();
    expect(a.getTime()).toBe(b.getTime());
  });

  it("same seed, different referenceDate => generally shifts output", () => {
    const a = fakerBackend.create(5, { referenceDate: new Date("2005-01-01T00:00:00.000Z") }).date();
    const b = fakerBackend.create(5, { referenceDate: new Date("2020-01-01T00:00:00.000Z") }).date();
    expect(a.getTime()).not.toBe(b.getTime());
  });
});

describe("defaultHeuristics — createdAt/birthDate honor a configured referenceDate", () => {
  const Schema = z.object({
    createdAt: z.string(),
    birthDate: z.string(),
  });

  it("createdAt/birthDate stay <= a configured referenceDate", () => {
    const referenceDate = new Date("2012-01-01T00:00:00.000Z");
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics, referenceDate });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(Date.parse(value.createdAt), `seed ${seed}: ${value.createdAt}`).toBeLessThanOrEqual(referenceDate.getTime());
      expect(Date.parse(value.birthDate), `seed ${seed}: ${value.birthDate}`).toBeLessThanOrEqual(referenceDate.getTime());
    }
  });

  it("defaults (no referenceDate) stay <= REFERENCE_DATE, unchanged from before this feature", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(Date.parse(value.createdAt)).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
      expect(Date.parse(value.birthDate)).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
    }
  });

  it("same seed + same referenceDate => deterministic", () => {
    const referenceDate = new Date("2019-07-07T00:00:00.000Z");
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics, referenceDate });
    const a = gen.fake(Schema, { seed: 4 });
    const b = gen.fake(Schema, { seed: 4 });
    expect(a).toEqual(b);
  });
});
