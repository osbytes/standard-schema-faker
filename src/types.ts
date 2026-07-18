import type { StandardSchemaV1 } from "@standard-schema/spec";

/** A JSON Schema document (draft-2020-12 / draft-07), represented loosely. */
export type JSONSchema = Record<string, unknown>;

/**
 * Hint passed to `BackendInstance.string()` describing the shape of string wanted.
 */
export interface StringHint {
  format?: string | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  pattern?: string | undefined;
}

/**
 * A fresh, seed-derived source of randomness + value factories.
 * One instance per `fake()`/`fakeMany()` call — never mutated/shared across calls,
 * so two generators can never perturb each other's streams.
 */
export interface BackendInstance {
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  bool(): boolean;
  pick<T>(items: readonly T[]): T;
  string(hint: StringHint): string;
  date(min?: Date, max?: Date): Date;
}

/**
 * A pluggable generator backend factory. Core ships `defaultBackend`
 * (zero-dependency, plausible-but-dumb strings). `standard-schema-faker/faker`
 * provides a realistic alternative backed by `@faker-js/faker`.
 */
export interface GeneratorBackend {
  /**
   * `options.referenceDate` (optional second param — additive, no existing call site breaks):
   * the fixed point in time every relative-date generation this instance produces should be
   * anchored to, instead of each backend's own hardcoded stability anchor (`defaultBackend`'s
   * `DEFAULT_REFERENCE_DATE`, `fakerBackend`'s `REFERENCE_DATE` — both `2025-01-01T00:00:00.000Z`
   * by default, kept in sync via a cross-reference comment in both files). Threaded from
   * `FakerConfig.referenceDate` through `createFaker` into every `.create(seed, options)` call
   * (`fake`/`fakeMany`/strict-retry paths alike). Passing `new Date()` is a deliberate opt-in to
   * now-ish data at the cost of cross-run stability — see README's "Design notes" section.
   */
  create(seed: number, options?: { referenceDate?: Date }): BackendInstance;
}

/** Which JSON Schema projection to walk: pre-validation "input" or post-validation "output". */
export type Projection = "input" | "output";

/**
 * The full context a heuristic rule's matcher/generator sees for the node currently being
 * visited. Deliberately a single extensible object (rather than positional arguments) so new
 * fields can be added later without another breaking signature change.
 *
 * Path/key fields, worked example for `{ phone: [{ value: '555-0100', type: 'mobile' }] }`
 * while visiting `phone[0].value`:
 *
 *   - `rawKey` / `key`: `"value"` / `"value"` (already normalized — no separators to strip).
 *   - `path`: `"phone.0.value"` — the raw dot-path, array indices included as plain numeric
 *     segments (matches how `overrides` builds paths).
 *   - `semanticPath`: `"phone.value"` — `path` with array-index segments stripped and each
 *     remaining segment normalized (same folding as `key`/`normalizeKey`: lowercased,
 *     `_`/`-`/word-boundary separators stripped — so `first_name.0` -> `"firstname"`,
 *     `contacts.0.PhoneNumber` -> `"contacts.phonenumber"`). This is what glob/RegExp
 *     matchers are tested against, so a rule doesn't need to know how many array levels
 *     deep it is, or worry about the exact casing/separator style a schema author used.
 *   - `segments`: `["phone", "0", "value"]` — `path` split on `.`.
 *   - `ancestors`: `[{ key: "0", node: <phone item schema> }, { key: "phone", node: <phone
 *     array schema> }]` — ordered LEAF TOWARD ROOT, one frame per raw path segment above the
 *     current node (an array-index step's `key` is that numeric segment, e.g. `"0"` — it is
 *     NOT skipped/collapsed away, so `ancestors[0]` is always "my immediate container" whether
 *     that's an array slot or an object property; walk further for the array's own name).
 *   - `node`: the JSON Schema node for `value` itself (`{ type: 'string' }`).
 *   - `parent`: the JSON Schema node for the immediately containing object (the `phone` item
 *     schema, `{ type: 'object', properties: { value, type } }`) — `undefined` at the root.
 *   - `root`: the whole document, for rules that need to resolve `$ref`s themselves.
 *   - `siblings`: the VALUES already generated for earlier properties of the immediate parent
 *     object (e.g. `{ type: "mobile" }` if `type` was declared before `value` and already
 *     generated). See `siblings`'s own doc comment for the ordering guarantee this depends on
 *     and why schema-level parent inspection (via `parent`/`ancestors`) can't substitute for
 *     it — some correlations (FHIR `ContactPoint`'s `system` deciding `value`'s shape) are only
 *     resolved by the actual generated value, not the schema.
 */
