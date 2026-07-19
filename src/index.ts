import { defaultBackend } from "./default-backend.js";
import { StrictModeError } from "./errors.js";
import { compileFinalizers } from "./finalize.js";
import { compileHeuristics } from "./heuristics.js";
import { compileOverrides } from "./overrides.js";
import { randomSeed } from "./rng.js";
import { DEFAULT_STRICT_RETRIES, strictRetrySeed, validateStrict } from "./strict.js";
import { toJsonSchemaSync } from "./to-json-schema.js";

export { prepare, toJsonSchemaSync } from "./to-json-schema.js";

import type { AnySchema, FakeOptions, FakerConfig, JSONSchema, MatchContext, Projected, Projection, SchemaFaker } from "./types.js";
import type { WalkContext } from "./walker.js";
import { generateFromSchema } from "./walker.js";

export { defaultBackend } from "./default-backend.js";
export {
  AsyncValidateError,
  JsonSchemaConversionError,
  SchemaFakerError,
  StrictModeError,
  UniqueItemsError,
  UnresolvableRefError,
} from "./errors.js";
export type { CompiledFinalizers } from "./finalize.js";
export { compileFinalizers } from "./finalize.js";
export type { CompiledHeuristics } from "./heuristics.js";
export { ancestorKeys, compileHeuristics, normalizeKey } from "./heuristics.js";
export { generateFromPattern, matchesPattern, parsePattern, UnsupportedPatternError } from "./pattern.js";
export { deriveSeed, mulberry32, normalizeSeed, randomSeed } from "./rng.js";
export type {
  AnySchema,
  BackendInstance,
  FakeOptions,
  FakerConfig,
  Finalizer,
  Finalizers,
  FormatGenerator,
  GeneratorBackend,
  HeuristicFn,
  HeuristicMatcher,
  HeuristicRule,
  JSONSchema,
  MatchContext,
  OverrideMatcher,
  Overrides,
  Projected,
  Projection,
  // Re-exported for consumers who prefer the more descriptive name over the bare
  // `SchemaFaker` import; identical type.
  SchemaFaker as Faker,
  SchemaFaker,
  StringHint,
} from "./types.js";

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_OPTIONAL_PROBABILITY = 0.5;
const DEFAULT_DEFAULT_PROBABILITY = 0.5;
const DEFAULT_EXAMPLES_PROBABILITY = 0.5;

/** Resolves `FakerConfig.optionalProbability` into the `(ctx: MatchContext) => number` function `WalkContext.optionalProbability` always expects — a bare `number` becomes a constant function, `undefined` defaults to the existing 50/50 rate. */
function resolveOptionalProbability(config: FakerConfig["optionalProbability"]): (ctx: MatchContext) => number {
  if (config === undefined) return () => DEFAULT_OPTIONAL_PROBABILITY;
  if (typeof config === "function") return config;
  const constant = config;
  return () => constant;
}

/**
 * Creates a configured faker instance — this is the advanced entry point; `fake`/`fakeMany`
 * below are sugar over `createFaker({}).fake` / `.fakeMany` for the common case.
 *
 * Generic over `P` (the `io` projection), inferred from `config.io`'s literal type — e.g.
 * `createFaker({io: 'input'})` infers `P = 'input'`, so the returned `SchemaFaker<'input'>`'s
 * `fake()`/`fakeMany()` are typed to return each schema's INFERRED INPUT type
 * (`StandardSchemaV1.InferInput<S>`), not `unknown`. This is the headline reason `FakerConfig`
 * itself is generic — see `Projected<S, P>` in types.ts.
 */
