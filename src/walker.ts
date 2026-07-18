import { UniqueItemsError, UnresolvableRefError } from "./errors.js";
import type { CompiledFinalizers } from "./finalize.js";
import { applyFinalize } from "./finalize.js";
import type { AncestorFrame, CompiledHeuristics } from "./heuristics.js";
import { buildMatchContext } from "./heuristics.js";
import type { CompiledOverrides } from "./overrides.js";
import type { BackendInstance, FormatGenerator, JSONSchema, MatchContext, Projection } from "./types.js";

export interface WalkContext {
  /** One seeded instance for the whole call — every random choice flows through this. */
  backend: BackendInstance;
  /** The root JSON Schema document, used to resolve `$ref`/`$defs`. */
  root: JSONSchema;
  /** Recursion / `$ref` depth cap (`maxDepth`, default 5). */
  maxDepth: number;
  /** Which JSON Schema projection is being generated ("input" | "output"); informs `default` handling. */
  projection: Projection;
  /** Compiled `overrides` glob/predicate matcher, if configured. Checked before generating each node. */
  overrides?: CompiledOverrides | undefined;
  /**
   * Compiled `heuristics` ruleset, if configured. Checked at every node (leaf string/
   * number/integer AND container object/array nodes, so a rule can generate a whole
   * correlated object — see heuristics.ts's `withinStructuralFit`), after `overrides` (which
   * already short-circuited the whole subtree if configured) but before `format`/`pattern`/
   * plain generation. `undefined` (core's default) means heuristics are off.
   */
  heuristics?: CompiledHeuristics | undefined;
  /**
   * Compiled `finalize` hooks, if configured. Applied POST-ORDER: once a node's value (and, for
   * a container, every child's own already-finalized value) is fully generated — see
   * `generateFromSchema`'s outer/inner split for how "exactly once per node, after its children"
   * is achieved despite `$ref`/`nullable`/`allOf`/`anyOf` unwrapping re-entering the walker at
   * the SAME path. `undefined` (default) means no finalize hooks configured.
   */
  finalize?: CompiledFinalizers | undefined;
  /**
   * Resolves the inclusion probability for an OPTIONAL object property, given that property's
   * OWN `MatchContext` (see `FakerConfig.optionalProbability`'s doc comment). `index.ts`'s
   * `createFaker` always resolves and passes this explicitly (a bare `number` or `undefined`
   * config value becomes a constant function there — see `resolveOptionalProbability`).
   * Optional here (rather than required) only so a `WalkContext` built BY HAND (advanced direct
   * `generateFromSchema` usage, or a test exercising the walker without going through
   * `createFaker`) doesn't have to supply a no-op resolver — `generateObject` falls back to the
   * constant `DEFAULT_OPTIONAL_PROBABILITY` (0.5, the pre-existing coin-flip rate) when absent.
   */
  optionalProbability?: ((ctx: MatchContext) => number) | undefined;
  /**
   * Compiled `formats` registry, if configured (`FakerConfig.formats`) — custom `format`-name ->
   * generator map, the `jsf.format()` analog. Consulted by `generateString` before falling back
   * to `ctx.backend.string()`'s built-in format handling — see `generateString`'s own doc
   * comment for exactly where this slots into the priority ladder. `undefined` (core's default)
   * means no custom formats are registered; every format name gets the backend's built-in
   * handling (or the plain-string fallthrough) exactly as before this feature existed.
   */
  formats?: Record<string, FormatGenerator> | undefined;
  /**
   * Resolved `FakerConfig.defaultProbability` — a plain `number`, compared against exactly one
   * seeded `backend.float(0, 1)` draw per `default`-bearing node in the output projection (see
   * the `default` branch in `generateFromSchemaInner`). Optional here (rather than required),
   * same rationale as `optionalProbability` above: a hand-built `WalkContext` (advanced direct
   * `generateFromSchema` usage, or a test exercising the walker without going through
   * `createFaker`) falls back to the constant `DEFAULT_DEFAULT_PROBABILITY` (0.5, the
   * pre-existing coin-flip rate) when absent. `index.ts`'s `createFaker` always resolves and
   * passes this explicitly.
   */
  defaultProbability?: number | undefined;
  /**
   * Resolved `FakerConfig.examplesProbability` — same shape/defaulting story as
   * `defaultProbability` above (falls back to `DEFAULT_EXAMPLES_PROBABILITY`, 0.5), applied to
   * `examples`-bearing nodes instead.
   */
  examplesProbability?: number | undefined;
}

const DEFAULT_OPTIONAL_PROBABILITY = 0.5;
const DEFAULT_NULL_PROBABILITY = 0.5;
const DEFAULT_DEFAULT_PROBABILITY = 0.5;
const DEFAULT_EXAMPLES_PROBABILITY = 0.5;
const DEFAULT_ARRAY_MIN = 1;
const DEFAULT_ARRAY_MAX = 3;
const DEFAULT_NUMBER_MIN = 0;
const DEFAULT_NUMBER_MAX = 100;
const DEFAULT_STRING_MIN = 8;
const DEFAULT_STRING_MAX = 16;

/** Ancestor chain, ordered leaf -> root — see `MatchContext.ancestors`. The public
 * `generateFromSchema` entry point defaults this to `[]` (root call); recursive internal call
 * sites thread it through explicitly, prepending a new frame as they descend one level. */
type Ancestors = readonly AncestorFrame[];

const NO_SIBLINGS: Readonly<Record<string, unknown>> = Object.freeze({});

