import { type } from "arktype";
import { Schema } from "effect";
import * as v from "valibot";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultHeuristics, fakerBackend } from "../../src/faker/index.js";
import type { AnySchema } from "../../src/index.js";
import { createFaker, prepare } from "../../src/index.js";

/**
 * Cross-vendor coverage for everything beyond the base vendor matrix
 * (`test/vendor-matrix.test.ts`, which only covers node-kind-level JSON Schema generation:
 * string/number/object/array/union/etc). The heuristics engine +
 * `defaultHeuristics` (incl. the FHIR `ContactPoint` rules) has been tested almost exclusively
 * against Zod. This file exercises the SAME logical schemas across Zod, Valibot, and ArkType,
 * with Effect Schema covered best-effort (see `effect-best-effort.test.ts`'s "Effect Schema
 * best-effort" precedent).
 *
 * `defaultHeuristics`/`fakerBackend` live in the `standard-schema-faker/faker` subpath, so this
 * file lives under `test/faker/` rather than alongside the root entry's own `heuristics.test.ts`.
 */

async function expectValidVendor(validate: (value: unknown) => boolean | Promise<boolean>, value: unknown, label: string) {
  const ok = await validate(value);
  if (!ok) throw new Error(`[${label}] validation failed for ${JSON.stringify(value)}`);
}

function zodValidate(schema: z.ZodType) {
  return async (value: unknown) => {
    const r = await schema["~standard"].validate(value);
    return !r.issues;
  };
}
function valibotValidate(schema: v.GenericSchema) {
  return (value: unknown) => v.safeParse(schema, value).success;
}
function arktypeValidate(schema: (value: unknown) => unknown) {
  return (value: unknown) => !(schema(value) instanceof type.errors);
}
function effectValidate(schema: AnySchema) {
  return async (value: unknown) => {
    const r = await schema["~standard"].validate(value);
    return !(r as { issues?: unknown }).issues;
  };
}

const gen = createFaker({ backend: fakerBackend, heuristics: defaultHeuristics });

beforeAll(async () => {
  await prepare(v.object({ id: v.string() }));
  await prepare(Schema.standardSchemaV1(Schema.Struct({ id: Schema.String })));
});

describe("cross-vendor — heuristics realism smoke (user schema: email/phone/name)", () => {
  const zodUser = z.object({
    firstName: z.string(),
    lastName: z.string(),
    email: z.email(),
    phone: z.string(),
  });
  const valibotUser = v.object({
    firstName: v.string(),
    lastName: v.string(),
    email: v.pipe(v.string(), v.email()),
    phone: v.string(),
  });
  const arktypeUser = type({
    firstName: "string",
    lastName: "string",
    email: "string.email",
    phone: "string",
  });
  const effectUser = Schema.standardSchemaV1(
    Schema.Struct({
      firstName: Schema.String,
      lastName: Schema.String,
      email: Schema.String,
      phone: Schema.String,
    }),
  );

  it("zod: realistic values, vendor validate passes", async () => {
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(zodUser, { seed });
      expect(value.email).toContain("@");
      expect(value.firstName.length).toBeGreaterThan(0);
      await expectValidVendor(zodValidate(zodUser), value, "zod");
    }
  });

  it("valibot: realistic values, vendor validate passes", async () => {
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(valibotUser as unknown as AnySchema, { seed }) as { email: string; firstName: string };
      expect(value.email).toContain("@");
      expect(value.firstName.length).toBeGreaterThan(0);
      await expectValidVendor(valibotValidate(valibotUser), value, "valibot");
    }
  });

  it("arktype: realistic values, vendor validate passes", async () => {
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(arktypeUser as unknown as AnySchema, { seed }) as { email: string; firstName: string };
      expect(value.email).toContain("@");
      expect(value.firstName.length).toBeGreaterThan(0);
      await expectValidVendor(arktypeValidate(arktypeUser), value, "arktype");
    }
  });

  it("effect (best-effort): realistic values, vendor validate passes", async () => {
    // Effect's fallback JSON Schema for a bare Schema.String property carries no `format`, so
    // defaultHeuristics' bare-key rules (email/firstName/phone, gated on `when.formats`
    // matching a format-less node -- see heuristics.ts's ruleTypeGateApplies) still apply the
    // same as they do for Zod/Valibot/ArkType's own format-less string properties.
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(effectUser, { seed }) as { email: string; firstName: string };
      expect(value.email).toContain("@");
      expect(value.firstName.length).toBeGreaterThan(0);
      await expectValidVendor(effectValidate(effectUser), value, "effect");
    }
  });
});

