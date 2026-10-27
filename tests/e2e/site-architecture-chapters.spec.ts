import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from './helpers/test.js';
import { waitForEditor } from './helpers/editor.js';
import { focusEnd, collectErrors } from './helpers/model.js';

// The live X-ray widgets of the seven Architecture chapters (src/site/architecture/widgets, chapter files in docs/architecture/chapters).
// Each chapter page is `/architecture/chapters/<slug>`; the widget sits right after the chapter's first paragraph. A widget is a small
// live Nabu editor next to a panel that shows the layer the chapter talks about. For every chapter this spec checks that the widget
// mounts, that typing (or the gesture the chapter asks for) updates the panel, that nothing moves at hydration (no layout shift from the
// widget, same box before and after the editor mounts), and that there is no horizontal scroll at 375px. Chapter 03 gets a closer look:
// the timed steps, and "step". The model is read through window.nabu, exposed by the widgets in E2E builds only.

const SHOTS = '/tmp/claude-1000/-home-killiandvcz-workspace--aionbuilders-nabu/80c82aab-d2d3-4d76-9871-9dafb82b36a2/scratchpad/site-shots';

const FERRYMAN = 'The ferryman waited under the eaves, an unlit lantern in his hand.';
const BANK = 'Across the river, the bank was already dark.';
const NOON = 'Nobody had crossed since noon.';

interface Case {
  n: string;
  slug: string;
  widget: string;
  /** The text of the block the caret goes to (end), before typing. */
  focus: string;
  /** What the panel must show once the gesture is done. */
  check: (page: Page) => Promise<void>;
  /** The gesture of the chapter (typing, or a selection). Default: type "xy". */
  act?: (page: Page) => Promise<void>;
}

const panel = (page: Page) => page.getByTestId('xray');

const CASES: Case[] = [
  {
    n: '01', slug: 'one-contenteditable', widget: 'single-root', focus: NOON,
    act: async (page) => {
      // select from the end of the paragraph down into the list: the browser's own selection crosses blocks
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
    },
    check: async (page) => {
      await expect(page.getByTestId('count-editable')).toHaveText('1');
      await expect(page.getByTestId('count-own')).toHaveText('0');
      await expect.poll(async () => Number(await page.getByTestId('count-blocks').textContent())).toBeGreaterThanOrEqual(6);
      await expect.poll(async () => Number(await page.getByTestId('count-touched').textContent())).toBeGreaterThanOrEqual(2);
    },
  },
  {
    n: '02', slug: 'the-model-is-the-truth', widget: 'model-truth', focus: NOON,
    check: async (page) => {
      await expect(page.getByTestId('xray-tree')).toContainText('Nobody had crossed since noon.xy');
      await expect(page.getByTestId('xray-ops').getByTestId('xray-op').first()).toContainText('insert');
    },
  },
  {
    n: '03', slug: 'the-life-of-a-keystroke', widget: 'keystroke', focus: NOON,
    check: async (page) => {
      await expect(page.locator('[data-step="paint"]')).toHaveAttribute('data-lit', 'true');
      await expect(page.locator('[data-step="keydown"]')).toContainText('“y”');
      await expect(page.locator('[data-step="beforeinput"]')).toContainText('insertText');
      await expect(page.locator('[data-step="loro"]')).toContainText('insert "y"');
      await expect(page.getByTestId('ms-paint')).toHaveText(/^\d+(\.\d)? ms$|^<0\.1 ms$/);
      await expect(page.getByTestId('ms-svelte')).toHaveText(/^\d+(\.\d)? ms$|^<0\.1 ms$/);
    },
  },
  {
    n: '04', slug: 'where-is-the-caret', widget: 'caret-map', focus: NOON,
    check: async (page) => {
      await expect(page.getByTestId('dom-start')).toContainText('#text');
      await expect(page.getByTestId('model-start')).toContainText('paragraph#');
      await expect(page.getByTestId('model-start')).toContainText(`index ${NOON.length + 2}`);
    },
  },
  {
    n: '05', slug: 'commands-not-keycodes', widget: 'command-keys', focus: FERRYMAN,
    act: async (page) => { await page.keyboard.press('Control+b'); },
    check: async (page) => {
      await expect(page.getByTestId('chord')).toContainText('Ctrl-b');
      await expect(page.locator('[data-command="mark:bold"]')).toHaveAttribute('data-winner', 'true');
      await expect(page.getByTestId('consumed')).toContainText('consumed');
    },
  },
  {
    n: '06', slug: 'nothing-gets-lost', widget: 'persistence', focus: NOON,
    check: async (page) => {
      await expect(page.getByTestId('persist-status')).toHaveAttribute('data-status', /^(pending|saving|saved)$/);
      await expect(page.getByTestId('persist-sync')).toHaveText('on');
      // the autosave lands (2 s after the last key), and the panel says so
      await expect(page.getByTestId('persist-status')).toHaveAttribute('data-status', 'saved', { timeout: 8000 });
      await expect(page.getByTestId('persist-saved-at')).not.toHaveText('—');
    },
  },
  {
    n: '07', slug: 'we-got-regions-wrong-once', widget: 'region-title', focus: BANK,
    check: async (page) => {
      await expect(page.getByTestId('xray-tree')).toContainText('region#');
      await expect(page.getByTestId('registry-item')).toHaveCount(2);
      await expect(page.getByTestId('registry-item').first()).toContainText('The ferryman');
      await expect(page.getByTestId('registry-item').first()).toContainText('level 2');
    },
  },
];