/**
 * Walks a JSON Schema node and produces one fake value for it.
 *
 * `path` is a dot-path (checked against `ctx.overrides`, if configured, before generating —
 * see overrides.ts; also useful for error messages). `depth` is the current `$ref`/recursion
 * depth, checked against `ctx.maxDepth`. `ancestors` (leaf -> root, closest first), `parent`
 * (the immediately containing node, `undefined` at the root), and `siblings` (values already
 * generated for earlier — schema declaration order — properties of the immediate parent
 * object; see `MatchContext.siblings`'s ordering guarantee) feed `MatchContext` for heuristics
 * — see heuristics.ts. All three default to the root-call shape so existing callers (and the
 * public API) don't need to pass them.
 */
export function generateFromSchema(
  node: JSONSchema,
  ctx: WalkContext,
  path: string,
  depth: number,
  ancestors: Ancestors = [],
  parent?: JSONSchema,
  siblings: Readonly<Record<string, unknown>> = NO_SIBLINGS,
): unknown {
  const value = generateFromSchemaInner(node, ctx, path, depth, ancestors, parent, siblings);

  // `finalize` runs POST-ORDER, exactly ONCE per node the walker visits (i.e. once per distinct
  // `path` reached from a genuine caller — `generateObject`/`generateArray`/the root entry
  // point — not once per same-path `$ref`/`nullable`/`allOf`/`anyOf` UNWRAPPING re-entry into
  // `generateFromSchemaInner` below, which would otherwise apply the same node's hook multiple
  // times). This is why finalize is applied HERE, in the outer wrapper, rather than inside
  // `generateFromSchemaInner` itself: every recursive same-path unwrap call goes straight to
  // the inner function, never back through this outer one. For a container (object/array), by
  // the time this line runs, `generateObject`/`generateArray` have already returned — meaning
  // every child has already been generated AND already had its own `finalize` hook (if any)
  // applied via ITS OWN call to this same outer function — so a parent's hook always observes
  // its children's amendments, never the other way around.
  if (!ctx.finalize) return value;
  const matchCtx = buildMatchContext({ path, node, parent, ancestors, siblings, root: ctx.root });
  return applyFinalize(ctx.finalize, value, { ...matchCtx, backend: ctx.backend });
}

