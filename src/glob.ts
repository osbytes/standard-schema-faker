/**
 * Shared dot-path glob matcher: `*` matches exactly one path segment, `**` matches zero or
 * more segments. Used by both `overrides.ts` (matching the raw dot-path, array indices
 * included as plain numeric segments) and `heuristics.ts` (matching the semantic path, with
 * array indices stripped) — ONE evaluation path for glob semantics, no second glob engine to
 * keep in sync with this one.
 */

const WILDCARD_ONE = "*";
const WILDCARD_ANY = "**";

/** Splits a dot-path into segments. The root path is `""` -> `[]`. */
export function splitPath(path: string): string[] {
  return path === "" ? [] : path.split(".");
}

/** Does `pattern` (a dot-path glob, `*`/`**`) match `path` (a plain dot-path)? */
export function matchGlob(pattern: string, path: string): boolean {
  return matchSegments(splitPath(pattern), splitPath(path));
}

export function matchSegments(pattern: string[], path: string[]): boolean {
  return matchFrom(pattern, 0, path, 0);
}

function matchFrom(pattern: string[], pIdx: number, path: string[], sIdx: number): boolean {
  if (pIdx === pattern.length) return sIdx === path.length;

  const segment = pattern[pIdx];

  if (segment === WILDCARD_ANY) {
    // `**` matches zero or more path segments — try every possible consumption length,
    // shortest first (doesn't affect correctness, just typical-case speed).
    for (let consume = 0; sIdx + consume <= path.length; consume++) {
      if (matchFrom(pattern, pIdx + 1, path, sIdx + consume)) return true;
    }
    return false;
  }

  if (sIdx >= path.length) return false;

  if (segment === WILDCARD_ONE) {
    return matchFrom(pattern, pIdx + 1, path, sIdx + 1);
  }

  return segment === path[sIdx] && matchFrom(pattern, pIdx + 1, path, sIdx + 1);
}

/** `true` if `pattern` contains no glob wildcards at all (a plain literal dot-path). */
export function isLiteralPattern(pattern: string): boolean {
  return !pattern.includes(WILDCARD_ONE);
}

export { WILDCARD_ANY, WILDCARD_ONE };