export interface MatchContext {
  /** Normalized leaf key: `first_name` / `firstName` / `FIRST-NAME` -> `"firstname"`. `""` at the root or on an array-index node. */
  key: string;
  /** The leaf key exactly as authored in the schema (no normalization). `""` at the root or on an array-index node. */
  rawKey: string;
  /** Raw dot-path; numeric array-index segments included (e.g. `"phone.0.value"`). `""` at the root. */
  path: string;
  /** `path` with array-index segments stripped and each segment normalized (see `normalizeKey`) — e.g. `"phone.value"` — what glob/RegExp matchers are tested against. */
  semanticPath: string;
  /** `path` split on `.` (`[]` at the root). */
  segments: string[];
  /** The JSON Schema node being generated. */
  node: JSONSchema;
  /** The immediately containing JSON Schema node (object or array). `undefined` at the root. */
  parent?: JSONSchema | undefined;
  /** Ancestor chain, ordered leaf -> root: one frame per path segment above `node`. See the worked example above for the array-index-step convention. */
  ancestors: Array<{ key: string; node: JSONSchema }>;
  /**
   * The VALUES already generated for earlier properties of the immediate parent object —
   * distinct from `parent`, which only exposes the parent's *schema*. This is what makes a
   * rule like "FHIR `ContactPoint`'s `value` should be shaped by whatever `system` actually
   * generated (not just `system`'s possible enum values)" resolvable: schema-level inspection
   * (`ctx.parent?.properties?.system?.enum`) can tell you `system` might be `"phone"` or
   * `"email"`, but only `ctx.siblings.system` tells you which one THIS instance actually got.
   *
   * ORDERING GUARANTEE (rule authors may rely on this): the walker generates an object's
   * properties in schema declaration order (`Object.keys` of the JSON Schema's `properties`),
   * building `siblings` incrementally as each one completes — so a property's rule sees every
   * property declared BEFORE it in the schema, and none declared after (not yet generated,
   * so simply absent from `siblings`). FHIR's own `ContactPoint` declares `system` before
   * `value`, so `defaultHeuristics`' ContactPoint rule (which reads `ctx.siblings.system`) only
   * works when a schema follows that same declaration order — see README's "Realistic fields
   * (heuristics)" section. A rule depending on a sibling that turns out to be absent/`undefined`
   * (not yet generated, or genuinely optional-and-omitted) should decline (return `undefined`
   * from `generate`, or `false` from a `match` predicate) rather than guess — ordinary
   * decline-fallthrough semantics apply.
   *
   * `{}` (empty) at the root and for the first property of any object (nothing generated yet).
   * Only reflects the IMMEDIATE parent's siblings — not an ancestor further up the chain (use
   * `ancestors`/`parent` for schema-level access to those, or nest a container-node rule if you
   * need cross-level value correlation).
   */
  siblings: Record<string, unknown>;
  /** The whole JSON Schema document (for resolving `$ref`s or inspecting global structure). */
  root: JSONSchema;
}