function generateFromSchemaInner(
  node: JSONSchema,
  ctx: WalkContext,
  path: string,
  depth: number,
  ancestors: Ancestors,
  parent: JSONSchema | undefined,
  siblings: Readonly<Record<string, unknown>>,
): unknown {
  if (ctx.overrides) {
    // Built LAZILY (only when `ctx.overrides` is actually configured — the common case is no
    // overrides at all, and building a MatchContext on every single node visited would be
    // wasted work otherwise). Checked before `$ref` resolution, same as always, so an override
    // can still short-circuit a recursive/`$ref`-heavy subtree entirely; `ancestors`/`parent`/
    // `siblings` are passed through exactly as the walker already tracks them at this point.
    // The override's value still passes through `finalize` (applied by the OUTER
    // `generateFromSchema` once this inner call returns) — an override IS "this node's
    // generated value," same as any other generation path.
    const matchCtx = buildMatchContext({ path, node, parent, ancestors, siblings, root: ctx.root });
    const matched = ctx.overrides.match({ ...matchCtx, backend: ctx.backend });
    if (matched.hit) return matched.value;
  }

  const resolved = resolveRef(node, ctx, depth);
  if (resolved.hitDepthCap) {
    // `resolved.node` may still be a bare `{ $ref }` (depth cap was hit before dereferencing);
    // `generateDepthCapFallback` peeks through it itself to figure out what "empty" shape to
    // terminate the recursion with.
    return generateDepthCapFallback(resolved.node, ctx, path);
  }
  node = resolved.node;
  depth = resolved.depth;

  // OpenAPI-style `nullable: true` sibling keyword (native JSON Schema has no dedicated
  // `nullable` keyword; vendors that support it in-spec, e.g. Zod v4, express it instead as
  // `anyOf: [T, { type: 'null' }]`, which the generic anyOf branch-pick a few lines down
  // already covers). Checked here — the TOP of `generateFromSchema`, right after `$ref`
  // resolution and before the composition/type dispatch below — so it's honored for EVERY
  // node the walker ever generates (array items, the root node, `anyOf`/`oneOf` branches,
  // object properties), not just object properties.
  //
  // `nullable: true` must be honored at EVERY recursive entry point — an array's OWN `items`
  // schema (or the root schema itself) declaring `nullable: true` needs the same treatment as
  // an object property, e.g. an array of `{ type: 'string', nullable: true }` items must be
  // able to produce a null element. Checked here, once, with no dedicated per-call-site guard
  // to remember.
  if (node.nullable === true) {
    if (ctx.backend.bool()) return null;
    const { nullable: _nullable, ...rest } = node;
    void _nullable;
    // Same-path re-entry — calls the INNER function directly (not the outer `finalize`-wrapped
    // one) so a `nullable: true` unwrap doesn't apply this node's `finalize` hook twice.
    return generateFromSchemaInner(rest, ctx, path, depth, ancestors, parent, siblings);
  }

  // --- Composition keywords take priority over `type` ---
  if (Array.isArray(node.allOf)) {
    const merged = shallowMergeAllOf(node.allOf as JSONSchema[], node);
    return generateFromSchemaInner(merged, ctx, path, depth, ancestors, parent, siblings);
  }

  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const branches = (node.anyOf ?? node.oneOf) as JSONSchema[];
    const branch = ctx.backend.pick(branches);
    return generateFromSchemaInner(branch, ctx, path, depth, ancestors, parent, siblings);
  }

  // `const` (a fixed literal) wins over any other constraint.
  if ("const" in node) {
    return node.const;
  }

  // `enum` — pick one value.
  if (Array.isArray(node.enum)) {
    return ctx.backend.pick(node.enum as unknown[]);
  }

  // `examples` — pick one with some probability (free realism).
  //
  // `ctx.examplesProbability` is a resolved `number` (0..1; defaulted to 0.5 in index.ts's
  // `resolveExamplesProbability` when unconfigured), compared against exactly ONE seeded
  // `backend.float(0, 1)` draw — same "one seed -> identical output" stream-shape discipline
  // `optionalProbability` uses (see its own doc comment in types.ts): `bool()` and
  // `float(0,1) < 0.5` are bit-for-bit equivalent for `defaultBackend` (`bool()` IS
  // `rand() < 0.5`), so the default behavior is unchanged there; `fakerBackend`'s concrete
  // sequence for existing seeds changes even at the default (documented divergence, same
  // caveat `optionalProbability` carries).
  if (Array.isArray(node.examples) && node.examples.length > 0) {
    const draw = ctx.backend.float(0, 1);
    if (draw < (ctx.examplesProbability ?? DEFAULT_EXAMPLES_PROBABILITY)) return ctx.backend.pick(node.examples as unknown[]);
  }

  // `default` — in the output projection, prefer the declared default some of the time.
  // Same probability-draw replacement as `examples` above, via `ctx.defaultProbability`.
  if (ctx.projection === "output" && "default" in node) {
    const draw = ctx.backend.float(0, 1);
    if (draw < (ctx.defaultProbability ?? DEFAULT_DEFAULT_PROBABILITY)) return node.default;
  }

  const type = resolveType(node, ctx.backend);

  // Heuristics run for string/number/integer leaves AND object/array containers (a container
  // rule may generate a whole correlated value — e.g. a FHIR ContactPoint's
  // {system, value, use} — before the walker would otherwise recurse into its
  // properties/items). Checked after `overrides` (already short-circuited above if
  // configured) but before format/pattern/plain generation. `const`/`enum` nodes never reach
  // here (handled above already) — heuristics.ts's resolver also guards this defensively.
  if (ctx.heuristics && (type === "string" || type === "number" || type === "integer" || type === "object" || type === "array")) {
    const matchCtx = buildMatchContext({ path, node, parent, ancestors, siblings, root: ctx.root });
    const matched = ctx.heuristics.resolve({ ...matchCtx, backend: ctx.backend });
    if (matched.hit) return matched.value;
  }

  switch (type) {
    case "null":
      return null;
    case "boolean":
      return ctx.backend.bool();
    case "integer":
      return generateInteger(node, ctx);
    case "number":
      return generateNumber(node, ctx);
    case "string":
      return generateString(node, ctx, path, parent, ancestors, siblings);
    case "array":
      // A container becomes a new ancestor frame FOR ITS OWN CHILDREN once we descend into it
      // — never for itself (an object/array's own `ctx.ancestors`, as seen by e.g. a
      // container-node heuristic rule, must describe what's ABOVE it, not include itself). The
      // frame is `{key: <this array's own last path segment>, node: this array}` — `undefined`
      // at the root (nothing to add). See `MatchContext.ancestors`'s worked example in
      // types.ts and `generateObject`'s matching doc comment for the full derivation.
      return generateArray(node, ctx, path, depth, pushSelfAsAncestor(ancestors, path, node));
    case "object":
      return generateObject(node, ctx, path, depth, pushSelfAsAncestor(ancestors, path, node));
    default:
      // No recognizable `type` and no composition keyword matched above — JSON Schema
      // allows this (e.g. `{}` = "anything"). Emit a plausible default: a short string.
      return ctx.backend.string({ minLength: DEFAULT_STRING_MIN, maxLength: DEFAULT_STRING_MAX });
  }
}

/** Pushes a frame representing the CURRENT container node (`node`, at `path`) onto `ancestors`, for its children to inherit — `undefined`/root-path contributes no frame (nothing to describe). See `generateFromSchema`'s "array"/"object" cases and `generateObject`'s doc comment for the full derivation of why this lives here rather than in `generateObject`/`generateArray` themselves. */
function pushSelfAsAncestor(ancestors: Ancestors, path: string, node: JSONSchema): Ancestors {
  const ownKey = lastPathSegment(path);
  return ownKey === undefined ? ancestors : prependAncestor(ancestors, ownKey, node);
}

/**
 * Multiple `type` values (a JSON Schema array, e.g. `["string","null"]`) are handled as a
 * pseudo-`anyOf`.
 *
 * A `backend` argument means this call is a GENERATION dispatch (about to actually produce a
 * value of whatever type comes back) — in that case a type is picked via `backend.pick(types)`,
 * seeded and uniform across all listed types. A schema declaring `type: ["null", "string"]`
 * (order matters to some vendors/authors, and JSON Schema doesn't mandate declaring the
 * "primary" type first) must be able to generate either type, not just the first one listed.
 *
 * Omitting `backend` (the classification-only call sites: depth-cap fallback's own `"null"`
 * branch check, `isEnumOrConstProperty`-style pure inspection) keeps a deterministic
 * "first element" behavior deliberately — those call sites are asking "is one of the possible
 * types X," not "generate a value," so they must stay pure and side-effect-free (no RNG draw).
 */
function resolveType(node: JSONSchema, backend?: BackendInstance): string | undefined {
  const t = node.type;
  if (Array.isArray(t)) {
    const types = t as string[];
    if (types.length === 0) return undefined;
    return backend ? backend.pick(types) : types[0];
  }
  return t as string | undefined;
}

// ---------------------------------------------------------------------------
// $ref / $defs resolution with maxDepth cap
// ---------------------------------------------------------------------------