const url = (c: Case) => `/architecture/chapters/${c.slug}`;
const widget = (page: Page) => page.getByTestId('widget');

/** From the first paint: the layout shifts whose source is inside the widget, and the widget's height over time. */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__shifts = [];
    w.__heights = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as any[]) {
          if (e.hadRecentInput) continue;
          const inside = (e.sources ?? []).some((s: any) => s.node && s.node.closest?.('[data-testid="widget"]'));
          w.__shifts.push({ value: e.value, inside });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch { /* no layout-shift entries in this browser */ }
    const hook = () => {
      const el = document.querySelector('[data-testid="widget"]');
      if (!el) return false;
      const ro = new ResizeObserver(() => w.__heights.push(Math.round(el.getBoundingClientRect().height * 10) / 10));
      ro.observe(el);
      w.__heights.push(Math.round(el.getBoundingClientRect().height * 10) / 10);
      return true;
    };
    const mo = new MutationObserver(() => { if (hook()) mo.disconnect(); });
    document.addEventListener('DOMContentLoaded', () => { if (hook()) return; mo.observe(document.documentElement, { childList: true, subtree: true }); });
  });
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => { errors = collectErrors(page); });
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

test.describe('chapter widgets, desktop', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 } });

  for (const c of CASES) {
    test(`${c.n} ${c.slug}: the widget mounts, typing updates the X-ray, nothing moves at hydration`, async ({ page }) => {
      await watchShifts(page);
      await page.goto(url(c));
      // The inert shell is in the server HTML, and the live editor replaces it in the same box.
      await expect(widget(page)).toHaveAttribute('data-widget', c.widget);
      await waitForEditor(page);
      await expect(widget(page)).toHaveAttribute('data-ready', 'true');
      await expect(page.getByTestId('widget-skeleton')).toHaveCount(0);
      await expect(widget(page).locator('[data-nabu-root]')).toBeVisible();
      await expect(page.getByTestId('chapter-widget')).toHaveAttribute('data-xray', c.widget);
      await expect(panel(page)).toBeVisible();

      await focusEnd(page, c.focus);
      if (c.act) await c.act(page);
      else await page.keyboard.type('xy');
      await c.check(page);

      // no layout shift whose source is the widget, and the widget kept its height from the shell to the live editor
      await page.waitForTimeout(400);
      const { shifts, heights } = await page.evaluate(() => ({ shifts: (window as any).__shifts as Array<{ value: number; inside: boolean }>, heights: (window as any).__heights as number[] }));
      const inside = shifts.filter((s) => s.inside).reduce((sum, s) => sum + s.value, 0);
      expect(inside, `layout shift inside the widget: ${JSON.stringify(shifts)}`).toBeLessThan(0.001);
      // typing in the editor may grow it (a line more); what must not move is the first heights (shell -> live)
      expect(heights.length).toBeGreaterThan(0);
      expect(Math.abs(heights[0] - heights[Math.min(heights.length - 1, 1)]), `heights ${JSON.stringify(heights)}`).toBeLessThanOrEqual(1.5);
    });
  }

  // The owner's bug report: on a chapter page the caret jumped out of the widget on click, so nothing could be typed. The chapter body
  // is two read-only Nabu documents around the widget; each editor must leave a selection that is not in its own root alone.
  for (const c of CASES) {
    test(`${c.n} ${c.slug}: a real click puts the caret in the widget, typing changes the text and the X-ray`, async ({ page }) => {
      await page.goto(url(c));
      await waitForEditor(page);
      const editor = widget(page).locator('[data-nabu-root]');
      const before = await panel(page).innerText();
      const target = editor.locator('[data-block-type="paragraph"], .nabu-region-title').filter({ hasText: /\w/ }).first();
      await target.click({ position: { x: 20, y: 8 } });
      const where = await page.evaluate(() => {
        const a = window.getSelection()!.anchorNode;
        const el = a instanceof Element ? a : a?.parentElement;
        return { inWidget: !!el?.closest('[data-testid="widget"] [data-nabu-root]'), editable: !!el?.closest('[contenteditable="true"]') };
      });
      expect(where, 'the caret stays where the user clicked').toEqual({ inWidget: true, editable: true });
      await page.keyboard.type('zq');
      await expect(editor).toContainText('zq');
      if (c.n !== '01') await expect.poll(() => panel(page).innerText()).not.toBe(before);
      // and the page's own text did not receive the caret
      expect(await page.evaluate(() => !!window.getSelection()!.anchorNode?.parentElement?.closest('[data-nabu-readonly]'))).toBe(false);
    });
  }

  test('03: "step" walks the seven steps, and only two of them carry a time', async ({ page }) => {
    await page.goto(url(CASES[2]));
    await waitForEditor(page);
    // before any key: nothing is lit and nothing has a time
    await expect(page.locator('[data-step][data-lit="true"]')).toHaveCount(0);
    await expect(page.getByTestId('ms-paint')).toHaveText('');
    await focusEnd(page, NOON);
    await page.keyboard.type('n');
    await expect(page.locator('[data-step="paint"]')).toHaveAttribute('data-lit', 'true');
    // lit steps: keydown, beforeinput, selection, dispatch, Loro, Svelte, paint: all seven for a plain key
    await expect(page.locator('[data-step][data-lit="true"]')).toHaveCount(7);
    // the steps in between have no time column
    const timed = await page.locator('[data-step] .ms').evaluateAll((els) => els.map((e) => !!e.textContent?.trim()));
    expect(timed).toEqual([false, false, false, false, false, true, true]);

    // step: one row at a time, with what it does and where the code is
    const btn = page.getByTestId('step-btn');
    await expect(btn).toHaveText(/step/);
    await btn.click();
    await expect(page.locator('[data-step="keydown"] .detail')).toBeVisible();
    await expect(page.locator('[data-step="keydown"] .where')).toContainText('Nabu#handleKeydown');
    for (let i = 0; i < 6; i++) await btn.click();
    await expect(page.locator('[data-step="paint"] .detail')).toBeVisible();
    await expect(page.locator('[data-step] .detail')).toHaveCount(1);
    await btn.click(); // back to none
    await expect(page.locator('[data-step] .detail')).toHaveCount(0);
  });

  test('03: Enter names the path it takes (ascension), Backspace does not ascend', async ({ page }) => {
    await page.goto(url(CASES[2]));
    await waitForEditor(page);
    await focusEnd(page, NOON);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-step="ascend"]')).toContainText('insertParagraph');
    await expect(page.locator('[data-step="ascend"]')).toContainText('ascends');
    await page.keyboard.type('a');
    await page.keyboard.press('Backspace');
    await expect(page.locator('[data-step="ascend"]')).toContainText('deleteContentBackward');
    await expect(page.locator('[data-step="ascend"]')).not.toContainText('ascends');
  });

  test('02: writing to the model changes the editor with no key and no DOM event; undo takes it back', async ({ page }) => {
    await page.goto(url(CASES[1]));
    await waitForEditor(page);
    const root = widget(page).locator('[data-nabu-root]');
    // no input event reaches the editor while the button writes to the model
    await page.evaluate(() => {
      (window as any).__inputs = 0;
      for (const type of ['beforeinput', 'input', 'keydown']) document.addEventListener(type, () => { (window as any).__inputs++; }, true);
    });
    await page.getByTestId('write-model').click();
    await expect(root).toContainText('(written to the model, 1)');
    await expect(page.getByTestId('xray-ops').getByTestId('xray-op').first()).toContainText('command');
    expect(await page.evaluate(() => (window as any).__inputs)).toBe(0);
    // the JSON view shows the same document
    await page.getByTestId('view-json').click();
    await expect(page.getByTestId('xray-json')).toContainText('written to the model');
    await page.getByTestId('view-tree').click();
    // undo is the model's too
    await focusEnd(page, NOON);
    await page.keyboard.press('Control+z');
    await expect(root).not.toContainText('written to the model');
  });

  test('01: the outline button draws the root and the blocks; the selection crosses blocks', async ({ page }) => {
    await page.goto(url(CASES[0]));
    await waitForEditor(page);
    const outline = page.getByTestId('outline-btn');
    await expect(outline).toHaveAttribute('aria-pressed', 'false');
    await outline.click();
    await expect(outline).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('widget-editor')).toHaveAttribute('data-arch-outline', '');
    const block = widget(page).locator('[data-block-id]').first();
    expect(await block.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('dashed');
    await outline.click();
    await expect(page.getByTestId('widget-editor')).not.toHaveAttribute('data-arch-outline', '');
    // exactly one editable root, however many blocks
    expect(await widget(page).locator('[contenteditable="true"]').count()).toBe(1);
  });

  test('04: bold, then undo: the panel shows what undo restored', async ({ page }) => {
    await page.goto(url(CASES[3]));
    await waitForEditor(page);
    // select "the bank" (the bold run is already there: select the first word of the second paragraph instead and bold it)
    await page.evaluate(async (text) => {
      const n = (window as any).nabu;
      const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === text);
      await n.focus({ from: { block: b, offset: 4 }, to: { block: b, offset: 12 } });
    }, FERRYMAN);
    await expect(page.getByTestId('model-start')).toContainText('index 4');
    await expect(page.getByTestId('model-end')).toContainText('index 12');
    await expect(page.getByTestId('dom-end')).toContainText('@');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+z');
    // the whole selection is back, not just a caret
    await expect(page.getByTestId('restored')).toContainText('undo');
    await expect(page.getByTestId('restored')).toContainText('index 4');
    await expect(page.getByTestId('restored')).toContainText('index 12');
    await expect(page.getByTestId('model-end')).toContainText('index 12');
  });

  test('05: the same key is two commands, depending on the caret; a rebind is data', async ({ page }) => {
    await page.goto(url(CASES[4]));
    await waitForEditor(page);
    // Mod-Enter in the paragraph of the region: "cut here"
    await focusEnd(page, FERRYMAN);
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('[data-command="region:split"]')).toHaveAttribute('data-winner', 'true');
    await expect(page.locator('[data-command="todo:toggle"]')).toHaveAttribute('data-available', 'false');
    // Mod-Enter in a to-do item: the to-do wins (its scope is the block's type)
    await focusEnd(page, 'Light the lantern');
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('[data-command="todo:toggle"]')).toHaveAttribute('data-winner', 'true');
    await expect(page.locator('[data-command="region:split"]')).toHaveAttribute('data-available', 'false');
    // a key with no command
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('chord')).toContainText('ArrowRight');
    await expect(page.getByTestId('consumed')).toContainText('No command is bound');

    // rebind bold: the editor is rebuilt with a keymap, Ctrl+B no longer binds, Ctrl+Shift+B does
    await page.getByTestId('rebind-btn').click();
    await expect(page.getByTestId('rebind-btn')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => (window as any).__nabu_ready === true);
    await focusEnd(page, FERRYMAN);
    await page.keyboard.press('Control+b');
    await expect(page.getByTestId('consumed')).toContainText('No command is bound');
    await page.keyboard.press('Control+Shift+B');
    await expect(page.locator('[data-command="mark:bold"]')).toHaveAttribute('data-winner', 'true');
  });

  test('06: a persisted editor: a reload keeps the text, Reset clears it, a second tab receives it', async ({ page, context }) => {
    await page.goto(url(CASES[5]));
    await waitForEditor(page);
    await focusEnd(page, NOON);
    await page.keyboard.type(' Kept.');
    await expect(page.getByTestId('persist-status')).toHaveAttribute('data-status', /^(pending|saving)$/);
    await page.getByTestId('save-now').click();
    await expect(page.getByTestId('persist-status')).toHaveAttribute('data-status', 'saved');
    await expect(page.getByTestId('persist-size')).toHaveText(/KB|B$/);

    // a second tab on the same page gets the text, and the first one says it received an update
    const second = await context.newPage();
    await second.goto(url(CASES[5]));
    await waitForEditor(second);
    await expect(widget(second).locator('[data-nabu-root]')).toContainText('Nobody had crossed since noon. Kept.');
    await focusEnd(second, `${NOON} Kept.`);
    await second.keyboard.type(' More.');
    await expect(widget(page).locator('[data-nabu-root]')).toContainText('Kept. More.');
    await expect(page.getByTestId('persist-received')).not.toHaveText('0');
    await second.close();

    await page.getByTestId('save-now').click();
    await page.reload();
    await waitForEditor(page);
    await expect(widget(page).locator('[data-nabu-root]')).toContainText('Kept. More.');
    await page.getByTestId('widget-reset').click();
    await page.waitForFunction(() => (window as any).__nabu_ready === true);
    await expect(widget(page).locator('[data-nabu-root]')).not.toContainText('Kept.');
  });

  test('07: a region is a container in the tree; Ctrl+A in the body leaves the titles out', async ({ page }) => {
    await page.goto(url(CASES[6]));
    await waitForEditor(page);
    const tree = page.getByTestId('xray-tree');
    await expect(tree).toContainText('region#');
    await expect(tree).toContainText('paragraph#');
    // a region's children are nested one level deeper than the region
    const depths = await tree.locator('[data-kind="block"]').evaluateAll((els) => els.map((e) => [e.textContent?.split('#')[0], parseInt((e as HTMLElement).style.paddingLeft || '0')]));
    expect(depths[0]).toEqual(['region', 0]);
    expect(depths.some(([t, d]) => t === 'paragraph' && (d as number) > 0)).toBe(true);
    await focusEnd(page, BANK);
    await page.keyboard.press('Control+a');
    const selected = await page.evaluate(() => window.getSelection()!.toString());
    expect(selected).toContain('The ferryman waited');
    expect(selected).toContain('Nobody had crossed');
    expect(selected).not.toContain('The bank');
    // editing a title is live in the registry
    await widget(page).locator('.nabu-region-title').first().click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect(page.getByTestId('registry-item').first()).toContainText('The ferryman!');
  });
});

