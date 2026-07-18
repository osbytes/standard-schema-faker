import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultBackend } from "../src/default-backend.js";
import { createFaker, generateFromSchema } from "../src/index.js";
import type { JSONSchema } from "../src/types.js";

/**
 * `formats` (new `FakerConfig` feature — the `jsf.format()` analog from `json-schema-faker`):
 * `Record<string, (ctx: MatchContext & {backend}) => string>`, keyed by JSON Schema `format`
 * name. A registered generator runs INSTEAD OF the backend's own built-in handling for that
 * format name. Priority ladder position: overrides > heuristics > user `formats` > backend
 * built-in format > pattern > plain — i.e. it slots exactly at the existing `format` tier,
 * shadowing the built-in only for registered names; unregistered names keep using the built-in
 * (or fall through to plain generation if the backend has no built-in for that name either).
 */

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function semverGenerator() {
  return ({ backend }: { backend: { int(min: number, max: number): number } }) =>
    `${backend.int(0, 20)}.${backend.int(0, 20)}.${backend.int(0, 20)}`;
}

describe("formats — driving the walker directly via generateFromSchema", () => {
  const semverSchema: JSONSchema = { type: "string", format: "semver" };

  it("a registered custom format ('semver') generates values matching a semver RegExp", () => {
    for (let seed = 0; seed < 30; seed++) {
      const backend = defaultBackend.create(seed);
      const value = generateFromSchema(
        semverSchema,
        { backend, root: semverSchema, maxDepth: 5, projection: "output", formats: { semver: semverGenerator() } },
        "",
        0,
      );
      expect(value, `seed ${seed}`).toMatch(SEMVER_RE);
    }
  });

  it("is deterministic per seed", () => {
    const ctx = {
      root: semverSchema,
      maxDepth: 5,
      projection: "output" as const,
      formats: { semver: semverGenerator() },
    };
    for (const seed of [1, 2, 3, 10, 20]) {
      const a = generateFromSchema(semverSchema, { ...ctx, backend: defaultBackend.create(seed) }, "", 0);
      const b = generateFromSchema(semverSchema, { ...ctx, backend: defaultBackend.create(seed) }, "", 0);
      expect(a).toBe(b);
    }
  });

  it("an unregistered custom format (no registry entry, no backend built-in) still falls to plain string generation", () => {
    const unknownFormatSchema: JSONSchema = { type: "string", format: "totally-made-up-format" };
    const backend = defaultBackend.create(1);
    const value = generateFromSchema(
      unknownFormatSchema,
      { backend, root: unknownFormatSchema, maxDepth: 5, projection: "output", formats: { semver: semverGenerator() } },
      "",
      0,
    );
    // defaultBackend's plain-string fallback (randomWord) -- lowercase letters only.
    expect(value).toMatch(/^[a-z]+$/);
  });

  it("no `formats` configured at all -- an unrecognized format still falls to plain string (existing behavior, untouched)", () => {
    const unknownFormatSchema: JSONSchema = { type: "string", format: "totally-made-up-format" };
    const backend = defaultBackend.create(1);
    const value = generateFromSchema(unknownFormatSchema, { backend, root: unknownFormatSchema, maxDepth: 5, projection: "output" }, "", 0);
    expect(value).toMatch(/^[a-z]+$/);
  });
});

describe("formats — registering a BUILT-IN format name shadows the backend's own built-in", () => {
  const emailSchema: JSONSchema = { type: "string", format: "email" };

  it("registering 'email' overrides defaultBackend's built-in email generator", () => {
    const backend = defaultBackend.create(1);
    const value = generateFromSchema(
      emailSchema,
      {
        backend,
        root: emailSchema,
        maxDepth: 5,
        projection: "output",
        formats: { email: () => "shadowed@example.test" },
      },
      "",
      0,
    );
    expect(value).toBe("shadowed@example.test");
  });

  it("without registering 'email', the backend's own built-in email generator runs (unshadowed)", () => {
    const backend = defaultBackend.create(1);
    const value = generateFromSchema(emailSchema, { backend, root: emailSchema, maxDepth: 5, projection: "output" }, "", 0);
    expect(value).not.toBe("shadowed@example.test");
    expect(value).toMatch(/@/);
  });
});

describe("formats — via createFaker() end-to-end", () => {
  it("createFaker({formats}) generates a semver-shaped value for a vendor schema carrying a custom `format`", () => {
    // z.string().meta({format: 'semver'}) is a cheap way to get Zod to emit a `format` keyword
    // with NO competing `pattern` (unlike z.iso.datetime()/z.email(), which always pair `format`
    // with a strict validating pattern that would otherwise win per this library's documented
    // priority) -- isolates the custom format registry path end-to-end through a real vendor.
    const Schema = z.object({ version: z.string().meta({ format: "semver" }) });
    const gen = createFaker({ formats: { semver: semverGenerator() } });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.version, `seed ${seed}`).toMatch(SEMVER_RE);
    }
  });

  it("is deterministic per seed through createFaker()", () => {
    const Schema = z.object({ version: z.string().meta({ format: "semver" }) });
    const gen = createFaker({ formats: { semver: semverGenerator() } });
    const a = gen.fake(Schema, { seed: 5 });
    const b = gen.fake(Schema, { seed: 5 });
    expect(a).toEqual(b);
  });

  it("overrides still beat a registered format (priority ladder: overrides > heuristics > formats > built-in format)", () => {
    const Schema = z.object({ version: z.string().meta({ format: "semver" }) });
    const gen = createFaker({
      formats: { semver: semverGenerator() },
      overrides: { version: () => "9.9.9-override" },
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.version).toBe("9.9.9-override");
  });
});
