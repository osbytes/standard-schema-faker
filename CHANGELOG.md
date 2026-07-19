# standard-schema-faker

## 0.3.1

### Patch Changes

- 6be1ea8: remove stale dev-time artifacts

## 0.3.0

### Minor Changes

- 6e58a12: Realism fixes for vendor-emitted JSON Schema quirks.

  **Format-first generation** when a string schema carries both `format` and `pattern` (all three backends). The dedicated format generator's value is kept whenever it satisfies the schema's own `pattern` (checked with the native regex engine, which also handles constructs the pattern generator can't, like lookaheads) and the length bounds; only otherwise does randexp-style pattern generation run. Fixes Zod v4 `z.uuid()` returning the degenerate nil (`00000000-…`) or max (`ffffffff-…`) UUID constant for ~2/3 of seeds — Zod's uuid pattern lists those literals as alternation branches, and uniform branch selection kept picking them. Also aligns the implementation with the documented priority ladder (`… > backend built-in format > pattern > plain`). This also fixes Zod's `z.iso.datetime()` (format `date-time` + pattern) generating regex-derived stamps like `"1108-11-09T01:15Z"` instead of realistic dates. New export: `matchesPattern(pattern, value)` from the root entry.

  **Nested-field heuristics** (faker + chance rulesets): every default rule was written `/^key$/` while `HeuristicMatcher` tests regexes against the full dotted `semanticPath` — so heuristics only ever fired for TOP-LEVEL fields, and anything nested (`shipping.city`, `order.meta.id`) fell through to lorem noise. All 80 rules are now suffix-anchored (`/(^|\.)key$/`). The heuristic constraint guard also now honors `pattern` (a rule value violating the node's own regex is discarded instead of returned — caught by `commerce.sku` emitting `"ZVH-10669"` for a `/^SKU-\d{4}$/` schema), `country` fields constrained to 2 chars generate ISO alpha-2 codes instead of failing the guard, and `line1`/`line2` inside address-shaped parents (address/shipping/billing) generate street addresses.

  **Numeric bound windowing**: Zod v4 stamps every `z.int()` with minimum/maximum ±(2^53 − 1) as an "any safe integer" sentinel; honoring those literally produced 16-digit values for `z.int().positive()`, and a half-bounded `z.int().min(200)` collapsed onto the 0–100 default window as the constant 200. Bounds at sentinel magnitude are now treated as absent, and half-bounded schemas get a 100-wide window anchored at their real bound (`positive()` → 1..101, `max(10)` → -90..10). Explicit two-sided bounds are honored exactly as before. Note: seeds that previously hit the pattern path for format+pattern schemas now produce different (better) values — minor, not patch, because byte-identical outputs across versions were never promised but this shifts them broadly.

## 0.2.0

### Minor Changes

- 7349813: Add `standard-schema-faker/chance` — a batteries-included subpath backed by `chance` (an
  alternative to `standard-schema-faker/faker`'s `@faker-js/faker` backend), with its own
  `chanceHeuristics` ruleset, `chanceBackend`, and `createFaker`/`fake`/`fakeMany`. `chance` is an
  optional peer dependency, same as `@faker-js/faker` — the root `standard-schema-faker` entry
  still has zero runtime dependencies beyond the Standard Schema/JSON Schema plumbing.
- f4dfe1b: chance and benchmark fix

## 0.1.2

### Patch Changes

- eaeee48: fix repo URL
