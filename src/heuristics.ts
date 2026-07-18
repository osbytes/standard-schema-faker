import { isLiteralPattern, matchGlob, splitPath, WILDCARD_ANY, WILDCARD_ONE } from "./glob.js";
import type { BackendInstance, HeuristicFn, HeuristicMatcher, HeuristicRule, JSONSchema, MatchContext } from "./types.js";

/**
 * The heuristic rule engine — an inspectable, fully overridable, opt-in ruleset for
 * "if a node's property name/path/shape looks like X, generate a realistic X." See
 * `HeuristicRule`'s doc comment in types.ts for the full rationale.
 *
 * This root entry ships zero rules and `heuristics: false` by default — this module is pure
 * machinery, with no opinions about what a "name" or "email" looks like. `standard-schema-faker/
 * faker` supplies `defaultHeuristics` and turns it on by default there.
 *
 * Every matcher form (bare key string, dot-path glob string, RegExp, predicate function)
 * compiles down to ONE evaluation path — a `(ctx: MatchContext) => boolean` predicate — so
 * there is exactly one place that decides "does this rule apply," no matter how the rule
 * author expressed it. The predicate is evaluated against a `MatchContext`, an extensible
 * object carrying the leaf key (raw and normalized), the raw and semantic (index-stripped)
 * dot-paths, the ordered ancestor chain (leaf -> root, needed for sibling/parent-aware rules
 * like the FHIR `ContactPoint` case), and the node/parent/root schemas themselves.
 */

// ---------------------------------------------------------------------------
// Key/path normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes a property key for matching: lowercases and strips common word-boundary
 * separators, so `first_name`, `firstName`, `FIRST-NAME`, and `first name` all normalize to
 * the same `"firstname"`. This is deliberately simple (no stemming/pluralization) — rules
 * are expected to account for that themselves (e.g. matching both `phone` and `phones`).
 */
export function normalizeKey(key: string): string {
  return key.replace(/[_\-\s]+/g, "").toLowerCase();
}

