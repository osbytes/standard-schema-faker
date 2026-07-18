import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFaker } from "../src/index.js";

/**
 * `io: 'input' | 'output'` projection: which JSON Schema surface (pre- or
 * post-validation) the walker generates from. Wired through `toJsonSchemaSync(schema,
 * projection)` -> native `~standard.jsonSchema.{input,output}()` when available, else the
 * `@standard-community/standard-json` fallback (passing its vendor-specific `typeMode` option
 * for Valibot; Effect's fallback shim ignores projection entirely and throws for
 * `io: 'input'` — see to-json-schema.ts).
 */
describe("input/output projection", () => {
  it("a z.pipe(string -> transform -> number) generates a string for 'input', a number for 'output'", () => {
    // The clearest possible input != output case: the TYPE itself differs, not just
    // optionality. Verified at runtime: zod v4's native jsonSchema.input()
    // reports {type: "string"}, .output() reports {type: "number"}.
    const StringToNumber = z
      .string()
      .transform((s) => Number(s))
      .pipe(z.number());

    const inputGen = createFaker({ io: "input" });
    const outputGen = createFaker({ io: "output" });

    const inputValue = inputGen.fake(StringToNumber, { seed: 1 });
    const outputValue = outputGen.fake(StringToNumber, { seed: 1 });

    expect(typeof inputValue).toBe("string");
    expect(typeof outputValue).toBe("number");
  });

  it("a schema with .default() generates without the defaulted field for 'input', always with it for 'output'", () => {
    // input: `tag` is optional (may be omitted). output: `tag` is always present (defaults
    // apply post-validation). Exercises the walker's existing required-vs-optional handling
    // driven purely by which projection's `required` array is used.
    const WithDefault = z.object({
      name: z.string(),
      tag: z.string().default("untagged"),
    });

    const outputGen = createFaker({ io: "output" });
    for (let seed = 0; seed < 20; seed++) {
      const value = outputGen.fake(WithDefault, { seed });
      expect(typeof value.tag).toBe("string");
      expect(value.tag).toBeTruthy();
    }

    // For 'input', `tag` is optional — across many seeds we should see it both included and
    // omitted (the walker's normal optional-inclusion coin flip applies to it there).
    const inputGen = createFaker({ io: "input" });
    let sawOmitted = false;
    let sawIncluded = false;
    for (let seed = 0; seed < 20; seed++) {
      const value = inputGen.fake(WithDefault, { seed });
      if ("tag" in value) sawIncluded = true;
      else sawOmitted = true;
    }
    expect(sawIncluded).toBe(true);
    expect(sawOmitted).toBe(true);
  });

  it("defaults to 'output' when `use` is not specified", () => {
    const WithDefault = z.object({ tag: z.string().default("untagged") });
    const defaultGen = createFaker({});
    const outputGen = createFaker({ io: "output" });

    for (const seed of [1, 2, 3, 4, 5]) {
      const a = defaultGen.fake(WithDefault, { seed });
      const b = outputGen.fake(WithDefault, { seed });
      expect(a).toEqual(b);
    }
  });

  it("throws a clear error for io: 'input' on a vendor whose fallback conversion can't project it (Effect Schema)", async () => {
    const { Schema } = await import("effect");
    const EffectStruct = Schema.standardSchemaV1(Schema.Struct({ id: Schema.String }));

    const inputGen = createFaker({ io: "input" });
    expect(() => inputGen.fake(EffectStruct)).toThrow(/io: 'input' is not supported for vendor "effect"/);
  });

  it("'output' still works normally for Effect Schema (only 'input' is blocked)", async () => {
    const { Schema } = await import("effect");
    const { prepare } = await import("../src/index.js");
    const EffectStruct = Schema.standardSchemaV1(Schema.Struct({ id: Schema.String }));
    await prepare(EffectStruct);

    const outputGen = createFaker({ io: "output" });
    const value = outputGen.fake(EffectStruct, { seed: 1 });
    expect(typeof value.id).toBe("string");
  });
});
