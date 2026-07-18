---
"standard-schema-faker": minor
---

Fix several real bugs, tighten the public API shape, and close known issue classes shared by
comparable mocking tools (json-schema-faker, zod-mock, faker-js/faker). Pre-release (nothing
published yet), so every change below is a straight fix/rename with no back-compat alias kept.

**Real bugs fixed:**

- A JSON Schema type array (`type: ["null", "string"]`) always generated `null` — the first
  element was always picked. Generation now picks uniformly (seeded) among the listed types.
- `defaultBackend` truncated formatted email/uri values to satisfy an unrelated `maxLength`,
  corrupting them into invalid strings; the clamp was removed (matches `fakerBackend`'s
  already-correct behavior). Also fixed a length-0 floor bug (`z.string().max(0)` always
  produced a 1-character string).
- Heuristics glob patterns weren't normalized at compile time, so a camelCase pattern segment
  (e.g. `'**.phoneNumber.value'`) silently never matched.
- OpenAPI-style `nullable: true` was only honored for object properties — array items and the
  root schema itself silently ignored it. Now honored uniformly everywhere.
- `overrides`' Record form: a declining thunk became the literal generated value (`undefined`)
  instead of falling through to the next candidate — fixed as part of the redesign below.
- **Non-deterministic dates (critical):** `fakerBackend`'s relative-date generation
  (`date-time`/`date`/`time` string formats, `BackendInstance.date()`, and `defaultHeuristics`'
  `createdAt`/`updatedAt`/`deletedAt`/`birthDate` rules) depended on `Date.now()` at call time
  — the same seed produced a different value depending on which day the process ran, violating
  this library's own "same seed → identical output" promise. Every relative-date call is now
  anchored to a fixed, exported `REFERENCE_DATE` (`2025-01-01T00:00:00.000Z`).
- `pattern` generation ignored `minLength`/`maxLength` entirely whenever a pattern was present.
  Both backends now re-roll (bounded, up to 10 attempts) until both constraints hold, or return
  the last attempt unchanged — never truncating/padding a pattern-matched value.

**API-shape changes:**

- `fake`/`fakeMany`/`createFaker` now infer each schema's own type
  (`StandardSchemaV1.InferInput`/`InferOutput`) instead of `fake<T = unknown>`.
  `FakerConfig`/`SchemaFaker` are generic over the `io` projection.
- The `use` config key is renamed `io` — matches Zod v4's own `z.toJSONSchema(schema, {io})`
  option name.
- `overrides` redesigned around the same `MatchContext` ctx-object the heuristics engine uses —
  positional `(path, node)` replaced with a shared context object (`ctx.path`/`ctx.node`, plus
  `ctx.parent`/`ctx.ancestors`/`ctx.siblings`), with consistent decline-fallthrough semantics.
- New typed error hierarchy (`src/errors.ts`): `SchemaFakerError` base, plus `StrictModeError`,
  `AsyncValidateError`, `JsonSchemaConversionError`, `UniqueItemsError`, `UnresolvableRefError`,
  and `UnsupportedPatternError` (now extending the base) — carrying structured data (`issues`,
  `attempts`, `seed`, `vendor`, `ref`) instead of ad-hoc string-prefixed `Error`s.
- Core's `Faker` interface is renamed `SchemaFaker` (re-exported as `Faker` too) — avoids
  colliding with `@faker-js/faker`'s own `Faker` class.

**`defaultHeuristics` overreach fixed:**

- `person.jobTitle` narrowed to `jobTitle`/`jobPosition` — no longer matches bare `title`.
- `commerce.description` renamed `text.description`, generating neutral prose instead of a
  product description for any field literally named `description`.
- Meta's `createFaker` no longer defaults `heuristics` to `defaultHeuristics` when paired with
  a custom (non-`fakerBackend`) backend — that combination used to throw on the first heuristic
  hit.

**New feature — `additionalProperties` schema-form generation** (`z.record(K, V)` support):
generates 1–3 synthesized entries for an open-ended record, honoring `propertyNames`'s
pattern/format/enum; a closed enum key set (Zod's `z.record(z.enum([...]), V)`) generates
exactly those keys.

**Defensive check, no gap found:** `z.map()`/`z.set()` (no JSON Schema equivalent) now surface
a clear `JsonSchemaConversionError` instead of letting the vendor's bare `Error` propagate
unwrapped.

This cross-check specifically verified against known upstream/ecosystem issues:
faker-js/faker#1870 (non-deterministic dates), zod-mock's open date-stability feature request,
and json-schema-faker's pattern/length-bounds bug class (#74/#486/#659).
