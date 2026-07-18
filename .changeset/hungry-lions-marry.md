---
"standard-schema-faker": minor
---

Initial v0.1.0 release: universal fake/mock data generation for any Standard Schema
validator (Zod v4, Valibot, ArkType, best-effort Effect Schema).

- `fake`, `fakeMany`, `createFaker` public API with seeded, deterministic generation.
- JSON Schema walker covering string (length bounds, format, bounded pattern generation),
  number/integer (min/max/multipleOf), boolean, enum/const, object (required/optional),
  array (minItems/maxItems, proper uniqueItems dedupe with re-roll/shrink/clear-error),
  tuples, anyOf/oneOf, allOf (shallow merge), $ref/recursive schemas with a maxDepth cap,
  nullable, default (seeded probability in output projection), and examples (seeded pick).
- `strict: true` mode: validates each generated value against the schema's own
  `~standard.validate()` and retries with deterministically re-seeded attempts.
- `overrides`: a dot-path glob engine (`*`/`**`) plus predicate-function matcher for
  business rules and correlated fields.
- `use: 'input' | 'output'` JSON Schema projection, wired through both the native
  `~standard.jsonSchema` surface and the `@standard-community/standard-json` fallback.
- `prepare(schema)`: one-time async warm-up for vendors without a native JSON Schema
  surface (Valibot, Effect Schema), keeping `fake()`/`fakeMany()` fully synchronous.
- `@standard-schema-faker/faker`: a `@faker-js/faker`-backed `GeneratorBackend` with
  realistic emails, UUIDs, URLs, dates, IPs, and pattern-aware strings.
- `standard-schema-faker`: the batteries-included meta package, defaulting to the faker
  backend while `@standard-schema-faker/core` stays dependency-free.
