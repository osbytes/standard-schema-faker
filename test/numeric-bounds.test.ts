import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fake as fakeFaker } from "../src/faker/index.js";
import { fake } from "../src/index.js";

/**
 * Regression: Zod v4 stamps every `z.int()` with minimum/maximum
 * ±(2^53 - 1) as an "any safe integer" sentinel. Honoring those bounds
 * literally made half-bounded integers astronomical (`z.int().positive()` →
 * 6488106240503889), and a real lower bound above the 0-100 default window
 * (`z.int().min(200)`) collapsed to a constant. Sentinel-magnitude bounds are
 * now treated as absent and half-bounded schemas get a 100-wide window
 * anchored at the real bound — see walker.ts's effectiveBounds.
 */
describe("numeric bounds: sentinel and half-bounded windows", () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

  it("z.int().positive() stays in a small realistic window", () => {
    const S = z.object({ q: z.int().positive() });
    for (const seed of SEEDS) {
      const { q } = fake(S, { seed });
      expect(q, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(q, `seed ${seed}`).toBeLessThanOrEqual(101);
    }
  });

  it("z.int().min(200) does not collapse to a constant", () => {
    const S = z.object({ n: z.int().min(200) });
    const values = new Set(SEEDS.map((seed) => fake(S, { seed }).n));
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(200);
      expect(v).toBeLessThanOrEqual(300);
    }
    expect(values.size).toBeGreaterThan(5);
  });

  it("z.int().max(10) yields values near the bound, not -2^53", () => {
    const S = z.object({ n: z.int().max(10) });
    for (const seed of SEEDS) {
      const { n } = fake(S, { seed });
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(10);
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(-90);
    }
  });

  it("plain z.int() uses the 0-100 default window", () => {
    const S = z.object({ n: z.int() });
    for (const seed of SEEDS) {
      const { n } = fake(S, { seed });
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(100);
    }
  });

  it("explicit two-sided bounds are honored exactly", () => {
    const S = z.object({ n: z.int().min(18).max(99) });
    for (const seed of SEEDS) {
      const { n } = fake(S, { seed });
      expect(n, `seed ${seed}`).toBeGreaterThanOrEqual(18);
      expect(n, `seed ${seed}`).toBeLessThanOrEqual(99);
    }
  });

  it("half-bounded floats get the same windowing (z.number().min(0))", () => {
    const S = z.object({ f: z.number().min(0) });
    for (const seed of SEEDS) {
      const { f } = fake(S, { seed });
      expect(f, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(f, `seed ${seed}`).toBeLessThanOrEqual(100);
    }
  });

  it("faker backend applies the same windows", () => {
    const S = z.object({ q: z.int().positive() });
    for (const seed of SEEDS) {
      const { q } = fakeFaker(S, { seed });
      expect(q, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(q, `seed ${seed}`).toBeLessThanOrEqual(101);
    }
  });
});
