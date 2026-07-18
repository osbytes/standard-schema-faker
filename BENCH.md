# Benchmark: standard-schema-faker vs @anatine/zod-mock

Honest numbers, including where we lose. Measured on the machine this was authored on
(darwin, Node 22.23.0) — treat as directional, not absolute; re-run `bench/bench.mjs`
yourself if the numbers matter to a decision.

## Setup

`@anatine/zod-mock` requires zod v3 (`peerDependencies: { zod: "^3.21.4" }`), incompatible
with this monorepo's zod v4. The benchmark therefore lives in `bench/`, a **standalone
directory outside the pnpm workspace** with its own `package.json` and plain `npm install`
(not a workspace member — see `bench/package.json`'s description). It compares **logically
equivalent** schemas (same fields, same constraints) written against each library's own zod
major version — the fairest comparison achievable given the peer-dependency conflict, and
arguably the realistic one: a real project picks one zod major and one mocking library, not
both at once.

The representative schema (a "user" object) used on both sides:

```
id: uuid, email: email, name: string(2-40), age: int(18-99),
role: enum(admin|user|guest), tags: string(3-12)[](max 5),
bio: string(max 200) optional, createdAt: datetime
```

Run it yourself: `cd bench && npm install && node bench.mjs` (and `node cold-*.mjs` for the
cold-start numbers).

## A known third-party bug affecting this bench

`@standard-community/standard-json`'s zod adapter's **synchronous** path
(`toJsonSchema.sync()`) returns an empty `{}` schema for **zod v3** even after a successful
async warm-up via this library's `prepare()` — a bug in that third-party package, not in
standard-schema-faker: the *async* path (`await toJsonSchema(schema, opts)`) returns the
correct schema every single time; only `.sync()` is broken, and only for the zod v3 adapter
specifically (Valibot's and Effect Schema's sync-after-warmup paths both work correctly).

**Practical upshot: standard-schema-faker cannot currently support zod v3 through the
fallback path.** This is why the bench uses zod v4 (the fully-working native path) for our
side rather than the same zod v3 schema object `@anatine/zod-mock` consumes. Not something
fixable from this side without a fix or workaround upstream in
`@standard-community/standard-json`.

## Results (warm / steady-state, 2000 iterations after 200 warm-up iterations)

| Generator | ops/sec | vs @anatine/zod-mock |
|---|---:|---:|
| `@standard-schema-faker/core` (dumb backend, zero deps) | ~20,400–20,800 | 2.0–2.1x faster |
| `standard-schema-faker` (fakerBackend, realistic values) | ~7,300–7,400 | **0.71–0.74x (slower)** |
| `@anatine/zod-mock` | ~9,900–10,400 | 1x (baseline) |

We lose to `@anatine/zod-mock` on raw warm throughput when using the realistic
(`fakerBackend`) backend — by roughly 26–29%. The zero-dependency `defaultBackend` is
meaningfully *faster* than zod-mock (about 2x), which makes sense: it's a tiny seeded PRNG
with hand-rolled string templates, doing far less work per field than a full `@faker-js/faker`
call.

## What the numbers mean

- **`fakerBackend` being slower than zod-mock is a believable, honest result, not a red
  flag.** Both ultimately call into `@faker-js/faker` for realistic values; the gap is
  architectural overhead specific to this library's design, not a `@faker-js/faker` slowdown:
  standard-schema-faker walks a generic JSON Schema document (dispatch by `type`/`format`/
  keyword at every node, `$ref` resolution, override-matcher checks, path-string
  construction) — a general mechanism that works for **any** Standard Schema vendor.
  `@anatine/zod-mock` walks Zod's own internal schema tree directly, a representation
  purpose-built for exactly this. Universality (the whole point of this library — one API for
  Zod, Valibot, ArkType, Effect Schema) costs something at the margin versus a Zod-only tool
  walking Zod's native structures.
- **The zero-dependency default backend is a genuine differentiator** for the "tiny core, no
  install" use case (throwaway fixtures, tests that don't care about realism) — 2x zod-mock's
  throughput with zero runtime dependencies. If this project ever leans into that as a
  differentiator, that story has real numbers behind it.
- **Cold start** (single first call in a fresh `node` process — module load + first schema
  conversion + first generation, no warm-up) is roughly comparable across all three: **~2.3ms**
  (dumb backend), **~3.6–7.4ms** (fakerBackend — variance likely from `Faker` instance
  construction cost), **~2.9–3.5ms** (zod-mock). Directional only; not the focus of this
  benchmark, since a mocking library's steady-state throughput matters far more in realistic
  usage (test suites, seed scripts) than its first-call latency.
- These numbers should NOT be read as "don't use standard-schema-faker" — they're read as "the
  universality has a real, measured cost on the zod-only axis where an incumbent already
  exists." The honest trade-off: differentiate on universality + seeding + input/output; out-
  *breadth* the zod mockers, don't out-zod them.

## Reproducing

```sh
cd bench
npm install
node bench.mjs          # warm, steady-state
node cold-dumb.mjs       # cold start, defaultBackend
node cold-faker.mjs      # cold start, fakerBackend
node cold-zodmock.mjs    # cold start, @anatine/zod-mock
```
