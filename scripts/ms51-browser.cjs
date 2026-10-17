// MS51-TC01-10 / QAD-TC45: real Settings component with isolated API responses.
// Mount tests/fixtures/ms51-knowledge-browser.tsx at /ms51-fixture locally.
const { chromium } = require(process.env.MS51_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve('node_modules/.cache/ms51');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      for (const state of ['mixed', 'empty', 'cleanup', 'failed', 'denied', 'processing', 'uploading', 'queued', 'publish', 'delayed', 'lost']) {
        console.log(`MS51 ${width}: ${state}`);
        const page = await browser.newPage({ viewport: { width, height } });
        page.setDefaultTimeout(15000);
        await page.goto(`http://localhost:3000/ms51-fixture?state=${state}`, { timeout: 30000 });
        await page.getByRole('button', { name: 'Upload document', exact: true }).waitFor();
        await page.waitForFunction(() => !document.querySelector('button[disabled]'));
        if (state !== 'empty' && state !== 'cleanup') await page.getByText('Operating guide', { exact: true }).first().waitFor();
        await page.screenshot({ path: path.join(output, `${process.env.MS51_BASELINE ? 'before' : 'after'}-${width}-${state}.png`), fullPage: true });
        if (process.env.MS51_BASELINE) { await page.close(); continue; }
        assert.equal(await page.locator('article').count(), ['empty', 'cleanup'].includes(state) ? 0 : 1);
        assert.equal(await page.getByText('operating-guide-1.md', { exact: false }).count(), 0);
        assert.equal(await page.getByText('operating-guide-4.md', { exact: false }).count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (state === 'cleanup') {
          await page.getByText(/Artifact cleanup:/).click();
          await page.getByRole('button', { name: 'Retry cleanup' }).click();
          await page.getByText('Cleanup queued.').waitFor();
        }
        if (state === 'publish') {
          await page.getByRole('button', { name: 'Preview and review' }).click();
          const publish = page.getByRole('button', { name: 'Publish reviewed version' });
          assert.equal(await publish.isDisabled(), true);
          await page.getByLabel('Rule scope').selectOption('DOCUMENT');
          await page.getByRole('checkbox').check();
          await publish.click();
          await page.getByText('Document published.').waitFor();
          assert.equal(await page.getByText('operating-guide-2.md', { exact: false }).count(), 0);
          await page.reload();
          await page.getByText('operating-guide-3.md', { exact: true }).waitFor();
          assert.equal(await page.getByText('operating-guide-2.md', { exact: false }).count(), 0);
        }
        if (state === 'delayed') {
          await page.evaluate(() => { window.dispatchEvent(new Event('ms51-delay-read')); document.dispatchEvent(new Event('visibilitychange')); });
          await page.waitForTimeout(100);
        }
        if (['mixed', 'denied', 'delayed', 'lost'].includes(state)) {
          await page.getByRole('button', { name: 'Remove pending version' }).click();
          await page.getByRole('button', { name: 'Confirm removal' }).click();
          if (state === 'denied' || state === 'lost') {
            await page.getByRole('alert').first().waitFor();
            assert.equal(await page.locator('article').count(), 1);
            if (state === 'denied') await page.getByRole('button', { name: 'Close dialog' }).click();
            else await page.getByRole('button', { name: 'Upload document', exact: true }).waitFor({ state: 'visible' });
            assert.equal(await page.getByText('Version removed.', { exact: true }).count(), 0);
            if (state === 'lost') assert.equal(await page.getByText('operating-guide-3.md', { exact: true }).count(), 0);
          } else {
            await page.getByText('Version removed.').waitFor();
            assert.equal(await page.getByText('operating-guide-3.md', { exact: false }).count(), 0);
            assert.equal(await page.getByText('operating-guide-2.md', { exact: false }).count(), 1);
            assert.equal(await page.getByRole('button', { name: 'Upload document', exact: true }).evaluate(e => e === document.activeElement), true);
            await page.getByText('Document actions', { exact: true }).click();
            await page.getByRole('button', { name: 'Remove document', exact: true }).click();
            await page.getByRole('button', { name: 'Confirm removal' }).click();
            await page.getByText('Document removed. Cleanup continues in the background.').waitFor();
            assert.equal(await page.locator('article').count(), 0);
            if (state === 'delayed') {
              await page.evaluate(() => window.dispatchEvent(new Event('ms51-release-read')));
              await page.waitForTimeout(100);
              assert.equal(await page.locator('article').count(), 0);
            }
            await page.reload();
            await page.getByText('No knowledge documents yet.', { exact: false }).waitFor();
            assert.equal(await page.locator('article').count(), 0);
          }
        }
        await page.close();
      }
    }
    console.log(process.env.MS51_BASELINE ? 'MS51 baseline captured' : 'MS51 browser lifecycle and mobile checks passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
