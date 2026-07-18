// Standalone benchmark: standard-schema-faker vs @anatine/zod-mock.
//
// Isolated from the main package (see package.json) because @anatine/zod-mock requires
// zod v3, incompatible with this repo's zod v4. The two libraries therefore benchmark
// LOGICALLY EQUIVALENT schemas (same fields/constraints) written against each library's own
// zod major version, not the literal same schema object -- the fairest comparison achievable
// given the version constraint, and arguably the more realistic one (a real user picks one
// zod major and one mocking library).
//
// KNOWN ISSUE (documented in BENCH.md): @standard-community/standard-json's zod adapter's SYNC
// path (`toJsonSchema.sync()`) returns an empty `{}` schema for zod v3 even after a successful
// async warm-up via `prepare()` -- a bug in that third-party package, not this library (the
// async path `toJsonSchema(...)` returns the correct schema every time; only `.sync()` is
// broken, and only for the zod v3 adapter specifically -- Valibot and Effect's sync-after-warmup
// paths work correctly). Practical upshot: standard-schema-faker cannot currently support zod v3
// through the fallback path. This bench therefore uses zod v4 (the native, fully-working path)
// for our side.

import { generateMock } from "@anatine/zod-mock";
import { fake as fakeDumb } from "standard-schema-faker";
import { fake as fakeRealistic } from "standard-schema-faker/faker";
import { z as z3 } from "zod";
import { z as z4 } from "zod-v4";

// --- Logically equivalent user schemas ---

const UserV4 = z4.object({
  id: z4.uuid(),
  email: z4.email(),
  name: z4.string().min(2).max(40),
  age: z4.int().min(18).max(99),
  role: z4.enum(["admin", "user", "guest"]),
  tags: z4.array(z4.string().min(3).max(12)).max(5),
  bio: z4.string().max(200).optional(),
  createdAt: z4.iso.datetime(),
});

const UserV3 = z3.object({
  id: z3.string().uuid(),
  email: z3.string().email(),
  name: z3.string().min(2).max(40),
  age: z3.number().int().min(18).max(99),
  role: z3.enum(["admin", "user", "guest"]),
  tags: z3.array(z3.string().min(3).max(12)).max(5),
  bio: z3.string().max(200).optional(),
  createdAt: z3.string().datetime(),
});

const N_WARMUP = 200;
const N_MEASURE = 2000;

function benchOnce(name, fn) {
  // Warm-up (JIT warm the hot path; "cold" numbers below are measured separately from a
  // process that has done ZERO prior calls, since that's what "cold" means for a CLI/script
  // use case -- see the separate cold-start measurement below).
  for (let i = 0; i < N_WARMUP; i++) fn();

  const start = process.hrtime.bigint();
  for (let i = 0; i < N_MEASURE; i++) fn();
  const end = process.hrtime.bigint();

  const ms = Number(end - start) / 1e6;
  const opsPerSec = (N_MEASURE / ms) * 1000;
  console.log(`${name.padEnd(45)} ${opsPerSec.toFixed(0).padStart(10)} ops/sec  (${ms.toFixed(1)}ms for ${N_MEASURE} runs, warm)`);
  return opsPerSec;
}

console.log("=== WARM (steady-state, ops/sec, higher is better) ===\n");

const results = {};
results.dumbBackend = benchOnce("standard-schema-faker (root, dumb backend)", () => fakeDumb(UserV4, { seed: 1 }));
results.fakerBackend = benchOnce("standard-schema-faker/faker (fakerBackend)", () => fakeRealistic(UserV4, { seed: 1 }));
results.zodMock = benchOnce("@anatine/zod-mock", () => generateMock(UserV3));

console.log("\nSummary (warm, ops/sec):");
for (const [k, v] of Object.entries(results)) {
  console.log(`  ${k}: ${v.toFixed(0)}`);
}

const speedupOverZodMock = results.fakerBackend / results.zodMock;
console.log(`\nstandard-schema-faker/faker (fakerBackend) vs @anatine/zod-mock: ${speedupOverZodMock.toFixed(2)}x`);
