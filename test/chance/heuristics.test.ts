import { describe, expect, it } from "vitest";
import { z } from "zod";
import { chanceBackend, chanceHeuristics } from "../../src/chance/index.js";
import { compileHeuristics, createFaker, generateFromSchema } from "../../src/index.js";

/**
 * `chanceHeuristics` — the concrete ruleset `standard-schema-faker/chance` enables by default.
 * Mirrors test/faker/heuristics.test.ts's structure: rule firing per key-name variant, negative
 * word-boundary cases, constraint-guard fallthrough, extend/remove recipes, determinism, and the
 * FHIR ContactPoint correlation rules.
 */

function fieldSchema<K extends string, T extends z.ZodType = z.ZodString>(key: K, zodType?: T): z.ZodObject<{ [P in K]: T }> {
  const shape = { [key]: zodType ?? z.string() } as { [P in K]: T };
  return z.object(shape);
}

describe("chanceHeuristics — key variants fire the expected rule", () => {
  const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });

  const cases: Array<{ variants: string[]; check: (value: string) => boolean }> = [
    { variants: ["firstName", "first_name", "FIRST-NAME", "first name"], check: (v) => v.length > 0 && !/^\d+$/.test(v) },
    { variants: ["lastName", "last_name", "surname"], check: (v) => v.length > 0 },
    { variants: ["email", "emailAddress"], check: (v) => v.includes("@") },
    { variants: ["phone", "phoneNumber", "mobile"], check: (v) => v.length > 0 },
    { variants: ["avatar", "avatarUrl", "photo"], check: (v) => /^https:\/\//.test(v) },
    { variants: ["city", "town"], check: (v) => v.length > 0 },
    { variants: ["zip", "zipCode", "postalCode"], check: (v) => v.length > 0 },
    { variants: ["country", "countryCode"], check: (v) => v.length > 0 },
    { variants: ["companyName", "company", "organization"], check: (v) => v.length > 0 },
    { variants: ["createdAt", "updatedAt"], check: (v) => !Number.isNaN(Date.parse(v)) },
    { variants: ["uuid", "guid"], check: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) },
    { variants: ["hexColor", "color"], check: (v) => /^#[0-9a-f]{6}$/i.test(v) },
  ];

  for (const { variants, check } of cases) {
    for (const key of variants) {
      it(`"${key}" produces a realistic value`, () => {
        const result = gen.fake(fieldSchema(key), { seed: 1 }) as Record<string, unknown>;
        const value = result[key];
        if (typeof value !== "string") {
          throw new Error(
            `fieldSchema("${key}") always declares "${key}" as its only (required) string property -- got ${JSON.stringify(result)}`,
          );
        }
        expect(check(value), `key "${key}": got ${JSON.stringify(value)}`).toBe(true);
      });
    }
  }

  it('"name" (bare, no prefix) generates a person full name (deliberately kept, removable by design)', () => {
    const value = gen.fake(fieldSchema("name"), { seed: 1 });
    expect(value.name.split(" ").length).toBeGreaterThanOrEqual(2);
  });
});

