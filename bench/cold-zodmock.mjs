import { generateMock } from "@anatine/zod-mock";
import { z as z3 } from "zod";

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

const start = process.hrtime.bigint();
generateMock(UserV3);
const end = process.hrtime.bigint();
console.log(`@anatine/zod-mock, cold: ${(Number(end - start) / 1e6).toFixed(2)}ms`);
