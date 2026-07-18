import { base, en, Faker } from "@faker-js/faker";
import type { BackendInstance, GeneratorBackend, StringHint } from "../index.js";
import { generateFromPattern, parsePattern, UnsupportedPatternError } from "../index.js";

/**
 * standard-schema-faker/faker
 *
 * A `GeneratorBackend` implementation backed by `@faker-js/faker`, producing realistic,
 * format-aware values (real-looking emails, UUIDs, URLs, dates, IPs, hostnames) instead of
 * the root entry's zero-dependency "plausible-but-dumb" default backend. Also the
 * batteries-included entry point: `fake`/`fakeMany`/`createFaker` here are preconfigured with
 * `fakerBackend` + `defaultHeuristics` (see the bottom of this file), unlike the root entry's
 * bare walker + default backend + heuristics-off.
 *
 * `@faker-js/faker` is a peerDependency of the whole package (optional — see package.json's
 * `peerDependenciesMeta`), never a hard dependency of the root `.` entry — a tiny core with
 * pluggable realism: importing only from `standard-schema-faker` (root) never requires
 * `@faker-js/faker` to be installed at all.
 */

const MIN_LOREM_WORD_LENGTH = 3; // faker's shortest generated lorem words are ~3 chars

/** How many times to re-roll a `pattern`-generated string before giving up on also satisfying `minLength`/`maxLength` — see the `pattern` branch of `string()` below (mirrors core's default-backend.ts). */
const PATTERN_LENGTH_RETRY_BUDGET = 10;

/** Does `value` satisfy `hint`'s `minLength`/`maxLength` (whichever are present)? Absent bounds are trivially satisfied. */
function withinLengthBounds(value: string, hint: StringHint): boolean {
  if (typeof hint.minLength === "number" && value.length < hint.minLength) return false;
  if (typeof hint.maxLength === "number" && value.length > hint.maxLength) return false;
  return true;
}

/**
 * Fixed reference point every relative-date `faker.date.*` call in this package is anchored
 * to, instead of each call's own default (`faker.defaultRefDate()`, which is `Date.now()` at
 * CALL time). Same literal value as the root entry's `DEFAULT_REFERENCE_DATE`
 * (src/default-backend.ts) — this subpath imports the root entry only for its public surface
 * (types, `generateFromPattern`/`parsePattern`), not an internal constant with no reason to be
 * exported, so the value is duplicated here; keep both in sync if this ever changes.
 *
 * `faker.date.anytime()`/`.past()`/`.recent()`/`.soon()`/`.birthdate()` all default their
 * `refDate` option to the CURRENT wall-clock time when omitted (an upstream faker issue,
 * faker-js/faker#1870, and an open zod-mock feature request, "Generate all Dates in a stable
 * way," for the identical gap). That means the exact same seed would produce a DIFFERENT date
 * depending on what day/hour the process happened to run, violating this library's core
 * promise ("same seed -> identical output").
 *
 * Resolved via `faker.setDefaultRefDate(...)` (`create()`, below) — faker's own dedicated knob
 * for exactly this — set once per `.create(seed, options)` call to `options?.referenceDate ??
 * REFERENCE_DATE`. Every relative-date method (`anytime()`/`.past()`/`.recent()`/`.soon()`/
 * `.birthdate()`) then inherits it automatically with NO per-call `refDate` argument needed —
 * `date.birthdate({mode: 'age', ...})` (which has its own `min`/`max` age-range options
 * alongside `refDate`) also inherits `setDefaultRefDate` correctly, so it needs no
 * special-casing either. This is a deliberate design choice, not an accident: dates are
 * generated relative to a FIXED point in time by default, never "now" — `referenceDate` is the
 * documented, explicit opt-in for now-relative data (see `FakerConfig.referenceDate` and
 * README's "Design notes"). Changing this constant (or passing a different `referenceDate`) is
 * a semver-major-equivalent change for anyone whose snapshot tests pin exact `fakerBackend` date
 * output (already documented as only stable within one `@faker-js/faker` version — see README's
 * "Determinism tiers").
 */
export const REFERENCE_DATE = new Date("2025-01-01T00:00:00.000Z");

/** Earliest bound for `fakeAnytime()`'s range — arbitrary but stable; any fixed early date works, this one just reads clearly as "long enough ago to look plausible." */
const ANYTIME_EARLIEST = new Date("2000-01-01T00:00:00.000Z");

