# standard-schema-faker

> Fake data for **any** [Standard Schema](https://standardschema.dev) validator — Zod, Valibot, ArkType, and friends. Seeded, typed, zero config.

<a href="https://www.osbytes.io" target="_blank" title="osbytes — open source bytes">
  <img
    src="https://www.osbytes.io/badge.svg"
    alt="osbytes — open source bytes"
    width="32"
    height="32"
  />
</a>

[![npm version](https://img.shields.io/npm/v/standard-schema-faker.svg)](https://www.npmjs.com/package/standard-schema-faker)
[![CI](https://github.com/osbytes/standard-schema-faker/actions/workflows/ci.yml/badge.svg)](https://github.com/osbytes/standard-schema-faker/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/standard-schema-faker.svg)](./LICENSE)

One package, three entry points:

```ts
// root entry: zero-dependency, structurally-valid-but-meaningless values, no realism opinions
import { fake, fakeMany } from 'standard-schema-faker'

// batteries-included: same API, realistic values via @faker-js/faker + defaultHeuristics
import { fake, fakeMany } from 'standard-schema-faker/faker'

// alternative batteries-included: same API, realistic values via chance + chanceHeuristics
import { fake, fakeMany } from 'standard-schema-faker/chance'
```

```ts
import { fake, fakeMany } from 'standard-schema-faker/faker'
import { z } from 'zod'

const User = z.object({
  id: z.uuid(),
  email: z.email(),
  age: z.int().min(18).max(99),
  tags: z.array(z.string()).max(3),
})

const user = fake(User)                        // one fake user -- typed as z.infer<typeof User>, not `unknown`
const same = fake(User, { seed: 42 })          // reproducible — same seed, same value
const many = fakeMany(User, 100, { seed: 42 }) // deterministic batch, typed as (typeof User's inferred type)[]

user.email    // string -- TypeScript knows this, no cast/assertion needed
user.tags     // string[]
```

Works with any library implementing the Standard Schema + [Standard JSON Schema](https://standardschema.dev/json-schema) specs — no per-library adapters needed.

## Why

- **Typed** — `fake(schema)` returns the schema's own INFERRED type (`StandardSchemaV1.InferOutput<S>` under the hood), not `unknown`. This is the point of building on Standard Schema's type surface, not just its runtime `validate()`.
- **Universal** — one API for Zod v4, Valibot, ArkType, and (best-effort) Effect Schema. Zod has mockers; the rest have none. This covers them all.
- **Seeded** — every value flows through a seeded RNG. Same seed → identical output, across processes and days (dates are generated relative to a fixed reference point, not `Date.now()`, by default — configurable via `referenceDate`, see "Design notes"). Built for snapshot tests and fixtures.
- **Input vs output aware** — generate what a client would *send* (`io: 'input'`) or what validation *yields* — defaults and transforms applied (`io: 'output'`).
- **Tiny root entry, pluggable realism** — the root `standard-schema-faker` entry has no faker dependency and ships a minimal deterministic generator (zero runtime deps beyond the Standard Schema/JSON Schema spec plumbing). The `standard-schema-faker/faker` subpath wires up a `@faker-js/faker`-backed backend (realistic emails, UUIDs, URLs, dates, IPs) plus `defaultHeuristics` as its default; `standard-schema-faker/chance` is the same idea backed by [`chance`](https://chancejs.com) instead, with its own `chanceHeuristics` default (a similar but not identical ruleset — see "Realistic fields (heuristics)" below for what it covers) — use the root entry directly if you want the zero-dependency generator instead.

## Install

```sh
npm install -D standard-schema-faker
```

`@faker-js/faker` and `chance` are both optional **peer dependencies** — only needed if you use the corresponding batteries-included subpath (`standard-schema-faker/faker` or `standard-schema-faker/chance`). The root `standard-schema-faker` entry never requires either. If you want realistic values via faker:

```sh
npm i -D standard-schema-faker @faker-js/faker
```

...or via chance:

```sh
npm i -D standard-schema-faker chance
```

## Supported validators

| Library | Status | JSON Schema surface | Notes |
|---|---|---|---|
| Zod v4 | ✅ green in CI | native `~standard.jsonSchema`, sync | works out of the box |
| ArkType 2.1+ | ✅ green in CI | native `~standard.jsonSchema`, sync | works out of the box |
| Valibot 1.4+ | ✅ green in CI | fallback (`@standard-community/standard-json`, wraps `@valibot/to-json-schema`); async on cold start | call `await prepare(schema)` once per vendor before using `fake()`/`fakeMany()` — see below. **Use `v.lazy()` for recursive schemas**, not a getter on an object literal (a getter-based recursive schema crashes the fallback converter with a stack overflow) |
| Effect Schema 3.22 | 🚧 best-effort, green in CI | fallback, async on cold start; targets draft-07 | same `prepare()` requirement as Valibot. Recursive schemas (`Schema.suspend`) need every recursive member schema annotated with `.annotations({ identifier: '...' })`, or the converter throws `Missing annotation` |
| Anything else emitting Standard JSON Schema | ✅ automatically | native or fallback | that's the point |

Only Zod v4 and ArkType have a synchronous native `~standard.jsonSchema` surface today — the
spec permits either input/output projection method to be synchronous, and both do this.
Valibot and Effect Schema don't yet implement the native surface, so this library falls back
to `@standard-community/standard-json`, which is async on its first use per vendor (it
dynamically imports the vendor-specific converter). `fake()`/`fakeMany()` themselves are
**always synchronous** — call `await prepare(schema)` once (e.g. at startup, or in a test
`beforeAll`) to warm the fallback converter for that vendor; every `fake()` call afterwards,
for any schema from that vendor, stays synchronous. `prepare()` is a safe no-op for vendors
with a native surface (Zod v4, ArkType).

```ts
import { prepare, fake } from 'standard-schema-faker'
import * as v from 'valibot'

const User = v.object({ id: v.string() })
await prepare(User)       // one-time async warm-up (per vendor, per process)
const user = fake(User)   // sync from here on, for any Valibot schema
```

## Supported JSON Schema features

| Node | Handling |
|---|---|
| `string` | length bounds (default 8–16 when unbounded); `format` (email/uuid/uri/date-time/date/ipv4/ipv6/hostname, plus any name registered via `formats`, which shadows a built-in of the same name); `pattern` — bounded randexp-style generation (literals, char classes with ranges/negation, `\d \w \s`, quantifiers `+ * ? {n} {n,m}` capped at 10 reps when unbounded, alternation, groups), re-rolled (bounded, fresh randomness each attempt) up to 10 times if `minLength`/`maxLength` are also present until BOTH constraints hold, never truncated/padded; unsupported regex constructs (lookaround, named groups) fall back to a plain string, with `strict` retry as the backstop |
| `number`/`integer` | min/max/exclusive/multipleOf; defaults 0–100 when unbounded |
| `boolean` | coin flip |
| `enum`/`const` | pick / literal |
| `object` | required always; optional included by probability; schema-form `additionalProperties` (`z.record(K, V)`) generates 1–3 synthesized entries honoring `propertyNames`'s pattern/format/enum (an enum key set generates exactly those keys, not a random subset); bare `additionalProperties: true`/absent still off by default |
| `array` | minItems/maxItems (default 1–3); tuple (`prefixItems`, and draft-07's array-valued `items`); `uniqueItems` — re-roll on collision, shrink if `minItems` already satisfied, clear error if structurally impossible |
| `anyOf`/`oneOf` | pick branch (seeded) |
| `allOf` | shallow merge then generate (see Limitations for the JSON-Schema-composition edge case this can't fully solve) |
| `$ref`/recursive | resolves `$defs` and root self-refs; `maxDepth` cap (default 5) terminates via an optional/empty branch |
| `nullable`/null | probability of null when allowed (`anyOf` null branch, or OpenAPI-style `nullable: true`) — honored uniformly at every node (array items, the root schema itself, not just object properties) |
| `default` | in `output` projection, prefers the declared default with seeded probability (`defaultProbability`, default 0.5) |
| `examples` | when present, picks from examples with seeded probability (`examplesProbability`, default 0.5) |

Out of scope: `not`, `if/then/else`, `patternProperties`, `dependentSchemas`. `Map`/`Set`
(`z.map()`/`z.set()`) have no JSON Schema equivalent at all — JSON itself has no map/set
primitive — and throw a clear `JsonSchemaConversionError` naming the construct; model as an
array or a `z.record()` instead, or supply the field via `overrides`. `overrides` covers the
gap for anything else these can't express.

**Vendor note on closed-key-set records**: the open-ended dictionary form of schema-form
`additionalProperties` (no `propertyNames.enum`) works identically across Zod, Valibot, and
ArkType. The CLOSED-key-set variant (`z.record(z.enum([...]), V)`, which generates exactly
those keys — see the table row above) is Zod-specific: Valibot's equivalent
(`v.record(v.picklist([...]), V)`) is accepted at construction time but its JSON Schema
conversion throws, and ArkType rejects a literal-key-union `Record` at schema-construction time
itself, steering you toward a plain object with named properties instead (which this library
already generates normally, via `properties`, not the `additionalProperties` path). Neither is
a gap in this library — "a record with a closed key set" isn't the same concept across these
vendors' own schema-authoring surfaces.

## Benchmark

standard-schema-faker vs `@anatine/zod-mock` on a representative "user" schema — see
[BENCH.md](./BENCH.md) for the full methodology, numbers, and an honest discussion of what
they mean (including where we lose). Short version: the zero-dependency `defaultBackend` is
about 2x zod-mock's throughput; the realistic `fakerBackend` is about 0.71–0.74x zod-mock's
throughput on zod-only schemas — the cost of walking a generic JSON Schema document to stay
vendor-universal, versus a Zod-only tool walking Zod's own internal schema tree directly.

## Advanced

```ts
import { createFaker } from 'standard-schema-faker/faker'
// `fakerBackend` is already the default backend for this subpath — only import it
// explicitly if you want to pass it to a different createFaker() config, or import
// createFaker from the root `standard-schema-faker` entry instead (whose default is
// the zero-dependency generator, with heuristics off).

const gen = createFaker({
  io: 'output',                                   // 'input' | 'output' -- matches Zod v4's own z.toJSONSchema(schema, {io}) option name
  strict: true,                                    // validate each value, retry on failure
  overrides: { '**.email': (ctx) => 'me@test.dev' }, // dot-path globs; ctx is the same MatchContext heuristics get
  // heuristics: defaultHeuristics is already the default in this package -- pass `heuristics:
  // false` here to disable it, or your own ruleset/array/function to override it (see below).
  optionalProbability: 0.9,                       // number (global) or (ctx) => number (per optional property) -- default 0.5
  finalize: { '**.email': (value, ctx) => value }, // post-generation amend hooks -- see "Ensuring fields exist (finalize)" below
  referenceDate: new Date(),                      // anchor for every relative-date value this call generates -- default: a fixed constant, see "Design notes"
  formats: { semver: ({ backend }) => `${backend.int(0, 20)}.${backend.int(0, 20)}.${backend.int(0, 20)}` }, // custom `format` generators -- jsf.format() analog, see below
  defaultProbability: 0.5,                        // probability of emitting a node's declared `default` (output projection only) -- default 0.5
  examplesProbability: 0.5,                       // probability of sampling from a node's `examples` -- default 0.5
  maxDepth: 5,                                     // recursion cap
})

const user = gen.fake(User, { seed: 1 }) // typed per `io` -- gen.fake's return type follows io: 'input' | 'output'
```

- `strict: true` runs the schema's own `validate()` on each value; on failure, retries up to
  5 times with a seed deterministically re-derived from the original seed, then throws a
  `StrictModeError` (carrying `issues`/`attempts`/`seed` as real fields — see "Error classes"
  below) listing the validator's issues. Catches refinements/transforms JSON Schema can't
  express (e.g. a Zod `.refine()`). Requires the schema's `validate()` to resolve
  synchronously — a schema with an async refinement throws an `AsyncValidateError`
  immediately rather than silently making `fake()` async.
- `overrides` is the escape hatch for business rules and correlated fields — dot-path glob
  keys (`*` matches exactly one path segment, `**` matches any number of segments), or a
  single predicate function checked directly. Both forms receive the SAME `MatchContext &
  {backend}` a heuristic rule's `generate` does — `ctx.path`/`ctx.node`, plus `ctx.parent`/
  `ctx.ancestors`/`ctx.siblings` for correlated overrides (e.g. reading an already-generated
  sibling's value). Returning `undefined` **declines** — the engine tries the next-most-specific
  matching pattern, then falls through to normal generation if every match declines (same
  decline semantics as heuristics, throughout this library). Array indices are plain numeric
  path segments (e.g. `contacts.0.email`). When multiple glob keys match the same path, the
  most specific one is tried first: an exact path beats any glob, and among globs, fewer/
  more-precise wildcards beat `**`.
- `heuristics` picks realistic values for semantically-recognizable fields (`email`, `phone`,
  `firstName`, FHIR-style `ContactPoint` shapes, ...) — see "Realistic fields (heuristics)"
  below for the full matcher/context API, the default ruleset, and extend/remove/disable
  recipes. Beats `format`/`pattern`/plain generation but loses to `overrides`.
- `io: 'input' | 'output'` picks which JSON Schema projection to generate from — `input` is
  what a client would send (pre-validation; optional/defaulted fields may be absent), `output`
  is the post-validation shape (defaults applied, transforms' result type). Requires the
  vendor to support the requested projection — e.g. Effect Schema's fallback conversion can't
  distinguish `input` from `output` at all, so `io: 'input'` throws a `JsonSchemaConversionError`
  for it. `createFaker`'s return type is generic over `io` — `createFaker({io: 'input'})`'s
  `.fake()`/`.fakeMany()` are typed to return each schema's INFERRED INPUT type, not `unknown`.
- `optionalProbability` controls how often an OPTIONAL (non-required) object property is
  included at all — default `0.5` (the historical 50/50 coin flip). A plain `number` (`0`..`1`)
  applies globally; a `(ctx: MatchContext) => number` function is evaluated PER OPTIONAL
  PROPERTY, receiving that property's own `MatchContext` (`ctx.path`/`ctx.key`/`ctx.parent`/
  etc.), so you can vary inclusion by field — e.g. force one normally-optional array to always
  be present while leaving everything else at the default rate:
  `optionalProbability: (ctx) => (ctx.path === 'identifier' ? 1 : 0.5)`. Exactly one seeded
  draw happens per optional property regardless of configuration, so the generated stream's
  shape/length never depends on this setting.
- `finalize` runs hooks AFTER a node's value is fully generated (post-order), letting you amend
  the value — the tool for "ensure X exists in the output" semantics. See "Ensuring fields
  exist (finalize)" below for the full API and the FHIR MRN example.
- `referenceDate` is the fixed point in time every relative-date value this call generates is
  anchored to — `date-time`/`date`/`time` string formats, `BackendInstance.date()` with no
  explicit bounds, and (with `defaultHeuristics`) the `createdAt`/`updatedAt`/`deletedAt`/
  `birthDate` rules. Defaults to a fixed constant (`2025-01-01T00:00:00.000Z`), NOT `new
  Date()`/`Date.now()`, so the same seed produces the same date-shaped output across
  runs/machines/days. Passing `referenceDate: new Date()` is a deliberate, explicit OPT-IN to
  now-relative data (e.g. "an order placed sometime in the last 30 days") at the cost of losing
  that cross-run stability for the call — every generated date is still guaranteed
  `<= referenceDate`. See "Design notes" below.
- `formats` registers custom `format`-name generators — the `jsf.format()` analog from
  `json-schema-faker`. When a string node's `format` matches a registered key, that generator
  runs INSTEAD OF the backend's built-in handling for that format name; every unregistered
  format name (including ones with no built-in at all) is completely unaffected. This slots in
  exactly at the existing `format` tier of the priority ladder: `overrides` > `heuristics` >
  registered `formats` > backend built-in `format` > `pattern` > plain generation — so it beats
  a backend's built-in (registering `'email'` shadows `fakerBackend`'s/`defaultBackend`'s own
  email generator) but still loses to `overrides`/`heuristics`. Each generator receives the same
  `MatchContext & {backend}` a heuristic rule/override does and must return a `string`, drawing
  all randomness from `ctx.backend` for determinism.
- `defaultProbability` / `examplesProbability` control how often a node's `default`/`examples`
  keyword is actually used, replacing what used to be two bare 50/50 coin flips — both default
  to `0.5` (unchanged behavior). `0` disables the behavior entirely (never emit the default /
  never sample from examples); `1` always applies it whenever the keyword is present. Exactly
  ONE seeded `backend.float(0, 1)` draw happens per `default`/`examples`-bearing node regardless
  of configuration — same stream-shape stability guarantee `optionalProbability` established.

### Coming from `json-schema-faker`?

If you're used to `json-schema-faker`'s options, here's the rough mapping onto this library's
config (names differ because these are independent designs converging on similar ideas, not a
compatibility shim — semantics aren't always identical, so check each option's own docs above):

| `json-schema-faker` | `standard-schema-faker` | Notes |
|---|---|---|
| `optionalsProbability` / `alwaysFakeOptionals` | `optionalProbability` | `json-schema-faker`'s `optionalsProbability` is a global 0..1 rate; ours additionally accepts a `(ctx) => number` function evaluated per optional property (see "Advanced" above). |
| `useDefaultValue` | `defaultProbability` | `json-schema-faker`'s is a boolean on/off; ours is a 0..1 probability (`0`/`1` recover the boolean behavior), only applied in the `output` projection. |
| `useExamplesValue` | `examplesProbability` | Same boolean-vs-probability distinction as `defaultProbability` above. |
| `jsf.format(name, fn)` | `formats: { name: (ctx) => string }` | `json-schema-faker`'s `format()` is a global, mutable registration on a shared module instance; ours is per-`createFaker()`-call config, keeping the "no global mutable state" determinism guarantee this library makes throughout (see "Design notes"). Also slots into the SAME priority ladder position (shadows a built-in `format` handler only for registered names) rather than being the only mechanism for format handling. |

Not mapped: `json-schema-faker` has no direct equivalent of this library's `overrides` (ctx-aware
dot-path/predicate business-rule escape hatch), `heuristics` (opt-in realistic-field matching),
`finalize` (post-generation amend hooks), Standard Schema's `io: 'input'|'output'` projection, or
typed inference of the schema's own inferred type — see the rest of this README for those.

### Error classes

Every error this library throws is a `SchemaFakerError` subclass (never a bare `Error`), so you
can `instanceof`-narrow instead of string-matching `error.message`:

| Class | Thrown when | Extra fields |
|---|---|---|
| `StrictModeError` | `strict: true` exhausted its retry budget | `issues`, `attempts`, `seed` |
| `AsyncValidateError` | `strict: true` + a schema whose `validate()` resolves asynchronously | `vendor` |
| `JsonSchemaConversionError` | no JSON Schema surface for a vendor, or `io: 'input'` unsupported by its fallback conversion | `vendor` |
| `UniqueItemsError` | `uniqueItems: true` array whose item schema's value space is too small for `minItems` distinct values | — |
| `UnresolvableRefError` | a `$ref` the walker couldn't resolve against the root document | `ref` |
| `UnsupportedPatternError` | a `pattern` regex construct outside the supported subset (falls back to plain-string generation automatically — this is informational, not usually something you catch) | — |

All extend the base `SchemaFakerError` — `catch (e) { if (e instanceof SchemaFakerError) ... }`
catches any of them at once. Available from the root `standard-schema-faker` entry and both the
`standard-schema-faker/faker` and `standard-schema-faker/chance` subpaths.

### Determinism tiers

The `defaultBackend` (from the root `standard-schema-faker` entry) is stable across this
package's own releases — only a semver-major bump changes its seeded output sequences. `fakerBackend`'s
seeded output is only stable within a given `@faker-js/faker` version (faker majors have
historically changed seeded sequences) — pin `@faker-js/faker` in your own `package.json` if
snapshot tests depend on exact `fakerBackend` output surviving a `faker` upgrade. `chanceBackend`
(from `standard-schema-faker/chance`) has the identical caveat with respect to `chance` instead —
its seeded output is only stable within a given `chance` version, so pin `chance` in your own
`package.json` if snapshot tests depend on exact `chanceBackend` output surviving a `chance`
upgrade. This is stability ACROSS VERSIONS; stability across processes/days is separate and always
holds — see "Design notes" below for why dates specifically are anchored to a fixed reference
point rather than the real clock.

## Realistic fields (heuristics)

`standard-schema-faker/faker` (the batteries-included subpath) turns on **heuristics** by
default: a property named `email` gets a real-looking email, `firstName` a real first name,
`createdAt` an ISO timestamp, and so on, instead of a structurally-valid-but-meaningless string.
The root `standard-schema-faker` entry ships **zero** rules and defaults to `heuristics: false`
— it stays fully spec-driven with no guessing; only the `/faker` subpath opts in by default (you
can still pass `defaultHeuristics` to the root entry's own `createFaker` explicitly).

`standard-schema-faker/chance` is the same idea, backed by [`chance`](https://chancejs.com)
instead of `@faker-js/faker`, with its own `chanceHeuristics` ruleset turned on by default. It
mirrors `defaultHeuristics`' structure, rule ordering, and FHIR `ContactPoint` correlation tiers
exactly (see below) — but `chance` doesn't have a generator for everything faker does, so
`chanceHeuristics` **omits** those rules entirely rather than faking them badly. Compared to
`defaultHeuristics` (faker), `chanceHeuristics` does **not** include: `person.jobTitle`'s
faker-style seniority-worded titles (uses `chance.profession()` instead — included, just a
different flavor), `commerce.productName`/`commerce.price`/`commerce.sku` (chance has no
product-catalog namespace at all), `finance.iban`/`finance.bic`/`finance.accountNumber` (no
dedicated, documented chance generator), `company.department`/`company.industry`, `internet.
userAgent`, `media.mimeType`/`media.fileName`, and `ids.slug`. Everything else — person names/
gender/bio, email/phone/ContactPoint correlation, username/password/url/avatar/ip, address
fields, company name, credit card/currency, uuid/createdAt/updatedAt/deletedAt/birthDate, and
color — has a `chanceHeuristics` equivalent. See `src/chance/heuristics.ts`'s header comment for
the exact list, cross-referenced against `defaultHeuristics`' own rule names.

```ts
import { createFaker } from 'standard-schema-faker/faker'

const gen = createFaker({}) // heuristics: defaultHeuristics is already the default here
const user = gen.fake(User, { seed: 1 })
// { firstName: 'Josefina', email: 'Josefina.Kunde@yahoo.com', createdAt: '2025-03-11T…', ... }
```

Priority ladder (highest first): **`overrides` > heuristics > `format` > `pattern` > plain
generation**. A rule returning `undefined` from `generate` **declines** — falls through to the
next matching rule, then the next tier. A rule's value that violates the node's own
`minLength`/`maxLength`/`minimum`/`maximum` (or, for a container rule, is missing a required
key / has a property of the wrong basic type) is treated exactly like a decline — never
truncated or coerced into range.

### The `MatchContext` object

Every rule's `match` and `generate` see the same `MatchContext` — a single, extensible object
(not positional arguments) so new fields can be added later without another breaking change:

| Field | Type | What it is |
|---|---|---|
| `key` | `string` | Normalized leaf key: `first_name`/`firstName`/`FIRST-NAME` → `"firstname"`. `""` at the root or on an array-index node. |
| `rawKey` | `string` | The leaf key exactly as authored (no normalization). |
| `path` | `string` | Raw dot-path; array indices as plain numeric segments, e.g. `"phone.0.value"`. |
| `semanticPath` | `string` | `path` with array indices stripped and each segment normalized, e.g. `"phone.value"` — what glob/RegExp matchers are tested against. |
| `segments` | `string[]` | `path` split on `.`. |
| `node` | `JSONSchema` | The JSON Schema node being generated. |
| `parent` | `JSONSchema \| undefined` | The immediately containing node's **schema**. `undefined` at the root. |
| `ancestors` | `Array<{key, node}>` | Ancestor chain, nearest first, one frame per container above the current node — array-index steps included as their own frame (see below). |
| `siblings` | `Record<string, unknown>` | The **values already generated** for earlier (declaration-order) properties of the immediate parent object — see the ordering guarantee below. |
| `root` | `JSONSchema` | The whole JSON Schema document. |
| `backend` | `BackendInstance` | (in `generate` only) the call's seeded backend — draw all randomness from here for determinism. |

`ancestorKeys(ctx)` (exported from both the root `standard-schema-faker` entry and the
`standard-schema-faker/faker` subpath) is a convenience helper: the **normalized** keys of
`ctx.ancestors`, nearest first, with array-index steps skipped — `ancestorKeys(ctx)[0]` is the
nearest *named* ancestor.

**Ordering guarantee** (rule authors may rely on this): an object's properties are generated in
two tiers, not raw declaration order — (1) `enum`/`const` properties (typically discriminators
like `system`/`type`/`status`), in their own declaration order, then (2) every other property,
in declaration order. `siblings` is built up incrementally across both tiers, so a rule sees
every property declared before it **or hoisted ahead of it as a discriminator**, and never one
declared after. This means a discriminator-dependent rule works whether the schema author wrote
the discriminator before or after the field that depends on it. Determinism is unaffected — the
reorder is a pure function of the schema shape, so the same schema + seed always produces the
same output.

### Matcher forms

`HeuristicRule.match` accepts four forms, all compiling to the **same** evaluation path
internally (one glob engine, shared with `overrides`; no second implementation to keep in
sync):

| Form | Matches against | Example |
|---|---|---|
| Bare key `string` (no `.`/`*`) | Normalized `ctx.key` | `match: 'firstName'` — also fires on `first_name`, `FIRST-NAME` |
| Dot-path glob `string` (`.`/`*`) | `ctx.semanticPath`, via the same `*`/`**` engine `overrides` uses | `match: '**.phone.value'` — fires on `phone.0.value`, `contacts.2.phone.value`, any depth |
| `RegExp` | `ctx.semanticPath` — anchor it yourself | `match: /(^|\.)phone\.value$/` |
| `(ctx: MatchContext) => boolean` | Full context — the **primary form** for context-dependent semantics a glob/RegExp can't express (sibling values, ancestor names, schema shape) | `match: (ctx) => ctx.key === 'value' && typeof ctx.siblings.system === 'string'` |

Function matchers are the right tool whenever the signal isn't in the path shape alone —
reach for a bare-key/glob/RegExp for simple cases, but don't contort one to express a
correlation it structurally cannot see (a glob/RegExp only sees `semanticPath`; only a function
matcher can read `ctx.parent`/`ctx.ancestors`/`ctx.siblings`).

### The FHIR `ContactPoint` example

FHIR's [`ContactPoint`](https://build.fhir.org/datatypes.html#ContactPoint)
(`{ system: 'phone'|'email'|..., value: '...', use: '...' }`) is the motivating case for
context-aware matching: a property literally named `value` is semantically empty on its own —
the signal is in the schema's shape *and* the actual generated sibling value. `system` is also
a **heavily reused** FHIR field name (`Coding.system`, `Identifier.system` are unrelated
URI-valued fields, not contact-kind enums) — reliable ContactPoint detection needs BOTH the
`system`-enum content check AND an ancestor-name gate (`telecom`/`contact(s)`/`contactPoint(s)`).
`defaultHeuristics` ships this as three complementary tiers, strongest signal first (simplified
below for readability — see `src/faker/heuristics.ts` for the exact rules):

```ts
// 1. Sibling-VALUE-aware (defaultHeuristics, simplified) — reads the ACTUAL generated
//    `system`, not just its possible enum values, so `value` is genuinely correlated:
{
  name: 'contact.telecom.value (sibling-VALUE-aware, leaf)',
  match: (ctx) =>
    ctx.key === 'value' &&
    nearestAncestorLooksLikeContactPointContainer(ctx) && // telecom/contact(s)/contactPoint(s)
    typeof ctx.siblings.system === 'string',
  when: { type: 'string' },
  generate: ({ backend, siblings }) => {
    switch ((siblings.system as string).toLowerCase()) {
      case 'email': return faker(backend).internet.email()
      case 'url': return faker(backend).internet.url()
      case 'phone': case 'fax': case 'pager': case 'sms':
        return faker(backend).phone.number()
      default: return undefined // decline -- unrecognized `system`
    }
  },
}

// 2. Container-node rule — generates the WHOLE object in one shot (useful when you want to
//    correlate properties that aren't ordering-hoisted, or want full control at once):
{
  name: 'contact.telecom (container, fully correlated)',
  match: (ctx) =>
    nearestAncestorLooksLikeContactPointContainer(ctx) &&
    Array.isArray(ctx.node.properties?.system?.enum), // node itself declares a `system` enum
  when: { type: 'object' }, // checked at the object node, BEFORE its properties are generated
  generate: ({ backend }) => ({ system: 'email', value: faker(backend).internet.email() }),
  // engine checks structural fit (required keys present, each property's basic type matches)
  // and declines on a mismatch -- same as any other decline.
}

// 3. Ancestor-NAME-only (no discriminator sibling at all) — e.g. `phone: [{ value, type }]`:
{
  name: 'contact.phone.value (ancestor-name, no discriminator)',
  match: (ctx) =>
    ctx.key === 'value' &&
    typeof ctx.siblings.system !== 'string' && // yield to tier 1 if a discriminator IS present
    /^(phones?|mobiles?|faxes?)$/.test(ancestorKeys(ctx)[0] ?? ''),
  when: { type: 'string' },
  generate: ({ backend }) => faker(backend).phone.number(),
}
```

First match wins across the whole `defaultHeuristics` array, ordered by signal strength:
glob rules → sibling-VALUE-aware rules → ancestor-name-only rules → the container rule →
bare-key rules. A schema with both a `system` sibling and a recognizable ancestor name is
always resolved by the stronger sibling-value rule, never guessed from the ancestor name alone.

### Semantically-empty bare keys — deliberately unmatched

A few bare property names have no reliable single meaning without surrounding context, so
`defaultHeuristics` doesn't guess at them at all (they fall through to plain generation):

- `value` — see the FHIR `ContactPoint` rules above; matched only with ancestor/sibling context.
- `title` — could mean a job title, a book/article/page title, or a generic UI label.
  `person.jobTitle` only matches the unambiguous `jobTitle`/`jobPosition` variants, never bare
  `title` (an earlier version matched bare `title` too, generating job-title-shaped text for a
  book's `title` field — a real overreach, fixed).

`description` DOES have a rule (`text.description`), but generates neutral prose
(`faker.lorem.sentences(2)`) rather than product-catalog text — a person's bio, a task's
description, and a product's description all get the same *kind* of realistic-but-generic
sentence, since there's no reliable signal that a bare `description` field is commerce-specific.

If your domain gives one of these fields a specific, reliable meaning, add your own rule ahead
of `defaultHeuristics` (see "Extend / remove / disable" below) rather than expecting this
library to guess it.

### Extend / remove / disable

```ts
import { defaultHeuristics, fakerBackend, createFaker } from 'standard-schema-faker/faker'

// Remove a rule you don't want (e.g. bare "name" defaulting to a person's full name):
const withoutBareName = defaultHeuristics.filter((r) => r.name !== 'person.name')

// Prepend your own rule ahead of it to win for the same key (first match wins):
const custom = [
  { name: 'my.accountId', match: 'accountId', generate: ({ backend }) => `acct_${backend.pick(['a','b','c'])}` },
  ...defaultHeuristics,
]

const gen = createFaker({ backend: fakerBackend, heuristics: custom })

// Disable heuristics entirely (structurally-valid-but-meaningless values, same as the root entry's default):
const plain = createFaker({ heuristics: false })

// Function shorthand: sugar for a single catch-all rule (same decline semantics):
const simple = createFaker({
  heuristics: (ctx) => (ctx.key === 'ssn' ? '000-00-0000' : undefined),
})
```

Every rule/matcher/generator draws all randomness from `ctx.backend` — the same seeded
instance every other value in the call uses — so heuristic output is deterministic per seed
like everything else in this library: same seed → deep-equal output, with heuristics on or off.

### `dates.birthDate`'s age window

`defaultHeuristics`' `dates.birthDate` rule (matches `birthDate`/`dob`/`dateOfBirth`) generates
via faker's `date.birthdate({ mode: 'age', min: 0, max: 100 })` — an explicit, wide age window
covering infants through centenarians: **born up to 100 years before the call's reference date
(`REFERENCE_DATE`, or a configured `FakerConfig.referenceDate`), never after it.** No explicit
`refDate` is passed at the call site — `fakerBackend` calls faker's own
`setDefaultRefDate(...)` once per `.create(seed, options)` (see "Design notes" below), and
`date.birthdate()` inherits that default automatically like every other relative-date method,
verified at runtime. This age window is a deliberate override of faker's own default (bare
`faker.date.birthdate()` defaults to `min: 18, max: 80` — no children, no elderly past 80),
which would silently exclude both ends of a general population from any schema using this rule
(e.g. a patient registry, a household census). See "Design notes" below for why dates are
anchored to a fixed reference point rather than the real clock at all, and for `referenceDate`'s
opt-in to now-relative data.

If your domain needs a narrower/different age range (e.g. an adults-only signup form, or a
school roster capped at 18), filter the default rule out and add your own with faker's own
`date.birthdate()` called with different `min`/`max`:

```ts
import type { FakerBackendInstance } from 'standard-schema-faker/faker'
import { defaultHeuristics, fakerBackend, createFaker } from 'standard-schema-faker/faker'

const adultsOnlyBirthDate = {
  name: 'dates.birthDate.adultsOnly', // 18-100 years old, instead of the default 0-100
  match: /^(birthdate|dob|dateofbirth)$/,
  when: { type: 'string' as const },
  // `ctx.backend`, cast to `FakerBackendInstance`, exposes `.faker` -- the call's own seeded
  // Faker instance, already anchored to REFERENCE_DATE (or a configured `referenceDate`) via
  // `setDefaultRefDate` -- so `date.birthdate()` inherits it with no explicit `refDate` needed,
  // same as the default rule this replaces.
  generate: ({ backend }: { backend: FakerBackendInstance }) =>
    backend.faker.date.birthdate({ mode: 'age', min: 18, max: 100 }).toISOString().slice(0, 10),
}

const gen = createFaker({
  backend: fakerBackend,
  heuristics: [adultsOnlyBirthDate, ...defaultHeuristics.filter((r) => r.name !== 'dates.birthDate')],
})
```

(Drawing through `ctx.backend.faker` — the call's seeded `Faker` instance, exposed via
`FakerBackendInstance` — rather than a bare unseeded `@faker-js/faker` import keeps rule output
fully seeded-deterministic; see `src/faker/heuristics.ts`'s own rules, which do the
same via a small `faker(backend)` helper.)

## Ensuring fields exist (finalize)

`overrides` replaces a value BEFORE generation (full pre-generation control); `heuristics`
SELECTS a realistic value, declining when it doesn't apply. Neither expresses "generate this
field normally, but make sure the result satisfies some extra invariant" — e.g. a FHIR
`Patient` resource whose `identifier` array must always contain an MRN-system entry, or a
`Practitioner` that must always carry an NPI, on top of whatever else the array happens to
contain. `finalize` is the tool for that: a hook that runs AFTER a node's value is fully
generated and returns the (possibly amended) value — the same "afterBuild" pattern factory
libraries like Fishery/factory_bot use, applied to a JSON-Schema-driven generator.

```ts
import { createFaker } from 'standard-schema-faker'
import { z } from 'zod'

const MRN_SYSTEM = 'http://hospital.example.org/mrn'

const Identifier = z.object({ system: z.string(), value: z.string() })
const Patient = z.object({
  name: z.string(),
  identifier: z.array(Identifier).max(4).optional(),
})

function ensureMrn(value: unknown) {
  const arr = Array.isArray(value) ? (value as Array<{ system: string; value: string }>) : []
  if (arr.some((entry) => entry.system === MRN_SYSTEM)) return arr
  return [...arr, { system: MRN_SYSTEM, value: 'MRN-0000001' }]
}

const gen = createFaker({
  // Force the normally-optional `identifier` array to always be present, so `finalize` always
  // has a container to amend into (see "Advanced" above for optionalProbability's full API).
  optionalProbability: (ctx) => (ctx.path === 'identifier' ? 1 : 0.5),
  finalize: {
    identifier: (value) => ensureMrn(value),
  },
})

const patient = gen.fake(Patient, { seed: 1 })
// patient.identifier always contains an { system: MRN_SYSTEM, ... } entry, across every seed.
```

- **Signature**: `finalize?: Record<string, (value, ctx: MatchContext & {backend}) => unknown>
  | ((value, ctx) => unknown)` — same dot-path glob keys (`*`/`**`) as `overrides`, or a single
  function as a catch-all applied to every node (same sugar pattern as the heuristics function
  shorthand). `ctx` is the identical `MatchContext & {backend}` an override/heuristic rule
  sees.
- **Same matcher engine as `overrides`, reused, not reimplemented** — the glob syntax and
  specificity ranking (exact literal beats any glob; fewer wildcard segments beats more; `*`
  beats `**` at the same count; first-declared-key order as the final tie-break) are identical.
  The ONE difference: when multiple glob keys match the same path, `finalize` applies ONLY the
  single most-specific one — there's no decline-and-fall-through-to-the-next-candidate chain
  the way `overrides` has, because a finalize hook always has an existing value to fall back
  to (no "declined vs. genuinely `undefined`" ambiguity to resolve).
- **Post-order**: a container's (object/array) own `finalize` hook runs AFTER every child's
  value has already been generated AND already had its own `finalize` hook (if any) applied —
  so a parent-level hook can rely on seeing its children's amendments, never the raw
  pre-amendment values.
- **Verbatim, no constraint guard**: unlike a heuristic rule's `generate`, a finalize hook's
  return value is used exactly as returned — no length/range/structural fit-check. This is a
  deliberate, explicit escape hatch at the SAME trust level `overrides` already has: if your
  amendment doesn't satisfy the node's own schema (e.g. pushes an array past its own `maxItems`
  — see the `.max(4)` headroom in the example above), that's on you.
- **Interaction with `strict: true`**: `finalize` runs BEFORE strict-mode validation — strict
  mode validates (and, on failure, retries generating-and-then-finalizing again from) the
  FINAL, already-finalized value, not the raw pre-finalize generation. An amendment that breaks
  the schema surfaces as a normal `StrictModeError`, same as any other invalid generated value.
- **Interaction with `optionalProbability`**: `finalize` only ever sees a value if the node was
  actually generated — an optional property finalize targets that ended up omitted (the coin
  flip/probability draw excluded it) never has its hook invoked at all. Pair `finalize` with
  `optionalProbability` (as in the example above) when you need the container to reliably
  exist before amending it.

## Limitations

- Custom refinements/transforms invisible to JSON Schema are only honored via `strict` retries
  — and only if the retry loop finds a passing value within 5 attempts (low-probability
  refinements, e.g. rejecting all but ~4% of values, may exhaust retries and throw).
- Cross-field constraints need `overrides`.
- `pattern` generation supports a real (if bounded) regex subset — see "Supported JSON Schema
  features" above for exactly what; lookaround, named groups, and backreferences aren't
  supported and fall back to a plain string, with `strict` retry as the backstop. When a
  pattern and `minLength`/`maxLength` are both present, up to 10 re-rolls are tried to satisfy
  both; an unsatisfiable or very narrow combination (e.g. a pattern that can only ever produce
  a 10-character string, with `maxLength: 3`) may not converge within that budget — `strict`
  retry is the backstop for those cases too.
- Unsupported JSON Schema keywords: `not`, `if/then/else`, `patternProperties`, `dependentSchemas`.
- `Map`/`Set` (`z.map()`/`z.set()`) have no JSON Schema equivalent — JSON itself has no map/set
  primitive — and throw a `JsonSchemaConversionError` naming the construct rather than silently
  failing. Model the field as an array or a `z.record()` instead, or supply it via `overrides`.
- `allOf` is shallow-merged and generates ONE value from the merged shape (the practically
  useful behavior — matches what `z.intersection()` itself validates) but a strict
  independent-branch JSON Schema validator can reject that value if branches share a key with
  different constraints, or if multiple branches each set `additionalProperties: false` over
  disjoint keys (the latter has no valid values at all under strict `allOf` semantics — this
  reproduces even with Zod's own native JSON Schema output, not something specific to this
  library).
- Valibot and Effect Schema require one `await prepare(schema)` call per vendor before
  `fake()`/`fakeMany()` can be used synchronously with them — see "Supported validators" above.
- Valibot recursive schemas must use `v.lazy()`; a getter-based recursive object literal
  crashes the fallback JSON Schema converter.
- Effect Schema recursive schemas (`Schema.suspend`) require an explicit `.annotations({
  identifier: '...' })` on every recursive member, or the fallback converter throws.
- `io: 'input'` is not supported for Effect Schema — its fallback JSON Schema conversion
  (`JSONSchema.make`) doesn't distinguish input from output at all; requesting `input` throws
  a `JsonSchemaConversionError` rather than silently generating the output shape.
- **Zod v3 is not currently supported.** `@standard-community/standard-json`'s zod adapter's
  synchronous path returns an empty schema for zod v3 even after a successful `prepare()`
  warm-up — a bug in that third-party package (its async path works correctly every time;
  only `.sync()` is broken, and only for zod v3). See [BENCH.md](./BENCH.md) for details.

## Design notes

A few specific guarantees this library makes, called out because they're exactly the top
complaint classes in comparable mocking tools:

- **Stable dates, not "now" — by default.** Every relative date `fakerBackend`/`defaultBackend`
  generates (`date-time`/`date`/`time` formats, `BackendInstance.date()` with no bounds, and
  `defaultHeuristics`' `createdAt`/`updatedAt`/`deletedAt`/`birthDate` rules) is anchored to a
  FIXED reference point (`2025-01-01T00:00:00.000Z` — `fakerBackend`'s exported `REFERENCE_DATE`
  / `defaultBackend`'s internal `DEFAULT_REFERENCE_DATE`, kept in sync across both packages),
  never the real wall-clock time by default. Faker's own relative-date methods
  (`anytime()`/`past()`/`recent()`/`soon()`/`birthdate()`) default their reference date to
  `Date.now()` when called directly — meaning the same seed would otherwise produce a different
  date depending on which day the process happens to run, quietly breaking "same seed →
  identical output" for any date field. `fakerBackend` calls faker's own
  `setDefaultRefDate(...)` once per `.create(seed, options)` instead (faker's dedicated knob for
  exactly this), so every relative-date method inherits it uniformly with no per-call `refDate`
  argument needed — this includes `date.birthdate({mode: 'age', ...})`, which has its own
  `min`/`max` age-range options alongside `refDate` but still defers to `faker.defaultRefDate()`
  when `refDate` is omitted. `FakerConfig.referenceDate` makes this
  fixed point CONFIGURABLE per call — pass `referenceDate: new Date()` as a deliberate, explicit
  opt-in to now-relative data (e.g. "an invoice due within 30 days of today") at the cost of
  losing cross-run stability for that call; every generated date is still guaranteed
  `<= referenceDate`, whichever value is in effect. `defaultBackend` anchors its own unbounded
  date-string/`.date()` generation window to `[referenceDate − 25 years, referenceDate]`
  instead of a hardcoded `2000–2035` range, so the same `referenceDate` configuration governs
  both backends uniformly.
- **No global seed state.** Every `fakerBackend`/`defaultBackend` instance is created fresh per
  `.create(seed)` call — never a shared, mutated global RNG. Contrast with the common
  `faker.seed(n)` pattern (a single shared instance whose stream is consumed in whatever order
  your code happens to call it), where two unrelated `fake()` calls can perturb each other's
  output depending on call order. Here, two `fake()` calls (or two `createFaker()` instances)
  with the same seed always produce the same value, regardless of what else has run.
- **Refinements/transforms via `strict`, not silent guessing.** JSON Schema can't express a
  Zod `.refine()` or similar cross-field/custom validation — `strict: true` is the honest
  mechanism for this: generate, validate against the schema's own `validate()`, retry
  (deterministically re-seeded) on failure, throw a `StrictModeError` if every retry fails.
  Nothing is silently faked into looking valid.
- **`pattern` respects length bounds via re-roll, never cropping.** `minLength`/`maxLength` and
  `pattern` are independent, simultaneous JSON Schema constraints — cropping a pattern-matched
  string to fit a length bound (or padding it) breaks the pattern match itself, producing a
  value that looks "in bounds" but is actually invalid. This library re-rolls (fresh
  randomness, bounded attempts) until both hold, or gives up and returns the last
  pattern-matching attempt unchanged — never truncated, never padded.

## License

MIT