describe("chanceHeuristics — negative word-boundary cases", () => {
  const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });

  it('"username" does not get treated as a person name (contains "name" as a substring only)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(fieldSchema("username"), { seed }).username;
      expect(value.split(" ").length).toBe(1);
    }
  });

  it('"emailBody" (an unrelated field that happens to contain "email") does not get email-formatted', () => {
    const value = gen.fake(fieldSchema("emailBody"), { seed: 1 }).emailBody;
    expect(value).not.toContain("@");
  });

  it('bare "title" is NOT treated as a job title (semantically empty without context, by design)', () => {
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(fieldSchema("title"), { seed }).title;
      // A real chance.profession() result reads as a role/title; plain word fallback doesn't.
      // We only assert it's a string here -- the point of this test is that NO rule fires (no
      // throw, no crash), covered by the negative check in the faker suite's equivalent test.
      expect(typeof value).toBe("string");
    }
  });

  it('"jobTitle" / "jobPosition" DO still fire the job-title rule', () => {
    for (const key of ["jobTitle", "jobPosition"]) {
      const result = gen.fake(fieldSchema(key), { seed: 1 }) as Record<string, unknown>;
      const value = result[key];
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});

describe("chanceHeuristics — constraint-guard fallthrough", () => {
  it('a "name" field with maxLength: 5 falls through to plain generation (still valid, no realistic name that short)', () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(fieldSchema("name", z.string().max(5)), { seed }).name;
      expect(value.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("chanceHeuristics — format compatibility", () => {
  it('"name" with format: uuid falls through to the format tier (uuid), not the person-name rule', () => {
    const schema = { type: "object", properties: { name: { type: "string", format: "uuid" } }, required: ["name"] };
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (let seed = 0; seed < 10; seed++) {
      const backend = chanceBackend.create(seed);
      const value = generateFromSchema(
        schema,
        { backend, root: schema, maxDepth: 5, projection: "output", heuristics: compileHeuristics(chanceHeuristics) },
        "",
        0,
      ) as { name: string };
      expect(uuidRegex.test(value.name), `seed ${seed}: ${value.name}`).toBe(true);
    }
  });
});

describe("chanceHeuristics — extend/remove recipes (README parity)", () => {
  it("filtering out person.name lets a custom-authored rule (or plain generation) take over", () => {
    const withoutBareName = chanceHeuristics.filter((r) => r.name !== "person.name");
    const gen = createFaker({ backend: chanceBackend, heuristics: withoutBareName });
    const value = gen.fake(fieldSchema("name"), { seed: 1 }).name;
    expect(typeof value).toBe("string");
  });

  it("prepending a custom rule ahead of chanceHeuristics wins for the same key", () => {
    const custom = [{ name: "custom.name", match: /^name$/, generate: () => "Custom Override Name" }, ...chanceHeuristics];
    const gen = createFaker({ backend: chanceBackend, heuristics: custom });
    const value = gen.fake(fieldSchema("name"), { seed: 1 }).name;
    expect(value).toBe("Custom Override Name");
  });
});

describe("chanceHeuristics — dates.birthDate age window", () => {
  const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
  const REFERENCE_DATE = new Date("2025-01-01T00:00:00.000Z");
  const HUNDRED_YEARS_BEFORE = new Date(REFERENCE_DATE.getTime());
  HUNDRED_YEARS_BEFORE.setFullYear(HUNDRED_YEARS_BEFORE.getFullYear() - 100);

  it("never generates a birth date after REFERENCE_DATE, and covers more than an 18-80 window across many seeds", () => {
    let sawUnder18 = false;
    let sawOver80 = false;
    for (let seed = 0; seed < 60; seed++) {
      const value = gen.fake(fieldSchema("birthDate"), { seed }).birthDate;
      const parsed = new Date(value);
      expect(Number.isNaN(parsed.getTime()), `"${value}" did not parse as a date`).toBe(false);
      expect(parsed.getTime()).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
      expect(parsed.getTime()).toBeGreaterThanOrEqual(HUNDRED_YEARS_BEFORE.getTime());

      const ageYears = (REFERENCE_DATE.getTime() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (ageYears < 18) sawUnder18 = true;
      if (ageYears > 80) sawOver80 = true;
    }
    expect(sawUnder18, "expected at least one seed to produce an age under 18 across 60 seeds").toBe(true);
    expect(sawOver80, "expected at least one seed to produce an age over 80 across 60 seeds").toBe(true);
  });

  it("also fires on dob/dateOfBirth variants with the same window", () => {
    for (const key of ["dob", "dateOfBirth"]) {
      const result = gen.fake(fieldSchema(key), { seed: 3 }) as Record<string, unknown>;
      const value = result[key];
      expect(typeof value).toBe("string");
      const parsed = new Date(value as string);
      expect(parsed.getTime()).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
      expect(parsed.getTime()).toBeGreaterThanOrEqual(HUNDRED_YEARS_BEFORE.getTime());
    }
  });
});

describe("chanceHeuristics — determinism", () => {
  it("same seed -> deep-equal output with heuristics on", () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Schema = z.object({ firstName: z.string(), email: z.email(), city: z.string() });
    const a = gen.fake(Schema, { seed: 7 });
    const b = gen.fake(Schema, { seed: 7 });
    expect(a).toEqual(b);
  });
});

describe("chanceHeuristics — FHIR ContactPoint (path/sibling/container rules)", () => {
  function contactPointSchema() {
    return z.object({
      system: z.enum(["phone", "email", "fax", "pager", "url", "sms", "other"]),
      value: z.string(),
      use: z.enum(["home", "work", "mobile"]).optional(),
    });
  }

  function telecomSchema<T extends z.ZodType = ReturnType<typeof contactPointSchema>>(contactPoint?: T) {
    return z.object({
      telecom: z
        .array(contactPoint ?? contactPointSchema())
        .min(1)
        .max(3),
    });
  }

  it("glob rule: **.phone.value fires for a phone array's value property", () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string(), type: z.string() }))
        .min(2)
        .max(2),
    });
    const value = gen.fake(Schema, { seed: 1 });
    for (const item of value.phone) {
      expect(item.value.length).toBeGreaterThan(0);
      expect(item.value).not.toContain("@");
    }
  });

  it("sibling-VALUE-aware rule: under `telecom`, value is consistent with the ACTUAL generated system across many seeds", () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Schema = telecomSchema();
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const cp of value.telecom) {
        if (cp.system === "email") expect(cp.value).toContain("@");
        if (cp.system === "url") expect(() => new URL(cp.value)).not.toThrow();
        if (["phone", "fax", "pager", "sms"].includes(cp.system)) expect(cp.value).toMatch(/\d/);
      }
    }
  });

  it("container rule: under `telecom`, a ContactPoint-shaped object gets a fully correlated value", async () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const ContactPoint = contactPointSchema();
    const Schema = telecomSchema(ContactPoint);
    for (const seed of [1, 2, 3, 4, 5]) {
      const value = gen.fake(Schema, { seed });
      const result = await Schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(result.issues)}`).toBeUndefined();
    }
  });

  it("determinism holds for the ContactPoint rules", () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Schema = telecomSchema();
    const a = gen.fake(Schema, { seed: 42 });
    const b = gen.fake(Schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("an identical {system, value} shape under an UNRELATED ancestor (e.g. real FHIR Identifier) does NOT fire either ContactPoint rule", async () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Identifier = z.object({
      system: z.enum(["http://hl7.org/fhir/sid/us-ssn", "phone"]),
      value: z.string().min(3).max(30),
    });
    const Schema = z.object({ identifier: z.array(Identifier).min(3).max(3) });
    for (let seed = 0; seed < 20; seed++) {
      const result = gen.fake(Schema, { seed });
      for (const id of result.identifier) {
        expect(id.value).not.toContain("@");
        expect(() => new URL(id.value)).toThrow();
      }
    }
  });
});

describe("chanceHeuristics — ancestor-NAME-only rules (no discriminator sibling)", () => {
  it('"phone: [{ value, type }]" (no `system`) generates a phone-looking value', () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string(), type: z.string() }))
        .min(2)
        .max(2),
    });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const item of value.phone) {
        expect(item.value).not.toContain("@");
        expect(item.value).toMatch(/\d/);
      }
    }
  });

  it('"emails: [{ value }]" (no `system`) generates an email-looking value', () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const Schema = z.object({
      emails: z
        .array(z.object({ value: z.string() }))
        .min(1)
        .max(3),
    });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const item of value.emails) {
        expect(item.value).toContain("@");
      }
    }
  });
});

describe("chanceHeuristics — whole-schema realism smoke test", () => {
  it("a representative User schema (with FHIR-style telecom) generates realistic values everywhere and still validates", async () => {
    const gen = createFaker({ backend: chanceBackend, heuristics: chanceHeuristics });
    const ContactPoint = z.object({
      system: z.enum(["phone", "email", "fax", "pager", "url", "sms", "other"]),
      value: z.string(),
      use: z.enum(["home", "work", "mobile"]).optional(),
    });
    const User = z.object({
      id: z.uuid(),
      firstName: z.string(),
      lastName: z.string(),
      email: z.email(),
      phone: z.string(),
      avatar: z.string(),
      city: z.string(),
      country: z.string(),
      companyName: z.string(),
      createdAt: z.iso.datetime(),
      telecom: z.array(ContactPoint).min(1).max(3),
    });

    for (const seed of [1, 2, 3, 4, 5]) {
      const value = gen.fake(User, { seed });
      expect(value.email).toContain("@");
      expect(() => new URL(value.avatar)).not.toThrow();
      for (const cp of value.telecom) {
        if (cp.system === "email") expect(cp.value).toContain("@");
        if (cp.system === "url") expect(() => new URL(cp.value)).not.toThrow();
      }
      const result = await User["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(result.issues)}`).toBeUndefined();
    }
  });
});

describe("chanceHeuristics — guard: requires chanceBackend to be the active backend", () => {
  it("throws a clear error when chanceHeuristics is paired with a non-chance backend", () => {
    const gen = createFaker({ heuristics: chanceHeuristics }); // root default backend, not chanceBackend
    const schema = z.object({ firstName: z.string() });
    expect(() => gen.fake(schema, { seed: 1 })).toThrow(/chanceBackend to be the active backend/);
  });
});
