import { fakeBase64String, fakeDurationString } from "./internal/rand-string-generators.js";
import { generateFromPattern, matchesPattern, parsePattern, UnsupportedPatternError } from "./pattern.js";
import { mulberry32 } from "./rng.js";
import type { BackendInstance, GeneratorBackend, StringHint } from "./types.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** How many times to re-roll a `pattern`-generated string before giving up on also satisfying `minLength`/`maxLength` — see the `pattern` branch of `string()` below. */
const PATTERN_LENGTH_RETRY_BUDGET = 10;

/** Does `value` satisfy `hint`'s `minLength`/`maxLength` (whichever are present)? Used to decide whether a `pattern`-generated string needs a re-roll — see the `pattern` branch of `string()` below. Absent bounds are trivially satisfied (nothing to check). */
function withinLengthBounds(value: string, hint: StringHint): boolean {
  if (typeof hint.minLength === "number" && value.length < hint.minLength) return false;
  if (typeof hint.maxLength === "number" && value.length > hint.maxLength) return false;
  return true;
}

/**
 * Zero is a legitimate length: `{maxLength: 0}` (e.g. `z.string().max(0)`, an always-empty
 * string field) must produce a 0-character string. Only floor at 1 when `maxLen` itself
 * allows it (`maxLen > 0`); when the resolved maximum is 0, the only valid length is 0.
 */
function randomWord(rand: () => number, minLen: number, maxLen: number): string {
  const floor = maxLen > 0 ? 1 : 0;
  const len = Math.max(floor, Math.floor(rand() * (maxLen - minLen + 1)) + minLen);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return out;
}

function hex(rand: () => number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += Math.floor(rand() * 16).toString(16);
  }
  return out;
}

/** Deterministic (but not spec-conformant) UUID v4-shaped string. */
function fakeUuid(rand: () => number): string {
  return `${hex(rand, 8)}-${hex(rand, 4)}-4${hex(rand, 3)}-${"89ab"[Math.floor(rand() * 4)]}${hex(rand, 3)}-${hex(rand, 12)}`;
}

function fakeEmail(rand: () => number): string {
  return `${randomWord(rand, 4, 8)}@${randomWord(rand, 3, 6)}.${rand() > 0.5 ? "com" : "dev"}`;
}

function fakeUri(rand: () => number): string {
  return `https://${randomWord(rand, 3, 8)}.example.com/${randomWord(rand, 2, 6)}`;
}

function fakeIpv4(rand: () => number): string {
  return `${Math.floor(rand() * 256)}.${Math.floor(rand() * 256)}.${Math.floor(rand() * 256)}.${Math.floor(rand() * 256)}`;
}

function fakeIpv6(rand: () => number): string {
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) groups.push(hex(rand, 4));
  return groups.join(":");
}

function fakeHostname(rand: () => number): string {
  return `${randomWord(rand, 3, 8)}.example.com`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Fixed reference point every date/date-time string and no-bounds `BackendInstance.date()` call
 * in this backend is anchored to, unless `GeneratorBackend.create`'s `options.referenceDate`
 * overrides it (see `FakerConfig.referenceDate`). Same literal value as `standard-schema-faker/
 * faker`'s `REFERENCE_DATE` (src/faker/index.ts) — this root entry cannot import from the
 * `./faker` subpath (would create a dependency the "tiny core" design forbids — the root entry
 * must never require `@faker-js/faker`), so the constant is duplicated here; keep both in sync
 * if this value ever changes.
 */
export const DEFAULT_REFERENCE_DATE = new Date("2025-01-01T00:00:00.000Z");

/** Window width (in years) behind `referenceDate` for the unbounded date-string/`.date()` generation range — see `create`'s `windowStart`/`windowEnd` below. */
const DEFAULT_DATE_WINDOW_YEARS = 25;

function fakeDateString(rand: () => number, includeTime: boolean, windowStart: Date, windowEnd: Date): string {
  const t = Math.floor(rand() * (windowEnd.getTime() - windowStart.getTime() + 1)) + windowStart.getTime();
  const d = new Date(t);
  const datePart = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  if (!includeTime) return datePart;
  return `${datePart}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.000Z`;
}

/** JSON Schema `time` format: RFC 3339 partial-time, e.g. "13:45:30" or "13:45:30.123". */
function fakeTimeString(rand: () => number): string {
  const hh = Math.floor(rand() * 24);
  const mm = Math.floor(rand() * 60);
  const ss = Math.floor(rand() * 60);
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

/**
 * Base64url-encodes a plain-ASCII string with no padding, per RFC 7515 (JWS). Hand-rolled
 * (not `btoa`, which isn't in TypeScript's ES2022 lib target without pulling in `dom` — and
 * isn't guaranteed to exist in every JS runtime this zero-dependency package might run in)
 * so core stays dependency-free and portable.
 */
function base64UrlEncode(input: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < input.length; i += 3) {
    const b0 = input.charCodeAt(i) & 0xff;
    const b1 = i + 1 < input.length ? input.charCodeAt(i + 1) & 0xff : undefined;
    const b2 = i + 2 < input.length ? input.charCodeAt(i + 2) & 0xff : undefined;

    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    if (b1 !== undefined) out += alphabet[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)];
    if (b2 !== undefined) out += alphabet[b2 & 0x3f];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Deterministic (not cryptographically meaningful — the "signature" segment is not a real
 * HMAC/RSA signature) but STRUCTURALLY valid JWT: header.payload.signature, header and
 * payload each real base64url-encoded JSON (Zod's `z.jwt()` decodes and JSON-parses both
 * segments, so random base64url noise fails validation). The signature segment only needs
 * to look base64url-shaped; nothing decodes or verifies it structurally.
 */
function fakeJwtString(rand: () => number): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadObj = {
    sub: hex(rand, 8),
    iat: Math.floor(rand() * 2_000_000_000),
  };
  const payload = base64UrlEncode(JSON.stringify(payloadObj));

  const base64UrlSegment = (len: number): string => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
    return out;
  };
  const signature = base64UrlSegment(43); // matches a real HS256 signature's typical length

  return `${header}.${payload}.${signature}`;
}