interface ResolveResult {
  node: JSONSchema;
  depth: number;
  hitDepthCap: boolean;
}

function resolveRef(node: JSONSchema, ctx: WalkContext, depth: number): ResolveResult {
  let current = node;
  let currentDepth = depth;
  const seenRefs = new Set<string>();

  while (typeof current.$ref === "string") {
    const ref = current.$ref;

    if (currentDepth >= ctx.maxDepth) {
      return { node: current, depth: currentDepth, hitDepthCap: true };
    }
    // Guard against a $ref cycle that doesn't even grow `depth` (shouldn't normally happen
    // since we increment below, but keep an explicit breaker for safety).
    if (seenRefs.has(ref)) {
      return { node: current, depth: currentDepth, hitDepthCap: true };
    }
    seenRefs.add(ref);

    const target = resolvePointer(ref, ctx.root);
    if (!target) {
      throw new UnresolvableRefError(`standard-schema-faker: could not resolve $ref "${ref}"`, { ref });
    }
    current = target;
    currentDepth += 1;
  }

  return { node: current, depth: currentDepth, hitDepthCap: false };
}

function resolvePointer(ref: string, root: JSONSchema): JSONSchema | undefined {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) return undefined;

  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "object" && current !== null ? (current as JSONSchema) : undefined;
}

/**
 * At `maxDepth`, prefer an optional-terminating branch instead of recursing further. This
 * function is fully self-contained — it never re-enters the normal
 * `generateFromSchema` dispatch for container types (array/object/anyOf), because that could
 * loop forever: a capped `$ref` always peeks back to the *same* recursive shape, and normal
 * dispatch does not advance `depth` for non-`$ref` nodes. Only genuine leaf/primitive types
 * (string/number/integer/boolean) are safe to hand back to `generateFromSchema`.
 *
 * Arrays terminate as `[]` (valid regardless of minItems in the vast majority of real-world
 * recursive schemas — a hard structural minItems exactly at the depth boundary is an accepted
 * v0 fidelity gap). Objects still populate their *required* properties so e.g.
 * `{ name: string, subcategories: Category[] }` terminates as `{ name: "...", subcategories: [] }`
 * rather than an invalid `{}` — each required property is resolved through this same
 * depth-cap-safe path recursively (bounded by the object's own finite property count, so it
 * always terminates).
 *
 * KNOWN GAP: `ctx.overrides`/`ctx.heuristics`/`ctx.finalize` are intentionally NOT re-checked
 * for container-typed nodes here (only for the leaf/primitive case, which re-enters
 * `generateFromSchema` and gets all three there) — an override, heuristic, or finalize hook
 * targeting a path that's only reachable exactly at the depth-cap boundary won't apply to it.
 * Deliberately not touched, to avoid destabilizing the depth-cap termination logic (recursion
 * safety here is load-bearing — see the self-containment note above). Edge case; all three
 * still apply normally everywhere above the cap.
 */
function generateDepthCapFallback(node: JSONSchema, ctx: WalkContext, path: string): unknown {
  // Peek through $ref one more time (still without consuming depth budget) so nested
  // properties that are themselves refs get the same safe treatment.
  if (typeof node.$ref === "string") {
    const target = resolvePointer(node.$ref, ctx.root);
    node = target ?? node;
  }

  const type = resolveType(node, ctx.backend);

  if (type === "array") return [];

  if (type === "object") {
    const properties = (node.properties as Record<string, JSONSchema> | undefined) ?? {};
    const required = new Set((node.required as string[] | undefined) ?? []);
    const result: Record<string, unknown> = {};
    for (const key of required) {
      const propSchema = properties[key];
      if (!propSchema) continue;
      result[key] = generateDepthCapFallback(propSchema, ctx, joinPath(path, key));
    }
    return result;
  }

  if (Array.isArray(node.anyOf)) {
    const nullBranch = (node.anyOf as JSONSchema[]).find((b) => resolveType(b) === "null");
    if (nullBranch) return null;
    // Prefer the structurally simplest branch (no nested $ref) to terminate recursion.
    const simple = (node.anyOf as JSONSchema[]).find((b) => typeof b.$ref !== "string");
    if (simple) return generateDepthCapFallback(simple, ctx, path);
    // Every branch is a $ref (mutually recursive union) — nothing safe to terminate with.
    return null;
  }

  if (type && type !== "null") {
    // A concrete non-recursive primitive type (string/number/integer/boolean) — generate it
    // normally. Safe to hand to `generateFromSchema`: primitives never re-enter the depth-cap
    // path since they have no `$ref`/container structure to recurse through.
    return generateFromSchema(node, ctx, path, ctx.maxDepth);
  }

  return null;
}

// ---------------------------------------------------------------------------
// allOf — shallow merge
// ---------------------------------------------------------------------------

function shallowMergeAllOf(subSchemas: JSONSchema[], rest: JSONSchema): JSONSchema {
  const merged: JSONSchema = {};
  const { allOf: _allOf, ...restWithoutAllOf } = rest;
  void _allOf;
  Object.assign(merged, restWithoutAllOf);

  let properties: Record<string, unknown> = { ...(merged.properties as Record<string, unknown> | undefined) };
  let required: string[] = [...((merged.required as string[] | undefined) ?? [])];

  for (const sub of subSchemas) {
    for (const [key, value] of Object.entries(sub)) {
      if (key === "properties") {
        properties = { ...properties, ...(value as Record<string, unknown>) };
      } else if (key === "required") {
        required = [...required, ...(value as string[])];
      } else {
        // last-write-wins shallow merge for everything else (type, format, etc.)
        merged[key] = value;
      }
    }
  }

  if (Object.keys(properties).length > 0) merged.properties = properties;
  if (required.length > 0) merged.required = Array.from(new Set(required));
  return merged;
}

