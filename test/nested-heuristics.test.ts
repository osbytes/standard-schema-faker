import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fake as fakeFaker } from "../src/faker/index.js";

/**
 * Regression: every default heuristic rule was written `/^key$/` while
 * `HeuristicMatcher` documents RegExp matchers as testing `ctx.semanticPath`
 * (the full dotted path) — so `shipping.city` never matched `/^(city|town)$/`
 * and NESTED fields silently fell back to lorem noise; heuristics only ever
 * fired at the top level. Rules are now suffix-anchored (`/(^|\.)(city|town)$/`),
 * the form the contract itself recommends.
 */
describe("default heuristics fire for nested fields", () => {
  it("shipping.city gets a real city, not lorem", () => {
    const S = z.object({
      shipping: z.object({ city: z.string(), country: z.string() }),
    });
    for (const seed of [1, 7, 42]) {
      const { shipping } = fakeFaker(S, { seed });
      // faker city names are capitalized multi-word-ish values; lorem words are
      // single lowercase latin tokens. Capitalization is the cheap tell.
      expect(shipping.city, `seed ${seed}: ${shipping.city}`).toMatch(/^[A-Z]/);
    }
  });

  it("suffix anchoring does not loosen into substring matches (myCity ≠ city)", () => {
    const S = z.object({ velocity: z.string() });
    for (const seed of [1, 7, 42]) {
      const { velocity } = fakeFaker(S, { seed });
      // "velocity" must NOT hit the city rule — the (^|\.) boundary requires a
      // full trailing segment. Lorem output is lowercase.
      expect(velocity, `seed ${seed}: ${velocity}`).toMatch(/^[a-z]/);
    }
  });

  it("deeply nested ids still get uuids", () => {
    const S = z.object({ order: z.object({ meta: z.object({ id: z.string() }) }) });
    for (const seed of [1, 7, 42]) {
      const { order } = fakeFaker(S, { seed });
      expect(order.meta.id, `seed ${seed}`).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });
});

describe("heuristic constraint guard honors pattern", () => {
  it("a pattern-bearing sku falls back to pattern generation, not the sku heuristic", async () => {
    const { z } = await import("zod");
    const S = z.object({ sku: z.string().regex(/^SKU-\d{4}$/) });
    for (const seed of [1, 7, 42, 99]) {
      const { sku } = fakeFaker(S, { seed });
      expect(sku, `seed ${seed}: ${sku}`).toMatch(/^SKU-\d{4}$/);
    }
  });
});