/**
 * An override matcher: a predicate function receiving the SAME `MatchContext` (plus the call's
 * seeded `backend`) as a `HeuristicRule.generate` — the same ctx-object design the heuristics
 * engine uses, applied here too (positional `(path, node)` args were replaced with the shared
 * `MatchContext` for exactly the reasons documented on `MatchContext`/`HeuristicMatcher`: one
 * extensible object instead of positional arguments that can't grow without another breaking
 * change, and access to `ancestors`/`parent`/`siblings` for correlated overrides, not just the
 * bare path/node).
 *
 * Returning `undefined` means DECLINE: this predicate has nothing to offer for this particular
 * node — the engine falls through to the next-most-specific matching `Overrides` Record key (if
 * any), then to normal generation (heuristics/format/pattern/plain). Same decline semantics as
 * `HeuristicRule.generate` throughout this library — never a special case.
 */
export type OverrideMatcher = (ctx: MatchContext & { backend: BackendInstance }) => unknown | undefined;

/**
 * Dot-path (`*`/`**` globs) overrides for business rules and correlated fields — either:
 *
 *   - A `Record<string, OverrideMatcher>` keyed by dot-path glob. Each thunk receives the same
 *     `MatchContext & { backend }` a `HeuristicRule.generate` does. Returning `undefined` DECLINES
 *     — the engine tries the next-most-specific matching key (see overrides.ts's specificity
 *     ranking), then falls through to normal generation if every matching key declines.
 *   - A single `OverrideMatcher` predicate function, checked directly (no Record indirection).
 */
export type Overrides = Record<string, OverrideMatcher> | OverrideMatcher;

/**
 * A `finalize` hook: receives a node's ALREADY-GENERATED value (post-order — for a container
 * node, its children have already been finalized by the time the container's own hook runs)
 * plus the same `MatchContext & { backend }` an override/heuristic sees, and returns the
 * (possibly amended) value. This is the "ensure X exists in the generated value" tool — e.g. a
 * FHIR `Patient` resource that must always carry an MRN-system `identifier` entry, or a
 * `Practitioner` that must always carry an NPI — semantics neither `overrides` (full
 * pre-generation replacement) nor `heuristics` (decline-based value SELECTION) express on
 * their own. This is the factory-library "afterBuild" pattern (Fishery/factory_bot precedent),
 * applied to a JSON-Schema-driven generator.
 *
 * Unlike `OverrideMatcher`/`HeuristicRule.generate`, the return value is used VERBATIM — no
 * constraint guard, no structural fit-check. This is a deliberate, explicit user escape hatch
 * at the SAME trust level as `overrides`: if you amend a value into something that no longer
 * matches the node's own schema, that's on you (though `strict: true` still validates the
 * FINAL, finalized result as usual — see `FakerConfig.finalize`'s doc comment — so a real
 * mismatch surfaces there, just AFTER finalize has already run, not as an in-place guard).
 */
export type Finalizer = (value: unknown, ctx: MatchContext & { backend: BackendInstance }) => unknown;

/**
 * Dot-path (`*`/`**` globs) finalize hooks — either:
 *
 *   - A `Record<string, Finalizer>` keyed by dot-path glob, using the EXACT SAME compiled
 *     matcher engine `overrides` uses (see `finalize.ts`, which reuses `overrides.ts`'s
 *     specificity ranking directly rather than building a second implementation). Unlike
 *     `Overrides`, there is no decline-and-fall-through-to-the-next-candidate chain: when
 *     multiple glob keys match the same path, only the SINGLE MOST SPECIFIC one runs (same
 *     specificity ranking as overrides — exact literal beats any glob, fewer wildcards beats
 *     more, `*` beats `**` at the same count, first-declared-key order as the final tie-break).
 *     There's no ambiguity to resolve here the way `undefined` is ambiguous for `overrides`
 *     (decline vs. "set it to `undefined`") — a finalizer's return value is ALWAYS applied
 *     verbatim, so "most specific wins outright" is the whole rule.
 *   - A single `Finalizer` function, checked directly (no Record indirection) — the "function
 *     shorthand," a catch-all applied to every node (mirrors `HeuristicFn`'s catch-all sugar).
 */
export type Finalizers = Record<string, Finalizer> | Finalizer;

