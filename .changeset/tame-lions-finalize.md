---
"standard-schema-faker": minor
---

Add `finalize` hooks and `optionalProbability` to `FakerConfig`, widen the `dates.birthDate`
heuristic's age window, and extend the vendor test matrix to Valibot/ArkType/Effect for every
heuristics/overrides/finalize feature added since the original vendor matrix.

- **`finalize`** (`FakerConfig.finalize`): dot-path glob (`*`/`**`, reusing `overrides`' exact
  compiled matcher engine and specificity ranking) or predicate-function hooks that run AFTER a
  node's value is fully generated, post-order — a container's own hook sees its children's
  values already finalized. Receives the value plus the same `MatchContext & {backend}` an
  override sees, and returns the (possibly amended) value USED VERBATIM (no constraint guard —
  same trust level as `overrides`). Unlike `overrides`, only the SINGLE MOST SPECIFIC matching
  hook runs (no decline/fall-through chain — there's always an existing value to fall back to,
  so there's no "declined vs. genuinely `undefined`" ambiguity to resolve). This is the tool for
  "ensure X exists in the generated value" semantics — e.g. a FHIR `Patient` resource whose
  `identifier` array must always carry an MRN-system entry. `strict: true` validates the FINAL,
  post-finalize value. See README's new "Ensuring fields exist (finalize)" section.
- **`optionalProbability`** (`FakerConfig.optionalProbability`): `number | (ctx: MatchContext)
  => number`, controlling the inclusion probability for optional object properties (default
  stays `0.5`). A function is evaluated per optional property, receiving that property's own
  `MatchContext`. Exactly one seeded `backend.float(0, 1)` draw happens per optional property
  regardless of configuration, keeping the generated stream's shape/length independent of this
  setting. Bit-for-bit equivalent to the old `backend.bool()` coin flip for `defaultBackend` at
  the unconfigured default (`bool()` IS `rand() < 0.5`; `float(0,1)` IS `rand()`) — **note for
  `fakerBackend` specifically**: its `bool()` and `float()` consume different underlying
  `@faker-js/faker` entropy, so `fakerBackend`'s concrete optional-inclusion sequence for
  existing seeds changes even at the unconfigured default (pre-release, no back-compat
  guarantee yet — flagged explicitly since it's the one non-additive part of this change).
- **`dates.birthDate` heuristic**: now generates via `date.birthdate({mode: 'age', min: 0, max:
  100, refDate: REFERENCE_DATE})` instead of faker's own default (`min: 18, max: 80`), which
  silently excluded children and centenarians. README documents the new "born up to 100y before
  REFERENCE_DATE, never after it" contract and a swap recipe for custom age ranges.
- **Cross-vendor coverage**: heuristics realism smoke tests, the FHIR `ContactPoint` rules,
  `z.record`/schema-form `additionalProperties`, ctx-based `overrides`, pattern×length re-roll,
  and the new `finalize`/`optionalProbability` features are now exercised against Valibot and
  ArkType (previously Zod-only for everything added after the original vendor matrix), with
  Effect Schema covered best-effort where its converter supports the shape. All four vendors
  round-trip cleanly for heuristics/ContactPoint/overrides/finalize — no shim needed. Found a
  genuine vendor divergence for the CLOSED-key-set `additionalProperties` form
  (`z.record(z.enum([...]), V)`): it's Zod-specific. Valibot's equivalent
  (`v.record(v.picklist([...]), V)`) is accepted at construction time but its JSON Schema
  conversion throws; ArkType rejects a literal-key-union `Record` at schema-construction time
  itself, steering toward a plain object with named properties instead (handled normally via
  ordinary declared `properties`, never reaching the `additionalProperties` codepath). Not a
  gap in this library — documented in README as a real difference in what "a record with a
  closed key set" means across these vendors' own schema-authoring surfaces.
