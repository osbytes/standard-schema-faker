import { matchSegments, splitPath, WILDCARD_ANY, WILDCARD_ONE } from "./glob.js";
import type { BackendInstance, MatchContext, OverrideMatcher, Overrides } from "./types.js";

/**
 * The overrides glob engine — the escape hatch for business rules and correlated fields. Two
 * matcher kinds are accepted, per `Overrides`:
 *
 *   - A `Record<string, OverrideMatcher>` keyed by dot-path globs. Array indices are plain
 *     numeric path segments (e.g. `tags.0.email`), matching how the walker builds paths.
 *     `*` matches exactly one path segment; `**` matches zero or more segments. Each thunk
 *     receives the SAME `MatchContext & { backend }` a `HeuristicRule.generate` does — see
 *     `OverrideMatcher`'s doc comment in types.ts for why (the same ctx-object design the
 *     heuristics engine uses: one extensible object instead of positional args that can't grow
 *     without a breaking change, and access to `ancestors`/`parent`/`siblings` for correlated
 *     overrides).
 *   - A single `OverrideMatcher` predicate function — called directly with the same ctx shape;
 *     returning `undefined` means "no override, generate normally."
 *
 * DECLINE SEMANTICS: a thunk returning `undefined` DECLINES — the engine tries the
 * next-most-specific matching candidate (by the same specificity ranking below), and so on,
 * falling through to `{hit: false}` (normal generation: heuristics > format > pattern > plain)
 * only once every matching candidate has declined. The predicate-function form declining
 * behaves identically — normal generation takes over. `undefined` from a thunk is never treated
 * as the literal generated value.
 *
 * Specificity / tie-break: when multiple glob keys in a `Record` match the same path, the MOST
 * SPECIFIC one is tried FIRST, ranked as:
 *
 *   1. An exact literal match (no `*`/`**` at all) beats every glob.
 *   2. Among globs, fewer wildcard segments beats more (a pattern with one `*` beats one with
 *      two). `**` is considered "less specific" than `*` at the same position, since `**` can
 *      absorb an arbitrary number of segments.
 *   3. Remaining ties break on longer pattern (more literal segments) beats shorter, then on
 *      first-declared-key order in the `Record` (stable, so config authors can rely on
 *      insertion order as a final tie-break if they want one).
 *
 * A predicate-function matcher is checked AFTER the `Record` glob keys (if both are somehow
 * combined — in practice `Overrides` is a union, so a config uses one or the other, never
 * both, but the resolution order is documented here for completeness).
 */

interface CompiledPattern {
  key: string;
  segments: string[];
  thunk: OverrideMatcher;
  /** Lower is more specific. Used to rank multiple matching patterns. */
  specificityRank: [isExact: number, wildcardCount: number, negatedSegmentCount: number, insertionIndex: number];
}

export interface CompiledOverrides {
  match(ctx: MatchContext & { backend: BackendInstance }): { hit: true; value: unknown } | { hit: false };
}

function patternMatches(segments: string[], pathSegments: string[]): boolean {
  return matchSegments(segments, pathSegments);
}

function compilePattern(key: string, thunk: OverrideMatcher, insertionIndex: number): CompiledPattern {
  const segments = splitPath(key);
  const isExact = segments.every((s) => s !== WILDCARD_ONE && s !== WILDCARD_ANY) ? 0 : 1;
  const wildcardCount = segments.filter((s) => s === WILDCARD_ONE || s === WILDCARD_ANY).length;
  // `**` is strictly less specific than `*` — weight it heavier so it loses ties against
  // patterns using only `*` with the same total wildcard count.
  const anyCount = segments.filter((s) => s === WILDCARD_ANY).length;
  return {
    key,
    segments,
    thunk,
    specificityRank: [isExact, wildcardCount, anyCount, insertionIndex],
  };
}

function compareSpecificity(a: CompiledPattern, b: CompiledPattern): number {
  const [aExact, aWild, aAny, aIdx] = a.specificityRank;
  const [bExact, bWild, bAny, bIdx] = b.specificityRank;
  if (aExact !== bExact) return aExact - bExact;
  if (aWild !== bWild) return aWild - bWild;
  if (aAny !== bAny) return aAny - bAny;
  // Same specificity — first-declared wins (stable tie-break the config author can rely on).
  return aIdx - bIdx;
}

/** Compiles a `FakerConfig.overrides` value into a fast path-matcher, once per `createFaker()` call. */
export function compileOverrides(overrides: Overrides | undefined): CompiledOverrides | undefined {
  if (!overrides) return undefined;

  if (typeof overrides === "function") {
    const predicate = overrides;
    return {
      match(ctx) {
        const value = predicate(ctx);
        return value === undefined ? { hit: false } : { hit: true, value };
      },
    };
  }

  const patterns = Object.entries(overrides).map(([key, thunk], i) => compilePattern(key, thunk, i));

  return {
    match(ctx) {
      const pathSegments = splitPath(ctx.path);
      const candidates = patterns.filter((p) => patternMatches(p.segments, pathSegments));
      if (candidates.length === 0) return { hit: false };
      candidates.sort(compareSpecificity);

      // Try candidates most-specific-first; a thunk returning `undefined` DECLINES (falls
      // through to the next-most-specific matching candidate), same as everywhere else in
      // this library — never becomes the generated value.
      for (const candidate of candidates) {
        const value = candidate.thunk(ctx);
        if (value !== undefined) return { hit: true, value };
      }
      return { hit: false };
    },
  };
}
