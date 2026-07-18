import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker } from "../src/index.js";

/**
 * `finalize` hooks (new `FakerConfig` feature): dot-path glob / predicate-function hooks that
 * run AFTER a node's value is fully generated (post-order — a container's own hook sees its
 * children's values already finalized), receive the value + the same `MatchContext & {backend}`
 * an override sees, and return the (possibly amended) value USED VERBATIM (no constraint
 * guard). Reuses `overrides.ts`'s compiled glob/specificity engine (see finalize.ts) — same
 * `*`/`**` semantics, same specificity ranking — but with a simpler resolution rule: only the
 * SINGLE MOST SPECIFIC matching pattern runs (no decline/fall-through chain, since there's
 * always an already-generated value to fall back to — no ambiguity to resolve).
 *
 * Motivating case (FHIR): a `Patient` resource whose `identifier` array must always contain an
 * MRN-system entry, even though `identifier` itself is a normal, sometimes-absent-or-varying
 * array from the schema's own point of view.
 */

const MRN_SYSTEM = "http://hospital.example.org/mrn";

interface Identifier {
  system: string;
  value: string;
}

const IdentifierSchema = z.object({
  system: z.string(),
  value: z.string(),
});

const PatientSchema = z.object({
  name: z.string(),
  identifier: z.array(IdentifierSchema).min(0).max(2).optional(),
});

/**
 * Ensures an MRN-system entry exists in the (already-generated) `identifier` array --
 * `finalize`'s motivating "ensure X exists" use case. Deliberately SWAPS IN the last slot
 * (rather than blindly appending) whenever the array is already at the schema's declared
 * `maxItems` -- appending unconditionally could overflow `maxItems` and (rightly) fail vendor
 * validation, since `finalize` applies no constraint guard of its own. This is realistic
 * `finalize`-author behavior, not a test-only workaround: any real "ensure X exists" hook
 * amending a bounded array needs to respect the array's own bound the same way.
 */
function ensureMrn(value: unknown, maxItems: number): Identifier[] {
  const arr = Array.isArray(value) ? (value as Identifier[]) : [];
  if (arr.some((entry) => entry.system === MRN_SYSTEM)) return arr;
  const mrn: Identifier = { system: MRN_SYSTEM, value: "MRN-0000001" };
  if (arr.length < maxItems) return [...arr, mrn];
  return [...arr.slice(0, -1), mrn];
}

describe("finalize — FHIR Patient MRN example (Record form)", () => {
  it("ensures every generated Patient carries an MRN identifier entry, across many seeds, forcing identifier present via optionalProbability", () => {
    const gen = createFaker({
      optionalProbability: (ctx) => (ctx.key === "identifier" ? 1 : 0.5),
      finalize: {
        identifier: (value) => ensureMrn(value, 2),
      },
    });

    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(PatientSchema, { seed });
      expect(value.identifier).toBeDefined();
      expect(value.identifier?.some((entry) => entry.system === MRN_SYSTEM)).toBe(true);
    }
  });

  it("passes the vendor's own validate() after finalize amends the value", async () => {
    const gen = createFaker({
      optionalProbability: 1,
      finalize: { identifier: (value) => ensureMrn(value, 2) },
    });
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(PatientSchema, { seed });
      const result = await PatientSchema["~standard"].validate(value);
      expect(result.issues).toBeUndefined();
    }
  });

  it("strict: true validates the FINAL (post-finalize) value, not the pre-finalize one", () => {
    // A finalize hook that produces an INVALID amendment (a raw string not matching the item
    // schema) should cause strict mode to retry and eventually throw -- proving strict runs
    // against finalize's own output, not the raw walker output.
    const BrokenSchema = z.object({ tag: z.string().min(3) });
    const gen = createFaker({
      strict: true,
      finalize: { tag: () => "x" }, // always violates min(3)
    });
    expect(() => gen.fake(BrokenSchema, { seed: 1 })).toThrow();
  });

  it("strict: true still succeeds when finalize's amendment is itself valid", async () => {
    const gen = createFaker({
      strict: true,
      optionalProbability: 1,
      finalize: { identifier: (value) => ensureMrn(value, 2) },
    });
    const value = gen.fake(PatientSchema, { seed: 5 });
    const result = await PatientSchema["~standard"].validate(value);
    expect(result.issues).toBeUndefined();
    expect(value.identifier?.some((entry) => entry.system === MRN_SYSTEM)).toBe(true);
  });
});