// ---------------------------------------------------------------------------
// Primitive generators
// ---------------------------------------------------------------------------

function generateInteger(node: JSONSchema, ctx: WalkContext): number {
  let min = typeof node.minimum === "number" ? node.minimum : DEFAULT_NUMBER_MIN;
  let max = typeof node.maximum === "number" ? node.maximum : DEFAULT_NUMBER_MAX;

  if (typeof node.exclusiveMinimum === "number") min = node.exclusiveMinimum + 1;
  if (typeof node.exclusiveMaximum === "number") max = node.exclusiveMaximum - 1;

  if (max < min) max = min;

  const multipleOf = typeof node.multipleOf === "number" ? node.multipleOf : undefined;
  if (multipleOf && multipleOf > 0) {
    const lo = Math.ceil(min / multipleOf);
    const hi = Math.floor(max / multipleOf);
    if (hi >= lo) {
      const k = ctx.backend.int(lo, hi);
      return k * multipleOf;
    }
  }

  return ctx.backend.int(Math.ceil(min), Math.floor(max));
}

function generateNumber(node: JSONSchema, ctx: WalkContext): number {
  let min = typeof node.minimum === "number" ? node.minimum : DEFAULT_NUMBER_MIN;
  let max = typeof node.maximum === "number" ? node.maximum : DEFAULT_NUMBER_MAX;

  if (typeof node.exclusiveMinimum === "number") min = node.exclusiveMinimum;
  if (typeof node.exclusiveMaximum === "number") max = node.exclusiveMaximum;

  if (max < min) max = min;

  const multipleOf = typeof node.multipleOf === "number" ? node.multipleOf : undefined;
  if (multipleOf && multipleOf > 0) {
    const lo = Math.ceil(min / multipleOf);
    const hi = Math.floor(max / multipleOf);
    if (hi >= lo) {
      const k = ctx.backend.int(lo, hi);
      return k * multipleOf;
    }
  }

  let value = ctx.backend.float(min, max);
  if (typeof node.exclusiveMinimum === "number" && value <= node.exclusiveMinimum) {
    value = node.exclusiveMinimum + Math.abs(max - min) * 1e-6 || node.exclusiveMinimum + 1e-9;
  }
  if (typeof node.exclusiveMaximum === "number" && value >= node.exclusiveMaximum) {
    value = node.exclusiveMaximum - (Math.abs(max - min) * 1e-6 || 1e-9);
  }
  return value;
}

function generateString(
  node: JSONSchema,
  ctx: WalkContext,
  path: string,
  parent: JSONSchema | undefined,
  ancestors: Ancestors,
  siblings: Readonly<Record<string, unknown>>,
): string {
  const minLength = typeof node.minLength === "number" ? node.minLength : undefined;
  const maxLength = typeof node.maxLength === "number" ? node.maxLength : undefined;
  const format = typeof node.format === "string" ? node.format : undefined;
  const pattern = typeof node.pattern === "string" ? node.pattern : undefined;

  // Custom `format` registry (`FakerConfig.formats`, the `jsf.format()` analog) — checked
  // BEFORE calling `backend.string()`, so a registered generator runs INSTEAD OF the backend's
  // own built-in handling for that format name. This is the `format` tier of the priority
  // ladder (overrides > heuristics > user `formats` > backend built-in format > pattern > plain)
  // — heuristics have already had their chance above (in `generateFromSchemaInner`) and
  // declined/weren't configured; an unregistered format name (or no `formats` config at all)
  // falls straight through to the normal `ctx.backend.string()` call below, unaffected.
  if (format && ctx.formats?.[format]) {
    const matchCtx = buildMatchContext({ path, node, parent, ancestors, siblings, root: ctx.root });
    return ctx.formats[format]({ ...matchCtx, backend: ctx.backend });
  }

  // Only synthesize the 8-16 default length window for the *unformatted* case. A `format`
  // (email/uuid/uri/date-time/...) drives a fixed-shape deterministic template in the default
  // backend — imposing an unrelated default maxLength on top would risk truncating it into an
  // invalid value (e.g. chopping an email's TLD). Explicit minLength/maxLength from the schema
  // are always honored regardless of format.
  //
  // The default minLength floor (DEFAULT_STRING_MIN = 8) must never exceed an explicit smaller
  // `maxLength` (e.g. `z.string().max(2)` with no `.min()` must yield <=2 chars, not an
  // inverted {minLength: 8, maxLength: 2} range) — clamp the default down to `maxLength` in
  // that case.
  const defaultMin = maxLength !== undefined ? Math.min(DEFAULT_STRING_MIN, maxLength) : DEFAULT_STRING_MIN;
  const resolvedMinLength = minLength ?? (format ? undefined : defaultMin);
  const resolvedMaxLength = maxLength ?? (format ? undefined : Math.max(resolvedMinLength ?? defaultMin, DEFAULT_STRING_MAX));

  return ctx.backend.string({
    format,
    pattern,
    minLength: resolvedMinLength,
    maxLength: resolvedMaxLength,
  });
}

// ---------------------------------------------------------------------------
// array
// ---------------------------------------------------------------------------

