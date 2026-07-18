---
"standard-schema-faker": minor
---

Add `referenceDate`, a custom `formats` registry, and `defaultProbability`/`examplesProbability`
to `FakerConfig`.

- **`referenceDate?: Date`**: the fixed point in time every relative-date value a call generates
  is anchored to — `date-time`/`date`/`time` string formats, `BackendInstance.date()` with no
  explicit bounds, and (with `defaultHeuristics`) the `createdAt`/`updatedAt`/`deletedAt`/
  `birthDate` rules. Defaults to a fixed constant (`2025-01-01T00:00:00.000Z`), not `new
  Date()`/`Date.now()`, so seeded output stays stable across runs/machines/days — passing
  `referenceDate: new Date()` is a deliberate, explicit opt-in to now-relative data at the cost
  of that cross-run stability (every generated date is still guaranteed `<= referenceDate`).
  `GeneratorBackend.create(seed, options?)` gained an optional second parameter (additive, no
  existing implementation breaks) carrying `referenceDate` through to backend instances.
  `fakerBackend` implements this via `faker.setDefaultRefDate(...)` — faker's own dedicated knob
  for exactly this — called once per `.create()`, so every relative-date faker method
  (including `date.birthdate({mode: 'age', ...})`, verified at runtime) inherits it with no
  per-call `refDate` argument needed anymore. `defaultBackend` gained its own
  `DEFAULT_REFERENCE_DATE` constant (same literal value, duplicated with a cross-reference
  comment since core can't depend on the faker package) and now anchors its unbounded
  date-string/`.date()` window to `[referenceDate − 25y, referenceDate]` instead of a hardcoded
  `2000–2035` range. Unconfigured behavior is unchanged for both backends.
- **`formats?: Record<string, (ctx) => string>`**: a custom `format`-name generator registry —
  the `jsf.format()` analog from `json-schema-faker`. Slots into the walker's existing priority
  ladder at exactly the `format` tier: `overrides` > `heuristics` > registered `formats` >
  backend built-in `format` > `pattern` > plain generation. A registered name shadows the
  backend's own built-in handling for that name only (e.g. registering `'email'` overrides
  `fakerBackend`'s/`defaultBackend`'s built-in email generator); every unregistered format name
  is completely unaffected, including the plain-string fallthrough for names with no built-in at
  all. Unlike `json-schema-faker`'s `jsf.format()` (a global, mutable registration on a shared
  module instance), this is per-`createFaker()`-call config, preserving this library's "no
  global mutable state" determinism guarantee.
- **`defaultProbability`/`examplesProbability`** (both default `0.5`, matching prior behavior):
  replace the walker's two remaining bare `ctx.backend.bool()` 50/50 coin flips (for the
  `default` and `examples` keywords) with configurable probabilities, following the same pattern
  `optionalProbability` established — `backend.float(0, 1) < p` instead of `bool()`, exactly one
  seeded draw per decision regardless of configuration, so the generated stream's shape/length
  is unaffected by this setting. `0` disables the behavior entirely; `1` always applies it
  whenever the keyword is present. **Same caveat `optionalProbability` already carries**: bit-
  for-bit equivalent to the old `bool()` for `defaultBackend` at the unconfigured default
  (`bool()` IS `rand() < 0.5`), but `fakerBackend`'s concrete sequence for existing seeds shifts
  even at the default, since its `bool()` and `float()` consume different underlying
  `@faker-js/faker` entropy — pre-release, no back-compat guarantee yet, flagged explicitly
  rather than silently shipped.
- README gained a "Coming from `json-schema-faker`?" mapping table (`optionalsProbability`/
  `alwaysFakeOptionals` ≈ `optionalProbability`, `useDefaultValue` ≈ `defaultProbability`,
  `useExamplesValue` ≈ `examplesProbability`, `jsf.format()` ≈ `formats`) — an orientation aid,
  not a compatibility shim (semantics differ: boolean-vs-probability, global-vs-per-call).
