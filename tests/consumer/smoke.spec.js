import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Consumer smoke test: see scripts/consumer-smoke.js. The app under test installed the PACKED package.

const ROUTES = [
  { path: '/', name: 'SSR page' },
  { path: '/csr', name: 'client-only page (ssr = false)' },
  { path: '/lazy', name: 'lazy import', open: '#open' },
  { path: '/ssr', name: 'server-built document' },
];

for (const route of ROUTES) {
  test(`${route.name} (${route.path}): the editor boots and takes typing`, async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

    const response = await page.goto(route.path);
    expect(response?.status()).toBe(200);
    if (route.path === '/ssr') {
      // Present in the HTML sent by the server, before any JavaScript.
      expect(await response?.text()).toContain('Rendered on the server.');
    }
    if (route.open) await page.click(route.open);
    // A boot that fails usually throws before `__ready`: report those errors, not just the timeout.
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 }).catch((e) => {
      expect(errors, 'the page threw before the editor was ready').toEqual([]);
      throw e;
    });

    const editable = page.locator('.nabu-editor [contenteditable="true"], [contenteditable="true"]').first();
    await editable.click();
    await page.keyboard.type('Hello é');
    await expect.poll(() => page.evaluate(() => window.__engine.serialize('text'))).toContain('Hello é');
    // The browser's engine loaded the document the server built.
    if (route.path === '/ssr') expect(await page.evaluate(() => window.__engine.serialize('text'))).toContain('Rendered on the server.');

    expect(errors).toEqual([]);
  });
}

test('@aionbuilders/nabu/format loads in plain Node and renders text', () => {
  const app = process.env.NABU_CONSUMER_APP;
  const out = execFileSync('node', ['-e', `
    import('@aionbuilders/nabu/format').then((f) => {
      process.stdout.write(f.jsonToText({ version: '1', blocks: [{ type: 'paragraph', content: [{ text: 'Plain Node é' }] }] }));
    });
  `], { cwd: app, encoding: 'utf8' });
  expect(out).toBe('Plain Node é');
});