describe("cross-vendor — FHIR ContactPoint (telecom array, system enum, value, use)", () => {
  const zodContactPoint = z.object({
    system: z.enum(["phone", "email", "fax", "pager", "url", "sms", "other"]),
    value: z.string(),
    use: z.enum(["home", "work", "mobile"]).optional(),
  });
  const zodTelecom = z.object({ telecom: z.array(zodContactPoint).min(1).max(3) });

  const valibotContactPoint = v.object({
    system: v.picklist(["phone", "email", "fax", "pager", "url", "sms", "other"]),
    value: v.string(),
    use: v.optional(v.picklist(["home", "work", "mobile"])),
  });
  const valibotTelecom = v.object({ telecom: v.pipe(v.array(valibotContactPoint), v.minLength(1), v.maxLength(3)) });

  const arktypeContactPoint = type({
    system: "'phone'|'email'|'fax'|'pager'|'url'|'sms'|'other'",
    value: "string",
    "use?": "'home'|'work'|'mobile'",
  });
  const arktypeTelecom = type({ telecom: arktypeContactPoint.array().atLeastLength(1).atMostLength(3) });

  const effectContactPoint = Schema.Struct({
    system: Schema.Literal("phone", "email", "fax", "pager", "url", "sms", "other"),
    value: Schema.String,
    use: Schema.optional(Schema.Literal("home", "work", "mobile")),
  });
  const effectTelecom = Schema.standardSchemaV1(Schema.Struct({ telecom: Schema.Array(effectContactPoint) }));

  function checkConsistent(cp: { system: string; value: string }) {
    if (cp.system === "email") expect(cp.value).toContain("@");
    if (cp.system === "url") expect(() => new URL(cp.value)).not.toThrow();
    if (["phone", "fax", "pager", "sms"].includes(cp.system)) expect(cp.value).toMatch(/\d/);
  }

  it("zod: generated system/value pair is consistent, vendor validate passes", async () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(zodTelecom, { seed });
      for (const cp of value.telecom) checkConsistent(cp);
      await expectValidVendor(zodValidate(zodTelecom), value, "zod");
    }
  });

  it("valibot: generated system/value pair is consistent, vendor validate passes", async () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(valibotTelecom as unknown as AnySchema, { seed }) as {
        telecom: Array<{ system: string; value: string }>;
      };
      for (const cp of value.telecom) checkConsistent(cp);
      await expectValidVendor(valibotValidate(valibotTelecom), value, "valibot");
    }
  });

  it("arktype: generated system/value pair is consistent, vendor validate passes", async () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(arktypeTelecom as unknown as AnySchema, { seed }) as {
        telecom: Array<{ system: string; value: string }>;
      };
      for (const cp of value.telecom) checkConsistent(cp);
      await expectValidVendor(arktypeValidate(arktypeTelecom), value, "arktype");
    }
  });

  it("effect (best-effort): generated system/value pair is consistent, vendor validate passes", async () => {
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(effectTelecom, { seed }) as {
        telecom: Array<{ system: string; value: string }>;
      };
      for (const cp of value.telecom) checkConsistent(cp);
      await expectValidVendor(effectValidate(effectTelecom), value, "effect");
    }
  });
});

describe("cross-vendor — overrides + finalize applied per vendor", () => {
  const zodSchema = z.object({ email: z.email(), tag: z.string().optional() });
  const valibotSchema = v.object({ email: v.pipe(v.string(), v.email()), tag: v.optional(v.string()) });
  const arktypeSchema = type({ email: "string.email", "tag?": "string" });
  const effectSchema = Schema.standardSchemaV1(Schema.Struct({ email: Schema.String, tag: Schema.optional(Schema.String) }));

  function configured() {
    return createFaker({
      backend: fakerBackend,
      overrides: { email: () => "override@test.dev" },
      optionalProbability: 1,
      finalize: { tag: () => "finalized-tag" },
    });
  }

  it("zod: overrides + finalize both apply, vendor validate passes", async () => {
    const value = configured().fake(zodSchema, { seed: 1 });
    expect(value.email).toBe("override@test.dev");
    expect(value.tag).toBe("finalized-tag");
    await expectValidVendor(zodValidate(zodSchema), value, "zod");
  });

  it("valibot: overrides + finalize both apply, vendor validate passes", async () => {
    const value = configured().fake(valibotSchema as unknown as AnySchema, { seed: 1 }) as { email: string; tag: string };
    expect(value.email).toBe("override@test.dev");
    expect(value.tag).toBe("finalized-tag");
    await expectValidVendor(valibotValidate(valibotSchema), value, "valibot");
  });

  it("arktype: overrides + finalize both apply, vendor validate passes", async () => {
    const value = configured().fake(arktypeSchema as unknown as AnySchema, { seed: 1 }) as { email: string; tag: string };
    expect(value.email).toBe("override@test.dev");
    expect(value.tag).toBe("finalized-tag");
    await expectValidVendor(arktypeValidate(arktypeSchema), value, "arktype");
  });

  it("effect (best-effort): overrides + finalize both apply, vendor validate passes", async () => {
    const value = configured().fake(effectSchema, { seed: 1 }) as { email: string; tag: string };
    expect(value.email).toBe("override@test.dev");
    expect(value.tag).toBe("finalized-tag");
    await expectValidVendor(effectValidate(effectSchema), value, "effect");
  });
});
