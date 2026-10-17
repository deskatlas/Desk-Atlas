import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// MS49-TC03 / QAD-TC44: compile the real staff CSS entry, not the unused
// tailwind.css file. Browser geometry acceptance lives in ms49-browser.cjs.
const staffRequire = createRequire(resolve('apps/staff-dashboard/package.json'));
const pluginPath = staffRequire.resolve('@tailwindcss/postcss');
const postcss = createRequire(pluginPath)('postcss') as typeof import('postcss');
const tailwind = staffRequire('@tailwindcss/postcss') as (options: { base: string; optimize: boolean }) => import('postcss').Plugin;

describe('MS-49 staff assistant style delivery', () => {
  it('emits shared button sizing, centering and loading utilities through the active production pipeline', async () => {
    const entry = resolve('apps/staff-dashboard/src/styles/tokens.css');
    const result = await postcss([tailwind({ base: resolve('apps/staff-dashboard'), optimize: true })]).process(readFileSync(entry, 'utf8'), { from: entry });
    for (const selector of ['.inline-flex', '.items-center', '.justify-center', '.gap-2', '.px-3', '.py-1\\.5', '.text-xs', '.rounded-lg', '.animate-spin', '.h-3\\.5', '.w-3\\.5', '.border-t-transparent']) {
      expect(result.css, `missing shared Button utility ${selector}`).toContain(selector);
    }
  });
});
