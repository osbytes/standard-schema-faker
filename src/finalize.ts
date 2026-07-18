import { matchSegments, splitPath, WILDCARD_ANY, WILDCARD_ONE } from "./glob.js";
import type { BackendInstance, Finalizer, Finalizers, MatchContext } from "./types.js";

/**
 * The `finalize` glob engine — reuses the EXACT SAME compiled-matcher/specificity machinery
 * `overrides.ts` uses (`matchSegments`/`splitPath`/`WILDCARD_*` from glob.ts, and the same
 * specificity ranking: exact literal beats any glob, fewer wildcard segments beats more, `*`
 * beats `**` at the same count, first-declared-key order as the final tie-break) — no third
 * matcher implementation to keep in sync with the other two.
 *
 * Deliberately SIMPLER than `overrides.ts`'s resolution, though: `overrides` needs a
 * decline-and-try-the-next-most-specific-candidate chain because a Record thunk returning
 * `undefined` is genuinely ambiguous ("no override here" vs. "the value IS undefined") when
 * there's no pre-existing value to fall back on. `finalize` doesn't have that ambiguity — there
 * is always an already-generated value to fall back on, so "run ONLY the single most specific
 * matching hook, use its return value verbatim" is the whole rule; a hook is never "declined."
 */

interface CompiledFinalizePattern {
  segments: string[];
  thunk: Finalizer;
  specificityRank: [isExact: number, wildcardCount: number, negatedSegmentCount: number, insertionIndex: number];
}

export interface CompiledFinalizers {
  /**
   * Looks up the most-specific matching finalizer for `ctx`, if any, WITHOUT calling it —
   * callers (the walker) decide when to invoke it (post-order, after the node's value and all
   * its children are fully generated/finalized).
   */
  find(ctx: MatchContext): Finalizer | undefined;
}

function patternMatches(segments: string[], pathSegments: string[]): boolean {
  return matchSegments(segments, pathSegments);
}

function compilePattern(key: string, thunk: Finalizer, insertionIndex: number): CompiledFinalizePattern {
  const segments = splitPath(key);
  const isExact = segments.every((s) => s !== WILDCARD_ONE && s !== WILDCARD_ANY) ? 0 : 1;
  const wildcardCount = segments.filter((s) => s === WILDCARD_ONE || s === WILDCARD_ANY).length;
  const anyCount = segments.filter((s) => s === WILDCARD_ANY).length;
  return {
    segments,
    thunk,
    specificityRank: [isExact, wildcardCount, anyCount, insertionIndex],
  };
}

function compareSpecificity(a: CompiledFinalizePattern, b: CompiledFinalizePattern): number {
  const [aExact, aWild, aAny, aIdx] = a.specificityRank;
  const [bExact, bWild, bAny, bIdx] = b.specificityRank;
  if (aExact !== bExact) return aExact - bExact;
  if (aWild !== bWild) return aWild - bWild;
  if (aAny !== bAny) return aAny - bAny;
  return aIdx - bIdx;
}

/** Compiles a `FakerConfig.finalize` value into a fast path-matcher, once per `createFaker()` call. */
export function compileFinalizers(finalizers: Finalizers | undefined): CompiledFinalizers | undefined {
  if (!finalizers) return undefined;

  if (typeof finalizers === "function") {
    const fn = finalizers;
    return { find: () => fn };
  }

  const patterns = Object.entries(finalizers).map(([key, thunk], i) => compilePattern(key, thunk, i));

  return {
    find(ctx) {
      const pathSegments = splitPath(ctx.path);
      const candidates = patterns.filter((p) => patternMatches(p.segments, pathSegments));
      if (candidates.length === 0) return undefined;
      candidates.sort(compareSpecificity);
      return candidates[0]?.thunk;
    },
  };
}

/** Runs the matched finalizer (if any) for `ctx`, returning `value` verbatim if none matched — the walker's one call site for "apply finalize, if configured, to this node's already-generated value." */
export function applyFinalize(
  compiled: CompiledFinalizers | undefined,
  value: unknown,
  ctx: MatchContext & { backend: BackendInstance },
): unknown {
  if (!compiled) return value;
  const fn = compiled.find(ctx);
  if (!fn) return value;
  return fn(value, ctx);
}
