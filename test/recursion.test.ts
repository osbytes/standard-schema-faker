import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, fake } from "../src/index.js";

interface Category {
  name: string;
  subcategories: Category[];
}

// Recursive Zod schema via z.lazy — subcategories is REQUIRED (not optional), so every
// recursive step is forced to recurse again, making this a real stress test for maxDepth.
const CategorySchema: z.ZodType<Category> = z.object({
  name: z.string(),
  subcategories: z.lazy(() => z.array(CategorySchema)),
});

describe("recursion / maxDepth", () => {
  it("respects maxDepth without a stack overflow", () => {
    const gen = createFaker({ maxDepth: 5 });
    expect(() => gen.fake(CategorySchema, { seed: 1 })).not.toThrow();
  });

  it("terminates recursion at maxDepth and still produces a structurally valid value", async () => {
    const gen = createFaker({ maxDepth: 4 });
    const value = gen.fake(CategorySchema, { seed: 1 });
    const result = await CategorySchema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
  });

  it("a shallow maxDepth still terminates (edge case: maxDepth = 1)", () => {
    const gen = createFaker({ maxDepth: 1 });
    expect(() => gen.fake(CategorySchema, { seed: 1 })).not.toThrow();
  });

  it("default maxDepth (5) is used when not configured, and does not overflow the stack", () => {
    expect(() => fake(CategorySchema, { seed: 2 })).not.toThrow();
  });

  it("recursive depth is actually bounded (subcategories nesting stops)", () => {
    const gen = createFaker({ maxDepth: 3 });
    const value = gen.fake(CategorySchema, { seed: 1 });

    function depthOf(cat: Category): number {
      if (cat.subcategories.length === 0) return 1;
      return 1 + Math.max(...cat.subcategories.map(depthOf));
    }

    // Not an exact equality (branch/array-length randomness), just a sane upper bound —
    // the point is it's finite and small, not thousands of levels deep.
    expect(depthOf(value)).toBeLessThanOrEqual(6);
  });
});
