// Cold-start measurement: single first call in a fresh process. Must be run as its own
// `node` invocation (not from within bench.mjs) so module load + JIT warm-up genuinely
// reflect a cold process, matching a CLI/one-shot-script use case.
import { fake } from "standard-schema-faker";
import { z as z4 } from "zod-v4";

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

const start = process.hrtime.bigint();
fake(UserV4, { seed: 1 });
const end = process.hrtime.bigint();
console.log(`standard-schema-faker (root, dumb backend), cold: ${(Number(end - start) / 1e6).toFixed(2)}ms`);
