import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultHeuristics, fakerBackend } from "../../src/faker/index.js";
import { compileHeuristics, createFaker, generateFromSchema } from "../../src/index.js";

/**
 * `defaultHeuristics` — the concrete ruleset `standard-schema-faker` (the meta package)
 * enables by default. Verifies: each rule fires on expected key-name variants (camel/snake/
 * kebab), negative word-boundary cases (a rule must not fire on an unrelated key that merely
 * contains its pattern as a substring), constraint-guard fallthrough, format-compatibility
 * gating, extend/remove recipes, determinism, and a whole-schema realism smoke test.
 */

// Generic over the literal key `K` (not just `string`) so the inferred output type is
// precise -- `z.object({ [key]: zodType })` with a plain `string`-typed `key` parameter would
// infer as `Record<string, unknown>` (TypeScript can't recover a literal property name from a
// runtime string variable's TYPE alone), which defeats the whole point of type inference this
// suite now relies on (`gen.fake(fieldSchema(key))` needs to come back typed as `{[key]: T}`,
// not `Record<string, unknown>`). `K extends string` as its own type parameter, inferred from
// the literal argument at each call site, fixes the KEY side.
//
// `T`'s default is `z.ZodString` (a CONCRETE type), not a conditional keyed off `T extends
// z.ZodType` -- that conditional form was tried first and was itself a bug: when `zodType` is
// omitted, `T` infers as its own constraint `z.ZodType` (the abstract base class), and
// `z.ZodType extends z.ZodType` is trivially true, so the conditional picked the `T` branch --
// i.e. the ABSTRACT base type, whose own `z.infer` is `unknown`, not `string`. A plain default
// type parameter (`T extends z.ZodType = z.ZodString`) doesn't have this problem: omitting the
// argument makes `T` default to the concrete `z.ZodString`, not fall back through a conditional.
function fieldSchema<K extends string, T extends z.ZodType = z.ZodString>(key: K, zodType?: T): z.ZodObject<{ [P in K]: T }> {
  const shape = { [key]: zodType ?? z.string() } as { [P in K]: T };
  return z.object(shape);
}