function generateArray(node: JSONSchema, ctx: WalkContext, path: string, depth: number, ancestors: Ancestors): unknown[] {
  // Tuple, draft-2020-12 form: `prefixItems: JSONSchema[]` (`items` alongside it, if present,
  // describes trailing/additional elements beyond the tuple — not needed for v0's tuple support).
  const prefixItems = Array.isArray(node.prefixItems) ? (node.prefixItems as JSONSchema[]) : undefined;
  // Tuple, draft-07 form: `items: JSONSchema[]` (an ARRAY, not a single schema) is itself the
  // tuple's per-position schemas — draft-07 has no `prefixItems` keyword. Verified against
  // Effect Schema's fallback-converter output, which targets draft-07. Must be checked before
  // treating `items` as a single per-element schema below.
  const tupleItems = Array.isArray(node.items) ? (node.items as JSONSchema[]) : undefined;

  // NOTE on `ancestors`: by the time `generateArray` runs, `ancestors` already includes a frame
  // for THIS array (pushed by `generateFromSchema`'s "array" dispatch case, right before
  // calling here) — so each item is generated with `ancestors` UNCHANGED. If an item's own
  // resolved type turns out to be a container itself (object/array), `generateFromSchema` will
  // push a frame for THAT item when it dispatches into it — not `generateArray`'s job. See
  // `generateFromSchema`'s "array"/"object" cases and `generateObject`'s doc comment for the
  // full derivation of where ancestor frames get pushed and why.
  if (prefixItems || tupleItems) {
    const positions = (prefixItems ?? tupleItems) as JSONSchema[];
    return positions.map((itemSchema, i) => generateFromSchema(itemSchema, ctx, joinPath(path, String(i)), depth, ancestors, node));
  }

  const minItems = typeof node.minItems === "number" ? node.minItems : DEFAULT_ARRAY_MIN;
  const maxItems = typeof node.maxItems === "number" ? node.maxItems : DEFAULT_ARRAY_MAX;
  const count = ctx.backend.int(minItems, Math.max(minItems, maxItems));

  // `items` here is guaranteed to be a single schema (object), not an array — the tuple form
  // was already handled above.
  const itemSchema = (node.items as JSONSchema | undefined) ?? {};
  const uniqueItems = node.uniqueItems === true;

  if (!uniqueItems) {
    const result: unknown[] = [];
    for (let i = 0; i < count; i++) {
      result.push(generateFromSchema(itemSchema, ctx, joinPath(path, String(i)), depth, ancestors, node));
    }
    return result;
  }

  return generateUniqueArray(itemSchema, ctx, path, depth, count, minItems, ancestors, node);
}

/** Bounded re-roll budget per slot before falling back to shrinking (see `generateUniqueArray`). */
const UNIQUE_ITEMS_MAX_ATTEMPTS_PER_SLOT = 20;

/**
 * `uniqueItems: true` dedupe strategy:
 *
 *   1. On a collision (an already-seen value, compared via `JSON.stringify` — adequate for
 *      the plain-data values this walker produces), re-roll that slot up to
 *      `UNIQUE_ITEMS_MAX_ATTEMPTS_PER_SLOT` times.
 *   2. If a slot still can't find a fresh value after that budget: if we already have at
 *      least `minItems` unique items collected, shrink the array to what we have (stop early
 *      — still a valid array satisfying `minItems`/`uniqueItems`, just short of the originally
 *      rolled `count`).
 *   3. If we don't yet have `minItems` unique items and a slot exhausts its budget, the
 *      schema's cardinality is structurally too small to satisfy `minItems` unique items
 *      (e.g. a boolean-item array with `minItems: 5` — only 2 distinct values exist) — throw
 *      a clear error rather than looping forever or silently returning an invalid array.
 */
function generateUniqueArray(
  itemSchema: JSONSchema,
  ctx: WalkContext,
  path: string,
  depth: number,
  count: number,
  minItems: number,
  ancestors: Ancestors,
  arrayNode: JSONSchema,
): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<string>();

  while (result.length < count) {
    let foundFresh = false;
    for (let attempt = 0; attempt < UNIQUE_ITEMS_MAX_ATTEMPTS_PER_SLOT; attempt++) {
      const value = generateFromSchema(itemSchema, ctx, joinPath(path, String(result.length)), depth, ancestors, arrayNode);
      const key = JSON.stringify(value);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(value);
        foundFresh = true;
        break;
      }
    }

    if (!foundFresh) {
      if (result.length >= minItems) {
        // Can't fill any more unique slots, but we already satisfy minItems — shrink to what
        // we have rather than force a duplicate or loop forever.
        return result;
      }
      throw new UniqueItemsError(
        `standard-schema-faker: could not generate ${minItems} unique items for an array with ` +
          `uniqueItems: true — the item schema's value space appears too small (only found ` +
          `${result.length} distinct value(s) after ${UNIQUE_ITEMS_MAX_ATTEMPTS_PER_SLOT} ` +
          `re-rolls). Loosen minItems, drop uniqueItems, or widen the item schema.`,
      );
    }
  }

  return result;
}

/** Joins a dot-path segment onto a (possibly empty, for the root) path prefix. */
function joinPath(prefix: string, segment: string): string {
  return prefix ? `${prefix}.${segment}` : segment;
}

/** Prepends a new leaf-most ancestor frame: `node` is a container above the current node, `key` is how `node` was itself addressed from ITS OWN parent (see `generateObject`'s doc comment on ancestor frame semantics). */
function prependAncestor(ancestors: Ancestors, key: string, containerNode: JSONSchema): Ancestors {
  return [{ key, node: containerNode }, ...ancestors];
}

/** The last dot-path segment of `path` (how the node AT `path` was itself addressed from its own parent) — `undefined` at the root, which has no such key. */
function lastPathSegment(path: string): string | undefined {
  if (path === "") return undefined;
  const segments = path.split(".");
  return segments[segments.length - 1];
}

// ---------------------------------------------------------------------------
// object
// ---------------------------------------------------------------------------

