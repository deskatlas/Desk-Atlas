// MS49-TC01-07 / QAD-TC44: compare real app CSS and shared components.
// Mount tests/fixtures/ms49-assistant-browser.tsx at /ms49-fixture in both
// local apps before running. Remove the temporary routes before building.
const { chromium } = require(process.env.MS49_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const output = path.resolve(process.env.MS49_OUTPUT || 'node_modules/.cache/ms49');
fs.mkdirSync(output, { recursive: true });
const selectors = ['[data-assistant-panel]', '[data-assistant-panel] header', '#assistant-title', '[aria-label="Close assistant"]', '[data-assistant-panel] form', '#assistant-message', '[type="submit"]', 'article', 'article p', 'article button', 'table', 'label', '[aria-label="Published source excerpt"]', '[aria-label="Published source excerpt"] h3', '[role="alert"]'];
async function measure(page, targets) {
  return page.evaluate(targets => Object.fromEntries(targets.map(selector => {
    const element = document.querySelector(selector);
    if (!element) return [selector, null];
    const r = element.getBoundingClientRect(), c = getComputedStyle(element);
    return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, display: c.display, padding: c.padding, font: c.font, color: c.color, background: c.backgroundColor, border: c.borderWidth === '0px' ? '0px' : c.border, radius: c.borderRadius, shadow: c.boxShadow, lineHeight: c.lineHeight, gap: c.gap, align: c.alignItems }];
  })), targets);
}
(async () => {
  const browser = await chromium.launch({ channel: process.env.MS49_BROWSER || 'msedge', headless: true });
  const failures = [], evidence = [];
  try {
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 844], [720, 450], [390, 420]]) {
      for (const state of ['empty', 'populated', 'loading', 'error', 'source', 'long']) {
        const pages = await Promise.all([3000, 3003].map(async port => {
          const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
          await page.goto(`http://localhost:${port}/ms49-fixture?state=${state}`);
          await page.locator('[aria-label="Open DeskAtlas Assistant"]').waitFor();
          await page.evaluate(() => document.fonts.ready);
          // Exclude the Next.js development indicator from product screenshots.
          await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
          return page;
        }));
        const launchers = await Promise.all(pages.map(p => measure(p, ['[aria-label="Open DeskAtlas Assistant"]', '[aria-label="Open DeskAtlas Assistant"] svg'])));
        if (JSON.stringify(launchers[0]) !== JSON.stringify(launchers[1])) failures.push({ width, state, launcher: launchers });
        await Promise.all(pages.map(p => p.locator('#fixture-open').click()));
        const measurements = await Promise.all(pages.map(p => measure(p, selectors)));
        evidence.push({ width, height, state, measurements, launchers });
        if (JSON.stringify(measurements[0]) !== JSON.stringify(measurements[1])) failures.push({ width, state, panel: measurements });
        const captures = [];
        for (const [i, page] of pages.entries()) {
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) failures.push({ width, state, overflow: i });
          captures.push(await page.screenshot({ path: path.join(output, `${width}x${height}-${state}-${i === 0 ? 'admin' : 'staff'}.png`) }));
          if (state === 'empty') {
            if (await page.locator('#assistant-message').evaluate(e => e !== document.activeElement)) failures.push({ width, focusEntry: i });
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            if (await page.locator('[aria-label="Close assistant"]').evaluate(e => e !== document.activeElement)) failures.push({ width, focusTrap: i });
            await page.keyboard.press('Escape');
            if (await page.locator('#fixture-open').evaluate(e => e !== document.activeElement)) failures.push({ width, focusReturn: i });
          }
          await page.close();
        }
        // Empty-state copy intentionally differs by verified role. Other shared
        // states should be pixel identical in the same browser/font environment.
        if (state !== 'empty') {
          const [a, b] = captures.map(buffer => PNG.sync.read(buffer));
          let pixels = 0;
          for (let i = 0; i < a.data.length; i += 4) {
            // Compare the assistant, excluding intentional portal differences
            // in the underlying page visible through the backdrop.
            if ((i / 4) % a.width < a.width - Math.min(a.width, 560)) continue;
            if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) pixels++;
          }
          if (pixels) failures.push({ width, height, state, pixels });
        }
      }
    }
    fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(evidence, null, 2));
    fs.writeFileSync(path.join(output, 'failures.json'), JSON.stringify(failures, null, 2));
    console.log(`${failures.length ? 'FAIL' : 'PASS'}: ${failures.length} parity/accessibility failures; ${evidence.length} viewport/state comparisons. Evidence: ${output}`);
    process.exitCode = failures.length ? 1 : 0;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
