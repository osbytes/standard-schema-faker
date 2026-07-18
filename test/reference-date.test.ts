import { describe, expect, it, vi } from "vitest";
import { defaultBackend } from "../src/default-backend.js";
import { createFaker, generateFromSchema } from "../src/index.js";
import type { GeneratorBackend, JSONSchema } from "../src/types.js";

/**
 * `referenceDate` (new `FakerConfig`/`GeneratorBackend.create` feature): the fixed point in
 * time every relative-date value a call generates is anchored to. Default (unconfigured) is a
 * fixed constant (`DEFAULT_REFERENCE_DATE`, `2025-01-01T00:00:00.000Z`), NOT `new Date()` --
 * so seeds stay stable across runs/days. Passing an explicit `referenceDate` is a deliberate
 * opt-in to now-ish data at the cost of cross-run stability, and shifts every generated
 * date-time/date value (and, in `defaultBackend`'s case, its unbounded [-25y, referenceDate]
 * window) accordingly -- every generated date must still be <= referenceDate.
 */

const DEFAULT_REFERENCE_DATE = new Date("2025-01-01T00:00:00.000Z");

describe("defaultBackend — referenceDate", () => {
  it("defaults produce unchanged behavior: no-bounds date() stays within [-25y, DEFAULT_REFERENCE_DATE]", () => {
    for (let seed = 0; seed < 30; seed++) {
      const instance = defaultBackend.create(seed);
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}`).toBeLessThanOrEqual(DEFAULT_REFERENCE_DATE.getTime());
    }
  });

  it("a custom referenceDate shifts the no-bounds date() window -- every value <= referenceDate", () => {
    const referenceDate = new Date("2010-06-15T00:00:00.000Z");
    for (let seed = 0; seed < 30; seed++) {
      const instance = defaultBackend.create(seed, { referenceDate });
      const value = instance.date();
      expect(value.getTime(), `seed ${seed}: ${value.toISOString()}`).toBeLessThanOrEqual(referenceDate.getTime());
    }
  });

  it("a custom referenceDate shifts the date-time/date string formats too", () => {
    const referenceDate = new Date("2010-06-15T00:00:00.000Z");
    for (let seed = 0; seed < 20; seed++) {
      const instance = defaultBackend.create(seed, { referenceDate });
      const dateTime = instance.string({ format: "date-time" });
      const parsed = Date.parse(dateTime);
      expect(Number.isNaN(parsed), `seed ${seed}: ${dateTime}`).toBe(false);
      expect(parsed, `seed ${seed}: ${dateTime}`).toBeLessThanOrEqual(referenceDate.getTime());

      const dateOnly = instance.string({ format: "date" });
      const year = Number(dateOnly.slice(0, 4));
      expect(year, `seed ${seed}: ${dateOnly}`).toBeLessThanOrEqual(2010);
    }
  });

  it("same seed + same referenceDate => deterministic", () => {
    const referenceDate = new Date("2018-03-01T00:00:00.000Z");
    const a = defaultBackend.create(42, { referenceDate }).date();
    const b = defaultBackend.create(42, { referenceDate }).date();
    expect(a.getTime()).toBe(b.getTime());
  });

  it("same seed, different referenceDate => generally different output", () => {
    const a = defaultBackend.create(7, { referenceDate: new Date("2005-01-01T00:00:00.000Z") }).date();
    const b = defaultBackend.create(7, { referenceDate: new Date("2025-01-01T00:00:00.000Z") }).date();
    expect(a.getTime()).not.toBe(b.getTime());
  });
});

describe("createFaker — referenceDate threading through fake()/fakeMany()", () => {
  // A bare `{type: 'string', format: 'date-time'}` -- deliberately no `pattern` alongside it
  // (unlike Zod's `z.iso.datetime()`, which also emits a strict validating `pattern` that wins
  // over `format` per this library's documented priority -- see generateString/default-backend's
  // "pattern takes priority over format" comment). Driving `generateFromSchema` directly here
  // isolates the `format`-driven date generation path this test actually wants to exercise.
  const dateTimeSchema: JSONSchema = { type: "string", format: "date-time" };

  function fakeDateTime(seed: number, referenceDate?: Date): string {
    const backend = defaultBackend.create(seed, referenceDate ? { referenceDate } : undefined);
    return generateFromSchema(dateTimeSchema, { backend, root: dateTimeSchema, maxDepth: 5, projection: "output" }, "", 0) as string;
  }

  it("injected referenceDate shifts generated date-time values, all <= referenceDate", () => {
    const referenceDate = new Date("2012-05-05T00:00:00.000Z");
    for (let seed = 0; seed < 20; seed++) {
      const value = fakeDateTime(seed, referenceDate);
      const parsed = Date.parse(value);
      expect(Number.isNaN(parsed), `seed ${seed}: ${value}`).toBe(false);
      expect(parsed, `seed ${seed}: ${value}`).toBeLessThanOrEqual(referenceDate.getTime());
    }
  });

  it("defaults (no referenceDate configured) stay <= the fixed DEFAULT_REFERENCE_DATE, unchanged from before this feature", () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = fakeDateTime(seed);
      const parsed = Date.parse(value);
      expect(parsed).toBeLessThanOrEqual(DEFAULT_REFERENCE_DATE.getTime());
    }
  });

  it("same seed + same referenceDate => deterministic output", () => {
    const referenceDate = new Date("2015-09-09T00:00:00.000Z");
    const a = fakeDateTime(3, referenceDate);
    const b = fakeDateTime(3, referenceDate);
    expect(a).toBe(b);
  });

  /** A minimal hand-rolled Standard Schema wrapping a bare JSON Schema document, so `createFaker`'s
   * `toJsonSchemaSync` short-circuits on the native `~standard.jsonSchema` surface without needing
   * a real vendor library — just enough Standard Schema surface for `fake`/`fakeMany` to run. */
  function jsonSchemaVendor(schema: JSONSchema) {
    return {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: { output: () => schema, input: () => schema },
      },
    };
  }

  it("createFaker({referenceDate}) passes it through to every backend.create(seed, options) call (fake + fakeMany alike)", () => {
    // Zod's own format-producing helpers (z.iso.datetime(), z.string().date(), ...) always pair
    // `format` with a strict validating `pattern` -- which wins over `format` per this library's
    // documented priority (pattern is the harder-to-satisfy constraint), so a Zod schema can't
    // isolate the format-driven date path alone (see the describe block above, which drives
    // `generateFromSchema` directly against a vendor-agnostic `{format: 'date-time'}` node
    // instead). This test instead verifies the *threading itself*: wrap `defaultBackend.create`
    // in a spy and confirm `createFaker({referenceDate})` actually calls it with
    // `{referenceDate}` on both the `fake()` and `fakeMany()` code paths.
    const referenceDate = new Date("2008-02-02T00:00:00.000Z");
    const createSpy = vi.fn(defaultBackend.create);
    const spyBackend: GeneratorBackend = { create: createSpy };
    const gen = createFaker({ referenceDate, backend: spyBackend });
    const schema = jsonSchemaVendor({ type: "string" });

    gen.fake(schema, { seed: 1 });
    expect(createSpy).toHaveBeenCalledWith(1, { referenceDate });

    createSpy.mockClear();
    gen.fakeMany(schema, 3, { seed: 2 });
    expect(createSpy).toHaveBeenCalledWith(2, { referenceDate });
  });

  it("createFaker({}) (no referenceDate) passes `undefined` options -- backend.create's own default applies", () => {
    const createSpy = vi.fn(defaultBackend.create);
    const spyBackend: GeneratorBackend = { create: createSpy };
    const gen = createFaker({ backend: spyBackend });
    const schema = jsonSchemaVendor({ type: "string" });

    gen.fake(schema, { seed: 1 });
    expect(createSpy).toHaveBeenCalledWith(1, undefined);
  });
});
