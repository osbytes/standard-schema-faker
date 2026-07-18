import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker, normalizeKey } from "../src/index.js";
import type { HeuristicRule } from "../src/types.js";

/**
 * Heuristic field-matching engine — property-name/description sniffing against hand-built
 * rules. The root entry ships zero rules and defaults to `heuristics: false`; this suite
 * exercises the pure engine machinery with hand-built rules,
 * independent of `standard-schema-faker/faker`'s `defaultHeuristics` (tested separately in
 * that subpath).
 *
 * Priority ladder verified here: overrides > heuristics > format > pattern > plain. A rule
 * (or the function-shorthand form) returning `undefined` DECLINES — falls through to the
 * next matching rule, then to format/pattern/plain generation. A rule whose generated value
 * violates the node's own bounds is treated exactly like a decline (never truncated/coerced).
 */

describe("normalizeKey", () => {
  it("normalizes snake_case, camelCase, and kebab-case/SCREAMING to the same form", () => {
    expect(normalizeKey("first_name")).toBe("firstname");
    expect(normalizeKey("firstName")).toBe("firstname");
    expect(normalizeKey("FIRST-NAME")).toBe("firstname");
    expect(normalizeKey("first name")).toBe("firstname");
  });
});

describe("heuristics: false disables the layer entirely (core's default)", () => {
  it("createFaker({}) behaves identically to createFaker({ heuristics: false })", () => {
    const Schema = z.object({ name: z.string() });
    const gen1 = createFaker({});
    const gen2 = createFaker({ heuristics: false });
    for (const seed of [1, 2, 3]) {
      expect(gen1.fake(Schema, { seed })).toEqual(gen2.fake(Schema, { seed }));
    }
  });
});

describe("heuristics: rule matching", () => {
  const nameRule: HeuristicRule = {
    name: "test.name",
    match: /^name$/,
    when: { type: "string" },
    generate: ({ backend }) => backend.pick(["Alice", "Bob", "Carol"]),
  };

  it("fires on an exact normalized key match", () => {
    const gen = createFaker({ heuristics: [nameRule] });
    const Schema = z.object({ name: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(["Alice", "Bob", "Carol"]).toContain(value.name);
  });

  it("does NOT fire on a key that merely contains the pattern as a substring (username != name)", () => {
    const gen = createFaker({ heuristics: [nameRule] });
    const Schema = z.object({ username: z.string() });
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(["Alice", "Bob", "Carol"]).not.toContain(value.username);
    }
  });

  it("does not fire on enum/const nodes (constraint guard)", () => {
    const gen = createFaker({ heuristics: [nameRule] });
    const Schema = z.object({ name: z.enum(["fixed-a", "fixed-b"]) });
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(["fixed-a", "fixed-b"]).toContain(value.name);
    }
  });
});

describe("heuristics: constraint-guard fallthrough", () => {
  it("a rule producing an out-of-bounds value is discarded (falls through to plain generation), never truncated", () => {
    const rule: HeuristicRule = { name: "test.name", match: /^name$/, generate: () => "Bob" }; // "Bob" is 3 chars
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ name: z.string().max(2) });
    for (let seed = 0; seed < 20; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.name).not.toBe("Bob");
      expect(value.name.length).toBeLessThanOrEqual(2);
    }
  });

  it("a rule producing an in-bounds value is used normally", () => {
    const rule: HeuristicRule = { name: "test.name", match: /^name$/, generate: () => "Bo" };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ name: z.string().max(2) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.name).toBe("Bo");
  });

  it("number bounds are enforced the same way", () => {
    const rule: HeuristicRule = { name: "test.age", match: /^age$/, when: { type: "integer" }, generate: () => 200 };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ age: z.int().min(0).max(120) });
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.age).not.toBe(200);
      expect(value.age).toBeLessThanOrEqual(120);
    }
  });
});