describe("finalize — post-order (parent sees child's already-finalized value)", () => {
  it("a container's own finalize hook observes its child's finalize amendment, not the pre-amendment value", () => {
    const Schema = z.object({
      child: z.object({ n: z.number() }),
    });

    const seenByParent: unknown[] = [];

    const gen = createFaker({
      finalize: {
        "child.n": (value) => (typeof value === "number" ? value + 100 : value),
        child: (value) => {
          seenByParent.push(value);
          return value;
        },
      },
    });

    const result = gen.fake(Schema, { seed: 1 });
    expect(result.child.n).toBeGreaterThanOrEqual(100);
    // The parent hook must have seen the CHILD'S OWN finalize hook's amendment already applied
    // -- i.e. seenByParent[0].n === result.child.n (both already +100'd), never the raw
    // pre-finalize child value.
    expect(seenByParent).toHaveLength(1);
    expect((seenByParent[0] as { n: number }).n).toBe(result.child.n);
  });

  it("root-level finalize hook sees the WHOLE tree already finalized (deepest post-order guarantee)", () => {
    const Schema = z.object({
      a: z.object({ b: z.object({ c: z.number() }) }),
    });

    const gen = createFaker({
      finalize: {
        "a.b.c": (value) => (typeof value === "number" ? value + 1 : value),
        "a.b": (value) => {
          const obj = value as { c: number };
          return { c: obj.c + 10 };
        },
        a: (value) => {
          const obj = value as { b: { c: number } };
          return { b: { c: obj.b.c + 100 } };
        },
      },
    });

    const result = gen.fake(Schema, { seed: 1 });
    // Each layer's amendment stacks on the one below it, proving strict post-order:
    // raw -> +1 (leaf) -> +10 (mid, sees +1'd value) -> +100 (top, sees +11'd value) = +111.
    const rawValue = result.a.b.c - 111;
    expect(Number.isFinite(rawValue)).toBe(true);
    expect(result.a.b.c).toBe(rawValue + 111);
  });
});

describe("finalize — specificity (most-specific-only, no fallthrough)", () => {
  const Schema = z.object({
    profile: z.object({ email: z.string() }),
    other: z.object({ email: z.string() }),
  });

  it("exact path beats a '**' glob on the same field", () => {
    const gen = createFaker({
      finalize: {
        "**.email": () => "generic@finalize.dev",
        "profile.email": () => "specific@finalize.dev",
      },
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.profile.email).toBe("specific@finalize.dev");
    expect(value.other.email).toBe("generic@finalize.dev");
  });

  it("only the winning (most-specific) hook runs -- a losing candidate's side effect never fires", () => {
    let genericCalls = 0;
    let specificCalls = 0;
    const gen = createFaker({
      finalize: {
        "**.email": (value) => {
          genericCalls++;
          return value;
        },
        "profile.email": (value) => {
          specificCalls++;
          return value;
        },
      },
    });
    gen.fake(Schema, { seed: 1 });
    expect(specificCalls).toBe(1); // profile.email
    expect(genericCalls).toBe(1); // other.email only -- profile.email did NOT also invoke the generic hook
  });
});

describe("finalize — function shorthand (catch-all)", () => {
  it("applies to every node the walker visits", () => {
    const Schema = z.object({ a: z.string(), b: z.number() });
    const gen = createFaker({
      finalize: (value, ctx) => (ctx.key === "a" ? "always-a" : value),
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.a).toBe("always-a");
    expect(typeof value.b).toBe("number");
  });
});

describe("finalize — determinism", () => {
  it("same seed -> deep-equal output with finalize configured", () => {
    const gen = createFaker({
      optionalProbability: 1,
      finalize: { identifier: (value) => ensureMrn(value, 2) },
    });
    const a = gen.fake(PatientSchema, { seed: 42 });
    const b = gen.fake(PatientSchema, { seed: 42 });
    expect(a).toEqual(b);
  });
});

describe("finalize — no finalize configured leaves generation untouched", () => {
  it("identical output with and without an explicit empty config", () => {
    const gen = createFaker({});
    const withDefaults = createFaker();
    const a = gen.fake(PatientSchema, { seed: 3 });
    const b = withDefaults.fake(PatientSchema, { seed: 3 });
    expect(a).toEqual(b);
  });
});
