---
"standard-schema-faker": minor
---

Redesign the heuristic field-matching engine around a `MatchContext` object, and add
context-aware (path/sibling/ancestor) rules for shapes a bare property key can't describe on
its own — e.g. FHIR-style `ContactPoint` objects (`telecom: [{ system, use, value }]`) and
discriminator-less array shapes (`phone: [{ value, type }]`, `emails: [{ value }]`).

- **`HeuristicRule.match` is now `HeuristicMatcher`**: a bare key string, a dot-path glob string
  (`*`/`**`, reusing the same glob engine `overrides` uses), a `RegExp` (tested against
  `semanticPath`), or a `(ctx: MatchContext) => boolean` function — all four compile to one
  evaluation path. `MatchContext` replaces the old positional `(key, path, node)` signature:
  `key`/`rawKey`, `path`/`semanticPath`/`segments`, `node`/`parent`/`ancestors`/`root`, and
  `siblings` (new — the values already generated for earlier properties of the immediate parent
  object, not just their possible schema-declared range). This is a breaking change to
  `HeuristicRule`'s shape, taken pre-release (nothing has been published yet).
- **Container-node rules**: `when: {type: 'object' | 'array'}` lets a rule match a whole
  object/array node (checked before the walker would otherwise recurse into its
  properties/items) and generate a fully correlated value in one shot; the engine
  structurally fit-checks the result (required keys present, each property's basic type
  matches) and declines on a mismatch, same semantics as the existing leaf constraint guard.
- **`ancestorKeys(ctx)`**: new exported helper — normalized ancestor keys nearest-to-root, array
  indices skipped. Also exports `MatchContext` and `HeuristicMatcher` as standalone types.
- **Two-tier property generation order**: an object's `enum`/`const` properties (typically
  discriminators like `system`/`type`/`status`) are now generated before all other properties,
  regardless of declaration order, so `ctx.siblings`-dependent rules work whether a schema
  author wrote the discriminator before or after the field that depends on it. Determinism is
  unaffected (a pure function of schema shape); this does change concrete generated values for
  schemas with enum-typed properties compared to previous heuristics-related builds.
- **`defaultHeuristics`** (`@standard-schema-faker/faker`, on by default in the meta package)
  gained FHIR `ContactPoint` rules at three signal-strength tiers — sibling-VALUE-aware (reads
  the actual generated `system`, gated by ancestor name since `system` is reused across
  unrelated FHIR types like `Coding`/`Identifier`), a container rule, and ancestor-name-only
  rules for shapes with no discriminator at all — plus glob rules for simple path shapes.
- Fixed a real bug surfaced while building the ancestor-name rules: `ctx.ancestors` didn't match
  its own documented contract (a spurious frame keyed by the current leaf's own name leaked into
  its ancestor list), silently breaking any ancestor-name-based rule.

README's "Realistic fields (heuristics)" section documents the full design.