describe("heuristics: decline semantics (generate() returning undefined)", () => {
  it("a declining rule lets a later matching rule fire", () => {
    const rules: HeuristicRule[] = [
      { name: "a", match: /^name$/, generate: () => undefined },
      { name: "b", match: /^name$/, generate: () => "Fallback" },
    ];
    const gen = createFaker({ heuristics: rules });
    const Schema = z.object({ name: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.name).toBe("Fallback");
  });

  it("if every matching rule declines, generation falls through to format/pattern/plain", () => {
    const rules: HeuristicRule[] = [{ name: "a", match: /^name$/, generate: () => undefined }];
    const gen = createFaker({ heuristics: rules });
    const Schema = z.object({ name: z.string().min(5).max(10) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(typeof value.name).toBe("string");
    expect(value.name.length).toBeGreaterThanOrEqual(5);
    expect(value.name.length).toBeLessThanOrEqual(10);
  });
});

describe("heuristics: function shorthand", () => {
  it("works standalone as a single catch-all rule", () => {
    const gen = createFaker({
      heuristics: ({ key, backend }) => (key === "name" ? backend.pick(["X", "Y", "Z"]) : undefined),
    });
    const Schema = z.object({ name: z.string(), other: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(["X", "Y", "Z"]).toContain(value.name);
    expect(["X", "Y", "Z"]).not.toContain(value.other);
  });

  it("declining (returning undefined) falls through to plain generation, same as the array form", () => {
    const gen = createFaker({ heuristics: () => undefined });
    const Schema = z.object({ name: z.string().min(5).max(10) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.name.length).toBeGreaterThanOrEqual(5);
    expect(value.name.length).toBeLessThanOrEqual(10);
  });
});

describe("heuristics: priority ladder", () => {
  it("overrides beat heuristics", () => {
    const rule: HeuristicRule = { name: "test.name", match: /^name$/, generate: () => "FromHeuristic" };
    const gen = createFaker({ heuristics: [rule], overrides: { name: () => "FromOverride" } });
    const Schema = z.object({ name: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.name).toBe("FromOverride");
  });

  it("heuristics beat format-based generation", () => {
    const rule: HeuristicRule = {
      name: "test.email",
      match: /^email$/,
      when: { type: "string", formats: ["email"] },
      generate: () => "heuristic@fixed.dev",
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ email: z.email() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.email).toBe("heuristic@fixed.dev");
  });
});

describe("heuristics: determinism", () => {
  it("same seed -> deep-equal output with heuristics on", () => {
    const rule: HeuristicRule = {
      name: "test.name",
      match: /^name$/,
      generate: ({ backend }) => backend.pick(["A", "B", "C", "D", "E"]),
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ name: z.string(), age: z.int().min(0).max(100) });
    const a = gen.fake(Schema, { seed: 42 });
    const b = gen.fake(Schema, { seed: 42 });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// MatchContext — the ctx-object matcher forms
// ---------------------------------------------------------------------------

describe("MatchContext: matcher forms", () => {
  it("bare key string matches the normalized leaf key (same folding as RegExp against key)", () => {
    const rule: HeuristicRule = { name: "test.name", match: "firstName", generate: () => "Matched" };
    const gen = createFaker({ heuristics: [rule] });
    for (const key of ["firstName", "first_name", "FIRST-NAME", "first name"]) {
      const Schema = z.object({ [key]: z.string() });
      const value = gen.fake(Schema, { seed: 1 });
      expect(value[key], `key variant "${key}"`).toBe("Matched");
    }
  });

  it("bare key string does NOT match a mere substring (word-boundary discipline)", () => {
    const rule: HeuristicRule = { name: "test.name", match: "name", generate: () => "Matched" };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ username: z.string() });
    for (let seed = 0; seed < 10; seed++) {
      const value = gen.fake(Schema, { seed });
      expect(value.username).not.toBe("Matched");
    }
  });

  it("dot-path glob string matches semanticPath, array indices stripped (glob-through-array)", () => {
    const rule: HeuristicRule = { name: "test.phoneValue", match: "**.phone.value", when: { type: "string" }, generate: () => "555-0100" };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string(), type: z.string() }))
        .min(3)
        .max(3),
    });
    const value = gen.fake(Schema, { seed: 1 });
    // Fires regardless of array index -- phone.0.value, phone.1.value, phone.2.value all hit.
    for (const item of value.phone) {
      expect(item.value).toBe("555-0100");
    }
  });

  it("dot-path glob also matches when nested even deeper (phone.2.value equivalent via **)", () => {
    const rule: HeuristicRule = { name: "test.deepPhoneValue", match: "**.phone.value", when: { type: "string" }, generate: () => "DEEP" };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({
      contacts: z
        .array(
          z.object({
            phone: z
              .array(z.object({ value: z.string() }))
              .min(1)
              .max(1),
          }),
        )
        .min(1)
        .max(1),
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.contacts[0]?.phone[0]?.value).toBe("DEEP");
  });

  it("a bare `value` key outside a recognizable path context stays plain (no false-positive)", () => {
    const rule: HeuristicRule = { name: "test.phoneValue", match: "**.phone.value", when: { type: "string" }, generate: () => "555-0100" };
    const gen = createFaker({ heuristics: [rule] });
    // `value` here has nothing to do with `phone` -- must NOT match "**.phone.value".
    const Schema = z.object({ setting: z.object({ value: z.string().min(3).max(20) }) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.setting.value).not.toBe("555-0100");
  });

  it("RegExp is tested against semanticPath (anchored, path-suffix style)", () => {
    const rule: HeuristicRule = {
      name: "test.phoneValue",
      match: /(^|\.)phone\.value$/,
      when: { type: "string" },
      generate: () => "555-0100",
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string() }))
        .min(1)
        .max(1),
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.phone[0]?.value).toBe("555-0100");
  });

  it("RegExp against semanticPath does not match an unrelated field with a similar suffix", () => {
    const rule: HeuristicRule = {
      name: "test.phoneValue",
      match: /(^|\.)phone\.value$/,
      when: { type: "string" },
      generate: () => "555-0100",
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ telephoneValue: z.string().min(3).max(20) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.telephoneValue).not.toBe("555-0100");
  });

  it("function matcher receives the full MatchContext (parent-schema-aware via ctx.parent)", () => {
    const rule: HeuristicRule = {
      name: "test.contactPointValue",
      // Schema-shape check: does the parent object declare a `system` property with an enum?
      // (Distinct from the ACTUAL generated sibling value — see the `ctx.siblings` describe
      // block below for that.)
      match: (ctx) =>
        ctx.key === "value" && Array.isArray((ctx.parent?.properties as Record<string, { enum?: unknown }> | undefined)?.system?.enum),
      when: { type: "string" },
      generate: () => "parent-schema-matched",
    };
    const gen = createFaker({ heuristics: [rule] });
    const ContactPoint = z.object({ system: z.enum(["phone", "email"]), value: z.string() });
    const Schema = z.object({ contact: ContactPoint });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.contact.value).toBe("parent-schema-matched");
  });

  it("function matcher can inspect ctx.ancestors (leaf -> root)", () => {
    const rule: HeuristicRule = {
      name: "test.ancestorAware",
      match: (ctx) => ctx.key === "value" && ctx.ancestors.some((a) => a.key === "phone"),
      when: { type: "string" },
      generate: () => "ancestor-matched",
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string() }))
        .min(1)
        .max(1),
    });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.phone[0]?.value).toBe("ancestor-matched");
  });
});

