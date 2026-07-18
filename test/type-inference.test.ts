import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createFaker, fake, fakeMany } from "../src/index.js";

/**
 * Type-level tests for the headline feature added post-v0.1: `fake()`/`fakeMany()` return the
 * schema's OWN inferred type (`StandardSchemaV1.InferOutput<S>` / `InferInput<S>`), not
 * `unknown` — the entire point of building on Standard Schema's type surface (see
 * `Projected<S, P>` in types.ts). These assertions run at typecheck time only (`expectTypeOf`
 * from vitest, itself built on `expect-type`) — a regression here is a `tsc` failure, not a
 * runtime one.
 */

const ZodUser = z.object({
  id: z.uuid(),
  email: z.email(),
  age: z.int().min(18).max(99),
  tags: z.array(z.string()).max(3),
});

describe("type inference: fake()/fakeMany() (types only -- no runtime assertions)", () => {
  it("fake(zodUser) is inferred as the schema's own output type, not unknown", () => {
    const user = fake(ZodUser);
    expectTypeOf(user).not.toBeAny();
    expectTypeOf(user).not.toBeUnknown();
    expectTypeOf(user).toEqualTypeOf<z.infer<typeof ZodUser>>();
    expectTypeOf(user.id).toEqualTypeOf<string>();
    expectTypeOf(user.age).toEqualTypeOf<number>();
    expectTypeOf(user.tags).toEqualTypeOf<string[]>();
  });

  it("fakeMany(zodUser, n) is inferred as an array of the schema's output type", () => {
    const users = fakeMany(ZodUser, 10);
    expectTypeOf(users).toEqualTypeOf<Array<z.infer<typeof ZodUser>>>();
  });

  it("createFaker({}).fake(schema) defaults to the OUTPUT projection's inferred type", () => {
    const gen = createFaker({});
    const user = gen.fake(ZodUser);
    expectTypeOf(user).toEqualTypeOf<z.infer<typeof ZodUser>>();
  });

  it("createFaker({io: 'input'}).fake(schemaWithTransform) infers the INPUT type, not output", () => {
    // The clearest possible input != output case: a transform changes the TYPE itself, not
    // just optionality (string -> number). `io: 'input'` (a literal, not a widened `Projection`
    // union) is what lets `createFaker`'s own `P` type parameter infer as `'input'` — see
    // `FakerConfig<P>`/`SchemaFaker<P>` in types.ts.
    const StringToNumber = z
      .string()
      .transform((s) => Number(s))
      .pipe(z.number());

    const inputGen = createFaker({ io: "input" });
    const outputGen = createFaker({ io: "output" });

    const inputValue = inputGen.fake(StringToNumber);
    const outputValue = outputGen.fake(StringToNumber);

    expectTypeOf(inputValue).toEqualTypeOf<string>();
    expectTypeOf(outputValue).toEqualTypeOf<number>();
    // Sanity: these two inferred types are NOT the same type -- proof `io` actually changes
    // which projection's type comes back, not just which VALUE comes back at runtime.
    expectTypeOf(inputValue).not.toEqualTypeOf<number>();
  });

  it("createFaker() with no config defaults P to 'output' at the type level too", () => {
    const gen = createFaker();
    const user = gen.fake(ZodUser);
    expectTypeOf(user).toEqualTypeOf<z.infer<typeof ZodUser>>();
  });

  it("fakeMany on a configured instance is also inferred (not just the top-level sugar)", () => {
    const gen = createFaker({ io: "output" });
    const users = gen.fakeMany(ZodUser, 5);
    expectTypeOf(users).toEqualTypeOf<Array<z.infer<typeof ZodUser>>>();
  });
});
