import { test, expect } from './helpers/test.js';
import { gotoEditor } from './helpers/editor';

const root = '[data-nabu-root]';
const attrs = (page: any) =>
  page.locator(root).evaluate((el: HTMLElement) => ({
    spellcheck: el.getAttribute('spellcheck'),
    lang: el.getAttribute('lang'),
    gramm: el.getAttribute('data-gramm'),
    grammEditor: el.getAttribute('data-gramm_editor'),
    grammarly: el.getAttribute('data-enable-grammarly'),
  }));

test.describe('spellcheck & lang options', () => {
  test('default: spellcheck on, no lang, no opt-out hints', async ({ page }) => {
    await gotoEditor(page);
    expect(await attrs(page)).toEqual({ spellcheck: 'true', lang: null, gramm: null, grammEditor: null, grammarly: null });
  });

  test('spellcheck false + lang fr: attributes set on the root', async ({ page }) => {
    await gotoEditor(page, { options: { spellcheck: false, lang: 'fr' } });
    expect(await attrs(page)).toEqual({ spellcheck: 'false', lang: 'fr', gramm: 'false', grammEditor: 'false', grammarly: 'false' });
  });

  test('invalid lang is ignored (no attribute)', async ({ page }) => {
    await gotoEditor(page, { options: { lang: 'not a tag' } });
    expect((await attrs(page)).lang).toBeNull();
  });

  test('code blocks always stay spellcheck="false"', async ({ page }) => {
    await gotoEditor(page, { options: { spellcheck: true } });
    await page.evaluate(() => {
      const n = (window as any).nabu;
      n.insert('code', {});
      return n.commit();
    });
    const code = page.locator('pre[data-block-type="code"]');
    await expect(code).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator(root)).toHaveAttribute('spellcheck', 'true');
  });

  test('runtime toggles update the attributes', async ({ page }) => {
    await gotoEditor(page);
    await page.evaluate(() => { (window as any).nabu.spellcheck = false; (window as any).nabu.lang = 'de'; });
    await expect(page.locator(root)).toHaveAttribute('spellcheck', 'false');
    await expect(page.locator(root)).toHaveAttribute('data-gramm', 'false');
    await expect(page.locator(root)).toHaveAttribute('lang', 'de');
    await page.evaluate(() => { (window as any).nabu.spellcheck = true; (window as any).nabu.lang = undefined; });
    await expect(page.locator(root)).toHaveAttribute('spellcheck', 'true');
    await expect(page.locator(root)).not.toHaveAttribute('data-gramm', /.*/);
    await expect(page.locator(root)).not.toHaveAttribute('lang', /.*/);
  });
});