describe("defaultHeuristics — key variants fire the expected rule", () => {
  const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });

  const cases: Array<{ variants: string[]; check: (value: string) => boolean }> = [
    { variants: ["firstName", "first_name", "FIRST-NAME", "first name"], check: (v) => v.length > 0 && !/^\d+$/.test(v) },
    { variants: ["lastName", "last_name", "surname"], check: (v) => v.length > 0 },
    { variants: ["email", "emailAddress"], check: (v) => v.includes("@") },
    { variants: ["phone", "phoneNumber", "mobile"], check: (v) => v.length > 0 },
    { variants: ["avatar", "avatarUrl", "photo"], check: (v) => /^https?:\/\//.test(v) },
    { variants: ["city", "town"], check: (v) => v.length > 0 },
    { variants: ["zip", "zipCode", "postalCode"], check: (v) => v.length > 0 },
    { variants: ["country", "countryCode"], check: (v) => v.length > 0 },
    { variants: ["companyName", "company", "organization"], check: (v) => v.length > 0 },
    { variants: ["createdAt", "updatedAt"], check: (v) => !Number.isNaN(Date.parse(v)) },
    { variants: ["uuid", "guid"], check: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) },
    { variants: ["hexColor", "color"], check: (v) => /^#[0-9a-f]{6}$/i.test(v) },
  ];

  for (const { variants, check } of cases) {
    for (const key of variants) {
      it(`"${key}" produces a realistic value`, () => {
        // `key` here is a runtime string pulled from a `string[]` loop variable, not a literal
        // -- `fieldSchema`'s `K extends string` can't narrow to the specific literal in this
        // position (same limitation as any generic keyed off a non-literal runtime value), so
        // the result is typed as a generic string-indexed record. Asserted back to `string`
        // at the boundary, same pattern as the vendor-matrix/golden-cross-vendor tests, which
        // hit the identical "deliberately non-literal key" shape.
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

  it('"price"/"amount"/"cost" (number type) produce a plausible positive number', () => {
    for (const key of ["price", "amount", "cost"]) {
      const result = gen.fake(fieldSchema(key, z.number().min(0).max(100000)), { seed: 1 });
      const value = result[key];
      if (value === undefined) {
        throw new Error(`fieldSchema("${key}") always declares "${key}" as its only (required) property -- got ${JSON.stringify(result)}`);
      }
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("defaultHeuristics — negative word-boundary cases", () => {
  const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });

  it('"username" does not get treated as a person name (contains "name" as a substring only)', () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(fieldSchema("username"), { seed }).username;
      // The username rule fires instead (internet.username()-shaped, not a two-word full name).
      expect(value.split(" ").length).toBe(1);
    }
  });

  it('"filename" does not get treated as a plain "name" field', () => {
    const value = gen.fake(fieldSchema("filename"), { seed: 1 }).filename;
    // system.fileName()-shaped: has an extension-like suffix, not a "First Last" person name.
    expect(value).not.toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('"emailBody" (an unrelated field that happens to contain "email") does not get email-formatted', () => {
    const value = gen.fake(fieldSchema("emailBody"), { seed: 1 }).emailBody;
    expect(value).not.toContain("@");
  });
});

describe("defaultHeuristics — overreach fixes", () => {
  const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });

  it('bare "title" is NOT treated as a job title (semantically empty without context, by design)', () => {
    // A book/article/page title field named bare `title` must not get job-title-shaped text
    // ("Senior Marketing Coordinator") -- `person.jobTitle` only fires on `jobTitle`/
    // `jobPosition` now, never bare `title`.
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(fieldSchema("title"), { seed }).title;
      // A real faker job title always contains a recognizable seniority/role word structure
      // via person.jobTitle(); the plain lorem fallback is single/double lowercase word(s) with
      // no such structure. We assert the NEGATIVE (not job-title-shaped) rather than pin exact
      // fallback content, since the fallback tier itself isn't this rule's concern.
      expect(value).not.toMatch(/^(Chief|Senior|Lead|Global|International|Direct|Corporate|Dynamic|Future|Product|National)\b/);
    }
  });

  it('"jobTitle" / "jobPosition" DO still fire the job-title rule', () => {
    for (const key of ["jobTitle", "jobPosition"]) {
      // `key` is a plain (non-literal) `string` loop variable here -- same "deliberately
      // non-literal key" shape as the key-variants suite above; asserted back at the boundary.
      const result = gen.fake(fieldSchema(key), { seed: 1 }) as Record<string, unknown>;
      const value = result[key];
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it('"description" generates neutral prose (text.description), not a product description (commerce overreach fix)', () => {
    // Previously "commerce.description" generated faker.commerce.productDescription()
    // ("The Fantastic Wooden Chair range...") for ANY field literally named `description` --
    // including a person's bio, a task's description, etc. Now generates neutral lorem prose
    // instead, via the renamed "text.description" rule.
    const value = gen.fake(fieldSchema("description"), { seed: 1 }).description;
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
    // Neutral lorem text doesn't contain product-catalog vocabulary faker.commerce.* injects
    // (verified against faker's own commerce adjective/product-name corpus at the seed used).
    expect(value).not.toMatch(/\b(Chair|Shirt|Bike|Table|Shoes|Gloves|Pants|Ball|Chicken|Fish|Cheese|Bacon|Tuna)\b/i);
  });

  it("defaultHeuristics includes a rule named text.description, not commerce.description", () => {
    expect(defaultHeuristics.some((r) => r.name === "text.description")).toBe(true);
    expect(defaultHeuristics.some((r) => r.name === "commerce.description")).toBe(false);
  });
});

describe("defaultHeuristics — constraint-guard fallthrough", () => {
  it('a "name" field with maxLength: 5 falls through to plain generation (still valid, no realistic name that short)', () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(fieldSchema("name", z.string().max(5)), { seed }).name;
      expect(value.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("defaultHeuristics — format compatibility", () => {
  const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });

  it('"avatarUrl" with format: uri fires (formats allow-list includes it implicitly via url rule)', () => {
    const schema = z.object({ avatarUrl: z.url() });
    const value = gen.fake(schema, { seed: 1 }).avatarUrl;
    expect(() => new URL(value)).not.toThrow();
  });

  it('"name" with format: uuid falls through to the format tier (uuid), not the person-name rule', () => {
    // No zod helper emits {type: 'string', format: 'uuid'} under a property literally named
    // "name" in one step -- exercise the walker directly with a hand-built JSON Schema (same
    // approach core's own tests use for format/case combinations no vendor happens to emit).
    const schema = { type: "object", properties: { name: { type: "string", format: "uuid" } }, required: ["name"] };
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (let seed = 0; seed < 10; seed++) {
      const backend = fakerBackend.create(seed);
      const value = generateFromSchema(
        schema,
        { backend, root: schema, maxDepth: 5, projection: "output", heuristics: compileHeuristics(defaultHeuristics) },
        "",
        0,
      ) as { name: string };
      expect(uuidRegex.test(value.name), `seed ${seed}: ${value.name}`).toBe(true);
    }
  });
});

describe("defaultHeuristics — extend/remove recipes (README parity)", () => {
  it("filtering out person.name lets a custom-authored rule (or plain generation) take over", () => {
    const withoutBareName = defaultHeuristics.filter((r) => r.name !== "person.name");
    const gen = createFaker({ backend: fakerBackend, heuristics: withoutBareName });
    const value = gen.fake(fieldSchema("name"), { seed: 1 }).name;
    // No longer guaranteed to be a "First Last" shaped full name once the rule is removed.
    expect(typeof value).toBe("string");
  });

  it("prepending a custom rule ahead of defaultHeuristics wins for the same key", () => {
    const custom = [{ name: "custom.name", match: /^name$/, generate: () => "Custom Override Name" }, ...defaultHeuristics];
    const gen = createFaker({ backend: fakerBackend, heuristics: custom });
    const value = gen.fake(fieldSchema("name"), { seed: 1 }).name;
    expect(value).toBe("Custom Override Name");
  });
});

describe("defaultHeuristics — dates.birthDate age window", () => {
  const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
  // REFERENCE_DATE is 2025-01-01T00:00:00.000Z (see index.ts) -- the anchor every relative-date
  // rule in this package is pinned to, never Date.now().
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
      // Never in the future relative to REFERENCE_DATE.
      expect(parsed.getTime()).toBeLessThanOrEqual(REFERENCE_DATE.getTime());
      // Never more than 100 years before REFERENCE_DATE.
      expect(parsed.getTime()).toBeGreaterThanOrEqual(HUNDRED_YEARS_BEFORE.getTime());

      const ageYears = (REFERENCE_DATE.getTime() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (ageYears < 18) sawUnder18 = true;
      if (ageYears > 80) sawOver80 = true;
    }
    // faker's OWN default (`min: 18, max: 80`) would never produce either of these across any
    // number of seeds -- seeing both confirms the explicit {min: 0, max: 100} window is wired
    // through, not silently reverted to faker's default age range.
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

describe("defaultHeuristics — determinism", () => {
  it("same seed -> deep-equal output with heuristics on", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Schema = z.object({ firstName: z.string(), email: z.email(), city: z.string() });
    const a = gen.fake(Schema, { seed: 7 });
    const b = gen.fake(Schema, { seed: 7 });
    expect(a).toEqual(b);
  });
});

describe("defaultHeuristics — FHIR ContactPoint (path/sibling/container rules)", () => {
  // IMPORTANT: `system` alone is NOT a reliable ContactPoint signal -- FHIR reuses that field
  // name for `Coding.system`/`Identifier.system` (both URI strings, unrelated to contact
  // kinds). Both ContactPoint rules REQUIRE the nearest named ancestor to look like a
  // ContactPoint-array property (telecom/contact(s)/contactPoint(s)) as well as the system-enum
  // content check -- so every positive test here nests the ContactPoint shape under `telecom`.
  function contactPointSchema() {
    return z.object({
      system: z.enum(["phone", "email", "fax", "pager", "url", "sms", "other"]),
      value: z.string(),
      use: z.enum(["home", "work", "mobile"]).optional(),
    });
  }

  // Generic over the concrete ContactPoint schema type `T` (defaulting to
  // `contactPointSchema()`'s own return type), same reasoning as `fieldSchema` above: typing
  // the parameter as the abstract `z.ZodType` base (with `contactPointSchema()` merely as its
  // runtime default value) would infer `T = z.ZodType`, whose `z.infer` is `unknown` --
  // defeating the actual point of passing a concrete schema in.
  function telecomSchema<T extends z.ZodType = ReturnType<typeof contactPointSchema>>(contactPoint?: T) {
    return z.object({
      telecom: z
        .array(contactPoint ?? contactPointSchema())
        .min(1)
        .max(3),
    });
  }

  it("glob rule: **.phone.value fires for a phone array's value property", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string(), type: z.string() }))
        .min(2)
        .max(2),
    });
    const value = gen.fake(Schema, { seed: 1 });
    for (const item of value.phone) {
      expect(item.value.length).toBeGreaterThan(0);
      expect(item.value).not.toContain("@"); // phone-shaped, not email-shaped
    }
  });

  it("sibling-VALUE-aware rule: under `telecom`, value is consistent with the ACTUAL generated system across many seeds", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
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

  it("under `telecom`, works regardless of declaration order (value declared before system) thanks to two-tier property ordering", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const ReorderedContactPoint = z.object({
      value: z.string(),
      system: z.enum(["phone", "email", "fax", "pager", "url", "sms", "other"]),
    });
    const Schema = telecomSchema(ReorderedContactPoint);
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const cp of value.telecom) {
        if (cp.system === "email") expect(cp.value).toContain("@");
        if (cp.system === "url") expect(() => new URL(cp.value)).not.toThrow();
      }
    }
  });

  it("container rule: under `telecom`, a ContactPoint-shaped object gets a fully correlated value", async () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const ContactPoint = contactPointSchema();
    const Schema = telecomSchema(ContactPoint);
    for (const seed of [1, 2, 3, 4, 5]) {
      const value = gen.fake(Schema, { seed });
      const result = await Schema["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(result.issues)}`).toBeUndefined();
    }
  });

  it("determinism holds for the ContactPoint rules", () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Schema = telecomSchema();
    const a = gen.fake(Schema, { seed: 42 });
    const b = gen.fake(Schema, { seed: 42 });
    expect(a).toEqual(b);
  });

  it("an identical {system, value} shape under an UNRELATED ancestor (e.g. real FHIR Identifier) does NOT fire either ContactPoint rule", async () => {
    // Real FHIR `Identifier`: `{ system: uri, value: string }` -- `system` here is a URI string
    // (e.g. "http://hl7.org/fhir/sid/us-ssn"), not a phone/email/... contact-kind enum. Even
    // though this schema's `system` enum happens to contain a recognized contact-kind string
    // (to stress-test that the ancestor gate, not the enum-content check, is what's actually
    // preventing the false positive), the ContactPoint rules must not fire because the nearest
    // named ancestor is `identifier`, not `telecom`/`contact(s)`.
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Identifier = z.object({
      system: z.enum(["http://hl7.org/fhir/sid/us-ssn", "phone"]), // "phone" included deliberately, see above
      value: z.string().min(3).max(30),
    });
    const Schema = z.object({ identifier: z.array(Identifier).min(3).max(3) });
    for (let seed = 0; seed < 20; seed++) {
      const result = gen.fake(Schema, { seed });
      for (const id of result.identifier) {
        // Falls through to plain string generation -- never the sibling/container-correlated shape.
        expect(id.value).not.toContain("@");
        expect(() => new URL(id.value)).toThrow();
      }
    }
  });

  it("a Coding-like shape ({system, code, display}) is left untouched", async () => {
    // Real FHIR `Coding`: `{ system: uri, code: string, display?: string }` -- no `value`
    // property at all, so neither ContactPoint rule's key match (`value`) can ever fire
    // regardless of ancestor name. Included as an explicit regression guard.
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Coding = z.object({
      system: z.enum(["http://loinc.org", "http://snomed.info/sct"]),
      code: z.string().min(3).max(10),
      display: z.string().optional(),
    });
    const Schema = z.object({ coding: z.array(Coding).min(1).max(2) });
    const value = gen.fake(Schema, { seed: 1 });
    const result = await Schema["~standard"].validate(value);
    expect(result.issues, JSON.stringify(result.issues)).toBeUndefined();
  });

  it("priority: the sibling-value rule wins over an ancestor-name rule when both could apply (system sibling present AND phone-ish ancestor)", () => {
    // `telecom: [{ system: 'email', value: '...' }]` under a `phone`-NAMED ancestor as well
    // (nested doubly) -- both the sibling-VALUE-aware rule (ordered first in defaultHeuristics)
    // and an ancestor-name rule could theoretically match `value`; first-match-wins means the
    // sibling-value rule (more specific: it knows the ACTUAL generated `system`) fires, not an
    // ancestor-name rule that would guess purely from the `phone` ancestor name.
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const ContactPoint = contactPointSchema();
    const Schema = z.object({
      phone: z
        .array(z.object({ telecom: z.array(ContactPoint).min(1).max(1) }))
        .min(1)
        .max(1),
    });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      const cp = value.phone[0]?.telecom[0];
      if (!cp) continue;
      // system correlation (sibling-value rule) must hold, proving it -- not a generic
      // phone-ancestor guess -- is what decided `value`'s shape.
      if (cp.system === "email") expect(cp.value).toContain("@");
      if (cp.system === "url") expect(() => new URL(cp.value)).not.toThrow();
    }
  });
});

