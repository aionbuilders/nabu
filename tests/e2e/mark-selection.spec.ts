/**
 * E2E — the selection stays EXACTLY on the same characters when a mark is applied / removed (P-78).
 *
 * Root cause that was fixed: the mark action read the selection back from `Block#focus(null, true)` and used the DOM point's
 * `offset` (an offset inside a TEXT NODE) as a model offset; once the text is split in spans (`text <strong>…</strong> text`)
 * the two differ, so each toggle moved the selection (`brave` → the space before it…).
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, press, exec, flushRender } from './helpers/editor.js';
import { buildTree, Pp } from './helpers/blocks.js';
import { selectRange } from './helpers/model.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const KEYS: Record<string, string> = { bold: `${MOD}+b`, italic: `${MOD}+i`, underline: `${MOD}+u`, code: `${MOD}+e`, strikethrough: `${MOD}+Shift+x` };

/** The live selection as MODEL points: `{ a: [blockText, offset], f: [blockText, offset] }` (anchor / focus, direction kept). */
async function points(page: Page) {
  await flushRender(page);
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const s = window.getSelection()!;
    const at = (node: Node, off: number) => {
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
      const id = el?.closest('[data-block-id]')?.getAttribute('data-block-id');
      const b = id ? n.blocks.get(id) : null;
      const tb = b?.behaviors?.get('text');
      return tb ? [tb.text as string, tb.calculateOffset(node, off, b.element) as number] : null;
    };
    return { a: at(s.anchorNode!, s.anchorOffset), f: at(s.focusNode!, s.focusOffset) };
  });
}

/** Select [from, to] in the block `text` (backward: anchor at `to`, focus at `from`) through the live DOM selection. */
async function selectIn(page: Page, text: string, from: number, to: number, backward = false) {
  await page.evaluate(async ([t, f, e, back]) => {
    const n = (window as any).nabu;
    const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === t) as any;
    const p1 = b.getDOMPoint(f), p2 = b.getDOMPoint(e);
    window.getSelection()!.setBaseAndExtent(...(back ? [p2.node, p2.offset, p1.node, p1.offset] : [p1.node, p1.offset, p2.node, p2.offset]) as [Node, number, Node, number]);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }, [text, from, to, backward] as [string, number, number, boolean]);
}

const TEXT = 'Hello brave new world';

test.describe('P-78 · a mark toggle keeps the selection on the same characters', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp(TEXT)]);
    await page.locator('[data-block-type="paragraph"]').click();
  });

  for (const mark of Object.keys(KEYS)) {
    for (const backward of [false, true]) {
      test(`${mark} · keyboard, ${backward ? 'backward' : 'forward'} selection · 4 toggles never move the selection`, async ({ page }) => {
        await selectIn(page, TEXT, 6, 11, backward);
        const expected = await points(page);
        expect(expected).toEqual(backward ? { a: [TEXT, 11], f: [TEXT, 6] } : { a: [TEXT, 6], f: [TEXT, 11] });
        for (let i = 0; i < 4; i++) {
          await press(page, KEYS[mark]);
          await expect.poll(() => page.evaluate((m) => (window as any).nabu.isMarkActive(m), mark)).toBe(i % 2 === 0);
          expect(await points(page), `after toggle #${i + 1}`).toEqual(expected);
        }
      });
    }
  }

  test('programmatic selection + exec(mark:toggle / mark:apply / mark:remove): the selection is untouched', async ({ page }) => {
    await page.evaluate(async (t) => {
      const n = (window as any).nabu;
      const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === t) as any;
      await n.focus({ from: { block: b, offset: 6 }, to: { block: b, offset: 11 } });
    }, TEXT);
    const expected = { a: [TEXT, 6], f: [TEXT, 11] };
    expect(await points(page)).toEqual(expected);
    for (const [topic, data] of [['mark:toggle', { mark: 'bold' }], ['mark:toggle', { mark: 'bold' }], ['mark:apply', { mark: 'italic' }], ['mark:remove', { mark: 'italic' }], ['mark:apply', { mark: 'bold' }], ['mark:toggle', { mark: 'bold' }]] as const) {
      await exec(page, topic, data);
      await page.waitForTimeout(50);
      expect(await points(page), `${topic} ${data.mark}`).toEqual(expected);
    }
  });

  test('a selection that already sits inside / across marked spans keeps its characters', async ({ page }) => {
    await selectIn(page, TEXT, 0, 5);
    await press(page, KEYS.bold);
    await selectIn(page, TEXT, 12, 15);
    await press(page, KEYS.italic);
    // select across the bold start, the plain middle and the italic start
    await selectIn(page, TEXT, 2, 14);
    const expected = await points(page);
    expect(expected).toEqual({ a: [TEXT, 2], f: [TEXT, 14] });
    await press(page, KEYS.underline);
    expect(await points(page)).toEqual(expected);
    await press(page, KEYS.underline);
    expect(await points(page)).toEqual(expected);
    // mixed → bold applies to everything, then removes
    await press(page, KEYS.bold);
    expect(await points(page)).toEqual(expected);
    await press(page, KEYS.bold);
    expect(await points(page)).toEqual(expected);
  });

  test('links: link:set / link:remove keep the selection', async ({ page }) => {
    await selectIn(page, TEXT, 6, 11);
    await exec(page, 'link:set', { href: 'https://example.com' });
    await page.waitForTimeout(50);
    expect(await points(page)).toEqual({ a: [TEXT, 6], f: [TEXT, 11] });
    await exec(page, 'link:remove');
    await page.waitForTimeout(50);
    expect(await points(page)).toEqual({ a: [TEXT, 6], f: [TEXT, 11] });
  });
});

test.describe('P-78 · multi-block selections', () => {
  const A = 'Alpha one two', B = 'Beta three four', C = 'Gamma five six';
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await buildTree(page, [Pp(A), Pp(B), Pp(C)]);
    await page.locator('[data-block-type="paragraph"]').first().click();
  });

  for (const backward of [false, true]) {
    test(`3 blocks, ${backward ? 'backward' : 'forward'}: bold on / off / on / off never moves either end`, async ({ page }) => {
      await selectRange(page, A, 6, C, 5);
      if (backward) {
        await page.evaluate(([a, c]) => {
          const n = (window as any).nabu;
          const get = (t: string) => [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === t) as any;
          const p1 = get(a as string).getDOMPoint(6), p2 = get(c as string).getDOMPoint(5);
          window.getSelection()!.setBaseAndExtent(p2.node, p2.offset, p1.node, p1.offset);
        }, [A, C]);
      }
      const expected = await points(page);
      expect(expected).toEqual(backward ? { a: [C, 5], f: [A, 6] } : { a: [A, 6], f: [C, 5] });
      for (let i = 0; i < 4; i++) {
        await press(page, KEYS.bold);
        await expect.poll(() => page.evaluate(() => (window as any).nabu.isMarkActive('bold'))).toBe(i % 2 === 0);
        expect(await points(page), `after toggle #${i + 1}`).toEqual(expected);
      }
      // another mark on top, then undo: the selection comes back through the undo path too (not asserted here: ADR 015 specs)
      await press(page, KEYS.italic);
      expect(await points(page)).toEqual(expected);
    });
  }
});