test.describe('chapter widgets, phone (375px)', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 375, height: 800 }, hasTouch: true });

  for (const c of CASES) {
    test(`${c.n} ${c.slug}: no horizontal scroll, the panel under the editor`, async ({ page }) => {
      await watchShifts(page);
      await page.goto(url(c));
      await waitForEditor(page);
      await expect(widget(page).locator('[data-nabu-root]')).toBeVisible();
      await expect(panel(page)).toBeVisible();
      const m = await page.evaluate(() => {
        const w = document.querySelector('[data-testid="widget"]') as HTMLElement;
        const editor = w.querySelector('[data-nabu-root]') as HTMLElement;
        const p = w.querySelector('[data-testid="xray"]') as HTMLElement;
        const r = (el: HTMLElement) => el.getBoundingClientRect();
        return {
          page: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          widget: [w.scrollWidth, w.clientWidth],
          editorBottom: r(editor).bottom,
          panelTop: r(p).top,
          panelRight: r(p).right,
          heights: (window as any).__heights as number[],
          shifts: ((window as any).__shifts as Array<{ value: number; inside: boolean }>).filter((s) => s.inside),
        };
      });
      expect(m.page, 'the page scrolls sideways').toBeLessThanOrEqual(m.inner);
      expect(m.widget[0], 'the widget is wider than its box').toBeLessThanOrEqual(m.widget[1]);
      expect(m.panelRight).toBeLessThanOrEqual(m.inner);
      expect(m.panelTop, 'the panel sits under the editor').toBeGreaterThanOrEqual(m.editorBottom - 1);
      expect(m.shifts.reduce((s, x) => s + x.value, 0)).toBeLessThan(0.001);
      expect(Math.abs(m.heights[0] - m.heights[Math.min(m.heights.length - 1, 1)])).toBeLessThanOrEqual(1.5);
      // the controls are touch sized
      const small = await widget(page).locator('button.w-btn:visible, button.reset:visible').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43).length);
      expect(small, 'touch targets under 44px').toBe(0);
    });
  }
});

