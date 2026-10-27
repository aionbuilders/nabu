import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from './helpers/test.js';
import { waitForEditor, flushRender } from './helpers/editor.js';
import { outline, focusEnd, focusAt, focusEmpty, selectRange, collectErrors } from './helpers/model.js';
import { contrast } from './helpers/ui.js';

// The home page editor (src/site/HeroEditor.svelte): a persisted Nabu editor wearing the "Atelier" theme
// (src/lib/themes/atelier.css). The model is read through window.nabu, exposed by the E2E build only.

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';

const SEED =
  'p(Start typing — this is Nabu.) ; p(Press / for blocks, ::: for a region, ⌘Z to rewind.) ; ' +
  'R:section-2(The bank){ ul[Bold, italic, links, code, Lists, quotes, code blocks] ; p(Everything you type is kept in this browser.) }';
const LAST = 'Everything you type is kept in this browser.';

const DARK = { pane: 'rgb(20, 20, 22)', float: 'rgb(28, 28, 32)', text: 'rgb(237, 237, 237)' };
const LIGHT = { pane: 'rgb(255, 255, 255)', float: 'rgb(255, 255, 255)', text: 'rgb(20, 20, 22)' };

const pane = (page: Page) => page.locator('[data-nabu-root]');
const scope = (page: Page) => page.getByTestId('hero-editor');

