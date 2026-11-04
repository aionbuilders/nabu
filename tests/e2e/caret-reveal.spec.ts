import { test, expect, type Page } from './helpers/test.js';
import { pasteText } from './helpers/clipboard.js';

// The caret stays visible after an edit the user made (route /e2e/reveal, src/routes/e2e/reveal; utils/reveal-caret.js). Nabu cancels
// the native edits and re-renders from the model, so the browser no longer scrolls to the caret by itself: after an input, a paste,
// a cut, a drop, a composition or a key the editor handled, the engine scrolls every scrollable ancestor (and the window) by the least
// amount that shows the caret. Native editing is the reference: nothing scrolls otherwise (no edit, a key that changed nothing, a
// programmatic edit, a caret that is already visible).

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function open(page: Page, layout: string, params: Record<string, string | number> = {}) {
  const query = new URLSearchParams({ layout, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  await page.goto(`/e2e/reveal?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__reveal_ready === true, null, { timeout: 15000 });
}

/** Click into the editor (`label`), then put the caret at the end of the document. */
async function focusEnd(page: Page, label = 'Editor') {
  await page.getByLabel(label, { exact: true }).click();
  await page.keyboard.press(`${mod}+End`);
}

/** Let the frame that follows the last event run (the reveal is scheduled in a frame): two, to be sure of the layout. */
const frames = (page: Page, n = 2) =>
  page.evaluate((count) => new Promise<void>((resolve) => { const tick = (left: number) => (left ? requestAnimationFrame(() => tick(left - 1)) : resolve()); tick(count); }), n);

/**
 * How far (px, 0 = visible) the caret of the live selection lies outside the visible box of each element in `ids`, and of the window
 * (the visual viewport when there is one). The rects are post-transform, so the box is scaled like them. The caret is the collapsed
 * range at the focus, or the block holding it when the browser reports no rect (an empty line).
 */
function outside(page: Page, ids: string[] = []) {
  return page.evaluate((list) => {
    const sel = getSelection()!;
    const range = document.createRange();
    range.setStart(sel.focusNode!, sel.focusOffset);
    const holder = sel.focusNode!.nodeType === 1 ? (sel.focusNode as Element) : sel.focusNode!.parentElement!;
    const rect = [...range.getClientRects()].find((r) => r.height > 0) ?? (holder.closest('[data-block-id]') ?? holder).getBoundingClientRect();
    const out = (top: number, bottom: number, left: number, right: number) =>
      Math.max(0, top - rect.top, rect.bottom - bottom, left - rect.left, rect.right - right);
    const result: Record<string, number> = {};
    for (const id of list) {
      const el = document.getElementById(id)!;
      const box = el.getBoundingClientRect();
      const sy = box.height / el.offsetHeight || 1;
      const sx = box.width / el.offsetWidth || 1;
      result[id] = out(box.top + el.clientTop * sy, box.top + (el.clientTop + el.clientHeight) * sy, box.left + el.clientLeft * sx, box.left + (el.clientLeft + el.clientWidth) * sx);
    }
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const left = vv ? vv.offsetLeft : 0;
    result.window = out(top, top + (vv ? vv.height : innerHeight), left, left + (vv ? vv.width : innerWidth));
    return result;
  }, ids);
}

/** The caret is inside every box in `ids` and in the window (1 px of rounding allowed). */
async function expectVisible(page: Page, ids: string[] = []) {
  const result = await outside(page, ids);
  for (const [name, px] of Object.entries(result)) expect(px, `the caret is ${px}px outside of ${name}`).toBeLessThanOrEqual(1);
}

const scrollTop = (page: Page, id: string) => page.evaluate((i) => document.getElementById(i)!.scrollTop, id);
const scrollY = (page: Page) => page.evaluate(() => scrollY);
const setScrollTop = (page: Page, id: string, top: number) => page.evaluate(([i, t]) => { document.getElementById(i as string)!.scrollTop = t as number; }, [id, top]);

test.describe('Caret reveal', () => {
  test('1 · 20 Enter in a 220 px scroller: the caret stays visible', async ({ page }) => {
    await open(page, 'scroller');
    await page.getByLabel('Editor', { exact: true }).click();
    for (let i = 1; i <= 20; i++) {
      await page.keyboard.press('Enter');
      if (i % 4 === 0) {
        await frames(page);
        await expectVisible(page, ['scroller']);
      }
    }
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
  });

  test('2 · long wrapped typing: the caret stays visible', async ({ page }) => {
    await open(page, 'scroller');
    await page.getByLabel('Editor', { exact: true }).click();
    for (let i = 1; i <= 15; i++) {
      await page.keyboard.insertText('lorem ipsum dolor sit amet '.repeat(15));
      if (i % 3 === 0) {
        await frames(page);
        await expectVisible(page, ['scroller']);
      }
    }
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
  });

  test('3 · window scrolling: Enter at the bottom of a page taller than the viewport', async ({ page }) => {
    await open(page, 'window', { paragraphs: 80 });
    await focusEnd(page);
    for (let i = 1; i <= 12; i++) {
      await page.keyboard.press('Enter');
      if (i % 3 === 0) {
        await frames(page);
        await expectVisible(page);
      }
    }
  });

  test('4 · nested scrollers: both move, and the caret is visible in both', async ({ page }) => {
    await open(page, 'nested');
    await page.getByLabel('Editor', { exact: true }).click();
    for (let i = 1; i <= 25; i++) await page.keyboard.press('Enter');
    await frames(page);
    await expectVisible(page, ['inner', 'outer']);
    expect(await scrollTop(page, 'inner')).toBeGreaterThan(0);
    expect(await scrollTop(page, 'outer')).toBeGreaterThan(0);
  });

  test('5 · Backspace merging up past the top of the scrolled area: scrolls up', async ({ page }) => {
    await open(page, 'scroller', { paragraphs: 60 });
    await page.getByLabel('Editor', { exact: true }).click();
    // The caret at the start of line 40, which is the first line of the scrolled area.
    await page.evaluate(() => {
      const w = window as any;
      w.nabu.selection.setCursor([...w.nabu.children][40], 0);
    });
    await frames(page);
    await page.evaluate(() => {
      const scroller = document.getElementById('scroller')!;
      const line = [...document.querySelectorAll('[data-block-id]')][40];
      scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop;
    });
    const before = await scrollTop(page, 'scroller');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Backspace');
      await frames(page);
      await expectVisible(page, ['scroller']);
    }
    expect(await scrollTop(page, 'scroller')).toBeLessThan(before);
  });

  test('6 · paste of many lines: the caret at the end is visible', async ({ page }) => {
    await open(page, 'scroller');
    await page.getByLabel('Editor', { exact: true }).click();
    await pasteText(page, Array.from({ length: 60 }, (_, i) => `pasted line ${i}`).join('\n\n'));
    await frames(page);
    await expectVisible(page, ['scroller']);
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
  });

  test('7 · sticky footer with scroll-padding-bottom: the caret stays above the footer', async ({ page }) => {
    await open(page, 'sticky');
    await page.getByLabel('Editor', { exact: true }).click();
    for (let i = 1; i <= 20; i++) await page.keyboard.press('Enter');
    await frames(page);
    await expectVisible(page, ['scroller']);
    const gap = await page.evaluate(() => {
      const sel = getSelection()!;
      const holder = sel.focusNode!.nodeType === 1 ? (sel.focusNode as Element) : sel.focusNode!.parentElement!;
      const caret = (holder.closest('[data-block-id]') ?? holder).getBoundingClientRect();
      return document.getElementById('footer')!.getBoundingClientRect().top - caret.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
  });

  test('8 · a smaller visual viewport: the caret stays inside it (the bounds, not a real keyboard)', async ({ page }) => {
    // A stub of `window.visualViewport` 300 px high: it tests that the reveal reads its bounds, not what a virtual keyboard does.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: { offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1, height: 300, width: window.innerWidth, addEventListener() {}, removeEventListener() {} },
      });
    });
    await open(page, 'window', { paragraphs: 80 });
    await focusEnd(page);
    for (let i = 1; i <= 10; i++) await page.keyboard.press('Enter');
    await frames(page);
    await expectVisible(page);
    expect((await outside(page)).window).toBeLessThanOrEqual(1);
    const bottom = await page.evaluate(() => {
      const r = getSelection()!.getRangeAt(0).getClientRects()[0] ?? getSelection()!.focusNode!.parentElement!.getBoundingClientRect();
      return r.bottom;
    });
    expect(bottom).toBeLessThanOrEqual(300);
  });

  test('9 · no jump: Ctrl, Shift, Ctrl+C, Escape leave the scroll alone; typing brings the caret back', async ({ page }) => {
    await open(page, 'scroller', { paragraphs: 60 });
    await focusEnd(page);
    await frames(page);
    await setScrollTop(page, 'scroller', 0);
    const y = await scrollY(page);
    for (const key of ['Control', 'Shift', `${mod}+c`, 'Escape']) {
      await page.keyboard.press(key);
      await frames(page);
      expect(await scrollTop(page, 'scroller'), `scroller after ${key}`).toBe(0);
      expect(await scrollY(page), `window after ${key}`).toBe(y);
    }
    await page.keyboard.insertText('x');
    await frames(page);
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
    await expectVisible(page, ['scroller']);
  });

  test('10 · programmatic edits (insert, importRemote) far below do not scroll', async ({ page }) => {
    await open(page, 'scroller', { paragraphs: 60 });
    await page.getByLabel('Editor', { exact: true }).click();
    await page.keyboard.press(`${mod}+Home`);
    await frames(page);
    await setScrollTop(page, 'scroller', 0);
    const y = await scrollY(page);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.insert('paragraph', { text: 'inserted far below' }, null, 60);
      await n.commit();
      const last = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === 'Line 59') as any;
      const peer = new n.doc.constructor();
      peer.import(n.doc.export({ mode: 'snapshot' }));
      peer.getText(last.behaviors.get('text').container.id).insert(0, 'remote ');
      peer.commit();
      n.importRemote(peer.export({ mode: 'update', from: n.doc.version() }));
    });
    await frames(page, 3);
    await expect(page.getByText('remote Line 59')).toHaveCount(1);
    expect(await scrollTop(page, 'scroller')).toBe(0);
    expect(await scrollY(page)).toBe(y);
  });

  test('11 · caret already visible, typing in the middle of the visible text: no scroll at all', async ({ page }) => {
    await open(page, 'scroller', { paragraphs: 60 });
    await page.getByLabel('Editor', { exact: true }).click();
    await page.getByText('Line 05', { exact: true }).click();
    await frames(page);
    const top = await scrollTop(page, 'scroller');
    const y = await scrollY(page);
    for (const text of ['abc', 'def', 'ghi']) {
      await page.keyboard.insertText(text);
      await frames(page, 1);
      expect(await scrollTop(page, 'scroller')).toBe(top);
      expect(await scrollY(page)).toBe(y);
    }
  });

  test('12 · under transform: scale(0.7): the caret stays visible', async ({ page }) => {
    await open(page, 'scale');
    await page.getByLabel('Editor', { exact: true }).click();
    for (let i = 1; i <= 20; i++) {
      await page.keyboard.press('Enter');
      if (i % 5 === 0) {
        await frames(page);
        await expectVisible(page, ['scroller']);
      }
    }
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
  });

  test('13 · scroll-behavior: smooth on the host: the caret is visible on the very next frame', async ({ page }) => {
    await open(page, 'scroller', { smooth: 1 });
    await page.getByLabel('Editor', { exact: true }).click();
    for (let i = 1; i <= 25; i++) await page.keyboard.press('Enter');
    await frames(page, 1);
    await expectVisible(page, ['scroller']);
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
  });

  test('14 · two editors: the other one keeps its scroll; a reveal pending while the focus is outside does nothing', async ({ page }) => {
    await open(page, 'two', { paragraphs: 40 });
    await setScrollTop(page, 'scroller2', 150);
    const other = await scrollTop(page, 'scroller2');
    expect(other).toBeGreaterThan(0);
    const y = await scrollY(page);
    await focusEnd(page);
    for (let i = 0; i < 10; i++) await page.keyboard.press('Enter');
    await frames(page);
    await expectVisible(page, ['scroller']);
    expect(await scrollTop(page, 'scroller2')).toBe(other);

    // An input, then the focus leaves the editor before the frame that would reveal (the callback registered first runs first; the
    // engine puts the caret back in the editor after the render, so the focus has to leave in the frame itself): no reveal.
    await setScrollTop(page, 'scroller', 0);
    const typeThenLeave = (leave: boolean) =>
      page.evaluate((away) => {
        const root = (window as any).nabu.selection.root as HTMLElement;
        if (away) requestAnimationFrame(() => document.body.appendChild(document.createElement('input')).focus());
        root.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', bubbles: true, cancelable: true }));
      }, leave);
    await typeThenLeave(true);
    await frames(page);
    expect(await scrollTop(page, 'scroller')).toBe(0);
    expect(await scrollY(page)).toBe(y);
    // The same input with the focus kept does reveal.
    await focusEnd(page);
    await setScrollTop(page, 'scroller', 0);
    await typeThenLeave(false);
    await frames(page);
    expect(await scrollTop(page, 'scroller')).toBeGreaterThan(0);
  });

  test('15 · a long code line: typing keeps the caret visible horizontally, the block scrolls on its own', async ({ page }) => {
    await open(page, 'code');
    const code = page.locator('pre.nabu-code');
    await code.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 6; i++) await page.keyboard.insertText('0123456789');
    await frames(page);
    const horizontal = () => page.evaluate(() => {
      const pre = document.querySelector('pre.nabu-code')!;
      const box = pre.getBoundingClientRect();
      const r = getSelection()!.getRangeAt(0).getClientRects()[0];
      return { scrollLeft: pre.scrollLeft, inside: r.left >= box.left && r.right <= box.right, scroller: document.getElementById('scroller')!.scrollLeft };
    });
    const typed = await horizontal();
    expect(typed.scrollLeft).toBeGreaterThan(0);
    expect(typed.inside).toBe(true);
    expect(typed.scroller).toBe(0);
    await expectVisible(page, ['scroller']);
    // The block's own scroll (Code.svelte) still follows a caret move: back to the start of the line, then to the end.
    await page.keyboard.press('Home');
    await frames(page);
    expect((await horizontal()).scrollLeft).toBe(0);
    await page.keyboard.press('End');
    await frames(page);
    const end = await horizontal();
    expect(end.scrollLeft).toBeGreaterThan(0);
    expect(end.inside).toBe(true);
  });
});