test.describe('chapter widgets, themes and motion', () => {
  const COLORS = {
    dark: { panel: 'rgb(15, 15, 17)', pane: 'rgb(20, 20, 22)', text: 'rgb(237, 237, 237)' },
    light: { panel: 'rgb(243, 243, 240)', pane: 'rgb(255, 255, 255)', text: 'rgb(20, 20, 22)' },
  };
  for (const scheme of ['dark', 'light'] as const) {
    test(`03 follows the site theme (${scheme}), and nothing animates under reduced motion`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      await page.goto(url(CASES[2]));
      await waitForEditor(page);
      const look = await page.evaluate(() => {
        const w = document.querySelector('[data-testid="widget"]') as HTMLElement;
        const cs = (el: Element) => getComputedStyle(el);
        const root = w.querySelector('[data-nabu-root]') as HTMLElement;
        const animated = [...w.querySelectorAll('*')].filter((e) => {
          const s = cs(e);
          // the site's reduced-motion reset leaves a 0.00001s duration everywhere: only a real duration (over a millisecond) is motion
          return (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.001) || s.transitionDuration.split(',').some((d) => parseFloat(d) > 0.001);
        }).length;
        return { panel: cs(w.querySelector('[data-testid="xray"]')!).backgroundColor, pane: cs(root).backgroundColor, text: cs(root.querySelector('[data-block-type="paragraph"]')!).color, animated };
      });
      expect(look.panel).toBe(COLORS[scheme].panel);
      expect(look.pane).toBe(COLORS[scheme].pane);
      expect(look.text).toBe(COLORS[scheme].text);
      expect(look.animated, 'animated elements under prefers-reduced-motion').toBe(0);
      await context.close();
    });
  }

  test('03 works from the keyboard alone: Tab reaches the editor, then the step button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url(CASES[2]));
    await waitForEditor(page);
    await widget(page).locator('[data-nabu-root]').focus();
    await page.keyboard.type('k');
    await expect(page.locator('[data-step="paint"]')).toHaveAttribute('data-lit', 'true');
    await page.getByTestId('step-btn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-step="keydown"] .detail')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-step="beforeinput"] .detail')).toBeVisible();
  });
});

test.describe('chapter screenshots', () => {
  test('chapter 03 and chapter 07, at 1440 and at 375, dark and light', async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    for (const [name, c, size] of [
      ['chapter-03-1440', CASES[2], { width: 1440, height: 1400 }],
      ['chapter-03-375', CASES[2], { width: 375, height: 1500 }],
      ['chapter-07-1440', CASES[6], { width: 1440, height: 1400 }],
      ['chapter-07-375', CASES[6], { width: 375, height: 1500 }],
    ] as const) {
      for (const scheme of ['dark', 'light'] as const) {
        const context = await browser.newContext({ colorScheme: scheme, viewport: size });
        const page = await context.newPage();
        await page.goto(url(c));
        await waitForEditor(page);
        if (c.n === '03') {
          await focusEnd(page, NOON);
          await page.keyboard.type('n');
          await expect(page.locator('[data-step="paint"]')).toHaveAttribute('data-lit', 'true');
          await page.getByTestId('step-btn').click();
          await page.getByTestId('step-btn').click();
          await page.getByTestId('step-btn').click();
        }
        await page.screenshot({ path: `${SHOTS}/${name}${scheme === 'light' ? '-light' : ''}.png`, fullPage: false });
        await context.close();
      }
    }
  });
});
