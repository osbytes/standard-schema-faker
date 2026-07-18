import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonSchemaConversionError } from "../src/errors.js";
import { fake } from "../src/index.js";

/**
 * `z.map()`/`z.set()`: neither has a JSON Schema equivalent (JSON itself has
 * no map/set primitive, only objects/arrays) — verified at runtime that Zod v4's own native
 * `~standard.jsonSchema` surface throws a plain `Error("Map cannot be represented in JSON
 * Schema")` / `Error("Set cannot be represented in JSON Schema")` synchronously. This library
 * rewraps that throw into a `JsonSchemaConversionError` (same typed-error convention as every
 * other "couldn't get a JSON Schema for this schema" failure) rather than letting the vendor's
 * bare `Error` propagate unwrapped — preserving the vendor's own message inside it.
 */
describe("unsupported constructs: z.map() / z.set() surface a clear, typed error", () => {
  it("z.map() throws JsonSchemaConversionError (not the vendor's bare Error) naming the vendor and the underlying reason", () => {
    const schema = z.map(z.string(), z.number());
    let threw: unknown;
    try {
      fake(schema, { seed: 1 });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(JsonSchemaConversionError);
    const error = threw as JsonSchemaConversionError;
    expect(error.vendor).toBe("zod");
    expect(error.message).toContain("zod");
    expect(error.message.toLowerCase()).toContain("map");
  });

  it("z.set() throws JsonSchemaConversionError naming the vendor and the underlying reason", () => {
    const schema = z.set(z.string());
    let threw: unknown;
    try {
      fake(schema, { seed: 1 });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(JsonSchemaConversionError);
    const error = threw as JsonSchemaConversionError;
    expect(error.vendor).toBe("zod");
    expect(error.message.toLowerCase()).toContain("set");
  });

  it("the error message suggests a workaround (array/record modeling, or overrides)", () => {
    const schema = z.map(z.string(), z.number());
    try {
      fake(schema, { seed: 1 });
      expect.fail("expected fake() to throw for z.map()");
    } catch (e) {
      const message = (e as Error).message.toLowerCase();
      expect(message).toMatch(/array|record|overrides/);
    }
  });
});