describe("MatchContext: field shapes", () => {
  it("key/rawKey/path/semanticPath/segments are populated correctly for a nested array leaf", () => {
    let captured: { key: string; rawKey: string; path: string; semanticPath: string; segments: string[] } | undefined;
    const rule: HeuristicRule = {
      name: "test.capture",
      match: (ctx) => {
        if (ctx.key === "phonenumber") {
          captured = { key: ctx.key, rawKey: ctx.rawKey, path: ctx.path, semanticPath: ctx.semanticPath, segments: ctx.segments };
        }
        return false; // never actually generate -- just capture and decline
      },
      generate: () => undefined,
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({
      phone: z
        .array(z.object({ phoneNumber: z.string() }))
        .min(1)
        .max(1),
    });
    gen.fake(Schema, { seed: 1 });
    expect(captured).toBeDefined();
    expect(captured?.rawKey).toBe("phoneNumber");
    expect(captured?.key).toBe("phonenumber");
    expect(captured?.path).toBe("phone.0.phoneNumber");
    expect(captured?.semanticPath).toBe("phone.phonenumber");
    expect(captured?.segments).toEqual(["phone", "0", "phoneNumber"]);
  });

  it("ctx.ancestors matches MatchContext's documented worked example exactly (phone[0].value): [{key:'0'}, {key:'phone'}], never including the leaf's own key", () => {
    // Regression guard for a real bug found while building the ancestor-name-driven default
    // heuristics: the walker once pushed a spurious extra frame keyed by the CURRENT leaf's own
    // name (so ancestors came out as ["value", "0", "phone"] instead of ["0", "phone"]),
    // silently poisoning any ancestor-name-based rule (`ancestorKeys(ctx)[0]` would read back
    // the leaf's own key instead of its actual nearest named ancestor).
    let captured: Array<{ key: string }> | undefined;
    const rule: HeuristicRule = {
      name: "test.ancestorsShape",
      match: (ctx) => {
        if (ctx.key === "value") captured = ctx.ancestors.map((a) => ({ key: a.key }));
        return false;
      },
      generate: () => undefined,
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string(), type: z.string() }))
        .min(1)
        .max(1),
    });
    gen.fake(Schema, { seed: 1 });
    expect(captured).toEqual([{ key: "0" }, { key: "phone" }]);
  });

  it("ctx.ancestors for plain (non-array) nested objects: contact.inner.value -> [{key:'inner'}, {key:'contact'}]", () => {
    let captured: Array<{ key: string }> | undefined;
    const rule: HeuristicRule = {
      name: "test.ancestorsShapeNested",
      match: (ctx) => {
        if (ctx.key === "value") captured = ctx.ancestors.map((a) => ({ key: a.key }));
        return false;
      },
      generate: () => undefined,
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ contact: z.object({ inner: z.object({ value: z.string() }) }) });
    gen.fake(Schema, { seed: 1 });
    expect(captured).toEqual([{ key: "inner" }, { key: "contact" }]);
  });

  it("root call has empty key/path/segments and no parent", () => {
    let sawRoot = false;
    const rule: HeuristicRule = {
      name: "test.rootCapture",
      when: { type: "object" },
      match: (ctx) => {
        if (ctx.path === "" && ctx.parent === undefined) sawRoot = true;
        return false;
      },
      generate: () => undefined,
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ name: z.string() });
    gen.fake(Schema, { seed: 1 });
    expect(sawRoot).toBe(true);
  });
});

