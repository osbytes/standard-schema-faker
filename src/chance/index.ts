import Chance from "chance";
import type { BackendInstance, GeneratorBackend, StringHint } from "../index.js";
import { generateFromPattern, parsePattern, UnsupportedPatternError } from "../index.js";
import { fakeBase64String, fakeDurationString } from "../internal/rand-string-generators.js";

/**
 * standard-schema-faker/chance
 *
 * A `GeneratorBackend` implementation backed by `chance` (chancejs.com), an alternative to
 * `standard-schema-faker/faker`'s `@faker-js/faker`-backed generator — same contract, same
 * batteries-included pattern (`fake`/`fakeMany`/`createFaker` preconfigured with `chanceBackend`
 * + `chanceHeuristics`, see the bottom of this file), different upstream library.
 *
 * `chance` is a peerDependency of the whole package (optional — see package.json's
 * `peerDependenciesMeta`), never a hard dependency of the root `.` entry — a tiny core with
 * pluggable realism: importing only from `standard-schema-faker` (root) never requires `chance`
 * to be installed at all, exactly like `standard-schema-faker/faker` and `@faker-js/faker`.
 */

/** How many times to re-roll a `pattern`-generated string before giving up on also satisfying `minLength`/`maxLength` — see the `pattern` branch of `string()` below (mirrors core's default-backend.ts and the faker adapter). */
const PATTERN_LENGTH_RETRY_BUDGET = 10;

/** Does `value` satisfy `hint`'s `minLength`/`maxLength` (whichever are present)? Absent bounds are trivially satisfied. */
function withinLengthBounds(value: string, hint: StringHint): boolean {
  if (typeof hint.minLength === "number" && value.length < hint.minLength) return false;
  if (typeof hint.maxLength === "number" && value.length > hint.maxLength) return false;
  return true;
}

/**
 * Fixed reference point every relative-date value this backend generates is anchored to,
 * instead of the real wall-clock time. Same literal value as core's `DEFAULT_REFERENCE_DATE`
 * (src/default-backend.ts) and `standard-schema-faker/faker`'s `REFERENCE_DATE`
 * (src/faker/index.ts) — this subpath imports the root entry only for its public surface, not an
 * internal constant with no reason to be exported, so the value is duplicated here; keep all
 * three in sync if this ever changes.
 *
 * Unlike `fakerBackend` (which threads this through faker's own `setDefaultRefDate` knob),
 * `chance` has no equivalent "default reference date" concept for its relative-date-ish helpers
 * — `chance.birthday()`/`chance.date()` with no bounds derive from `Date.now()` internally (see
 * `create()`'s doc comment below for why those are deliberately NOT used here). Instead, every
 * relative-date value this backend produces is derived directly from a seeded integer draw over
 * an explicit `[windowStart, windowEnd]` timestamp window — see `date()` below — so determinism
 * never depends on chance's own un-seeded "now" handling at all.
 */
export const REFERENCE_DATE = new Date("2025-01-01T00:00:00.000Z");

/** Window width (in years) behind `referenceDate` for the unbounded date-string/`.date()` generation range — mirrors core's `DEFAULT_DATE_WINDOW_YEARS` (src/default-backend.ts). */
const DEFAULT_DATE_WINDOW_YEARS = 25;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Draws a random timestamp in `[windowStart, windowEnd]` (inclusive) via `chance.integer` — the same integer-timestamp-draw approach core's `defaultBackend` uses, deliberately NOT `chance.date({min, max})` (which is a thin wrapper around the identical `this.integer({min: min.getTime(), max: max.getTime()})` call anyway — verified against chance's own source — so drawing the integer directly here keeps full, uniform control over the window without an extra layer of indirection). */
function randomDateInWindow(chance: Chance.Chance, windowStart: Date, windowEnd: Date): Date {
  const t = chance.integer({ min: windowStart.getTime(), max: windowEnd.getTime() });
  return new Date(t);
}