/**
 * What counts as a match for a `HeuristicRule`, in increasing order of power. All forms
 * compile to the SAME predicate shape internally (`(ctx: MatchContext) => boolean`) — see
 * `heuristics.ts`'s `compileMatcher` — so there is exactly one evaluation path regardless of
 * which sugar form a rule author reaches for:
 *
 *   - A bare string with no `.`/`*` (e.g. `"firstName"`): matches when the NORMALIZED leaf key
 *     equals the (also-normalized) string — `first_name`/`firstName`/`FIRST-NAME` all match
 *     `"firstName"`.
 *   - A string containing `.` or `*` (e.g. `"**.phone.value"`, `"contacts.*.email"`): a
 *     dot-path glob evaluated against `ctx.semanticPath`, using the exact same glob engine
 *     `overrides` uses (`*` = one segment, `**` = zero or more segments) — reused, not
 *     reimplemented.
 *   - A `RegExp`: tested against `ctx.semanticPath`. Anchor it yourself for a path suffix match
 *     (e.g. `/(^|\.)phone\.value$/`) — an unanchored pattern can match more broadly than
 *     intended, the same word-boundary discipline bare-key rules need (see `normalizeKey`).
 *   - A function `(ctx: MatchContext) => boolean`: full power — inspect the parent schema
 *     (`ctx.parent`), ancestors, the node's own `format`/`enum`/etc., or ALREADY-GENERATED
 *     sibling values (`ctx.siblings`, ordering-guaranteed — see its doc comment). This is what
 *     makes a rule like "FHIR ContactPoint's `value`, shaped by whatever `system` actually
 *     generated" possible: `ctx.key === 'value' && typeof ctx.siblings.system === 'string'`.
 *     Function matchers are the PRIMARY form for this kind of context-dependent semantics —
 *     reach for a bare-key/glob/RegExp for simple cases, but don't contort one to express a
 *     correlation it can't actually see (schema-shape globs/RegExp can inspect `semanticPath`
 *     only; they have no access to `parent`/`siblings`).
 */
export type HeuristicMatcher = string | RegExp | ((ctx: MatchContext) => boolean);

/**
 * A single heuristic field-matching rule: "if a node's property name/path/shape looks like X,
 * generate a realistic X instead of a structurally-valid-but-meaningless value."
 *
 * Heuristics are an **inspectable, fully overridable ruleset**, not silent property-name/
 * description sniffing: `name` is addressable so a rule can be filtered out of the array by
 * anyone; nothing about matching is hidden inside opaque logic. See README's "Realistic fields
 * (heuristics)" section.
 */
export interface HeuristicRule {
  /** A stable, addressable name (e.g. `"person.firstName"`) — used to remove/replace a rule from a ruleset array (`rules.filter(r => r.name !== '...')`). */
  name: string;
  /** What counts as a match — see `HeuristicMatcher` for the four forms and how they compile to one evaluation path. */
  match: HeuristicMatcher;
  /** Extra compatibility gate checked before `match` is even tried — cheap to check, keeps a rule from firing on the wrong node kind. */
  when?:
    | {
        /**
         * `'object'` (or `'array'`) opts into CONTAINER-node matching: the rule is checked at
         * the object/array node itself (before its properties/items are generated), and
         * `generate` may return a whole correlated value (e.g. `{system: 'phone', value:
         * '...', use: 'mobile'}` for a FHIR `ContactPoint`). The engine then checks structural
         * fit (required keys present, each property's basic type matches) and declines
         * (falls through, same as any other decline) on a mismatch — see `withinStructuralFit`
         * in heuristics.ts. Omitting `type` (or using `'string'`/`'number'`/`'integer'`) keeps
         * the rule leaf-only, as before.
         */
        type?: "string" | "number" | "integer" | "object" | "array" | undefined;
        /** If set, the node's own `format` (if any) must be one of these — or the node must have no `format` at all when this is omitted. Not applicable to `type: 'object'`/`'array'` rules (neither has a `format` keyword). */
        formats?: readonly string[] | undefined;
      }
    | undefined;
  /**
   * Produces the value. Must draw all randomness from `ctx.backend` (the call's seeded
   * instance) — never from an unseeded source — so heuristic output stays deterministic per
   * seed.
   *
   * Returning `undefined` means DECLINE: this rule matched but has nothing to offer for this
   * particular node (e.g. it looked more closely and decided it doesn't apply) — the engine
   * falls through to the next matching rule in the ruleset, then on to `format` > `pattern` >
   * plain generation if no rule accepts. The same "fall through" behavior also happens when a
   * rule's generated value fails the constraint guard (leaf: violates the node's own
   * minLength/maxLength/minimum/maximum) or structural fit-check (container: missing a
   * required key, or a property's value doesn't match that property's declared type) — either
   * is treated exactly like a decline, never truncated, coerced, or partially applied.
   */
  generate: (ctx: MatchContext & { backend: BackendInstance }) => unknown | undefined;
}