describe("MatchContext: container-node rules (when: {type: 'object'})", () => {
  it("generates a whole correlated object and passes structural fit (required keys, basic types)", () => {
    const contactPointRule: HeuristicRule = {
      name: "test.contactPoint",
      match: (ctx) => Array.isArray((ctx.node.properties as Record<string, { enum?: unknown }> | undefined)?.system?.enum),
      when: { type: "object" },
      generate: ({ backend }) => ({
        system: backend.pick(["phone", "email"]),
        value: "555-0100",
        use: backend.pick(["home", "mobile"]),
      }),
    };
    const gen = createFaker({ heuristics: [contactPointRule] });
    const ContactPoint = z.object({
      system: z.enum(["phone", "email", "fax"]),
      value: z.string(),
      use: z.enum(["home", "mobile", "work"]),
    });
    const Schema = z.object({ telecom: z.array(ContactPoint).min(2).max(2) });
    const value = gen.fake(Schema, { seed: 1 });
    for (const cp of value.telecom) {
      expect(cp.value).toBe("555-0100");
      expect(["phone", "email"]).toContain(cp.system);
      expect(["home", "mobile"]).toContain(cp.use);
    }
  });

  it("declines (falls through to normal per-property generation) when required keys are missing", () => {
    const badRule: HeuristicRule = {
      name: "test.incompleteObject",
      match: () => true,
      when: { type: "object" },
      generate: () => ({ system: "phone" }), // missing required `value`
    };
    const gen = createFaker({ heuristics: [badRule] });
    const ContactPoint = z.object({ system: z.enum(["phone", "email"]), value: z.string() });
    const value = gen.fake(ContactPoint, { seed: 1 });
    // Fell through to plain per-property generation -- `value` is present and a string.
    expect(typeof value.value).toBe("string");
    expect(value.value).not.toBeUndefined();
  });

  it("declines when a property's value doesn't match its declared basic type", () => {
    const badRule: HeuristicRule = {
      name: "test.wrongType",
      match: () => true,
      when: { type: "object" },
      generate: () => ({ system: "phone", value: 12345 }), // value should be a string
    };
    const gen = createFaker({ heuristics: [badRule] });
    const ContactPoint = z.object({ system: z.enum(["phone", "email"]), value: z.string() });
    const value = gen.fake(ContactPoint, { seed: 1 });
    expect(typeof value.value).toBe("string");
  });

  it("a plain object heuristic can also just fall through (undefined) to normal generation", () => {
    const decliningRule: HeuristicRule = {
      name: "test.alwaysDecline",
      match: () => true,
      when: { type: "object" },
      generate: () => undefined,
    };
    const gen = createFaker({ heuristics: [decliningRule] });
    const Schema = z.object({ name: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(typeof value.name).toBe("string");
  });
});

describe("MatchContext: decline-fallthrough chains (multiple rules)", () => {
  it("falls through a chain of 3 declining rules to a final accepting rule", () => {
    const rules: HeuristicRule[] = [
      { name: "a", match: "name", generate: () => undefined },
      { name: "b", match: "name", generate: () => undefined },
      { name: "c", match: "name", generate: () => undefined },
      { name: "d", match: "name", generate: () => "Finally" },
    ];
    const gen = createFaker({ heuristics: rules });
    const Schema = z.object({ name: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.name).toBe("Finally");
  });

  it("falls all the way through to format tier when every rule declines on a formatted field", () => {
    const rules: HeuristicRule[] = [
      { name: "a", match: "email", when: { type: "string", formats: ["email"] }, generate: () => undefined },
      { name: "b", match: "email", when: { type: "string", formats: ["email"] }, generate: () => undefined },
    ];
    const gen = createFaker({ heuristics: rules });
    const Schema = z.object({ email: z.email() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.email).toContain("@");
  });
});

describe("MatchContext: priority ladder (override > heuristic > format > pattern > plain)", () => {
  it("overrides beat heuristics beat format", () => {
    const rule: HeuristicRule = {
      name: "test.email",
      match: "email",
      when: { type: "string", formats: ["email"] },
      generate: () => "from-heuristic@test.dev",
    };
    const gen = createFaker({
      heuristics: [rule],
      overrides: { email: () => "from-override@test.dev" },
    });
    const Schema = z.object({ email: z.email() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.email).toBe("from-override@test.dev");
  });

  it("heuristic beats format when overrides are absent", () => {
    const rule: HeuristicRule = {
      name: "test.email",
      match: "email",
      when: { type: "string", formats: ["email"] },
      generate: () => "from-heuristic@test.dev",
    };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ email: z.email() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.email).toBe("from-heuristic@test.dev");
  });

  it("format beats plain generation when heuristics are absent/decline", () => {
    const gen = createFaker({ heuristics: false });
    const Schema = z.object({ id: z.uuid() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("MatchContext: function-shorthand config receives full ctx", () => {
  it("the bare-function heuristics config gets ctx.key/path/parent like a full rule", () => {
    const gen = createFaker({
      heuristics: (ctx) => (ctx.key === "name" && ctx.parent !== undefined ? "Shorthand" : undefined),
    });
    const Schema = z.object({ name: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.name).toBe("Shorthand");
  });
});

describe("MatchContext: word-boundary negatives", () => {
  it.each(["username", "filename", "surname_field", "nameplate"])('bare-key rule "name" does not fire on "%s"', (key) => {
    const rule: HeuristicRule = { name: "test.name", match: "name", generate: () => "Matched" };
    const gen = createFaker({ heuristics: [rule] });
    const Schema = z.object({ [key]: z.string() });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value[key]).not.toBe("Matched");
  });
});

describe("MatchContext: determinism with heuristics on (ctx-object matchers)", () => {
  it("glob + function + container rules together still produce deep-equal output for the same seed", () => {
    const rules: HeuristicRule[] = [
      { name: "glob", match: "**.phone.value", when: { type: "string" }, generate: ({ backend }) => backend.pick(["A", "B", "C"]) },
      {
        name: "container",
        match: (ctx) => Array.isArray((ctx.node.properties as Record<string, { enum?: unknown }> | undefined)?.system?.enum),
        when: { type: "object" },
        generate: ({ backend }) => ({ system: backend.pick(["phone", "email"]), value: backend.pick(["X", "Y"]) }),
      },
    ];
    const gen = createFaker({ heuristics: rules });
    const Schema = z.object({
      phone: z
        .array(z.object({ value: z.string() }))
        .min(2)
        .max(2),
      telecom: z
        .array(z.object({ system: z.enum(["phone", "email"]), value: z.string() }))
        .min(2)
        .max(2),
    });
    const a = gen.fake(Schema, { seed: 99 });
    const b = gen.fake(Schema, { seed: 99 });
    expect(a).toEqual(b);
  });
});

describe("MatchContext: realism smoke on a representative schema", () => {
  it("a User-with-ContactPoints schema generates plausible values everywhere and validates", async () => {
    const contactPointRule: HeuristicRule = {
      name: "smoke.contactPoint",
      match: (ctx) => Array.isArray((ctx.node.properties as Record<string, { enum?: unknown }> | undefined)?.system?.enum),
      when: { type: "object" },
      generate: ({ backend }) => ({ system: backend.pick(["phone", "email"]), value: "smoke-value", use: "home" }),
    };
    const nameRule: HeuristicRule = {
      name: "smoke.name",
      match: "name",
      generate: ({ backend }) => backend.pick(["Alex", "Sam", "Jordan"]),
    };
    const gen = createFaker({ heuristics: [contactPointRule, nameRule] });

    const ContactPoint = z.object({ system: z.enum(["phone", "email"]), value: z.string(), use: z.enum(["home", "work"]) });
    const User = z.object({
      id: z.uuid(),
      name: z.string(),
      telecom: z.array(ContactPoint).min(1).max(3),
      age: z.int().min(0).max(120),
    });

    for (const seed of [1, 2, 3, 4, 5]) {
      const value = gen.fake(User, { seed });
      expect(["Alex", "Sam", "Jordan"]).toContain(value.name);
      for (const cp of value.telecom) expect(cp.value).toBe("smoke-value");
      const result = await User["~standard"].validate(value);
      expect(result.issues, `seed ${seed}: ${JSON.stringify(result.issues)}`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ctx.siblings — generated-VALUE-aware correlation (not just parent-schema-aware)
// ---------------------------------------------------------------------------
//
// `ctx.parent`/`ctx.ancestors` expose SCHEMA shape only -- enough to know `system` might be
// "phone" or "email", but not which one THIS instance actually got. `ctx.siblings` exposes the
// already-generated VALUES of earlier (declaration-order) properties of the immediate parent
// object, which is what a true FHIR ContactPoint correlation needs: `value`'s shape should
// match whatever `system` actually generated, not merely "one of its possible values."

function contactPointSchema() {
  return z.object({
    system: z.enum(["phone", "email", "url"]),
    value: z.string(),
    use: z.enum(["home", "work", "mobile"]).optional(),
  });
}

describe("ctx.siblings: generated-value-aware correlation", () => {
  const siblingAwareRule: HeuristicRule = {
    name: "test.contactPointValue (siblings)",
    match: (ctx) => ctx.key === "value" && typeof ctx.siblings.system === "string",
    when: { type: "string" },
    generate: ({ siblings }) => {
      switch (siblings.system) {
        case "phone":
          return "PHONE-555-0100";
        case "email":
          return "sibling@example.test";
        case "url":
          return "https://sibling.example.test";
        default:
          return undefined; // decline -- unrecognized `system` value
      }
    },
  };

  it("value is consistent with the ACTUAL generated system across many seeds", () => {
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    const ContactPoint = contactPointSchema();
    for (let seed = 0; seed < 40; seed++) {
      const value = gen.fake(ContactPoint, { seed });
      if (value.system === "phone") expect(value.value).toBe("PHONE-555-0100");
      if (value.system === "email") expect(value.value).toBe("sibling@example.test");
      if (value.system === "url") expect(value.value).toBe("https://sibling.example.test");
    }
  });

  it("determinism holds with a siblings-dependent rule", () => {
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    const ContactPoint = contactPointSchema();
    const a = gen.fake(ContactPoint, { seed: 7 });
    const b = gen.fake(ContactPoint, { seed: 7 });
    expect(a).toEqual(b);
  });

  it("declines cleanly (falls through to plain generation) when `system` is absent from siblings", () => {
    // A schema where `value` has no `system` sibling at all -- ctx.siblings.system is
    // undefined, so the rule's match predicate is false and it never even calls generate.
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    const Schema = z.object({ value: z.string().min(5).max(20) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.value).not.toBe("PHONE-555-0100");
    expect(value.value.length).toBeGreaterThanOrEqual(5);
    expect(value.value.length).toBeLessThanOrEqual(20);
  });

  it("declines cleanly when `system` is present but not a recognized value", () => {
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    // `system` here is a string but not one of phone/email/url -- generate() returns
    // undefined (decline), falling through to plain generation for `value`.
    const Schema = z.object({ system: z.literal("carrier-pigeon"), value: z.string().min(3).max(30) });
    const value = gen.fake(Schema, { seed: 1 });
    expect(value.value).not.toBe("PHONE-555-0100");
  });

  it("property ORDER GUARANTEE (two-tier): a schema declaring `value` BEFORE `system` still produces a consistent pair (enum/const properties are hoisted ahead of everything else)", () => {
    // The walker generates enum/const properties (tier 1 -- typically discriminators like
    // `system`) before all other properties (tier 2), regardless of declaration order in the
    // schema. So even though `value` is declared FIRST here, `system` (an enum) is generated
    // before it and is already present in `ctx.siblings` when the rule for `value` runs.
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    const ReorderedContactPoint = z.object({
      value: z.string().min(3).max(30),
      system: z.enum(["phone", "email", "url"]),
    });
    for (let seed = 0; seed < 15; seed++) {
      const value = gen.fake(ReorderedContactPoint, { seed });
      if (value.system === "phone") expect(value.value).toBe("PHONE-555-0100");
      if (value.system === "email") expect(value.value).toBe("sibling@example.test");
      if (value.system === "url") expect(value.value).toBe("https://sibling.example.test");
    }
  });

  it("determinism is unaffected by the two-tier reorder (same seed -> deep-equal, reordered schema)", () => {
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    const ReorderedContactPoint = z.object({
      value: z.string().min(3).max(30),
      system: z.enum(["phone", "email", "url"]),
    });
    const a = gen.fake(ReorderedContactPoint, { seed: 13 });
    const b = gen.fake(ReorderedContactPoint, { seed: 13 });
    expect(a).toEqual(b);
  });

  it("declines cleanly when `system` is genuinely absent (optional, omitted by the inclusion coin flip)", () => {
    // `system` is OPTIONAL here -- across enough seeds, some of them will omit it entirely
    // (the walker's ~50% optional-inclusion coin flip). When that happens, ctx.siblings.system
    // is simply undefined (never generated at all, not merely "not yet"), and the rule must
    // decline cleanly rather than throw or misbehave.
    const gen = createFaker({ heuristics: [siblingAwareRule] });
    const OptionalSystemContactPoint = z.object({
      system: z.enum(["phone", "email", "url"]).optional(),
      value: z.string().min(3).max(30),
    });
    let sawOmittedSystem = false;
    for (let seed = 0; seed < 60; seed++) {
      const value = gen.fake(OptionalSystemContactPoint, { seed });
      if (value.system === undefined) {
        sawOmittedSystem = true;
        expect(value.value).not.toBe("PHONE-555-0100");
        expect(value.value).not.toBe("sibling@example.test");
        expect(value.value).not.toBe("https://sibling.example.test");
      }
    }
    expect(sawOmittedSystem, "expected at least one seed to omit the optional `system` property").toBe(true);
  });

  it("siblings only reflects the IMMEDIATE parent, not a grandparent's properties", () => {
    let observedSiblingsAtNestedValue: Record<string, unknown> | undefined;
    const probeRule: HeuristicRule = {
      name: "test.probeSiblings",
      match: (ctx) => ctx.key === "value",
      when: { type: "string" },
      generate: ({ siblings }) => {
        observedSiblingsAtNestedValue = { ...siblings };
        return undefined; // decline -- just observing
      },
    };
    const gen = createFaker({ heuristics: [probeRule] });
    // `outer.system` is a grandparent-level sibling relative to `inner.value` -- must not leak in.
    const Schema = z.object({
      outerMarker: z.literal("outer-marker-value"),
      inner: z.object({ value: z.string() }),
    });
    gen.fake(Schema, { seed: 1 });
    expect(observedSiblingsAtNestedValue).toEqual({});
  });
});