function isArrayIndexSegment(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/** Strips array-index segments from a raw dot-path's segments and normalizes each remaining
 * segment (same folding as `normalizeKey` — lowercased, `_`/`-`/word-boundary separators
 * stripped), producing the "semantic" path used for glob/RegExp matching:
 * `phone.0.value` -> `phone.value`; `first_name.0` -> `firstname`. Array indices carry no
 * naming signal of their own — a rule that wants to match "any element of the `phone` array"
 * should be written against the semantic path, not have to special-case numeric segments
 * itself. Per-segment normalization keeps a bare-key-style RegExp/glob (e.g. `/^createdat$/`,
 * written against the normalized convention every other matcher form uses) working uniformly
 * at any depth, not just at the root. */
export function toSemanticPath(segments: readonly string[]): string {
  return segments
    .filter((s) => !isArrayIndexSegment(s))
    .map(normalizeKey)
    .join(".");
}

/** The last path segment is the property key for an object field. Array indices (plain digit
 * segments) and the root (no segments) have no meaningful "key" to match against. */
function keyFromSegments(segments: readonly string[]): string {
  const last = segments[segments.length - 1];
  return last === undefined || isArrayIndexSegment(last) ? "" : last;
}

// ---------------------------------------------------------------------------
// MatchContext construction
// ---------------------------------------------------------------------------

/** One ancestor frame, as tracked while the walker descends — used to build `MatchContext.ancestors`. */
export interface AncestorFrame {
  /** The raw path segment this ancestor was reached through: a property key for an object step, or the numeric index (e.g. `"0"`) for an array-index step — see `MatchContext.ancestors`'s worked example in types.ts. Never meaningfully present for the root itself (there is no frame for it). */
  key: string;
  node: JSONSchema;
}

/**
 * Builds the `MatchContext` for the node currently being visited. `ancestors` is supplied
 * leaf-to-root by the walker (it already tracks a node stack for `$ref`/depth-cap purposes);
 * this function only derives the key/path fields and assembles the final shape rule authors
 * see. Exported so the walker (which owns path/ancestor bookkeeping) can call it without
 * heuristics.ts needing to know how the walker tracks its stack.
 */
export function buildMatchContext(params: {
  path: string;
  node: JSONSchema;
  parent: JSONSchema | undefined;
  ancestors: readonly AncestorFrame[];
  root: JSONSchema;
  /** Values already generated for earlier (declaration-order) properties of the immediate parent object. `{}` at the root or for a non-object parent (e.g. an array). See `MatchContext.siblings`'s doc comment for the ordering guarantee. */
  siblings: Readonly<Record<string, unknown>>;
}): MatchContext {
  const segments = params.path === "" ? [] : params.path.split(".");
  const rawKey = keyFromSegments(segments);
  return {
    key: normalizeKey(rawKey),
    rawKey,
    path: params.path,
    semanticPath: toSemanticPath(segments),
    segments,
    node: params.node,
    parent: params.parent,
    ancestors: params.ancestors.map((a) => ({ key: a.key, node: a.node })),
    siblings: params.siblings,
    root: params.root,
  };
}

/**
 * Convenience helper for rule authors: the NORMALIZED (see `normalizeKey`) keys of
 * `ctx.ancestors`, nearest first, with array-index steps skipped entirely (a numeric segment
 * has no name of its own — see `AncestorFrame.key`'s doc comment). This is what makes a rule
 * like "the `value` field of a `phone: [{ value, type }]` array — no `system` discriminator
 * sibling, just an ancestor named `phone`" easy to write, without every rule author
 * reimplementing the same index-filtering: `ancestorKeys(ctx)[0] === 'phone'` (or, more
 * robustly against extra nesting, `ancestorKeys(ctx).some(k => /^phones?$/.test(k))`).
 *
 * @example
 * ```ts
 * // `{ phone: [{ value: '...', type: '...' }] }` -- matches "value" whose nearest NAMED
 * // ancestor (skipping the array-index step) is "phone"/"phones".
 * match: (ctx) => ctx.key === 'value' && /^phones?$/.test(ancestorKeys(ctx)[0] ?? ''),
 * ```
 */
export function ancestorKeys(ctx: Pick<MatchContext, "ancestors">): string[] {
  return ctx.ancestors.filter((a) => !isArrayIndexSegment(a.key)).map((a) => normalizeKey(a.key));
}

// ---------------------------------------------------------------------------
// Matcher compilation — sugar forms all reduce to one predicate shape
// ---------------------------------------------------------------------------

type CompiledMatcher = (ctx: MatchContext) => boolean;

/**
 * Normalizes every non-wildcard segment of a dot-path glob pattern (same folding as
 * `normalizeKey`), leaving `*`/`**` segments untouched — see `compileMatcher`'s glob branch for
 * why this is required: `ctx.semanticPath`'s own segments are normalized, so the pattern must
 * be normalized the same way or a pattern like `'**.phoneNumber.value'` never matches.
 */
function normalizeGlobPattern(pattern: string): string {
  return splitPath(pattern)
    .map((segment) => (segment === WILDCARD_ONE || segment === WILDCARD_ANY ? segment : normalizeKey(segment)))
    .join(".");
}

/**
 * Compiles any `HeuristicMatcher` sugar form into the one canonical predicate shape:
 *
 *   - A string with no `.`/`*` is a bare key: matches when the NORMALIZED leaf key equals the
 *     (also-normalized) pattern.
 *   - A string containing `.` or `*` is a dot-path glob, matched against `ctx.semanticPath`
 *     using the SAME glob engine `overrides` uses (see glob.ts) — one evaluation path, not a
 *     second parallel implementation. `**.phone.value` therefore matches any depth of nesting
 *     ending in a `phone` object's `value` property, array indices already stripped.
 *   - A `RegExp` is tested against `ctx.semanticPath` (anchor it yourself, e.g.
 *     `/(^|\.)phone\.value$/`, to avoid accidental substring matches).
 *   - A function receives the full `ctx` for maximum power (sibling/ancestor-aware rules).
 */
function compileMatcher(matcher: HeuristicMatcher): CompiledMatcher {
  if (typeof matcher === "function") return matcher;

  if (matcher instanceof RegExp) {
    return (ctx) => {
      // Reset lastIndex defensively in case a caller passed a `g`/`y`-flagged RegExp and reused it.
      matcher.lastIndex = 0;
      return matcher.test(ctx.semanticPath);
    };
  }

  // String matcher: bare key (no `.` or `*`) vs. dot-path glob.
  if (isLiteralPattern(matcher) && !matcher.includes(".")) {
    const normalized = normalizeKey(matcher);
    return (ctx) => ctx.key === normalized;
  }

  // `ctx.semanticPath`'s own segments are NORMALIZED (see `toSemanticPath` — folded through
  // `normalizeKey`, same as the bare-key form above), so the glob PATTERN's literal segments
  // must be normalized the same way or a pattern like `'**.phoneNumber.value'` would never
  // match a `phoneNumber` property (`ctx.semanticPath` contains the normalized `"phonenumber"`,
  // and `"phoneNumber" !== "phonenumber"` under exact per-segment comparison). Normalized at
  // COMPILE time (once, not per-match) — wildcard segments (`*`/`**`) are passed through
  // unchanged, since they're not literal text to normalize.
  const normalizedPattern = normalizeGlobPattern(matcher);
  return (ctx) => matchGlob(normalizedPattern, ctx.semanticPath);
}

// ---------------------------------------------------------------------------
// `when` compatibility gate + constraint guard
// ---------------------------------------------------------------------------

function nodeType(node: JSONSchema): string | undefined {
  const t = node.type;
  return typeof t === "string" ? t : Array.isArray(t) ? (t[0] as string | undefined) : undefined;
}

/** Constraint guard: a heuristic value must respect the node's own bounds, or it's discarded
 * (treated as a decline) — never truncated/clamped/coerced into range. Container-node rules
 * (object/array) are checked structurally instead — see `withinStructuralFit`. */
function withinBounds(value: unknown, node: JSONSchema): boolean {
  if (typeof value === "string") {
    if (typeof node.minLength === "number" && value.length < node.minLength) return false;
    if (typeof node.maxLength === "number" && value.length > node.maxLength) return false;
    return true;
  }
  if (typeof value === "number") {
    if (typeof node.minimum === "number" && value < node.minimum) return false;
    if (typeof node.maximum === "number" && value > node.maximum) return false;
    if (typeof node.exclusiveMinimum === "number" && value <= node.exclusiveMinimum) return false;
    if (typeof node.exclusiveMaximum === "number" && value >= node.exclusiveMaximum) return false;
    return true;
  }
  return true;
}

function typeRoughlyMatches(value: unknown, node: JSONSchema): boolean {
  const type = nodeType(node);
  if (!type) return true; // no declared type on this property -> anything fits
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

/**
 * Structural fit-check for a container-node rule (`when: {type: 'object'}` generating a whole
 * correlated value, e.g. `{system: 'phone', value: '...', use: 'mobile'}` for a FHIR
 * `ContactPoint`): the produced value must be a plain object, must include every property the
 * schema declares `required`, and each present property's value must satisfy that property's
 * own basic type (checked shallowly — this is a sanity fit-check, not a full recursive
 * validator; `strict: true` remains the tool for full validation). A mismatch is a decline,
 * exactly like a leaf constraint-guard failure.
 */
function withinStructuralFit(value: unknown, node: JSONSchema): boolean {
  const type = nodeType(node);
  if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>;
    const required = (node.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in obj)) return false;
    }
    const properties = (node.properties as Record<string, JSONSchema> | undefined) ?? {};
    for (const [key, propValue] of Object.entries(obj)) {
      const propSchema = properties[key];
      if (!propSchema) continue;
      if (!typeRoughlyMatches(propValue, propSchema)) return false;
    }
    return true;
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  return withinBounds(value, node);
}

