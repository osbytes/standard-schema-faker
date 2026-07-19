# Benchmark: standard-schema-faker vs @anatine/zod-mock

Honest numbers, including where we lose. Measured on darwin, Node 22.23.0 — treat as
directional, not absolute; re-run `bench/bench.mjs`
yourself if the numbers matter to a decision.

## Setup

`@anatine/zod-mock` requires zod v3 (`peerDependencies: { zod: "^3.21.4" }`), incompatible
with this repo's zod v4. The benchmark therefore lives in `bench/`, a **standalone
directory** with its own `package.json` and plain `npm install`
(see `bench/package.json`'s description). It compares **logically
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

Run it yourself: `cd bench && npm run pack-tarballs && npm install && npm run bench` (and
`npm run bench:cold` for the cold-start numbers). `bench/.npmrc` sets `legacy-peer-deps` —
zod-mock peer-requires faker ≤9 while our tarball peer-wants faker ^10, an unresolvable
strict-peer conflict for a harness that deliberately installs both; the runtime-required
peers skipped by legacy mode (`quansync`, `@standard-schema/spec`) are declared as direct
dependencies instead.

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
| `standard-schema-faker` (root entry, dumb backend, zero deps) | ~17,300 | ~1.75x faster |
| `standard-schema-faker/faker` (fakerBackend + defaultHeuristics) | ~5,700 | **~0.58x (slower)** |
| `@anatine/zod-mock` | ~9,900 | 1x (baseline) |

We lose to `@anatine/zod-mock` on raw warm throughput when using the realistic
`/faker` entry — by roughly 40%. Note the `/faker` entry now runs `defaultHeuristics` by
default (property-name matching against ~50 rules per string/number/object node), which is
additional per-node work zod-mock's fixed key-map lookup doesn't do; disabling heuristics
(`createFaker({ heuristics: false })`) recovers a chunk of that gap. The zero-dependency
root entry remains meaningfully *faster* than zod-mock (~1.75x): it's a tiny seeded PRNG
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
  throughput with zero runtime dependencies.
- **Cold start** (single first call in a fresh `node` process — module load + first schema
  conversion + first generation, no warm-up) is roughly comparable across all three: **~2.9ms**
  (dumb backend), **~4.8ms** (fakerBackend — `Faker` instance construction cost), **~2.7ms**
  (zod-mock). Directional only; not the focus of this
  benchmark, since a mocking library's steady-state throughput matters far more in realistic
  usage (test suites, seed scripts) than its first-call latency.
- These numbers should NOT be read as "don't use standard-schema-faker" — they're read as "the
  universality has a real, measured cost on the zod-only axis where an incumbent already
  exists." If you're Zod-only and warm throughput of realistic values is your top concern, a
  Zod-native mocker may be faster; this library's value is one API across validators, plus
  seeding and typed output.

## Reproducing

```sh
cd bench
npm install
node bench.mjs          # warm, steady-state
node cold-dumb.mjs       # cold start, defaultBackend
node cold-faker.mjs      # cold start, fakerBackend
node cold-zodmock.mjs    # cold start, @anatine/zod-mock
```
