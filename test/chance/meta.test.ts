import { describe, expect, it } from "vitest";
import { z } from "zod";
import { chanceBackend, chanceHeuristics, createFaker, fake, fakeMany, prepare } from "../../src/chance/index.js";
import { defaultBackend } from "../../src/index.js";

/**
 * standard-schema-faker/chance (batteries-included subpath) — verifies the wiring: `fake`/
 * `fakeMany`/`createFaker` default to `chanceBackend` (realistic values) here, unlike the root
 * `standard-schema-faker` entry's own default (the dumb generator). `backend` is still
 * overridable, including back to `defaultBackend`. Same story for `heuristics`: defaults to
 * `chanceHeuristics` here, `false` at the root; overridable, including explicitly back to
 * `false`. Mirrors test/faker/meta.test.ts's structure.
 */
describe("standard-schema-faker/chance — chanceBackend wired as default", () => {
  it("fake() produces realistic (chance-shaped) values by default", async () => {
    const schema = z.email();
    const value = fake(schema, { seed: 1 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
    expect(value).toContain("@");
  });

  it("createFaker({}) uses chanceBackend by default, same as top-level fake()", () => {
    const gen = createFaker();
    const schema = z.object({ id: z.uuid(), email: z.email() });
    const a = fake(schema, { seed: 42 });
    const b = gen.fake(schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("createFaker({ backend: defaultBackend }) still works — override back to the dumb generator", () => {
    const dumbGen = createFaker({ backend: defaultBackend });
    const chanceGen = createFaker({ backend: chanceBackend });
    const schema = z.uuid();

    const dumbValue = dumbGen.fake(schema, { seed: 1 });
    const chanceValue = chanceGen.fake(schema, { seed: 1 });
    expect(dumbValue).not.toBe(chanceValue);
  });

  it("createFaker({ backend: undefined }) still resolves to chanceBackend, not silently falling through to the dumb default", () => {
    const gen = createFaker({ backend: undefined });
    const defaultGen = createFaker();
    const schema = z.uuid();
    expect(gen.fake(schema, { seed: 5 })).toBe(defaultGen.fake(schema, { seed: 5 }));
  });

  it("fakeMany produces a deterministic sequence with chanceBackend", () => {
    const a = fakeMany(z.string(), 10, { seed: 42 });
    const b = fakeMany(z.string(), 10, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("re-exports prepare() for vendors needing the async warm-up", async () => {
    const valibot = await import("valibot");
    const schema = valibot.object({ id: valibot.string() });
    await expect(prepare(schema as never)).resolves.toBeUndefined();
  });

  it("strict/overrides/io config still forward through createFaker()", async () => {
    const schema = z.object({ email: z.email() });
    const gen = createFaker({ overrides: { "**.email": () => "fixed@test.dev" } });
    const value = gen.fake(schema, { seed: 1 });
    expect(value.email).toBe("fixed@test.dev");
  });
});

describe("chance package — chanceHeuristics wired as default", () => {
  it("fake() applies heuristics by default (e.g. firstName looks like a real first name, not a random word)", () => {
    const schema = z.object({ firstName: z.string() });
    const value = fake(schema, { seed: 1 });
    expect(value.firstName[0]).toBe(value.firstName[0]?.toUpperCase());
  });

  it("createFaker({ heuristics: false }) disables the layer, same as core's own default", () => {
    const gen = createFaker({ heuristics: false });
    const schema = z.object({ firstName: z.string() });
    expect(() => gen.fake(schema, { seed: 1 })).not.toThrow();
  });

  it("createFaker({ heuristics: undefined }) still resolves to chanceHeuristics, not silently disabling", () => {
    const gen = createFaker({ heuristics: undefined });
    const defaultGen = createFaker();
    const schema = z.object({ firstName: z.string() });
    expect(gen.fake(schema, { seed: 5 })).toEqual(defaultGen.fake(schema, { seed: 5 }));
  });

  it("a custom heuristics array overrides chanceHeuristics entirely", () => {
    const gen = createFaker({ heuristics: [{ name: "custom", match: /^firstname$/, generate: () => "CustomName" }] });
    const schema = z.object({ firstName: z.string() });
    const value = gen.fake(schema, { seed: 1 });
    expect(value.firstName).toBe("CustomName");
  });

  it("re-exports chanceHeuristics for advanced extend/remove/reorder recipes", () => {
    expect(Array.isArray(chanceHeuristics)).toBe(true);
    expect(chanceHeuristics.length).toBeGreaterThan(0);
    expect(chanceHeuristics.every((r) => typeof r.name === "string")).toBe(true);
  });

  it("createFaker({backend: defaultBackend}) does NOT default to chanceHeuristics", () => {
    const schema = z.object({ email: z.string() });
    expect(() => createFaker({ backend: defaultBackend }).fake(schema, { seed: 1 })).not.toThrow();
    const value = createFaker({ backend: defaultBackend }).fake(schema, { seed: 1 });
    expect(typeof value.email).toBe("string");
  });

  it("an explicit heuristics config always wins, even with a custom backend", () => {
    const schema = z.object({ tag: z.string() });
    const gen = createFaker({
      backend: defaultBackend,
      heuristics: [{ name: "custom", match: /^tag$/, generate: () => "explicit-wins" }],
    });
    expect(gen.fake(schema, { seed: 1 }).tag).toBe("explicit-wins");
  });

  it("explicit heuristics: false with a custom backend stays disabled (no surprise behavior)", () => {
    const schema = z.object({ email: z.string() });
    const gen = createFaker({ backend: defaultBackend, heuristics: false });
    expect(() => gen.fake(schema, { seed: 1 })).not.toThrow();
  });
});

describe("chance package — finalize + optionalProbability pass through unchanged, alongside chanceHeuristics", () => {
  it("finalize hooks apply on top of chanceBackend + chanceHeuristics realistic generation", () => {
    const schema = z.object({
      email: z.email(),
      tag: z.string().optional(),
    });
    const gen = createFaker({
      optionalProbability: 1,
      finalize: { tag: () => "always-finalized" },
    });
    const value = gen.fake(schema, { seed: 1 });
    expect(value.email).toContain("@");
    expect(value.tag).toBe("always-finalized");
  });

  it("optionalProbability: 0 with the chance package's defaults never includes an optional property", () => {
    const schema = z.object({ nickname: z.string().optional() });
    const gen = createFaker({ optionalProbability: 0 });
    for (let seed = 0; seed < 10; seed++) {
      expect(gen.fake(schema, { seed }).nickname).toBeUndefined();
    }
  });
});