/**
 * Deterministic replacement for `faker.date.anytime()`: that method's own default `refDate` is
 * `Date.now()`, so two calls with the identical seed on two different days produce different
 * dates (see `REFERENCE_DATE`'s doc comment). `between()` takes explicit, non-defaulted bounds
 * — anchoring the upper end to `referenceDate` (the instance's configured reference date, via
 * `faker.defaultRefDate()`, already set by `setDefaultRefDate` in `create()`) makes this call,
 * and everything derived from it (the `date-time`/`date`/`time` string formats, and the no-args
 * case of `BackendInstance.date()`), fully stable across processes and days, not just within
 * one run — while still honoring a caller-supplied `referenceDate`.
 */
function fakeAnytime(faker: Faker): Date {
  const referenceDate = faker.defaultRefDate();
  const earliest = new Date(Math.min(ANYTIME_EARLIEST.getTime(), referenceDate.getTime()));
  return faker.date.between({ from: earliest, to: referenceDate });
}

function clampToLength(value: string, minLength: number | undefined, maxLength: number | undefined): string {
  let result = value;
  if (maxLength !== undefined && result.length > maxLength) {
    result = result.slice(0, maxLength);
  }
  if (minLength !== undefined && result.length < minLength) {
    result = result.padEnd(minLength, "x");
  }
  return result;
}

function fakeLoremString(faker: Faker, hint: StringHint): string {
  // Same rule as core's default-backend.ts: the 8-char default floor must not exceed an
  // explicit, smaller maxLength (e.g. hint = {maxLength: 2} must yield <=2 chars).
  const minLength = hint.minLength ?? (hint.maxLength !== undefined ? Math.min(8, hint.maxLength) : 8);
  const maxLength = Math.max(minLength, hint.maxLength ?? Math.max(minLength, 16));

  // Build up from whole words (more realistic than random character soup) until we're at
  // least `minLength` long, then clamp down to `maxLength`. Guard against an unreachable
  // minLength (e.g. minLength: 1000) looping forever by capping word-append attempts.
  let out = faker.lorem.word();
  let attempts = 0;
  while (out.length < minLength && attempts < 200) {
    out += ` ${faker.lorem.word()}`;
    attempts += 1;
  }
  if (out.length < minLength) {
    // Extremely small vocabulary edge case (shouldn't happen with real faker data) — pad.
    out = out.padEnd(minLength, "x");
  }
  return clampToLength(out, minLength, maxLength);
}

/**
 * JSON Schema `duration` format (ISO 8601 duration, e.g. "P1Y2M3DT4H5M6S"). No dedicated
 * `@faker-js/faker` helper exists for this; built directly from `faker.number.int`, mirroring
 * core's default-backend.ts generator (always includes a nonzero seconds component so the
 * duration is never all-zero/empty, which Zod's own duration format rejects).
 */
