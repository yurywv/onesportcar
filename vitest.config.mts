import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", fileParallelism: false, testTimeout: 30000, env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://verisy@localhost:5432/onesportcar_test" } },
});