/**
 * Function shorthand for `FakerConfig.heuristics`: sugar for a single catch-all rule
 * (`{ name: 'custom', match: () => true, generate: fn }`) — same decline semantics as
 * `HeuristicRule.generate` (return `undefined` to fall through to the next tier). Receives the
 * same `MatchContext & { backend }` as a full rule's `generate`.
 */
export type HeuristicFn = (ctx: MatchContext & { backend: BackendInstance }) => unknown | undefined;

/**
 * A custom `format` generator — see `FakerConfig.formats`. Receives the same `MatchContext &
 * {backend}` a heuristic rule/override does (leaf string node, so `ctx.node.format` is the
 * format name that matched); must return a `string` and draw all randomness from `ctx.backend`
 * for determinism, same discipline as everything else in this library.
 */
export type FormatGenerator = (ctx: MatchContext & { backend: BackendInstance }) => string;

/**
 * `FakerConfig` is generic over the projection `P` (default `"output"`) SOLELY so
 * `createFaker({io: 'input'})` can infer `P = 'input'` from the literal config object passed
 * in — see `SchemaFaker<P>`/`Projected<S, P>` below, and `createFaker`'s overloads in
 * index.ts. The generic parameter has no runtime effect of its own; `io` is the one real
 * config field it types.
 */