function fakeDuration(faker: Faker): string {
  const years = faker.number.int({ min: 0, max: 4 });
  const months = faker.number.int({ min: 0, max: 11 });
  const days = faker.number.int({ min: 0, max: 27 });
  const hours = faker.number.int({ min: 0, max: 23 });
  const minutes = faker.number.int({ min: 0, max: 59 });
  const seconds = faker.number.int({ min: 1, max: 59 });
  let out = "P";
  if (years > 0) out += `${years}Y`;
  if (months > 0) out += `${months}M`;
  if (days > 0) out += `${days}D`;
  out += `T${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}${seconds}S`;
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** JSON Schema `base64` format (via `contentEncoding: "base64"`). Built from whole 4-char
 * groups (3 decoded bytes each) so the result is always exactly a multiple of 4 characters
 * with no padding needed — trivially valid base64. */
function fakeBase64(faker: Faker): string {
  const groupCount = faker.number.int({ min: 1, max: 4 });
  return faker.string.fromCharacters(BASE64_ALPHABET, groupCount * 4);
}

/**
 * A `BackendInstance` with the underlying seeded `Faker` instance attached, so
 * `defaultHeuristics`' rules (and any custom heuristic rule that wants to) can call real
 * faker methods (`faker.person.firstName()`, `faker.location.city()`, etc.) directly and
 * deterministically — the same seeded instance every other `BackendInstance` method uses,
 * never a fresh/unseeded `Faker`. This is additive (an extra own property beyond the
 * `BackendInstance` contract), so `fakerBackend`'s return value remains a fully compatible
 * `BackendInstance` for any code that only knows about the base interface.
 */
export interface FakerBackendInstance extends BackendInstance {
  readonly faker: Faker;
}

/**
 * `GeneratorBackend` backed by `@faker-js/faker`. Seeded deterministically from the seed
 * passed to `.create(seed)` — a fresh `Faker` instance per call, no mutable shared seed, so
 * two generators never perturb each other's streams.
 *
 * `StringHint.format` drives realistic values:
 *   email -> faker.internet.email(), uuid -> faker.string.uuid(), uri/url/uri-reference/
 *   iri/iri-reference -> faker.internet.url(), date-time/date/time -> faker.date.*,
 *   duration/base64 -> hand-rolled (no dedicated faker helper), jwt -> faker.internet.jwt(),
 *   ipv4/ipv6 -> faker.internet.ipv4/6(), hostname -> faker.internet.domainName().
 *   Unformatted strings fall back to faker.lorem-based words, clamped to minLength/maxLength.
 *
 * A `format` always wins over length bounds. Truncating/padding a formatted value (email,
 * UUID, URL, IP, date string) to satisfy an unrelated minLength/maxLength would corrupt it
 * into an invalid value (e.g. chopping an email's TLD) — see `default-backend.ts` in core for
 * the same rule. Only the unformatted lorem-word fallback is clamped to length bounds.
 */
export const fakerBackend: GeneratorBackend = {
  create(seed: number, options?: { referenceDate?: Date }): FakerBackendInstance {
    // `base` as a fallback locale fills in data gaps `en` alone doesn't have (verified:
    // faker.internet.jwt() throws "locale data ... missing" with `en` alone) without
    // changing any existing output — `en` is still checked first for every field.
    const faker = new Faker({ locale: [en, base] });
    // Faker's seed() takes a 32-bit-ish number; normalize like core's RNG does, tolerating
    // negatives/floats, so behavior matches core's seed semantics as closely as possible.
    faker.seed(Math.abs(Math.floor(seed)) % 2 ** 31);
    // `setDefaultRefDate` is faker's own dedicated knob for "what does every relative-date
    // method (anytime/past/recent/soon/birthdate) treat as 'now' when no explicit refDate is
    // passed" — see `REFERENCE_DATE`'s doc comment above for why this matters and why it's set
    // here (once per instance) rather than threaded as an explicit `refDate` argument at each
    // call site.
    faker.setDefaultRefDate(options?.referenceDate ?? REFERENCE_DATE);

    return {
      faker,

      int(min: number, max: number): number {
        if (max < min) [min, max] = [max, min];
        return faker.number.int({ min, max });
      },

      float(min: number, max: number): number {
        if (max < min) [min, max] = [max, min];
        return faker.number.float({ min, max });
      },

      bool(): boolean {
        return faker.datatype.boolean();
      },

      pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
          throw new Error("standard-schema-faker: pick() called with an empty list");
        }
        return faker.helpers.arrayElement(items as T[]);
      },

      string(hint: StringHint): string {
        // `pattern` takes priority over `format`, mirroring core's default backend (see
        // default-backend.ts) — reuses core's bounded randexp-style generator rather than
        // duplicating the regex engine here. `rand()` is bridged from faker's own seeded PRNG
        // via `faker.number.float`, capped strictly below 1 to avoid an off-by-one out-of-
        // bounds pick in the pattern generator's array-indexing (`Math.floor(rand() * n)`).
        // JSON Schema applies `pattern` AND `minLength`/`maxLength` simultaneously -- both must
        // hold on the SAME string. Bounded re-roll (regenerate from the pattern with fresh
        // randomness) up to `PATTERN_LENGTH_RETRY_BUDGET` times until both are satisfied; if the
        // budget is exhausted, return the LAST attempt UNCHANGED -- never truncate/pad a
        // pattern-generated value into range, since that would produce a string that's "in
        // bounds" but no longer matches its own pattern. `strict: true` is the documented
        // backstop for an unsatisfiable or too-narrow pattern/length combination.
        if (hint.pattern) {
          try {
            const parsed = parsePattern(hint.pattern);
            const rand = () => faker.number.float({ min: 0, max: 0.999999999, fractionDigits: 9 });
            let candidate = generateFromPattern(parsed, rand);
            for (let attempt = 1; attempt < PATTERN_LENGTH_RETRY_BUDGET && !withinLengthBounds(candidate, hint); attempt++) {
              candidate = generateFromPattern(parsed, rand);
            }
            return candidate;
          } catch (error) {
            if (!(error instanceof UnsupportedPatternError)) throw error;
            // fall through to format/lorem below
          }
        }

        switch (hint.format) {
          case "email":
            return faker.internet.email();
          case "uuid":
            return faker.string.uuid();
          case "uri":
          case "url":
          // `iri`/`iri-reference`/`uri-reference` — see default-backend.ts's comment on the
          // same cases: no faker helper distinguishes these from a plain URL, and a plain
          // ASCII URL is a valid value for all of them.
          case "iri":
          case "iri-reference":
          case "uri-reference":
            return faker.internet.url();
          case "date-time":
            return fakeAnytime(faker).toISOString();
          case "date":
            return fakeAnytime(faker).toISOString().slice(0, 10);
          case "time":
            return fakeAnytime(faker).toISOString().slice(11, 19);
          case "duration":
            return fakeDuration(faker);
          case "base64":
            return fakeBase64(faker);
          case "jwt":
            return faker.internet.jwt();
          case "ipv4":
            return faker.internet.ipv4();
          case "ipv6":
            return faker.internet.ipv6();
          case "hostname":
            return faker.internet.domainName();
          default:
            return fakeLoremString(faker, hint);
        }
      },

      date(min?: Date, max?: Date): Date {
        if (min && max) return faker.date.between({ from: min, to: max });
        // `refDate: min`/`refDate: max` here are CALLER-supplied bounds, not `Date.now()` --
        // already deterministic, no fix needed for these two branches.
        if (min) return faker.date.soon({ refDate: min });
        if (max) return faker.date.recent({ refDate: max });
        // No bounds at all -- this is the `faker.date.anytime()`-equivalent case, which DOES
        // default to `Date.now()` if called directly (see REFERENCE_DATE's doc comment).
        return fakeAnytime(faker);
      },
    };
  },
};

