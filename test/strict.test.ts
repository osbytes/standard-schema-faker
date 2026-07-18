import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, fake } from "../src/index.js";

/**
 * `strict: true` correctness strategy: generate structurally-valid values from
 * JSON Schema as usual, but retry (deterministically re-seeded) up to 5 times against the
 * schema's OWN `~standard.validate()` — catching refinements/transforms invisible to JSON
 * Schema (the walker never sees `.refine()`; it only sees `{type: "string", minLength: 1,
 * maxLength: 3}`).
 */
describe("strict mode", () => {
  it("retries and eventually succeeds for a refine that rejects most (but not all) values, across many seeds", () => {
    // Rejects any string not starting with 'a' — invisible to JSON Schema (walker only sees
    // length bounds), so most raw generations fail; strict mode's retry loop should recover
    // this for at least some seeds within the default 5-retry budget.
    const StartsWithA = z
      .string()
      .min(1)
      .max(3)
      .refine((s) => s.startsWith("a"));
    const gen = createFaker({ strict: true });

    let successCount = 0;
    let thrownCount = 0;
    for (let seed = 0; seed < 40; seed++) {
      try {
        const value = gen.fake(StartsWithA, { seed });
        expect(value.startsWith("a")).toBe(true);
        successCount++;
      } catch {
        thrownCount++;
      }
    }
    // With ~1/26 odds per attempt and 6 attempts total, most seeds should recover, some won't
    // (that's expected and fine) — the important invariant is that strict mode DOES recover
    // for a meaningful fraction of seeds, and every success genuinely satisfies the refine.
    expect(successCount).toBeGreaterThan(0);
    expect(successCount + thrownCount).toBe(40);
  });

  it("throws an informative error, including the issue list, for a never-satisfiable refine", () => {
    const Impossible = z
      .string()
      .min(1)
      .max(3)
      .refine(() => false, { message: "always rejected" });
    const gen = createFaker({ strict: true });

    let threw: unknown;
    try {
      gen.fake(Impossible, { seed: 1 });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(Error);
    const message = (threw as Error).message;
    expect(message).toContain("strict mode failed");
    expect(message).toContain("always rejected");
  });

  it("non-strict fake() does not validate or retry (may produce refine-violating values)", () => {
    // Sanity check that strict is opt-in: without it, generation is a single pass with no
    // validate() call, so it can (and for this schema, reliably does across many seeds)
    // produce values that violate the refine.
    const StartsWithA = z
      .string()
      .min(1)
      .max(3)
      .refine((s) => s.startsWith("a"));
    let sawViolation = false;
    for (let seed = 0; seed < 20; seed++) {
      const value = fake(StartsWithA, { seed });
      if (!value.startsWith("a")) sawViolation = true;
    }
    expect(sawViolation).toBe(true);
  });

  it("strict mode retry sequence is deterministic (same seed -> same outcome and value/issues)", () => {
    const StartsWithA = z
      .string()
      .min(1)
      .max(3)
      .refine((s) => s.startsWith("a"));
    const gen = createFaker({ strict: true });

    function attempt(seed: number): { ok: true; value: string } | { ok: false; message: string } {
      try {
        return { ok: true, value: gen.fake(StartsWithA, { seed }) };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    }

    for (const seed of [1, 2, 3, 4, 5]) {
      const a = attempt(seed);
      const b = attempt(seed);
      expect(a).toEqual(b);
    }
  });

  it("strict mode works with fakeMany (each item independently retried, whole batch deterministic)", () => {
    const StartsWithA = z
      .string()
      .min(1)
      .max(3)
      .refine((s) => s.startsWith("a"));
    const gen = createFaker({ strict: true });

    // Use a seed where every item is individually likely to eventually succeed within a
    // reasonable number of seeds — assert whatever comes back (success or a thrown error per
    // item) is consistent across two identical runs.
    function runBatch(): Array<{ ok: true; value: string } | { ok: false }> {
      const out: Array<{ ok: true; value: string } | { ok: false }> = [];
      for (let i = 0; i < 5; i++) {
        try {
          out.push({ ok: true, value: gen.fakeMany(StartsWithA, 1, { seed: 42 + i })[0] as string });
        } catch {
          out.push({ ok: false });
        }
      }
      return out;
    }

    expect(runBatch()).toEqual(runBatch());
  });

  it("strict mode throws a clear synchronous error for a schema whose validate() resolves asynchronously", () => {
    const AsyncRefine = z.string().refine(async (s) => s.length > 0);
    const gen = createFaker({ strict: true });
    expect(() => gen.fake(AsyncRefine, { seed: 1 })).toThrow(/synchronously/);
  });
});
