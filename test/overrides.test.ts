import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker } from "../src/index.js";

/**
 * `overrides` glob engine: dot-path keys with `*` (one segment) / `**` (any depth)
 * globs, plus a `(path, node) => value | undefined` predicate matcher. Array indices are
 * plain numeric path segments (e.g. `order.items.0.id`), matching the walker's path
 * construction (see walker.ts's `joinPath`). The root object's own properties sit at
 * depth 1 (path = just the property name, e.g. `"email"`); a nested property is at depth 2
 * (`"profile.email"`), and so on.
 */

const EmailSchema = z.object({
  email: z.email(),
  profile: z.object({
    email: z.email(),
    bio: z.string(),
  }),
  contacts: z
    .array(z.object({ email: z.email() }))
    .min(2)
    .max(2),
});

// `id` appears at depth 2 (`user.id`, `order.id`) and at depth 4 (`order.items.0.id`) — good
// for distinguishing a single-`*` glob (matches exactly one segment before `id`) from `**`.
const IdSchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  order: z.object({
    id: z.string(),
    items: z
      .array(z.object({ id: z.string() }))
      .min(1)
      .max(1),
  }),
});

describe("overrides glob engine", () => {
  it("'**.email' hits every nested email, at any depth", () => {
    const gen = createFaker({ overrides: { "**.email": () => "fixed@test.dev" } });
    const value = gen.fake(EmailSchema, { seed: 1 });

    expect(value.email).toBe("fixed@test.dev");
    expect(value.profile.email).toBe("fixed@test.dev");
    expect(value.contacts[0]?.email).toBe("fixed@test.dev");
    expect(value.contacts[1]?.email).toBe("fixed@test.dev");
    // Untouched fields still generate normally.
    expect(typeof value.profile.bio).toBe("string");
  });

  it("'*.id' hits depth-2 ids (user.id, order.id) but not the depth-4 order.items.0.id", () => {
    const gen = createFaker({ overrides: { "*.id": () => "OVERRIDDEN-ID" } });
    const value = gen.fake(IdSchema, { seed: 1 });

    expect(value.user.id).toBe("OVERRIDDEN-ID");
    expect(value.order.id).toBe("OVERRIDDEN-ID");
    expect(value.order.items[0]?.id).not.toBe("OVERRIDDEN-ID");
  });

  it("exact path 'profile.email' only hits that one field", () => {
    const gen = createFaker({ overrides: { "profile.email": () => "exact@test.dev" } });
    const value = gen.fake(EmailSchema, { seed: 1 });

    expect(value.profile.email).toBe("exact@test.dev");
    expect(value.email).not.toBe("exact@test.dev");
  });

  it("array indices are plain path segments: 'contacts.0.email' hits only the first contact", () => {
    const gen = createFaker({ overrides: { "contacts.0.email": () => "first@test.dev" } });
    const value = gen.fake(EmailSchema, { seed: 1 });

    expect(value.contacts[0]?.email).toBe("first@test.dev");
    expect(value.contacts[1]?.email).not.toBe("first@test.dev");
  });

  it("most-specific match wins: exact path beats a '**' glob on the same field", () => {
    const gen = createFaker({
      overrides: {
        "**.email": () => "generic@test.dev",
        "profile.email": () => "specific@test.dev",
      },
    });
    const value = gen.fake(EmailSchema, { seed: 1 });

    expect(value.profile.email).toBe("specific@test.dev");
    // Every other email still falls through to the less-specific ** glob.
    expect(value.email).toBe("generic@test.dev");
  });

  it("most-specific match wins: '*' beats '**' at the same effective position", () => {
    const gen = createFaker({
      overrides: {
        "**.id": () => "any-depth-id",
        "*.id": () => "depth-two-id",
      },
    });
    const value = gen.fake(IdSchema, { seed: 1 });

    // Depth-2 ids match both '*.id' and '**.id' — the more specific '*' pattern wins.
    expect(value.user.id).toBe("depth-two-id");
    expect(value.order.id).toBe("depth-two-id");
    // Depth-4 id only matches '**.id'.
    expect(value.order.items[0]?.id).toBe("any-depth-id");
  });

  it("function matcher: (ctx: MatchContext & {backend}) => value | undefined -- same ctx shape as HeuristicRule.generate", () => {
    const gen = createFaker({
      overrides: (ctx) => {
        if (ctx.path.endsWith("email")) return "matcher@test.dev";
        if (ctx.node.format === "email") return "format-matched@test.dev"; // unreachable given the check above, just exercises `ctx.node`
        return undefined;
      },
    });
    const value = gen.fake(EmailSchema, { seed: 1 });

    expect(value.email).toBe("matcher@test.dev");
    expect(value.profile.email).toBe("matcher@test.dev");
    expect(typeof value.profile.bio).toBe("string");
    expect(value.profile.bio).not.toBe("matcher@test.dev");
  });

  it("function matcher can read ctx.siblings (the ACTUAL generated value of an earlier property)", () => {
    const Schema = z.object({
      kind: z.enum(["a", "b"]),
      value: z.string(),
    });
    const gen = createFaker({
      overrides: (ctx) => {
        if (ctx.key !== "value") return undefined;
        if (ctx.siblings.kind === "a") return "override-for-a";
        if (ctx.siblings.kind === "b") return "override-for-b";
        return undefined;
      },
    });
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.value).toBe(value.kind === "a" ? "override-for-a" : "override-for-b");
    }
  });

  it("a declining Record thunk (returns undefined) falls through to the next-most-specific matching pattern", () => {
    const gen = createFaker({
      overrides: {
        "**.email": () => "generic@test.dev",
        "profile.email": () => undefined, // decline -- falls through to the '**.email' glob, not to plain generation
      },
    });
    const value = gen.fake(EmailSchema, { seed: 1 });
    expect(value.profile.email).toBe("generic@test.dev");
    expect(value.email).toBe("generic@test.dev");
  });

  it("every matching Record thunk declining falls all the way through to normal generation", () => {
    const gen = createFaker({
      overrides: {
        "**.email": () => undefined,
        "profile.email": () => undefined,
      },
    });
    const value = gen.fake(EmailSchema, { seed: 1 });
    // Normal generation took over -- still a valid (format: email) string, just not overridden.
    expect(value.profile.email).toContain("@");
  });

  it("override result still passes the schema's own validate() when the user provides a valid value", async () => {
    const gen = createFaker({ overrides: { "**.email": () => "valid@test.dev" } });
    const value = gen.fake(EmailSchema, { seed: 1 });
    const result = await EmailSchema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("overrides are deterministic alongside the rest of the seeded stream", () => {
    const gen = createFaker({ overrides: { "**.email": () => "fixed@test.dev" } });
    const a = gen.fake(EmailSchema, { seed: 7 });
    const b = gen.fake(EmailSchema, { seed: 7 });
    expect(a).toEqual(b);
  });

  it("no override configured leaves generation untouched", () => {
    const gen = createFaker({});
    const withDefaults = createFaker();
    const a = gen.fake(EmailSchema, { seed: 3 });
    const b = withDefaults.fake(EmailSchema, { seed: 3 });
    expect(a).toEqual(b);
  });
});