function fakeDateString(chance: Chance.Chance, includeTime: boolean, windowStart: Date, windowEnd: Date): string {
  const d = randomDateInWindow(chance, windowStart, windowEnd);
  const datePart = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  if (!includeTime) return datePart;
  return `${datePart}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.000Z`;
}

/** JSON Schema `time` format: RFC 3339 partial-time, e.g. "13:45:30". */
function fakeTimeString(chance: Chance.Chance): string {
  const hh = chance.integer({ min: 0, max: 23 });
  const mm = chance.integer({ min: 0, max: 59 });
  const ss = chance.integer({ min: 0, max: 59 });
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

/** JS's safe integer ceiling — same constant chance's own source uses internally for its default `integer()`/`floating()` bounds (`MAX_INT = 2^53`), duplicated here (not exported by chance) so `pickFloatingFixed` can reason about the same limit. */
const CHANCE_MAX_INT = 9007199254740992;

/**
 * `chance.floating({min, max, fixed})` throws a `RangeError` if `max` (or `min`) exceeds
 * `CHANCE_MAX_INT / 10^fixed` — verified directly against chance's own source
 * (`Chance.prototype.floating`): it draws `this.integer({min: min*fixed, max: max*fixed})`
 * internally, so a high `fixed` (needed for real decimal precision) combined with a wide
 * min/max range can overflow that inner integer draw's own safe range. Rather than a single
 * hardcoded `fixed` (the task's original "just pick fixed: 10" suggestion turns out to throw
 * for any schema whose bounds exceed ~900,719.9), this picks the LARGEST `fixed` (capped at 10)
 * that keeps `max(|min|, |max|, 1)` within `CHANCE_MAX_INT / 10^fixed` for the bounds actually
 * requested — full decimal precision for realistic bounded ranges (the overwhelmingly common
 * case), gracefully degrading precision only for the rare very-wide-range schema instead of
 * throwing.
 */
function pickFloatingFixed(min: number, max: number): number {
  const bound = Math.max(Math.abs(min), Math.abs(max), 1);
  const fixed = Math.floor(Math.log10(CHANCE_MAX_INT / bound));
  return Math.max(0, Math.min(10, fixed));
}

/**
 * A `BackendInstance` with the underlying seeded `Chance` instance attached, so
 * `chanceHeuristics`' rules (and any custom heuristic rule that wants to) can call real
 * `chance.*` methods (`chance.first()`, `chance.city()`, etc.) directly and deterministically —
 * the same seeded instance every other `BackendInstance` method uses, never a fresh/unseeded
 * `Chance`. Mirrors `FakerBackendInstance` in `standard-schema-faker/faker`. Additive (an extra
 * own property beyond the `BackendInstance` contract), so `chanceBackend`'s return value remains
 * a fully compatible `BackendInstance` for any code that only knows about the base interface.
 */
export interface ChanceBackendInstance extends BackendInstance {
  readonly chance: Chance.Chance;
  /**
   * The fixed point in time THIS call's relative-date generation is anchored to — `options
   * ?.referenceDate ?? REFERENCE_DATE` from `.create()`. Exposed (additive, beyond the base
   * `BackendInstance` contract) so a heuristic rule that needs a WIDER or narrower window than
   * `date()`'s own default `[referenceDate - 25y, referenceDate]` (e.g. `chanceHeuristics`'
   * `dates.birthDate`, which wants a 100-year window) can derive its own bounds from the same
   * anchor, rather than hardcoding `new Date()`/`Date.now()` and breaking determinism.
   */
  readonly referenceDate: Date;
}

/**
 * `GeneratorBackend` backed by `chance` (chancejs.com). `chance` is natively seed-deterministic
 * (`new Chance(seed)` seeds its internal Mersenne Twister directly — no separate "seed" call
 * needed, unlike faker's `faker.seed(n)`), so `.create(seed)` below is a thin, direct
 * construction — a fresh `Chance` instance per call, no mutable shared seed, so two generators
 * never perturb each other's streams (same "no global state" guarantee `fakerBackend` makes).
 *
 * `StringHint.format` drives realistic values:
 *   email -> chance.email(), uuid -> chance.guid({version: 4}), uri/url/uri-reference/iri/
 *   iri-reference -> chance.url(), hostname -> chance.domain(), ipv4 -> chance.ip(),
 *   ipv6 -> chance.ipv6(), date-time/date/time -> derived from a seeded integer draw over this
 *   instance's `[windowStart, windowEnd]` window (see `date()`/`fakeDateString` above),
 *   duration/base64 -> the same hand-rolled generators core's `defaultBackend` uses (shared via
 *   `internal/rand-string-generators.ts`, bridged through a `rand()` sourced from
 *   `chance.floating`), jwt -> hand-rolled (chance has no dedicated JWT helper, same gap
 *   `fakerBackend` fills by hand). Unformatted strings fall back to `chance.word()`-based text,
 *   clamped to minLength/maxLength.
 *
 * A `format` always wins over length bounds — truncating/padding a formatted value (email,
 * UUID, URL, IP, date string) to satisfy an unrelated minLength/maxLength would corrupt it into
 * an invalid value. Only the unformatted word-based fallback is clamped to length bounds.
 *
 * Deliberately does NOT use `chance.birthday()`/bare `chance.date()` (no bounds): both derive
 * their default window from `Date.now()` internally (chance has no `setDefaultRefDate`-style
 * knob the way faker does) — the exact "same seed, different day, different output" trap this
 * whole package exists to avoid (see README's "Design notes"). Every relative-date value here
 * is instead drawn from an explicit seeded integer timestamp within `[windowStart, windowEnd]`
 * (anchored to `options?.referenceDate ?? REFERENCE_DATE`), so determinism never depends on
 * chance's own "now" handling at all.
 */
export const chanceBackend: GeneratorBackend = {
  create(seed: number, options?: { referenceDate?: Date }): ChanceBackendInstance {
    // Normalize like core's RNG / fakerBackend do, tolerating negatives/floats — chance's own
    // constructor accepts any number seed directly (no separate `.seed()` call needed, unlike
    // faker), but normalizing keeps behavior consistent with how this package treats seeds
    // everywhere else.
    const normalizedSeed = Math.abs(Math.floor(seed)) % 2 ** 31;
    const chance = new Chance(normalizedSeed);

    const referenceDate = options?.referenceDate ?? REFERENCE_DATE;
    const windowStart = new Date(referenceDate.getTime() - DEFAULT_DATE_WINDOW_YEARS * 365.25 * 24 * 60 * 60 * 1000);
    const windowEnd = referenceDate;

    // Bridges chance's seeded PRNG into the plain `() => number` shape `generateFromPattern`
    // (core's shared pattern engine) and the shared duration/base64 generators expect. `fixed:
    // 9` keeps the draw strictly below 1 (matches fakerBackend's own `max: 0.999999999` bridge)
    // so `Math.floor(rand() * n)` in the pattern engine/shared generators never indexes one past
    // the end of an array.
    const rand = () => chance.floating({ min: 0, max: 0.999999999, fixed: 9 });

    return {
      chance,
      referenceDate,

      int(min: number, max: number): number {
        if (max < min) [min, max] = [max, min];
        return chance.integer({ min, max });
      },

      float(min: number, max: number): number {
        if (max < min) [min, max] = [max, min];
        if (min === max) return min;
        const fixed = pickFloatingFixed(min, max);
        return chance.floating({ min, max, fixed });
      },

      bool(): boolean {
        return chance.bool();
      },

      pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
          throw new Error("standard-schema-faker: pick() called with an empty list");
        }
        return chance.pickone(items as T[]);
      },

      string(hint: StringHint): string {
        // `pattern` takes priority over `format`, mirroring core's default backend and the
        // faker adapter (see default-backend.ts / faker/index.ts) — reuses core's bounded
        // randexp-style generator rather than duplicating the regex engine here. Bounded
        // re-roll (regenerate from the pattern with fresh randomness) up to
        // `PATTERN_LENGTH_RETRY_BUDGET` times until both the pattern AND minLength/maxLength are
        // satisfied; if the budget is exhausted, return the LAST attempt UNCHANGED — never
        // truncate/pad a pattern-generated value into range. `strict: true` is the documented
        // backstop for an unsatisfiable or too-narrow combination.
        if (hint.pattern) {
          try {
            const parsed = parsePattern(hint.pattern);
            let candidate = generateFromPattern(parsed, rand);
            for (let attempt = 1; attempt < PATTERN_LENGTH_RETRY_BUDGET && !withinLengthBounds(candidate, hint); attempt++) {
              candidate = generateFromPattern(parsed, rand);
            }
            return candidate;
          } catch (error) {
            if (!(error instanceof UnsupportedPatternError)) throw error;
            // fall through to format/word below
          }
        }

        switch (hint.format) {
          case "email":
            return chance.email();
          case "uuid":
            return chance.guid({ version: 4 });
          case "uri":
          case "url":
          // `iri`/`iri-reference`/`uri-reference` — see default-backend.ts's comment on the
          // same cases: no chance helper distinguishes these from a plain URL, and a plain
          // ASCII URL is a valid value for all of them.
          case "iri":
          case "iri-reference":
          case "uri-reference":
            return chance.url();
          case "date-time":
            return fakeDateString(chance, true, windowStart, windowEnd);
          case "date":
            return fakeDateString(chance, false, windowStart, windowEnd);
          case "time":
            return fakeTimeString(chance);
          case "duration":
            return fakeDurationString(rand);
          case "base64":
            return fakeBase64String(rand);
          case "jwt":
            return fakeJwtString(rand);
          case "ipv4":
            return chance.ip();
          case "ipv6":
            return chance.ipv6();
          case "hostname":
            return chance.domain();
          default:
            return fakeWordString(chance, hint);
        }
      },

      date(min?: Date, max?: Date): Date {
        if (min && max) return randomDateInWindow(chance, min, max);
        if (min) return randomDateInWindow(chance, min, windowEnd);
        if (max) return randomDateInWindow(chance, windowStart, max);
        return randomDateInWindow(chance, windowStart, windowEnd);
      },
    };
  },
};

