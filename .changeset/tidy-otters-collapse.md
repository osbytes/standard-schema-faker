---
"standard-schema-faker": minor
---

Collapse the three-package monorepo (`@standard-schema-faker/core`, `@standard-schema-faker/faker`,
`standard-schema-faker`) into a single published package, `standard-schema-faker`, with subpath
exports — the ecosystem-standard pattern (`drizzle-orm/*`, `hono/*`, `zod/v4`). The
`@standard-schema-faker/*` npm scope is dropped entirely (no npm org will be created for it).

- **`standard-schema-faker`** (root export, `.`): the walker + seeded RNG + zero-dependency
  default backend + heuristics engine (opinions off by default) — exactly the old
  `@standard-schema-faker/core` surface. Zero runtime dependencies beyond `@standard-schema/spec`
  and `@standard-community/standard-json`. `@faker-js/faker` is never required to use this entry.
- **`standard-schema-faker/faker`**: the batteries-included entry point — `fakerBackend`,
  `defaultHeuristics`, `REFERENCE_DATE`, plus its own `fake`/`fakeMany`/`createFaker`
  preconfigured with `fakerBackend` + `defaultHeuristics` (exactly the old `standard-schema-faker`
  meta package's behavior, folded into this subpath, including the "custom non-faker backend ->
  heuristics default to false" guard).
- `@faker-js/faker` is now a `peerDependency` (`peerDependenciesMeta.optional: true`) of this one
  package — install it yourself if you use the `/faker` subpath: `npm i -D standard-schema-faker
  @faker-js/faker`. Core-only consumers (`import ... from 'standard-schema-faker'`) never need it.
- No functional/behavioral changes to generation logic — this is a packaging-only change. Fixed
  one stale error message (the `defaultHeuristics` backend guard referenced the old
  `@standard-schema-faker/faker` package name) and every doc string mentioning the old scoped
  package names.

Pre-release (nothing published under the old scoped names), so this is a straight restructure —
no compatibility shim, no re-exported alias package.
