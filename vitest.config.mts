import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [{
    name: 'deskatlas-app-source-alias',
    async resolveId(source, importer) {
      if (!source.startsWith('@/') || !importer) return null;
      const app = importer.replace(/\\/g, '/').match(/\/apps\/([^/]+)\/src\//)?.[1];
      return app ? this.resolve(path.resolve(__dirname, 'apps', app, 'src', source.slice(2))) : null;
    },
  }],
  test: {
    include: ["tests/t*.test.ts", "tests/mf*.test.ts", "tests/ms*.test.ts", "tests/spec*.test.ts"],
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