async function open(page: Page) {
  await page.goto('/');
  await waitForEditor(page);
  await expect(pane(page)).toBeVisible();
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('home editor', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });

  test('renders the seeded content: the model, the bold mark, the accessible name', async ({ page }) => {
    await open(page);
    expect(await outline(page)).toBe(SEED);
    await expect(page.getByTestId('hero-editor-skeleton')).toHaveCount(0);
    await expect(pane(page).locator('.nabu-bold')).toHaveText('Start typing');
    await expect(pane(page).locator('[data-block-type="region"]')).toHaveText('The bank');
    await expect(page.getByRole('textbox', { name: 'Try Nabu' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(true);
    // the editor sits inside the Atelier scope, which is bound to the site theme (system here)
    await expect(scope(page)).toHaveClass(/nb-theme-atelier/);
    await expect(scope(page)).toHaveAttribute('data-nb-scheme', 'auto');
    await expect(scope(page).locator('[data-nabu-root]')).toHaveCount(1);
  });

  test('typing works', async ({ page }) => {
    await open(page);
    await focusEnd(page, LAST);
    await page.keyboard.type(' Yes, really.');
    await expect.poll(() => outline(page)).toContain('p(' + LAST + ' Yes, really.)');
  });

  test('edits are kept after a reload; Reset restores the seed (and the reset is kept)', async ({ page }) => {
    await open(page);
    await focusEnd(page, LAST);
    await page.keyboard.type(' Kept.');
    await expect.poll(() => outline(page)).toContain('Kept.)');
    await page.evaluate(() => (window as any).nabu.saveNow());

    await page.reload();
    await waitForEditor(page);
    expect(await page.evaluate(() => (window as any).nabu.isNew)).toBe(false);
    await expect.poll(() => outline(page)).toContain('p(' + LAST + ' Kept.)');

    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByText('Editor reset')).toHaveCount(1);
    await page.waitForFunction(() => (window as any).__nabu_ready === true);
    await expect.poll(() => outline(page)).toBe(SEED);
    await expect(pane(page)).toBeVisible();
    // the reset is itself stored: a reload shows the seed
    await page.evaluate(() => (window as any).nabu.saveNow());
    await page.reload();
    await waitForEditor(page);
    expect(await outline(page)).toBe(SEED);
  });

  test('the slash menu opens inside the theme scope, on the theme surface', async ({ page }) => {
    await open(page);
    await focusEnd(page, 'Press / for blocks, ::: for a region, ⌘Z to rewind.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    const menu = page.locator('.nabu-slash');
    await expect(menu).toBeVisible();
    expect(await menu.evaluate((el) => !!el.closest('.nb-theme-atelier'))).toBe(true);
    const bg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe(DARK.float);
    // the themed floating shadow and radius, and the theme font (buttons do not inherit one by default)
    const look = await menu.evaluate((el) => {
      const cs = getComputedStyle(el);
      const item = getComputedStyle(el.querySelector('.nabu-slash-item')!);
      return { radius: cs.borderRadius, shadow: cs.boxShadow, family: item.fontFamily };
    });
    expect(look.radius).toBe('10px');
    expect(look.shadow).toContain('rgba(0, 0, 0, 0.5)');
    expect(look.family).toContain('Inter');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('the floating toolbar appears on a selection, inside the scope', async ({ page }) => {
    await open(page);
    await selectRange(page, 'Start typing — this is Nabu.', 0, 'Start typing — this is Nabu.', 5);
    const bar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => !!el.closest('.nb-theme-atelier'))).toBe(true);
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(DARK.float);
    await bar.getByRole('button', { name: 'Italic' }).click();
    await expect.poll(() => pane(page).locator('.nabu-italic').first().textContent()).toBe('Start');
  });

  test('the region seam is drawn by the theme: mark, uppercase label, hairline', async ({ page }) => {
    await open(page);
    const seam = pane(page).locator('.nabu-region-seam');
    const s = await seam.evaluate((el) => {
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const rule = getComputedStyle(el.querySelector('.nabu-region-rule')!);
      return { transform: cs.textTransform, size: cs.fontSize, mark: before.content, rule: rule.borderTopColor };
    });
    expect(s.transform).toBe('uppercase');
    expect(s.size).toBe('12px');
    expect(s.mark).toContain('url(');
    expect(s.rule).toBe('rgb(42, 42, 46)');
  });

  test('dark / light follow the site theme: the editor colours change', async ({ page }) => {
    await open(page);
    const read = () =>
      pane(page).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color, caret: cs.caretColor, scheme: el.closest('.nb-theme-atelier')!.getAttribute('data-nb-scheme') };
      });
    const toggle = page.getByTestId('theme-toggle');
    // system (dark OS) -> dark -> light, clicking the site's toggle
    expect(await read()).toMatchObject({ bg: DARK.pane, color: DARK.text, scheme: 'auto' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'dark');
    expect(await read()).toMatchObject({ bg: DARK.pane, scheme: 'dark', caret: 'rgb(255, 111, 97)' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'light');
    expect(await read()).toMatchObject({ bg: LIGHT.pane, color: LIGHT.text, scheme: 'light', caret: 'rgb(194, 56, 31)' });
    // floating UI follows too
    await selectRange(page, 'Start typing — this is Nabu.', 0, 'Start typing — this is Nabu.', 5);
    await expect(page.locator('.nabu-toolbar')).toBeVisible();
    expect(await page.locator('.nabu-toolbar').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(LIGHT.float);
    // text contrast on the pane, in both schemes (WCAG 4.5:1)
    const light = await contrast(page, '[data-nabu-root] [data-block-type="paragraph"]');
    expect(light.ratio).toBeGreaterThanOrEqual(4.5);
    await toggle.click(); // system (OS dark)
    await expect(toggle).toHaveAttribute('data-mode', 'system');
    expect(await read()).toMatchObject({ bg: DARK.pane, scheme: 'auto' });
  });

  test('text contrast is at least 4.5:1 in both schemes (text, list, seam label, placeholder, floating UI)', async ({ page }) => {
    await open(page);
    await focusEnd(page, 'Press / for blocks, ::: for a region, ⌘Z to rewind.');
    await page.keyboard.press('Enter'); // an empty paragraph holding the caret shows its placeholder
    await expect(pane(page).locator('[data-placeholder="Start writing..."]')).toHaveCount(1);
    const toggle = page.getByTestId('theme-toggle');
    const checks: Array<[string, string, string?]> = [
      ['paragraph', '[data-nabu-root] [data-block-type="paragraph"]'],
      ['list item', '[data-nabu-root] .item-content'],
      ['seam label', '[data-nabu-root] .nabu-region-label'],
      ['seam title', '[data-nabu-root] .nabu-region-title'],
      ['placeholder', '[data-nabu-root] [data-placeholder="Start writing..."]', '::after'],
      ['Reset', '[data-testid="hero-editor-reset"]'],
    ];
    for (const mode of ['dark', 'light']) {
      while ((await toggle.getAttribute('data-mode')) !== mode) await toggle.click();
      await expect(pane(page)).toHaveAttribute('role', 'textbox');
      await focusEmpty(page); // the caret in the empty paragraph: its placeholder shows
      await expect(pane(page).locator('[data-placeholder="Start writing..."]')).toHaveCount(1);
      for (const [name, sel, pseudo] of checks) {
        const c = await contrast(page, sel, { pseudo });
        expect(c.ratio, `${mode}: ${name} ${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
      }
      await selectRange(page, 'Start typing — this is Nabu.', 0, 'Start typing — this is Nabu.', 5);
      await expect(page.locator('.nabu-toolbar')).toBeVisible();
      const c = await contrast(page, '.nabu-toolbar-btn');
      expect(c.ratio, `${mode}: toolbar button ${c.fg} on ${c.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the system theme: an OS in light mode gives the light theme', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await open(page);
    expect(await pane(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(LIGHT.pane);
    await ctx.close();
  });

  test('keyboard: the editor is reachable with Tab and shows a visible focus ring', async ({ page }) => {
    await open(page);
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-nabu-root') ?? false);
    }
    expect(reached, 'Tab reaches the editor').toBe(true);
    const ring = await pane(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
    expect(ring).toEqual({ style: 'solid', width: '2px', color: 'rgb(255, 111, 97)' });
    // Tab leaves the editor again (no keyboard trap): the next stop is the Reset button
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reset' })).toBeFocused();
  });

  test('selection is visible: the theme colours ::selection in the editor', async ({ page }) => {
    await open(page);
    const sel = await page.evaluate(() => {
      const el = document.querySelector('[data-nabu-root] [data-block-type="paragraph"]')!;
      return getComputedStyle(el, '::selection').backgroundColor;
    });
    expect(sel).toBe('rgba(255, 111, 97, 0.3)');
  });

  test('no request leaves localhost', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => { if (new URL(r.url()).hostname !== 'localhost') external.push(r.url()); });
    await open(page);
    await focusEnd(page, LAST);
    await page.keyboard.type(' x');
    await page.evaluate(() => (window as any).nabu.saveNow());
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
  });

  test('the skeleton has the editor\'s size: no layout shift when it hydrates', async ({ browser }) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 800 }]) {
      const nojs = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark', viewport });
      const p1 = await nojs.newPage();
      await p1.goto('/');
      const before = {
        box: (await scope(p1).boundingBox())!,
        reset: (await p1.getByTestId('hero-editor-reset').boundingBox())!,
      };
      await nojs.close();
      const ctx = await browser.newContext({ colorScheme: 'dark', viewport });
      const p2 = await ctx.newPage();
      await open(p2);
      const after = {
        box: (await scope(p2).boundingBox())!,
        reset: (await p2.getByTestId('hero-editor-reset').boundingBox())!,
      };
      await ctx.close();
      expect(after.box.y).toBeCloseTo(before.box.y, 0);
      expect(Math.abs(after.box.height - before.box.height), `pane height at ${viewport.width}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(after.reset.y - before.reset.y), `Reset position at ${viewport.width}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('home editor, phone', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 375, height: 800 }, hasTouch: false });

  test('375px: no horizontal scroll, the editor is usable', async ({ page }) => {
    await open(page);
    const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(dims.sw).toBeLessThanOrEqual(dims.iw);
    const box = (await pane(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await focusEnd(page, LAST);
    await page.keyboard.type(' ok');
    await expect.poll(() => outline(page)).toContain(LAST + ' ok)');
    const after = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(after.sw).toBeLessThanOrEqual(after.iw);
    // the Reset target is large enough to tap
    const reset = (await page.getByRole('button', { name: 'Reset' }).boundingBox())!;
    expect(reset.height).toBeGreaterThanOrEqual(44);
  });
});

// Screenshots for review (not assertions): written to the scratchpad.
test.describe('home editor, screenshots', () => {
  test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

  const shot = async (page: Page, name: string, full = false) => {
    await flushRender(page);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
  };

  test('1440 dark / light, region light', async ({ browser }) => {
    for (const scheme of ['dark', 'light'] as const) {
      const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await open(page);
      await page.evaluate(() => document.fonts.ready);
      await focusEnd(page, LAST);
      await shot(page, `hero-1440-${scheme}`);
      if (scheme === 'light') {
        await focusAt(page, 'Bold, italic, links, code', 4);
        await shot(page, 'hero-region-light');
      }
      await ctx.close();
    }
  });

  test('375 dark', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 375, height: 900 } });
    const page = await ctx.newPage();
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'hero-375-dark', true);
    await ctx.close();
  });

  test('slash menu and toolbar, dark', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await open(page);
    await page.evaluate(() => document.fonts.ready);
    await selectRange(page, 'Start typing — this is Nabu.', 0, 'Start typing — this is Nabu.', 5);
    await expect(page.locator('.nabu-toolbar')).toBeVisible();
    await shot(page, 'hero-toolbar-dark');
    await focusEnd(page, 'Press / for blocks, ::: for a region, ⌘Z to rewind.');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(page.locator('.nabu-slash')).toBeVisible();
    await shot(page, 'hero-slash-dark');
    await page.keyboard.press('Escape');
    await ctx.close();
  });
});
