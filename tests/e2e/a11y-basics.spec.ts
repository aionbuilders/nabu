/**
 * E2E — accessibility basics (audit P-120, P-121).
 *
 *  A. the `label` prop names the editor (and no role override: headings stay headings)
 *  B. the base theme draws a focus indicator (not `outline: none`), light and dark
 *  C. the default link colour passes AA (4.5:1) on a light and on a dark page
 *  D. the slash menu is a listbox: options, groups, aria-selected, aria-activedescendant on the root, live announcement
 *  E. the callout icon button has an accessible name
 *
 * Written with the unit tests of the same lot (tests/unit/slash-menu-aria.svelte.test.js, readonly.svelte.test.js); run with the
 * whole e2e suite.
 */

import { test, expect } from './helpers/test.js';
import { gotoEditor, focusEditor, clearAndReset, insertBlock, flushRender } from './helpers/editor.js';
import { contrast } from './helpers/ui.js';

const ROOT = '[data-nabu-root]';

test.describe('A. accessible name', () => {
  test('label names the editable root, with no role override', async ({ page }) => {
    await gotoEditor(page, { label: 'Chapter text' });
    await expect(page.getByLabel('Chapter text')).toBeVisible();
    await expect(page.locator(ROOT)).toHaveAttribute('aria-label', 'Chapter text');
    await expect(page.locator(ROOT)).not.toHaveAttribute('role', /.*/);
    await expect(page.locator(ROOT)).not.toHaveAttribute('aria-multiline', /.*/);
  });

  test('without a label the root carries no aria-label', async ({ page }) => {
    await gotoEditor(page);
    await expect(page.locator(ROOT)).not.toHaveAttribute('aria-label', /.*/);
  });

  test('headings inside a named editor are still headings in the accessibility tree', async ({ page }) => {
    await gotoEditor(page, { label: 'Chapter text' });
    await clearAndReset(page);
    await insertBlock(page, 'heading', { text: 'A title', level: 2 });
    await flushRender(page);
    await expect(page.getByRole('heading', { name: 'A title', level: 2 })).toBeVisible();
  });
});

test.describe('B. focus indicator of the base theme', () => {
  test('a visible solid ring appears on focus, in the theme colour (light page)', async ({ page }) => {
    await gotoEditor(page);
    const readRing = () => page.locator(ROOT).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor };
    });
    const before = await readRing();
    expect(before.style === 'none' || before.width === 0 || before.style === 'auto').toBe(true); // nothing before the focus
    await focusEditor(page);
    const ring = await readRing();
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.color).toBe('rgb(11, 87, 208)'); // --nb-focus-ring on a light page (#0b57d0)
  });

  test('the ring is at least 3:1 against the page, light and dark', async ({ page }) => {
    const ratio = (a: string, b: string) => {
      const lum = (c: string) => {
        const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      };
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const [scheme, theme, bg] of [['light', 'light', 'rgb(255, 255, 255)'], ['dark', 'dark', 'rgb(18, 18, 18)']] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoEditor(page, { theme });
      await focusEditor(page);
      const color = await page.locator(ROOT).evaluate((el) => getComputedStyle(el).outlineColor);
      expect(ratio(color, bg), `${scheme}: ${color} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });
});

test.describe('C. link colour', () => {
  for (const [scheme, theme] of [['light', 'light'], ['dark', 'dark']] as const) {
    test(`links are at least 4.5:1 on a ${scheme} page`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoEditor(page, { theme });
      await clearAndReset(page);
      await page.evaluate(async () => {
        const n = (window as any).nabu;
        n.insert('paragraph', { delta: [{ insert: 'a ' }, { insert: 'link', attributes: { link: 'https://example.com' } }, { insert: ' here' }] });
        await n.commit();
      });
      await flushRender(page);
      const c = await contrast(page, '.nabu-link');
      expect(c.ratio, `${scheme}: ${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('D. slash menu ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
    await page.keyboard.type('/');
  });

  test('a named listbox of options, one selected, grouped without a visual change', async ({ page }) => {
    const menu = page.getByRole('listbox', { name: 'Insert block' });
    await expect(menu).toBeVisible();
    const options = menu.getByRole('option');
    expect(await options.count()).toBeGreaterThan(8);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(menu.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
    expect(await menu.getByRole('group').count()).toBeGreaterThan(1); // text, lists, blocks, media...
    // grouping adds no box: every option still spans the width of the menu
    const widths = await menu.locator('.nabu-slash-item').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);
  });

  test('the editor root controls the list and points at the active option; the live region says it', async ({ page }) => {
    const menu = page.getByRole('listbox', { name: 'Insert block' });
    const root = page.locator(ROOT);
    await expect(root).toHaveAttribute('aria-controls', (await menu.getAttribute('id'))!);
    const first = menu.getByRole('option').first();
    await expect(root).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!);

    await page.keyboard.press('ArrowDown');
    const second = menu.getByRole('option').nth(1);
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expect(root).toHaveAttribute('aria-activedescendant', (await second.getAttribute('id'))!);
    const live = page.locator('.nabu-slash-live');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveText(/, 2 of \d+$/);
    const title = await second.locator('.nabu-slash-title').textContent();
    await expect(live).toContainText(title!);
  });

  test('filtering narrows the options; Escape closes the menu and cleans the root', async ({ page }) => {
    const menu = page.getByRole('listbox', { name: 'Insert block' });
    await page.keyboard.type('head');
    const names = await menu.locator('.nabu-slash-title').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n.toLowerCase()).toContain('head');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.locator(ROOT)).not.toHaveAttribute('aria-controls', /.*/);
    await expect(page.locator(ROOT)).not.toHaveAttribute('aria-activedescendant', /.*/);
  });
});

test.describe('E. callout icon button', () => {
  test('has an aria-label, not only a title', async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await insertBlock(page, 'callout', { text: 'Careful' });
    await flushRender(page);
    const button = page.locator('.nabu-callout-icon');
    await expect(button).toHaveAttribute('aria-label', /Change callout type \(note\)/);
    await expect(page.getByRole('button', { name: /Change callout type/ })).toHaveCount(1);
  });
});
