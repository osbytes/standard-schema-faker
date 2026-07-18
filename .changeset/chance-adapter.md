---
"standard-schema-faker": minor
---

Add `standard-schema-faker/chance` — a batteries-included subpath backed by `chance` (an
alternative to `standard-schema-faker/faker`'s `@faker-js/faker` backend), with its own
`chanceHeuristics` ruleset, `chanceBackend`, and `createFaker`/`fake`/`fakeMany`. `chance` is an
optional peer dependency, same as `@faker-js/faker` — the root `standard-schema-faker` entry
still has zero runtime dependencies beyond the Standard Schema/JSON Schema plumbing.
