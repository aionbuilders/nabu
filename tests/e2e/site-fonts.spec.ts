import { test, expect } from './helpers/test.js';

// Font preloads must point at the exact URL a @font-face rule uses, or the browser downloads twice (or the preload is dead).

// Not an editor test: the DOM invariant would fire on a docs page whose code block is still laying out when the test ends.
test.use({ domInvariant: false });

for (const path of ['/', '/changelog', '/docs/getting-started/installation']) {
  test(`${path}: every preloaded font is used by a @font-face rule (same URL)`, async ({ page }) => {
    await page.goto(path);
    const { preloaded, faces } = await page.evaluate(() => {
      const preloaded = [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((l) => new URL(/** @type {HTMLLinkElement} */ (l).href, location.href).href);
      const faces: string[] = [];
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          if (r instanceof CSSFontFaceRule) {
            for (const m of r.style.getPropertyValue('src').matchAll(/url\("?([^")]+)"?\)/g)) faces.push(new URL(m[1], sheet.href ?? location.href).href);
          }
        }
      }
      return { preloaded, faces };
    });
    expect(preloaded.length).toBeGreaterThan(0);
    for (const url of preloaded) expect(faces, `preload ${url} has no matching @font-face`).toContain(url);
  });
}