interface CompiledRule {
  name: string;
  matches: CompiledMatcher;
  whenType?: "string" | "number" | "integer" | "object" | "array" | undefined;
  whenFormats?: readonly string[] | undefined;
  generate: HeuristicRule["generate"];
}

function compileRule(rule: HeuristicRule): CompiledRule {
  return {
    name: rule.name,
    matches: compileMatcher(rule.match),
    whenType: rule.when?.type,
    whenFormats: rule.when?.formats,
    generate: rule.generate,
  };
}

function ruleTypeGateApplies(rule: CompiledRule, node: JSONSchema): boolean {
  if (rule.whenType) {
    if (rule.whenType !== nodeType(node)) return false;
  }
  const format = typeof node.format === "string" ? node.format : undefined;
  if (rule.whenFormats) {
    if (!format || !rule.whenFormats.includes(format)) return false;
  } else if (format && rule.whenType !== "object" && rule.whenType !== "array") {
    // No `formats` allow-list declared on the rule -> only match a format-less node, so a rule
    // aimed at plain strings doesn't accidentally hijack e.g. an explicit email format
    // (format-specific generation already handles those; a rule can opt into a format via
    // `when.formats` if it wants to override it deliberately). Object/array-typed container
    // rules have no `format` keyword to speak of, so this gate is a no-op for them.
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public compiled-resolver surface
// ---------------------------------------------------------------------------

export interface CompiledHeuristics {
  /**
   * Attempts to resolve a value for the node at `ctx`. Returns `{ hit: false }` if no rule
   * matched, or every matching rule declined / produced a value that fails the constraint
   * guard (leaf) or structural fit-check (container) — callers fall through to
   * `format` > `pattern` > plain generation in that case.
   */
  resolve(ctx: MatchContext & { backend: BackendInstance }): { hit: true; value: unknown } | { hit: false };
}

/** Compiles a `FakerConfig.heuristics` value (array, function shorthand, or `false`) into the resolver the walker calls. Returns `undefined` for `false`/absent (heuristics disabled). */
export function compileHeuristics(heuristics: readonly HeuristicRule[] | HeuristicFn | false | undefined): CompiledHeuristics | undefined {
  if (!heuristics) return undefined;

  const rules: readonly HeuristicRule[] =
    typeof heuristics === "function"
      ? [
          {
            name: "custom",
            match: () => true,
            generate: (ctx) => (heuristics as HeuristicFn)(ctx),
          },
        ]
      : heuristics;

  const compiled = rules.map(compileRule);

  return {
    resolve(ctx) {
      // `enum`/`const` nodes have a fixed, already-meaningful value space — a heuristic
      // shouldn't override that (constraint guard: "no enum/const on node"). Applies to leaf
      // nodes only — a container (object/array) node legitimately has neither keyword.
      if ("const" in ctx.node || Array.isArray(ctx.node.enum)) return { hit: false };

      for (const rule of compiled) {
        if (!ruleTypeGateApplies(rule, ctx.node)) continue;
        if (!rule.matches(ctx)) continue;

        const value = rule.generate(ctx);
        if (value === undefined) continue; // decline -> try the next rule

        const fits =
          rule.whenType === "object" || rule.whenType === "array" ? withinStructuralFit(value, ctx.node) : withinBounds(value, ctx.node);
        if (!fits) continue; // constraint-guard / structural-fit failure -> also a decline

        return { hit: true, value };
      }
      return { hit: false };
    },
  };
}