export interface FakerConfig<P extends Projection = "output"> {
  /** Pluggable generator backend. Defaults to the zero-dependency `defaultBackend`. */
  backend?: GeneratorBackend | undefined;
  /**
   * Which JSON Schema projection to generate from: pre-validation `"input"` (what a client
   * would send) or post-validation `"output"` (defaults applied, transforms' result type).
   * Defaults to `"output"`. Named to match Zod v4's own `z.toJSONSchema(schema, { io })` option
   * — the existing ecosystem convention for exactly this concept — rather than an invented name.
   */
  io?: P | undefined;
  /**
   * Validate each generated value against the schema's own `~standard.validate`, retrying
   * deterministically (up to 5 attempts, re-seeded from the original seed) on failure. Throws
   * `StrictModeError` if every retry still fails, or `AsyncValidateError` immediately if the
   * schema's `validate()` resolves asynchronously (strict mode requires synchronous
   * validation — see strict.ts). See errors.ts for both classes.
   */
  strict?: boolean | undefined;
  /**
   * Dot-path (with `*` / `**` globs) or predicate-based overrides for business rules /
   * correlated fields — the highest-priority tier (beats heuristics, `format`, `pattern`, and
   * plain generation). See `Overrides`/`OverrideMatcher` for the ctx-object matcher shape.
   */
  overrides?: Overrides | undefined;
  /**
   * Heuristic field-matching rules: an ordered array (first match wins — put more specific
   * rules before more generic ones), a single function (sugar for one catch-all rule — see
   * `HeuristicFn`), or `false` to disable entirely. Core ships ZERO rules and defaults to
   * `false` — the root entry stays fully spec-driven with no guessing. The `standard-schema-faker/faker`
   * subpath turns this on by default with its own `defaultHeuristics` ruleset. Priority ladder (highest first): `overrides` > heuristics > `format` > `pattern`
   * > plain generation. A rule (or the function form) returning `undefined` declines — falls
   * through to the next rule, then the next tier.
   */
  heuristics?: readonly HeuristicRule[] | HeuristicFn | false | undefined;
  /**
   * Controls the inclusion probability for OPTIONAL (non-`required`) object properties.
   * Defaults to `0.5` (the existing 50/50 coin flip). A plain `number` (0..1; `1` = always
   * include, `0` = never) applies globally to every optional property in the call. A function
   * `(ctx: MatchContext) => number` is evaluated PER OPTIONAL PROPERTY — `ctx` is the
   * `MatchContext` of the optional property itself (not its parent), so a rule can key off
   * `ctx.path`/`ctx.key`/`ctx.parent`/etc. to vary inclusion by field. Regardless of which form
   * is used, exactly ONE seeded `backend.float(0, 1)` draw happens per optional property — the
   * generated stream's shape/length never depends on this config, only which branch of a fixed
   * draw sequence gets taken (same "one seed -> identical output" contract as everything else).
   *
   * Motivating case: forcing a normally-optional array to be present (`optionalProbability:
   * ({ path }) => (path === 'identifier' ? 1 : 0.5)`) so a paired `finalize` hook always has a
   * container to amend into — see README's "Ensuring fields exist (finalize)" section.
   */
  optionalProbability?: number | ((ctx: MatchContext) => number) | undefined;
  /**
   * Dot-path (`*`/`**` globs) or predicate-based hooks that run AFTER a node's value is fully
   * generated (post-order: an object/array's OWN `finalize` hook sees its children's values
   * already finalized, not the raw pre-finalize generation), receive the value plus the same
   * `MatchContext & { backend }` an override sees, and return the (possibly amended) value —
   * used VERBATIM, no constraint guard. This is the tool for "ensure X exists in the generated
   * value" semantics `overrides` (pre-generation replacement) and `heuristics` (decline-based
   * selection) don't express — e.g. a FHIR `Patient` that must always carry an MRN-system
   * `identifier` entry: `finalize: { identifier: (value, ctx) => ensureMrn(value as
   * unknown[]) }`. When multiple glob keys match the same path, only the MOST SPECIFIC one
   * runs (same specificity ranking `overrides` uses — see `Finalizers`'s doc comment for why
   * there's no decline/fall-through chain here, unlike `overrides`). A single function is a
   * catch-all applied to every node (same sugar pattern as `HeuristicFn`).
   *
   * `strict: true` validates the FINAL, already-finalized value — `finalize` runs first, so an
   * amendment is what strict mode's retry loop actually validates (and what it retries
   * generating-then-finalizing again from, on failure).
   */
  finalize?: Finalizers | undefined;
  /**
   * Custom `format` generators, keyed by JSON Schema `format` name — the `jsf.format()` analog
   * from `json-schema-faker`. When a string node carries a `format` whose name is registered
   * here, the registered generator runs INSTEAD OF the backend's own built-in handling for that
   * format name — this slots in exactly at the existing `format` tier of the priority ladder:
   * `overrides` > `heuristics` > registered `formats` > backend built-in `format` > `pattern` >
   * plain generation. Registering a name the backend ALSO handles natively (e.g. `'email'`)
   * SHADOWS the built-in for that name; every unregistered format name still gets the backend's
   * built-in handling (or the plain-string fallthrough if the backend has none for it) exactly
   * as before — registering `formats` is purely additive, never a global opt-out of built-ins.
   * Each generator receives the same `MatchContext & {backend}` a heuristic/override does and
   * must return a `string`, drawing all randomness from `ctx.backend` for determinism.
   */
  formats?: Record<string, FormatGenerator> | undefined;
  /**
   * Probability (0..1) that a node's declared `default` value is emitted instead of a normally
   * generated value, in the `output` projection (a `default` is never preferred in `input`,
   * regardless of this setting — the field is simply optional there). Defaults to `0.5` (the
   * pre-existing coin flip). `0` disables the behavior entirely (never emit the default via
   * this mechanism); `1` always emits it whenever the `default` keyword is present. Exactly ONE
   * seeded `backend.float(0, 1)` draw happens per `default`-bearing node regardless of this
   * setting's value — same "one seed -> identical output" stream-shape discipline
   * `optionalProbability` established (see its own doc comment above): the draw is unconditional
   * whenever the node has a `default`, only which side of it wins changes.
   */
  defaultProbability?: number | undefined;
  /**
   * Probability (0..1) that a node's `examples` array (when present and non-empty) is sampled
   * from instead of generating a normal value. Defaults to `0.5` (the pre-existing coin flip).
   * `0` disables the behavior entirely; `1` always picks from `examples` whenever present.
   * Exactly ONE seeded `backend.float(0, 1)` draw happens per `examples`-bearing node regardless
   * of this setting — same stream-shape stability guarantee as `defaultProbability` above.
   */
  examplesProbability?: number | undefined;
  /** Recursion / `$ref` depth cap. Defaults to 5. */
  maxDepth?: number | undefined;
  /**
   * Fixed point in time every relative-date value this call generates is anchored to —
   * `date-time`/`date`/`time` string formats, `BackendInstance.date()` with no explicit bounds,
   * and (in `standard-schema-faker/faker`) `defaultHeuristics`' `createdAt`/`updatedAt`/
   * `deletedAt`/`birthDate` rules. Defaults to a fixed constant (`2025-01-01T00:00:00.000Z` —
   * `defaultBackend`'s `DEFAULT_REFERENCE_DATE` / `fakerBackend`'s `REFERENCE_DATE`), NOT
   * `new Date()`/`Date.now()`, so the same seed produces the same date-shaped output across
   * runs/machines/days — see README's "Design notes" for why this matters (faker's own
   * relative-date methods default their reference point to `Date.now()`, which would otherwise
   * silently break "same seed -> identical output" for any date field). Passing
   * `referenceDate: new Date()` is a deliberate, explicit OPT-IN to now-relative data — e.g. "an
   * order placed within the last 30 days of today" — at the cost of losing cross-run stability
   * for that call; every generated date is still guaranteed `<= referenceDate`.
   */
  referenceDate?: Date | undefined;
}