/**
 * Default backend: zero dependencies, plausible-but-dumb values. Honors StringHint's
 * format/minLength/maxLength loosely — realistic *shape*, not realistic *content*.
 * `standard-schema-faker/faker` supersedes this with real faker-backed content.
 *
 * Supported JSON Schema `format` values (dedicated generators — see README's coverage table
 * for which formats are handled natively here vs. via the `pattern` fallback): email, uuid,
 * uri/url/uri-reference/iri/iri-reference, date-time, date, time, duration, base64, jwt,
 * ipv4, ipv6, hostname. Anything else falls through to a plain word (or, if the schema also
 * carries a `pattern`, bounded randexp-style generation takes priority — see pattern.ts).
 */
export const defaultBackend: GeneratorBackend = {
  create(seed: number, options?: { referenceDate?: Date }): BackendInstance {
    const rand = mulberry32(seed);
    const referenceDate = options?.referenceDate ?? DEFAULT_REFERENCE_DATE;
    // Unbounded date/date-time/`.date()` generation window: [referenceDate - 25y, referenceDate]
    // — anchored to the (possibly caller-overridden) reference date rather than a hardcoded
    // 2000-2035 window, so every generated date honors `referenceDate` uniformly and is always
    // `<= referenceDate` (never "in the future" relative to the anchor).
    const windowStart = new Date(referenceDate.getTime() - DEFAULT_DATE_WINDOW_YEARS * 365.25 * 24 * 60 * 60 * 1000);
    const windowEnd = referenceDate;

    return {
      int(min: number, max: number): number {
        if (max < min) [min, max] = [max, min];
        return Math.floor(rand() * (max - min + 1)) + min;
      },

      float(min: number, max: number): number {
        if (max < min) [min, max] = [max, min];
        return rand() * (max - min) + min;
      },

      bool(): boolean {
        return rand() < 0.5;
      },

      pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
          throw new Error("standard-schema-faker: pick() called with an empty list");
        }
        const idx = Math.floor(rand() * items.length);
        return items[Math.min(idx, items.length - 1)] as T;
      },

      string(hint: StringHint): string {
        // Defensive against an inverted hint (maxLength < the 8-char default floor, e.g. a
        // caller-supplied hint of just `{maxLength: 2}`) — clamp the default minLength down
        // to maxLength rather than silently exceeding it (see walker.ts's generateString for
        // the primary fix; this is belt-and-suspenders for any other caller of this contract).
        const min = hint.minLength ?? (hint.maxLength !== undefined ? Math.min(8, hint.maxLength) : 8);
        const max = Math.max(min, hint.maxLength ?? Math.max(min, 16));

        // When BOTH `format` (with a dedicated generator) and `pattern` are present (e.g.
        // Zod's z.uuid() emits `format: "uuid"` plus a strict validating `pattern`), try the
        // format generator FIRST and keep its value if it satisfies the pattern (native-regex
        // check, see matchesPattern in pattern.ts) and the length bounds. Rationale: the
        // dedicated generators produce far better values than randexp-style generation, and
        // generating from the pattern can be pathological — Zod's uuid pattern alternation
        // explicitly includes the nil (00000000-…) and max (ffffffff-…) UUID literals, so
        // uniform branch selection returned a degenerate constant for ~2/3 of seeds. Only
        // when the format value fails its own schema's pattern (or there is no dedicated
        // generator) does pattern generation take over; on parse failure or an unsupported
        // construct there, fall through to the format/plain-string behavior below and rely on
        // `strict` mode's validate+retry as the documented backstop.
        //
        // JSON Schema applies `pattern` AND `minLength`/`maxLength` as independent, simultaneous
        // constraints on the SAME string — both must hold (the single most-reported bug class
        // in comparable tools, e.g. json-schema-faker#74/#659/#486/#398, where the length bounds
        // are ignored whenever a pattern is present). Fixed via bounded re-roll: regenerate from
        // the pattern (fresh randomness each time — the pattern generator is not itself
        // deterministically re-triable without re-rolling) up to `PATTERN_LENGTH_RETRY_BUDGET`
        // times until a result satisfies both bounds; if the budget is exhausted, return the
        // LAST attempt UNCHANGED (never truncate/pad a pattern-generated value into range — that
        // would produce a string that looks in-bounds but no longer matches its own pattern) —
        // `strict: true` remains the documented backstop for a pattern/length combination that's
        // unsatisfiable or too narrow to hit by chance within the retry budget.
        if (hint.pattern) {
          const formatted = dedicatedFormatValue();
          if (formatted !== null && matchesPattern(hint.pattern, formatted) && withinLengthBounds(formatted, hint)) {
            return formatted;
          }
          try {
            const parsed = parsePattern(hint.pattern);
            let candidate = generateFromPattern(parsed, rand);
            for (let attempt = 1; attempt < PATTERN_LENGTH_RETRY_BUDGET && !withinLengthBounds(candidate, hint); attempt++) {
              candidate = generateFromPattern(parsed, rand);
            }
            return candidate;
          } catch (error) {
            if (!(error instanceof UnsupportedPatternError)) throw error;
            // fall through
          }
        }

        return dedicatedFormatValue() ?? randomWord(rand, min, max);

        // Hoisted function declaration so the `pattern` branch above can call it. `default:
        // null` = no dedicated generator for this format; the plain-word fallback stays with
        // the caller so the pattern branch never mistakes it for a format-backed value.
        function dedicatedFormatValue(): string | null {
          switch (hint.format) {
            case "email":
              // Never clamp/truncate a formatted value to satisfy an unrelated length bound —
              // chopping a generated email at an arbitrary character (e.g. mid-TLD) produces a
              // string that's simultaneously "in bounds" and not a valid email. Formats win over
              // length bounds; see generateString's comment in walker.ts. `fakerBackend` follows
              // the same rule.
              return fakeEmail(rand);
            case "uuid":
              return fakeUuid(rand);
            case "uri":
            case "url":
            // `iri`/`iri-reference` are the internationalized-domain-name variant of
            // uri/uri-reference (RFC 3987) — no zod helper emits them, but they're a real
            // JSON Schema format value; a plain ASCII URI is a valid IRI, so reuse the same
            // generator rather than adding a distinct (untestable-against-any-vendor) one.
            case "iri":
            case "iri-reference":
            case "uri-reference":
              return fakeUri(rand);
            case "date-time":
              return fakeDateString(rand, true, windowStart, windowEnd);
            case "date":
              return fakeDateString(rand, false, windowStart, windowEnd);
            case "time":
              return fakeTimeString(rand);
            case "duration":
              return fakeDurationString(rand);
            case "base64":
              return fakeBase64String(rand);
            case "jwt":
              return fakeJwtString(rand);
            case "ipv4":
              return fakeIpv4(rand);
            case "ipv6":
              return fakeIpv6(rand);
            case "hostname":
              return fakeHostname(rand);
            default:
              return null;
          }
        }
      },

      date(min?: Date, max?: Date): Date {
        // No explicit bounds -- anchor the unbounded window to `referenceDate` (see above)
        // instead of the old hardcoded 2000-2035 range, so `referenceDate` governs every
        // no-bounds date this instance produces uniformly.
        const minT = min?.getTime() ?? windowStart.getTime();
        const maxT = max?.getTime() ?? windowEnd.getTime();
        const t = Math.floor(rand() * (maxT - minT + 1)) + minT;
        return new Date(t);
      },
    };
  },
};
