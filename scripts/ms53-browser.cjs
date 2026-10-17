// MS53-TC06/07: synthetic rendering acceptance in each portal's real layout.
const { chromium } = require(process.env.MS53_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve('node_modules/.cache/ms53/presentation');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const width of [1440, 390, 320]) {
      const parity = [];
      for (const port of [3000, 3003]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.goto(`http://localhost:${port}/ms53-fixture`, { timeout: 60000 });
        await page.locator('#fixture-open').click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-assistant-panel]')).fontFamily.includes('Plus Jakarta Sans'));
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('article ol li').count(), 8);
        assert.equal(await page.locator('article ol').evaluate(element => getComputedStyle(element).listStyleType), 'decimal');
        assert.equal(await page.locator('article h3').textContent(), 'Customer Check-Out');
        assert.equal(await page.locator('article strong').textContent(), 'Admin only: payment approval');
        assert.equal(await page.locator('article script, article a').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.getByText('Data as of', { exact: false }).last().waitFor();
        assert.ok((await page.locator('article').textContent()).includes('Oct 15, 2026, 2:16 PM (Asia/Manila)'));
        assert.ok((await page.locator('article').textContent()).includes('Snapshot may be stale.'));
        assert.equal(await page.getByText('INCOMPLETE_EVIDENCE: CONTEXT_BUDGET', { exact: true }).isVisible(), false);
        await page.getByRole('button', { name: /Synthetic Operations SOP/ }).click();
        assert.ok((await page.locator('[aria-label="Published source excerpt"]').textContent()).includes('1\\. Verify'));
        assert.equal(await page.locator('[aria-label="Published source excerpt"] script').count(), 0);
        await page.getByRole('button', { name: 'Close source excerpt' }).click();
        parity.push(await page.locator('article').evaluate(element => ({ text: element.textContent, list: element.querySelector('ol').outerHTML, font: getComputedStyle(element).font, width: element.getBoundingClientRect().width })));
        await page.locator('article h3').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${port}-${width}.png`) });
        await page.locator('#assistant-message').focus();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#fixture-open').evaluate(element => element === document.activeElement), true);
        await page.close();
      }
      assert.deepEqual(parity[0], parity[1]);
      results.push({ width, portals: 2, semanticSteps: 8, parity: true, inertSources: true, focusReturn: true });
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS: MS53 semantic steps, citations, metadata, focus and narrow-layout parity in six rendered states.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