export interface FakeOptions {
  /** Seed for this call's backend instance. Omit for a random (time-based) seed. */
  seed?: number | undefined;
}

export type AnySchema = StandardSchemaV1<unknown, unknown>;

/**
 * The schema-inferred type `fake()`/`fakeMany()` return for a given schema `S` and projection
 * `P` — `StandardSchemaV1.InferInput<S>` for `"input"`, `InferOutput<S>` for `"output"`. This is
 * the point of building on Standard Schema's own type surface: `fake(User)` is typed as
 * `User`'s actual inferred shape (with any Zod `.transform()`/default/refinement reflected),
 * not `unknown`.
 */
export type Projected<S extends AnySchema, P extends Projection> = P extends "input"
  ? StandardSchemaV1.InferInput<S>
  : StandardSchemaV1.InferOutput<S>;

/**
 * A configured faker instance, returned by `createFaker(config)`. Generic over the projection
 * `P` (inferred from `config.io` — see `FakerConfig<P>`) so `fake`/`fakeMany`'s return type
 * reflects whichever projection this instance was configured for.
 *
 * Named `SchemaFaker` (not `Faker`) to avoid colliding with `@faker-js/faker`'s own `Faker`
 * class — a real, confusing name collision in any codebase importing both this package and
 * `@faker-js/faker` directly (as `standard-schema-faker/faker` itself does internally).
 */
export interface SchemaFaker<P extends Projection = "output"> {
  fake<S extends AnySchema>(schema: S, opts?: FakeOptions): Projected<S, P>;
  fakeMany<S extends AnySchema>(schema: S, n: number, opts?: FakeOptions): Array<Projected<S, P>>;
}