export const __internals = { MIN_LOREM_WORD_LENGTH };

import { defaultHeuristics } from "./heuristics.js";

export { defaultHeuristics } from "./heuristics.js";

/**
 * Batteries-included entry point. Wires `fakerBackend` as the DEFAULT backend for THIS
 * subpath's `fake`/`fakeMany`/`createFaker` — the root `standard-schema-faker` entry's own
 * default stays the zero-dependency, plausible-but-dumb generator; the root entry never gains
 * a dependency on `@faker-js/faker`, only this subpath does (as a peerDependency of the whole
 * package — see package.json).
 *
 * Also defaults `heuristics` to `defaultHeuristics` (realistic values for name/email/phone/
 * avatar/address/... -shaped fields, keyed off property names — see heuristics.ts and README's
 * "Realistic fields (heuristics)" section) — but ONLY when the active backend is actually
 * `fakerBackend` (the default, or explicitly supplied). The root entry's own default stays
 * `heuristics: false` — it ships zero rules and never guesses. Root-entry-only users must opt in
 * explicitly (`createFaker({ heuristics: defaultHeuristics })` from `standard-schema-faker/faker`)
 * to get this behavior.
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
 * Creates a configured faker instance, defaulting to `fakerBackend` + `defaultHeuristics`
 * (unlike the root entry's `createFaker`, which defaults to the dumb backend and
 * `heuristics: false`).
 *
 * Generic over `P` (the `io` projection), same as the root entry's `createFaker` — inferred from
 * `config.io`'s literal type, e.g. `createFaker({io: 'input'})` infers `P = 'input'`.
 */
export function createFaker<P extends Projection = "output">(config: FakerConfig<P> = {}): SchemaFaker<P> {
  // Explicit `?? fallback` (not a naive spread) for `backend`, so an explicit `backend:
  // undefined` in `config` still resolves to this subpath's default (`fakerBackend`), not
  // silently falling through to the root entry's dumb default — this subpath's whole point is
  // defaulting to realistic, semantically-aware output.
  const backend = config.backend ?? fakerBackend;

  // Defaulting `heuristics` to `defaultHeuristics` must NOT happen when the caller supplied a
  // CUSTOM, non-`fakerBackend` backend — `defaultHeuristics`' rules call
  // `FakerBackendInstance.faker.*` methods that don't exist on an arbitrary custom
  // `BackendInstance` (e.g. the root entry's own `defaultBackend`), so the first heuristic hit
  // would throw. `defaultHeuristics` only makes sense paired with `fakerBackend` specifically —
  // so it's only the default when the backend IN EFFECT (after resolving `config.backend ??
  // fakerBackend` above) actually IS `fakerBackend`. An explicit `config.heuristics` (including
  // `false`) always wins regardless of backend — the caller opted in/out explicitly, so respect
  // that unconditionally.
  const heuristicsDefault = backend === fakerBackend ? defaultHeuristics : false;

  return createCoreFaker({
    ...config,
    backend,
    heuristics: config.heuristics ?? heuristicsDefault,
  });
}

const defaultFaker = createFaker();

/** Generate one realistic fake value (via `fakerBackend`) conforming to `schema` — typed as `schema`'s inferred OUTPUT type. */
export function fake<S extends AnySchema>(schema: S, opts?: FakeOptions): Projected<S, "output"> {
  return defaultFaker.fake(schema, opts);
}

/** Generate `n` realistic fake values from one seeded, deterministic stream — each typed as `schema`'s inferred OUTPUT type. */
export function fakeMany<S extends AnySchema>(schema: S, n: number, opts?: FakeOptions): Array<Projected<S, "output">> {
  return defaultFaker.fakeMany(schema, n, opts);
}
