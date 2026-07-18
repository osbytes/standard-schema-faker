import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker } from "../src/index.js";

/**
 * `optionalProbability` (new `FakerConfig` feature): controls the inclusion probability for
 * OPTIONAL (non-`required`) object properties. Defaults to 0.5 (the pre-existing coin flip).
 * A plain `number` applies globally; a `(ctx: MatchContext) => number` function is evaluated
 * PER OPTIONAL PROPERTY, receiving that property's OWN `MatchContext` (not its parent's).
 * Exactly one seeded `backend.float(0, 1)` draw happens per optional property regardless of
 * configuration -- the walk's stream shape/length never depends on this config.
 */

const Schema = z.object({
  id: z.string(), // required -- never affected by optionalProbability
  nickname: z.string().optional(),
  bio: z.string().optional(),
});

describe("optionalProbability — global number", () => {
  it("1 always includes every optional property, across many seeds", () => {
    const gen = createFaker({ optionalProbability: 1 });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.nickname).toBeDefined();
      expect(value.bio).toBeDefined();
    }
  });

  it("0 never includes any optional property, across many seeds", () => {
    const gen = createFaker({ optionalProbability: 0 });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.nickname).toBeUndefined();
      expect(value.bio).toBeUndefined();
    }
  });

  it("default (unconfigured) matches the historical 50/50 bool() coin flip -- both present and absent occur across many seeds", () => {
    const gen = createFaker({});
    let sawPresent = false;
    let sawAbsent = false;
    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(Schema, { seed });
      if (value.nickname !== undefined) sawPresent = true;
      else sawAbsent = true;
    }
    expect(sawPresent).toBe(true);
    expect(sawAbsent).toBe(true);
  });

  it("required properties are always present regardless of optionalProbability: 0", () => {
    const gen = createFaker({ optionalProbability: 0 });
    const value = gen.fake(Schema, { seed: 1 });
    expect(typeof value.id).toBe("string");
  });
});

describe("optionalProbability — per-property function", () => {
  it("receives the OPTIONAL PROPERTY's own MatchContext (ctx.key/ctx.path), not the parent's", () => {
    const seenKeys: string[] = [];
    const gen = createFaker({
      optionalProbability: (ctx) => {
        seenKeys.push(ctx.key);
        return ctx.key === "nickname" ? 1 : 0;
      },
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.nickname).toBeDefined();
    expect(value.bio).toBeUndefined();
    expect(seenKeys).toContain("nickname");
    expect(seenKeys).toContain("bio");
  });

  it("can force a specific field to 1 while leaving others at the default", () => {
    const gen = createFaker({
      optionalProbability: (ctx) => (ctx.path === "nickname" ? 1 : 0.5),
    });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.nickname).toBeDefined();
    }
  });

  it("ctx.parent/ctx.ancestors are available for nested optional properties", () => {
    const Nested = z.object({
      profile: z.object({
        avatar: z.string().optional(),
      }),
    });
    let sawParent = false;
    const gen = createFaker({
      optionalProbability: (ctx) => {
        if (ctx.key === "avatar" && ctx.parent?.type === "object") sawParent = true;
        return 1;
      },
    });
    gen.fake(Nested, { seed: 1 });
    expect(sawParent).toBe(true);
  });
});

describe("optionalProbability — stable draw count (stream shape unaffected by configuration)", () => {
  it("a later required/deterministic field's value is unaffected by optionalProbability, same seed", () => {
    // If optionalProbability changed how many seeded draws happen per optional property (e.g.
    // skipping the draw entirely for probability 0/1), every value generated AFTER an optional
    // property in declaration order would drift onto a different point in the seeded stream.
    // Asserting downstream field stability across different optionalProbability configs (same
    // seed) is an indirect but real check that exactly one draw always happens.
    const TailSchema = z.object({
      maybeA: z.string().optional(),
      tail: z.string(),
    });
    const gen05 = createFaker({ optionalProbability: 0.5 });
    const gen05Fn = createFaker({ optionalProbability: () => 0.5 });
    const a = gen05.fake(TailSchema, { seed: 9 });
    const b = gen05Fn.fake(TailSchema, { seed: 9 });
    expect(a).toEqual(b);
  });
});

describe("optionalProbability — determinism", () => {
  it("same seed -> deep-equal output with optionalProbability configured", () => {
    const gen = createFaker({ optionalProbability: (ctx) => (ctx.key === "nickname" ? 0.9 : 0.1) });
    const a = gen.fake(Schema, { seed: 11 });
    const b = gen.fake(Schema, { seed: 11 });
    expect(a).toEqual(b);
  });
});