describe("defaultHeuristics — ancestor-NAME-only rules (no discriminator sibling)", () => {
  // For shapes with NO `system`-style discriminator at all -- e.g. `phone: [{ value, type }]`,
  // `emails: [{ value, label }]` -- the only signal is the nearest NAMED ancestor. Strictly
  // weaker than the sibling-VALUE-aware rules (see the priority test at the end of this block).

  it('"phone: [{ value, type }]" (no `system`) generates a phone-looking value', () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
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
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
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

  it('"urls: [{ value }]" / "links: [{ value }]" (no `system`) generate URL-looking values', () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    for (const ancestorName of ["urls", "links"]) {
      const Schema = z.object({
        [ancestorName]: z
          .array(z.object({ value: z.string() }))
          .min(1)
          .max(2),
      });
      for (let seed = 0; seed < 10; seed++) {
        const value = gen.fake(Schema, { seed });
        for (const item of value[ancestorName] ?? []) {
          expect(() => new URL(item.value), `ancestor "${ancestorName}", seed ${seed}: ${item.value}`).not.toThrow();
        }
      }
    }
  });

  it('the same key "value" under an UNRELATED ancestor (e.g. `settings: [{ value }]`) stays plain', () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const Schema = z.object({
      settings: z
        .array(z.object({ value: z.string().min(3).max(20) }))
        .min(1)
        .max(1),
    });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const item of value.settings) {
        expect(item.value).not.toContain("@");
        expect(() => new URL(item.value)).toThrow();
      }
    }
  });

  it("ancestor-name rules LOSE to the sibling-VALUE rule when both could apply (object with a `system` discriminator AND a ContactPoint-like ancestor)", () => {
    // `contactPoints: [{ system: 'email'|'phone'|'url', value: '...' }]` -- `contactPoints`
    // matches the sibling-VALUE-aware ContactPoint rule's ancestor gate
    // (`/^(telecom|contactpoints?|contacts?)$/`), so THAT rule fires and correlates `value`
    // with the ACTUAL generated `system`. It does NOT match any of the plain ancestor-name
    // rules' patterns (phone/email/url-ish names only), so this isolates the priority claim:
    // the stronger, generated-value-aware rule wins over a purely name-based guess whenever
    // both COULD apply to the same shape.
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
    const ContactPoint = z.object({ system: z.enum(["phone", "email", "url"]), value: z.string() });
    const Schema = z.object({ contactPoints: z.array(ContactPoint).min(3).max(3) });
    for (let seed = 0; seed < 30; seed++) {
      const value = gen.fake(Schema, { seed });
      for (const cp of value.contactPoints) {
        if (cp.system === "email") expect(cp.value).toContain("@");
        if (cp.system === "url") expect(() => new URL(cp.value)).not.toThrow();
        if (cp.system === "phone") expect(cp.value).toMatch(/\d/);
      }
    }
  });
});

describe("defaultHeuristics — whole-schema realism smoke test", () => {
  it("a representative User schema (with FHIR-style telecom) generates realistic values everywhere and still validates", async () => {
    const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });
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
