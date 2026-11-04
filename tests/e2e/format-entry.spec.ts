import { test, expect } from './helpers/test.js';

// `@aionbuilders/nabu/format` is the entry for pages that only read a document: it must not pull Loro's WebAssembly.
// The route /e2e/format (src/routes/e2e/format) imports nothing but that entry and renders a stored JSON export.

test('a page that only uses the /format entry requests no WebAssembly and renders the document right', async ({ page }) => {
  const wasmRequests: string[] = [];
  page.on('request', (request) => {
    if (/\.wasm(\?|$)/.test(request.url()) || request.resourceType() === 'wasm') wasmRequests.push(request.url());
  });
  // Nothing may even try to compile a module (an inlined WebAssembly would not show up as a request).
  await page.addInitScript(() => {
    (window as any).__wasmCalls = 0;
    for (const name of ['instantiate', 'instantiateStreaming', 'compile', 'compileStreaming'] as const) {
      const original = (WebAssembly as any)[name];
      if (typeof original !== 'function') continue;
      (WebAssembly as any)[name] = function (...args: unknown[]) {
        (window as any).__wasmCalls++;
        return original.apply(this, args);
      };
    }
  });

  await page.goto('/e2e/format', { waitUntil: 'networkidle' });
  const viewer = page.getByTestId('viewer');
  await expect(viewer.locator('h2')).toHaveText('Release notes');

  // The HTML: marks as tags, a safe link live, an unsafe one only a label, markup escaped.
  await expect(viewer.locator('p').first().locator('strong')).toHaveText('paste');
  await expect(viewer.locator('a')).toHaveCount(1);
  await expect(viewer.locator('a')).toHaveAttribute('href', 'https://example.com/guide');
  await expect(viewer.locator('p').nth(1)).toHaveText('click me <script>x</script>');
  await expect(viewer.locator('script')).toHaveCount(0);
  await expect(viewer.locator('li li')).toHaveText('nested');

  // The text, from the same JSON.
  await expect(page.getByTestId('text')).toHaveText('Release notes\n\nFaster paste, 5 * 3 and a guide\n\nclick me <script>x</script>\n\none\nnested\ntwo');
  await expect(page.getByTestId('helpers')).toHaveText('safe');

  expect(wasmRequests).toEqual([]);
  expect(await page.evaluate(() => (window as any).__wasmCalls)).toBe(0);
});
