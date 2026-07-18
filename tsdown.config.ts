import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/faker/index.ts", "src/chance/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
});