/**
 * Deterministic, structurally-valid-but-not-cryptographically-meaningful JWT: header.payload.
 * signature, header and payload each real base64url-encoded JSON — mirrors `fakerBackend`'s own
 * hand-rolled `fakeJwtString` (chance has no dedicated JWT helper either).
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

function fakeJwtString(rand: () => number): string {
  const hex = (len: number): string => {
    let out = "";
    for (let i = 0; i < len; i++) out += Math.floor(rand() * 16).toString(16);
    return out;
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({ sub: hex(8), iat: Math.floor(rand() * 2_000_000_000) }));
  const base64UrlSegment = (len: number): string => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let out = "";
    for (let i = 0; i < len; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
    return out;
  };
  const signature = base64UrlSegment(43); // matches a real HS256 signature's typical length
  return `${header}.${payload}.${signature}`;
}

/** Unformatted string fallback: builds up whole `chance.word()`s (more realistic than random character soup) until at least `minLength`, then clamps to `maxLength` — same shape as `fakerBackend`'s `fakeLoremString`. */
function fakeWordString(chance: Chance.Chance, hint: StringHint): string {
  const minLength = hint.minLength ?? (hint.maxLength !== undefined ? Math.min(8, hint.maxLength) : 8);
  const maxLength = Math.max(minLength, hint.maxLength ?? Math.max(minLength, 16));

  let out = chance.word();
  let attempts = 0;
  while (out.length < minLength && attempts < 200) {
    out += ` ${chance.word()}`;
    attempts += 1;
  }
  if (out.length < minLength) {
    out = out.padEnd(minLength, "x");
  }
  if (out.length > maxLength) {
    out = out.slice(0, maxLength);
  }
  return out;
}