export function createFaker<P extends Projection = "output">(config: FakerConfig<P> = {}): SchemaFaker<P> {
  const backend = config.backend ?? defaultBackend;
  const projection = (config.io ?? "output") as P;
  const maxDepth = config.maxDepth ?? DEFAULT_MAX_DEPTH;
  const strict = config.strict ?? false;
  const overrides = compileOverrides(config.overrides);
  const heuristics = compileHeuristics(config.heuristics);
  const finalize = compileFinalizers(config.finalize);
  const optionalProbability = resolveOptionalProbability(config.optionalProbability);
  const referenceDate = config.referenceDate;
  const backendOptions = referenceDate ? { referenceDate } : undefined;
  const formats = config.formats;
  const defaultProbability = config.defaultProbability ?? DEFAULT_DEFAULT_PROBABILITY;
  const examplesProbability = config.examplesProbability ?? DEFAULT_EXAMPLES_PROBABILITY;

  /** One `WalkContext` shape shared by every entry point below — was duplicated inline at two call sites (`generateOnce` and `fakeMany`'s non-strict loop) before `finalize`/`optionalProbability` added two more fields to keep in sync; centralized to one place instead of a third copy. */
  function buildWalkContext(rootSchema: JSONSchema, backendInstance: ReturnType<typeof backend.create>): WalkContext {
    return {
      backend: backendInstance,
      root: rootSchema,
      maxDepth,
      projection,
      overrides,
      heuristics,
      finalize,
      optionalProbability,
      formats,
      defaultProbability,
      examplesProbability,
    };
  }

  function generateOnce<T>(rootSchema: JSONSchema, seed: number): T {
    const backendInstance = backend.create(seed, backendOptions);
    const value = generateFromSchema(rootSchema, buildWalkContext(rootSchema, backendInstance), "", 0);
    return value as T;
  }

  /**
   * `strict: true` correctness strategy: generate, then run the schema's own
   * `~standard.validate()`. On failure, retry generation up to `DEFAULT_STRICT_RETRIES` times
   * with a seed deterministically re-derived from `baseSeed` (`strictRetrySeed`), so the whole
   * retry sequence is reproducible. After exhausting retries, throw `StrictModeError` (carrying
   * `issues`/`attempts`/`seed` as real fields, not just baked into the message — see errors.ts)
   * with the last issue list. See strict.ts for the async-validate design decision (a schema
   * whose validate() resolves asynchronously throws `AsyncValidateError` immediately — strict
   * mode requires synchronous validation).
   */
  function generateStrict<T>(schema: AnySchema, rootSchema: JSONSchema, baseSeed: number): T {
    let lastIssues: readonly unknown[] = [];
    let attempts = 0;
    for (let attempt = 0; attempt <= DEFAULT_STRICT_RETRIES; attempt++) {
      const seed = attempt === 0 ? baseSeed : strictRetrySeed(baseSeed, attempt);
      const value = generateOnce<T>(rootSchema, seed);
      attempts += 1;
      const result = validateStrict(schema, value);
      if (result.ok) return value;
      lastIssues = result.issues;
    }
    throw new StrictModeError(
      `standard-schema-faker: strict mode failed after ${attempts} attempts (seed ${baseSeed}). ` +
        `The generated value never passed the schema's own validate() — likely a refinement/ ` +
        `transform/cross-field check invisible to JSON Schema. Last issues: ${JSON.stringify(lastIssues)}`,
      { issues: lastIssues, attempts, seed: baseSeed },
    );
  }

  function fake<S extends AnySchema>(schema: S, opts: FakeOptions = {}): Projected<S, P> {
    const seed = opts.seed ?? randomSeed();
    const rootSchema = toJsonSchemaSync(schema, projection);
    if (strict) return generateStrict<Projected<S, P>>(schema, rootSchema, seed);
    return generateOnce<Projected<S, P>>(rootSchema, seed);
  }

  function fakeMany<S extends AnySchema>(schema: S, n: number, opts: FakeOptions = {}): Array<Projected<S, P>> {
    if (n < 0) throw new Error("standard-schema-faker: fakeMany() requires n >= 0");
    const seed = opts.seed ?? randomSeed();
    const rootSchema = toJsonSchemaSync(schema, projection);

    if (strict) {
      // Each item gets its own deterministic sub-seed (derived from the batch seed + index),
      // so the whole batch stays reproducible from one `seed` while each item's strict retry
      // sequence (if needed) doesn't collide with another item's.
      const results: Array<Projected<S, P>> = [];
      for (let i = 0; i < n; i++) {
        results.push(generateStrict<Projected<S, P>>(schema, rootSchema, strictRetrySeed(seed, `item-${i}`)));
      }
      return results;
    }

    // One seeded stream for the whole batch — a single backend instance is reused across all
    // n items, so items differ from each other while the whole sequence is reproducible from
    // `seed`.
    const backendInstance = backend.create(seed, backendOptions);
    const walkContext = buildWalkContext(rootSchema, backendInstance);
    const results: Array<Projected<S, P>> = [];
    for (let i = 0; i < n; i++) {
      const value = generateFromSchema(rootSchema, walkContext, "", 0);
      results.push(value as Projected<S, P>);
    }
    return results;
  }

  return { fake, fakeMany };
}

const defaultFaker = createFaker();

/** Generate one fake value conforming to `schema` — typed as `schema`'s inferred OUTPUT type (`StandardSchemaV1.InferOutput<S>`). */
export function fake<S extends AnySchema>(schema: S, opts?: FakeOptions): Projected<S, "output"> {
  return defaultFaker.fake(schema, opts);
}

/** Generate `n` fake values conforming to `schema` from one seeded, deterministic stream — each typed as `schema`'s inferred OUTPUT type. */
export function fakeMany<S extends AnySchema>(schema: S, n: number, opts?: FakeOptions): Array<Projected<S, "output">> {
  return defaultFaker.fakeMany(schema, n, opts);
}

// Re-exported for advanced consumers who want to walk a JSON Schema document directly
// (e.g. one already produced by a vendor's converter) without going through a Standard Schema.
export { generateFromSchema } from "./walker.js";
