/**
 * Small, dependency-free seeded PRNG (mulberry32) plus a helper to derive
 * child seeds deterministically (used for e.g. `strict` retries, and internally
 * to fan out sub-streams without correlating them).
 *
 * Not cryptographically secure — this is for deterministic fake-data generation only.
 */

/** Normalizes an arbitrary number into a 32-bit unsigned integer seed. */
export function normalizeSeed(seed: number): number {
  // Fold the seed into 32 bits deterministically, tolerating negatives/floats/huge values.
  let h = 0x811c9dc5 ^ Math.floor(seed);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: a fast, small, decent-quality 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = normalizeSeed(seed);
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a new deterministic seed from a base seed + a string/number discriminator. */
export function deriveSeed(baseSeed: number, discriminator: string | number): number {
  const str = String(discriminator);
  let h = normalizeSeed(baseSeed);
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 2654435761);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** A random (time+entropy based) seed, used when the caller doesn't pass one. */
export function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