/**
 * Is `propSchema` (after resolving any `$ref` chain, bounded by a cycle guard — this is a
 * pure classification pass over the SCHEMA, not generation, so it deliberately does not
 * consume/consult `ctx.maxDepth`'s generation-depth budget) an `enum` or `const` node? Used to
 * sort an object's properties into the two-tier generation order — see `generateObject`'s
 * "ORDERING GUARANTEE" doc comment. `anyOf`-of-consts and any other composition are
 * deliberately NOT unwrapped here (tier-1 stays simple: a plain `enum`/`const` after ref
 * resolution) — they fall into tier 2, generated in ordinary declaration order.
 */
function isEnumOrConstProperty(propSchema: JSONSchema, root: JSONSchema): boolean {
  let current = propSchema;
  const seenRefs = new Set<string>();
  while (typeof current.$ref === "string") {
    if (seenRefs.has(current.$ref)) return false; // cycle -- bail out of classification, not generation
    seenRefs.add(current.$ref);
    const target = resolvePointer(current.$ref, root);
    if (!target) return false; // unresolvable -- let normal generation surface the real error
    current = target;
  }
  return "const" in current || Array.isArray(current.enum);
}

function generateObject(node: JSONSchema, ctx: WalkContext, path: string, depth: number, ancestors: Ancestors): Record<string, unknown> {
  const properties = (node.properties as Record<string, JSONSchema> | undefined) ?? {};
  const required = new Set((node.required as string[] | undefined) ?? []);

  const result: Record<string, unknown> = {};

  // NOTE on `ancestors`: by the time `generateObject` runs, `ancestors` already includes a
  // frame for THIS object (pushed by `generateFromSchema`'s "object" dispatch case, right
  // before calling here — see `pushSelfAsAncestor`) — so every property is generated with
  // `ancestors` UNCHANGED. If a property's own resolved type turns out to be a container itself
  // (object/array), `generateFromSchema` will push a NEW frame for THAT property when it
  // dispatches into it; `generateObject` itself never pushes anything. This is what makes
  // `ctx.ancestors[0]` always mean "my immediate container, and how it was itself reached" (see
  // `MatchContext.ancestors`'s worked example in types.ts: for `phone[0].value`, ancestors are
  // `[{key: "0", node: <phone ITEM schema>}, {key: "phone", node: <phone ARRAY schema>}]` — note
  // "value" itself never appears). Frames only describe what's ABOVE the current node — a
  // property's own key must never appear in its own ancestor list.

  // ORDERING GUARANTEE (MatchContext.siblings depends on this — documented in README and
  // types.ts): properties are generated in TWO TIERS, not raw declaration order:
  //
  //   1. `enum`/`const` properties (after $ref resolution), in their own declaration order.
  //      These are typically discriminators (system/type/status/use) that OTHER properties'
  //      heuristics key off of via `ctx.siblings` — and generating one needs no context of its
  //      own (it's just a pick from a fixed value space), so hoisting them ahead of everything
  //      else is free and makes that context available regardless of how the schema author
  //      ordered their fields.
  //   2. Every other property, in declaration order among themselves.
  //
  // `siblings` is built up incrementally across BOTH tiers (tier 2 properties see every tier-1
  // property, plus any tier-2 property declared before them). Determinism is unaffected —
  // this reordering is a pure function of the schema shape, so the same schema + seed always
  // produces the same tier assignment and the same output.
  const entries = Object.entries(properties);
  const tier1: Array<[string, JSONSchema]> = [];
  const tier2: Array<[string, JSONSchema]> = [];
  for (const entry of entries) {
    (isEnumOrConstProperty(entry[1], ctx.root) ? tier1 : tier2).push(entry);
  }

  let siblingsSoFar: Record<string, unknown> = {};

  for (const [key, propSchema] of [...tier1, ...tier2]) {
    const isRequired = required.has(key);
    const propPath = joinPath(path, key);

    if (!isRequired) {
      // Optional-inclusion draw flows through the shared seeded backend instance, keeping the
      // whole call on one deterministic stream: items differ, the whole sequence is
      // reproducible from `seed`.
      //
      // `ctx.optionalProbability` is ALWAYS a resolved `(ctx: MatchContext) => number` function
      // (defaulted in index.ts to a constant `DEFAULT_OPTIONAL_PROBABILITY`-returning function
      // when unconfigured) — evaluated with THIS property's own `MatchContext` (not its
      // parent's), so a per-field probability function can key off `ctx.path`/`ctx.key`/etc.
      // Regardless of what the resolver returns, EXACTLY ONE seeded `backend.float(0, 1)` draw
      // happens here, unconditionally — the walk's stream shape/length never depends on
      // `optionalProbability` being configured, only which side of a fixed draw the comparison
      // lands on.
      const optionalMatchCtx = buildMatchContext({
        path: propPath,
        node: propSchema,
        parent: node,
        ancestors,
        siblings: siblingsSoFar,
        root: ctx.root,
      });
      const probability = ctx.optionalProbability ? ctx.optionalProbability(optionalMatchCtx) : DEFAULT_OPTIONAL_PROBABILITY;
      const draw = ctx.backend.float(0, 1);
      if (!(draw < probability)) continue;
    }

    const value = generateFromSchema(propSchema, ctx, propPath, depth, ancestors, node, siblingsSoFar);
    result[key] = value;
    // Only extend `siblings` AFTER this property's own generation sees the prior snapshot —
    // a property never sees its own not-yet-final value as a "sibling."
    siblingsSoFar = { ...siblingsSoFar, [key]: value };
  }

  generateAdditionalProperties(node, ctx, path, depth, ancestors, result, required);

  return result;
}