import { chanceHeuristics } from "./heuristics.js";

export { chanceHeuristics } from "./heuristics.js";

/**
 * Batteries-included entry point. Wires `chanceBackend` as the DEFAULT backend for THIS
 * subpath's `fake`/`fakeMany`/`createFaker` — the root `standard-schema-faker` entry's own
 * default stays the zero-dependency, plausible-but-dumb generator; the root entry never gains a
 * dependency on `chance`, only this subpath does (as a peerDependency of the whole package —
 * see package.json).
 *
 * Also defaults `heuristics` to `chanceHeuristics` — but ONLY when the active backend is
 * actually `chanceBackend` (the default, or explicitly supplied), same guard
 * `standard-schema-faker/faker`'s `createFaker` applies for `fakerBackend`/`defaultHeuristics`:
 * `chanceHeuristics`' rules call `ChanceBackendInstance.chance.*` methods that don't exist on an
 * arbitrary custom `BackendInstance`. An explicit `config.heuristics` (including `false`) always
 * wins regardless of backend.
 *
 * `backend`/`heuristics` are still fully overridable via `createFaker({ backend, heuristics })`,
 * including back to `defaultBackend`/`false` (re-exported below) if you want the dumb generator
 * or to disable heuristics without a separate import.
 */

import type { AnySchema, FakeOptions, FakerConfig, Projected, Projection, SchemaFaker } from "../index.js";
import { createFaker as createCoreFaker } from "../index.js";

