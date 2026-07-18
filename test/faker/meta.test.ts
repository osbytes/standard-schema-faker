import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, defaultBackend, defaultHeuristics, fake, fakeMany, fakerBackend, prepare } from "../../src/faker/index.js";

/**
 * standard-schema-faker/faker (batteries-included subpath) — verifies the wiring: `fake`/
 * `fakeMany`/`createFaker` default to `fakerBackend` (realistic values) here, unlike the root
 * `standard-schema-faker` entry's own default (the dumb generator). `backend` is still
 * overridable, including back to `defaultBackend`. Same story for `heuristics`: defaults to
 * `defaultHeuristics` here, `false` at the root; overridable, including explicitly back to `false`.
 */
describe("standard-schema-faker/faker — fakerBackend wired as default", () => {
  it("fake() produces realistic (faker-shaped) values by default", async () => {
    const schema = z.email();
    const value = fake(schema, { seed: 1 });
    const result = await schema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
    // A faker-generated email looks like a real email (has a recognizable domain-ish TLD),
    // not the core dumb backend's `word@word.com|dev` template — this is a soft signal, not
    // a strict assertion of provenance, but combined with the createFaker() equality check
    // below it's a solid confirmation.
    expect(value).toContain("@");
  });

  it("createFaker({}) uses fakerBackend by default, same as top-level fake()", () => {
    const gen = createFaker();
    const schema = z.object({ id: z.uuid(), email: z.email() });
    const a = fake(schema, { seed: 42 });
    const b = gen.fake(schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("createFaker({ backend: defaultBackend }) still works — override back to the dumb generator", () => {
    const dumbGen = createFaker({ backend: defaultBackend });
    const fakerGen = createFaker({ backend: fakerBackend });
    const schema = z.uuid();

    const dumbValue = dumbGen.fake(schema, { seed: 1 });
    const fakerValue = fakerGen.fake(schema, { seed: 1 });
    // Both are valid UUIDs, but not required to be equal — different generators.
    expect(dumbValue).not.toBe(fakerValue);
  });

  it("createFaker({ backend: undefined }) still resolves to fakerBackend, not silently falling through to the dumb default", () => {
    const gen = createFaker({ backend: undefined });
    const defaultGen = createFaker();
    const schema = z.uuid();
    expect(gen.fake(schema, { seed: 5 })).toBe(defaultGen.fake(schema, { seed: 5 }));
  });

  it("fakeMany produces a deterministic sequence with fakerBackend", () => {
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

describe("meta package — defaultHeuristics wired as default", () => {
  it("fake() applies heuristics by default (e.g. firstName looks like a real first name, not a random word)", () => {
    const schema = z.object({ firstName: z.string() });
    const value = fake(schema, { seed: 1 });
    // A random-word default backend/no-heuristics value would be all-lowercase; a real faker
    // first name is capitalized.
    expect(value.firstName[0]).toBe(value.firstName[0]?.toUpperCase());
  });

  it("createFaker({ heuristics: false }) disables the layer, same as core's own default", () => {
    const gen = createFaker({ heuristics: false });
    const schema = z.object({ firstName: z.string() });
    const value = gen.fake(schema, { seed: 1 });
    // With heuristics off, `firstName` just gets fakerBackend's plain lorem-word fallback.
    expect(value.firstName).not.toBe("Aaliyah"); // the deterministic defaultHeuristics output for seed 1
  });

  it("createFaker({ heuristics: undefined }) still resolves to defaultHeuristics, not silently disabling", () => {
    const gen = createFaker({ heuristics: undefined });
    const defaultGen = createFaker();
    const schema = z.object({ firstName: z.string() });
    expect(gen.fake(schema, { seed: 5 })).toEqual(defaultGen.fake(schema, { seed: 5 }));
  });

  it("a custom heuristics array overrides defaultHeuristics entirely", () => {
    const gen = createFaker({ heuristics: [{ name: "custom", match: /^firstname$/, generate: () => "CustomName" }] });
    const schema = z.object({ firstName: z.string() });
    const value = gen.fake(schema, { seed: 1 });
    expect(value.firstName).toBe("CustomName");
  });

  it("re-exports defaultHeuristics for advanced extend/remove/reorder recipes", () => {
    expect(Array.isArray(defaultHeuristics)).toBe(true);
    expect(defaultHeuristics.length).toBeGreaterThan(0);
    expect(defaultHeuristics.every((r) => typeof r.name === "string")).toBe(true);
  });

  it("createFaker({backend: defaultBackend}) does NOT default to defaultHeuristics", () => {
    // createFaker must not default `heuristics` to `defaultHeuristics` unconditionally, even
    // when the caller supplies a CUSTOM (non-fakerBackend) backend -- the first heuristic hit
    // would then throw, since defaultHeuristics' rules call `FakerBackendInstance.faker.*`
    // methods that don't exist on an arbitrary BackendInstance like core's own defaultBackend.
    // heuristics must only default to defaultHeuristics when the backend in effect actually IS
    // fakerBackend.
    const schema = z.object({ email: z.string() }); // format-less -- would hit a heuristic rule if one were active
    expect(() => createFaker({ backend: defaultBackend }).fake(schema, { seed: 1 })).not.toThrow();
    const value = createFaker({ backend: defaultBackend }).fake(schema, { seed: 1 });
    // Heuristics were NOT applied -- defaultBackend's own plain-word fallback, not a
    // fakerBackend-shaped realistic email (no dedicated assertion on exact shape, just that it
    // didn't throw and produced SOME string, proving heuristics were skipped rather than
    // erroring out mid-generation).
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

describe("meta package — finalize + optionalProbability pass through unchanged, alongside defaultHeuristics", () => {
  it("finalize hooks apply on top of fakerBackend + defaultHeuristics realistic generation", () => {
    const schema = z.object({
      email: z.email(),
      tag: z.string().optional(),
    });
    const gen = createFaker({
      optionalProbability: 1,
      finalize: { tag: () => "always-finalized" },
    });
    const value = gen.fake(schema, { seed: 1 });
    // defaultHeuristics still produced a realistic email (untouched by finalize/optionalProbability).
    expect(value.email).toContain("@");
    expect(value.tag).toBe("always-finalized");
  });

  it("optionalProbability: 0 with the meta package's defaults never includes an optional property", () => {
    const schema = z.object({ nickname: z.string().optional() });
    const gen = createFaker({ optionalProbability: 0 });
    for (let seed = 0; seed < 10; seed++) {
      expect(gen.fake(schema, { seed }).nickname).toBeUndefined();
    }
  });
});