/**
 * Schema-FORM `additionalProperties` (an object schema for the VALUE type, as opposed to the
 * bare `true`/`false` this walker already handled) — how JSON Schema represents `z.record(K,
 * V)`: `{type: 'object', propertyNames: <K schema>, additionalProperties: <V schema>}`, with NO
 * `properties` keyword at all for a plain `z.record(z.string(), V)`. Verified at runtime
 * (Zod v4's own `~standard.jsonSchema` output) for three key shapes:
 *
 *   - `z.record(z.string(), V)` — `propertyNames: {type: 'string'}`, no further constraint.
 *   - `z.record(z.string().regex(p), V)` — `propertyNames: {type: 'string', pattern: p}`.
 *   - `z.record(z.enum([...]), V)` — `propertyNames: {type: 'string', enum: [...]}`, PLUS
 *     `required: [...every enum value]` at the object's own top level (Zod's way of saying
 *     "this is a closed, exhaustive key set," not merely "these entries happen to be
 *     required") — a real key shape distinct from the open-ended pattern/plain-string cases.
 *
 * Declared (non-additional) `properties` are always generated first (by the caller, above) and
 * are NEVER overwritten by a synthesized key here (checked via `alreadyPresent`) — even if a
 * synthesized key happens to collide with one, declared properties always win.
 */
function generateAdditionalProperties(
  node: JSONSchema,
  ctx: WalkContext,
  path: string,
  depth: number,
  ancestors: Ancestors,
  result: Record<string, unknown>,
  required: Set<string>,
): void {
  const additionalProperties = node.additionalProperties;
  // Bare `true`/`false`/absent — nothing to synthesize (v0's existing, still-correct behavior
  // for the boolean form; only the SCHEMA form is new here).
  if (typeof additionalProperties !== "object" || additionalProperties === null) return;

  const valueSchema = additionalProperties as JSONSchema;
  const propertyNames = (typeof node.propertyNames === "object" && node.propertyNames !== null ? node.propertyNames : {}) as JSONSchema;
  const enumKeys = Array.isArray(propertyNames.enum)
    ? (propertyNames.enum as unknown[]).filter((k): k is string => typeof k === "string")
    : undefined;

  // A closed enum key set (verified shape: Zod's `z.record(z.enum([...]), V)` also marks every
  // enum value `required` at the object's own top level) — generate exactly those keys, no
  // more, no fewer; this is a fixed-shape object wearing `additionalProperties` syntax, not an
  // open-ended dictionary. `minProperties`/`maxProperties` don't apply to a fixed key set.
  if (enumKeys?.every((k) => required.has(k))) {
    for (const key of enumKeys) {
      if (key in result) continue; // never overwrite a declared `properties` entry
      const propPath = joinPath(path, key);
      result[key] = generateFromSchema(valueSchema, ctx, propPath, depth, ancestors, node, {});
    }
    return;
  }

  // Open-ended dictionary: synthesize 1-3 extra entries (bounded via minProperties/
  // maxProperties if the schema declares them), with keys honoring `propertyNames`'s own
  // pattern/format/enum where present, else a plain word.
  const declaredCount = Object.keys(result).length;
  const minProperties = typeof node.minProperties === "number" ? node.minProperties : undefined;
  const maxProperties = typeof node.maxProperties === "number" ? node.maxProperties : undefined;
  const minExtra = Math.max(0, (minProperties ?? declaredCount + DEFAULT_ADDITIONAL_PROPERTIES_MIN) - declaredCount);
  const maxExtra = Math.max(minExtra, (maxProperties ?? declaredCount + DEFAULT_ADDITIONAL_PROPERTIES_MAX) - declaredCount);
  const count = ctx.backend.int(minExtra, maxExtra);

  const usedKeys = new Set(Object.keys(result));
  for (let i = 0; i < count; i++) {
    const key = generateAdditionalPropertyKey(propertyNames, enumKeys, ctx, usedKeys);
    if (key === undefined || usedKeys.has(key)) continue; // no fresh key available (e.g. enum exhausted) -- stop rather than collide
    usedKeys.add(key);
    const propPath = joinPath(path, key);
    result[key] = generateFromSchema(valueSchema, ctx, propPath, depth, ancestors, node, {});
  }
}

const DEFAULT_ADDITIONAL_PROPERTIES_MIN = 1;
const DEFAULT_ADDITIONAL_PROPERTIES_MAX = 3;

/** Generates one synthesized property key for the open-ended `additionalProperties` dictionary case, honoring `propertyNames`'s own `pattern`/`format`/`enum` where present. Returns `undefined` if an enum key set is present but already exhausted (every value already used). */
function generateAdditionalPropertyKey(
  propertyNames: JSONSchema,
  enumKeys: string[] | undefined,
  ctx: WalkContext,
  usedKeys: ReadonlySet<string>,
): string | undefined {
  if (enumKeys) {
    const available = enumKeys.filter((k) => !usedKeys.has(k));
    if (available.length === 0) return undefined;
    return ctx.backend.pick(available);
  }
  const pattern = typeof propertyNames.pattern === "string" ? propertyNames.pattern : undefined;
  const format = typeof propertyNames.format === "string" ? propertyNames.format : undefined;
  return ctx.backend.string({
    pattern,
    format,
    minLength: pattern || format ? undefined : 4,
    maxLength: pattern || format ? undefined : 10,
  });
}

export const __internals = {
  DEFAULT_OPTIONAL_PROBABILITY,
  DEFAULT_NULL_PROBABILITY,
  DEFAULT_ARRAY_MIN,
  DEFAULT_ARRAY_MAX,
  DEFAULT_DEFAULT_PROBABILITY,
  DEFAULT_EXAMPLES_PROBABILITY,
};