export type {
  AnySchema,
  BackendInstance,
  CompiledFinalizers,
  CompiledHeuristics,
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
} from "../index.js";
export {
  AsyncValidateError,
  ancestorKeys,
  compileFinalizers,
  compileHeuristics,
  defaultBackend,
  deriveSeed,
  generateFromSchema,
  JsonSchemaConversionError,
  mulberry32,
  normalizeKey,
  normalizeSeed,
  prepare,
  randomSeed,
  SchemaFakerError,
  StrictModeError,
  toJsonSchemaSync,
  UniqueItemsError,
  UnresolvableRefError,
} from "../index.js";

/**
 * Creates a configured chance-backed faker instance, defaulting to `chanceBackend` +
 * `chanceHeuristics` (unlike the root entry's `createFaker`, which defaults to the dumb backend
 * and `heuristics: false`).
 *
 * Generic over `P` (the `io` projection), same as the root entry's `createFaker` — inferred from
 * `config.io`'s literal type, e.g. `createFaker({io: 'input'})` infers `P = 'input'`.
 */
export function createFaker<P extends Projection = "output">(config: FakerConfig<P> = {}): SchemaFaker<P> {
  // Explicit `?? fallback` (not a naive spread) for `backend`, so an explicit `backend:
  // undefined` in `config` still resolves to this subpath's default (`chanceBackend`), not
  // silently falling through to the root entry's dumb default.
  const backend = config.backend ?? chanceBackend;

  // Defaulting `heuristics` to `chanceHeuristics` must NOT happen when the caller supplied a
  // CUSTOM, non-`chanceBackend` backend — see this file's header comment above `createFaker` for
  // why. An explicit `config.heuristics` (including `false`) always wins regardless of backend.
  const heuristicsDefault = backend === chanceBackend ? chanceHeuristics : false;

  return createCoreFaker({
    ...config,
    backend,
    heuristics: config.heuristics ?? heuristicsDefault,
  });
}

const defaultFaker = createFaker();

/** Generate one realistic fake value (via `chanceBackend`) conforming to `schema` — typed as `schema`'s inferred OUTPUT type. */
export function fake<S extends AnySchema>(schema: S, opts?: FakeOptions): Projected<S, "output"> {
  return defaultFaker.fake(schema, opts);
}

/** Generate `n` realistic fake values from one seeded, deterministic stream — each typed as `schema`'s inferred OUTPUT type. */
export function fakeMany<S extends AnySchema>(schema: S, n: number, opts?: FakeOptions): Array<Projected<S, "output">> {
  return defaultFaker.fakeMany(schema, n, opts);
}
