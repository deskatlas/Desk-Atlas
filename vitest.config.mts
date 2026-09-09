import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    include: ["tests/t*.test.ts", "tests/mf*.test.ts", "tests/staff*.test.ts"],
    passWithNoTests: true,
    environment: "node",
    testTimeout: 20000,
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/**/src/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@deskatlas/domain": path.resolve(__dirname, "packages/domain/src"),
      "@deskatlas/ui": path.resolve(__dirname, "packages/ui/src"),
      "@deskatlas/validation": path.resolve(__dirname, "packages/validation/src"),
      "@deskatlas/config": path.resolve(__dirname, "packages/config/src"),
    },
  },
});
