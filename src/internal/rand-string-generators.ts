/**
 * Shared, NOT PUBLICLY EXPORTED, hand-rolled string generators for JSON Schema `format` values
 * that neither `@faker-js/faker` nor `chance` (nor core's own zero-dependency backend) has a
 * dedicated helper for: `duration` (ISO 8601) and `base64`. All three backends need the exact
 * same shape of output (a value that passes Zod's `z.iso.duration()` / `z.base64()` validation),
 * so this is extracted to one place instead of copy-pasted per backend — `default-backend.ts`
 * and `chance/index.ts` both import from here. `faker/index.ts` keeps its own pre-existing
 * separate copy (calling `faker.number.int` directly rather than a bridged `rand()`) — not
 * touched, to avoid an unrelated behavior-preserving refactor of already-shipped, tested code.
 *
 * Every function here takes a plain `rand: () => number` (a `[0, 1)` source) so it works
 * identically regardless of which backend's seeded PRNG is bridged in.
 */

/**
 * JSON Schema `duration` format: ISO 8601 duration, e.g. "P1Y2M3DT4H5M6S". Always includes a
 * nonzero seconds component so the duration is never all-zero/empty (Zod's own `duration`
 * format rejects an all-zero duration).
 */
export function fakeDurationString(rand: () => number): string {
  const years = Math.floor(rand() * 5);
  const months = Math.floor(rand() * 12);
  const days = Math.floor(rand() * 28);
  const hours = Math.floor(rand() * 24);
  const minutes = Math.floor(rand() * 60);
  const seconds = 1 + Math.floor(rand() * 59); // always >=1 so the duration is never all-zero
  let out = "P";
  if (years > 0) out += `${years}Y`;
  if (months > 0) out += `${months}M`;
  if (days > 0) out += `${days}D`;
  out += `T${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}${seconds}S`;
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** JSON Schema `base64` format (via `contentEncoding: "base64"`): valid base64, always padded to a multiple of 4 — built from whole 3-byte groups (4 base64 chars, no `=` padding needed). */
export function fakeBase64String(rand: () => number): string {
  const groupCount = 1 + Math.floor(rand() * 4);
  let out = "";
  for (let g = 0; g < groupCount; g++) {
    for (let i = 0; i < 4; i++) {
      out += BASE64_ALPHABET[Math.floor(rand() * BASE64_ALPHABET.length)];
    }
  }
  return out;
}
