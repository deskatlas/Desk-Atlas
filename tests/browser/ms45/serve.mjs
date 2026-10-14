// MS45-TC06..10/12: existing Vite runtime, localhost-only synthetic fixture.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vitest/package.json'));
const { createServer } = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const server = await createServer({ configFile: fileURLToPath(new URL('./vite.config.mjs', import.meta.url)) });
await server.listen();
server.printUrls();
