/**
 * E2E — keyboard block moves (P-80): Mod+Shift+ArrowUp / ArrowDown run the engine commands `block:move-up` / `block:move-down`.
 * One step among the SIBLINGS of one parent; a selection moves as a run; an edge is a no-op; one undo step; the selection stays
 * on the same characters. Moving out of a container is NOT part of it (documented: indent / outdent for lists, drag for the rest).
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, press, flushRender } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { buildTree, Tog, Pp, tree } from './helpers/blocks.js';
import { buildDoc, UL, I, P, outline, violations, focusAt, selectRange, caret, allText } from './helpers/model.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const UP = `${MOD}+Shift+ArrowUp`;
const DOWN = `${MOD}+Shift+ArrowDown`;

test.describe('P-80 · block:move-up / block:move-down', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('the commands exist with their keys', async ({ page }) => {
    const info = await page.evaluate(() => ['block:move-up', 'block:move-down'].map((id) => { const c = (window as any).nabu.commands.get(id); return [id, c?.keys]; }));
    expect(info).toEqual([['block:move-up', ['Mod-Shift-ArrowUp']], ['block:move-down', ['Mod-Shift-ArrowDown']]]);
  });

  test('Mod+Shift+ArrowDown / ArrowUp move the block holding the caret; the caret stays in it; edges are no-ops', async ({ page }) => {
    await buildTree(page, [Pp('one'), Pp('two'), Pp('three')]);
    await focusAt(page, 'one', 2);
    await press(page, UP);
    expect(await outline(page), 'first block: no-op').toBe('p(one) ; p(two) ; p(three)');
    await press(page, DOWN);
    await expect.poll(() => outline(page)).toBe('p(two) ; p(one) ; p(three)');
    await flushRender(page);
    expect(await caret(page), 'the caret is still at the same place of the same block').toBe('on|e');
    await press(page, DOWN);
    await expect.poll(() => outline(page)).toBe('p(two) ; p(three) ; p(one)');
    await press(page, DOWN);
    await flushRender(page);
    expect(await outline(page), 'last block: no-op').toBe('p(two) ; p(three) ; p(one)');
    expect(await caret(page)).toBe('on|e');
    await press(page, UP);
    await expect.poll(() => outline(page)).toBe('p(two) ; p(one) ; p(three)');
    expect(await violations(page)).toEqual([]);
    // typing lands in the moved block: the editor has the focus
    await page.keyboard.type('X');
    expect(await outline(page)).toBe('p(two) ; p(onXe) ; p(three)');
  });

  test('one undo step per move, and redo', async ({ page }) => {
    await buildTree(page, [Pp('one'), Pp('two'), Pp('three')]);
    await focusAt(page, 'two', 1);
    await press(page, DOWN);
    await expect.poll(() => outline(page)).toBe('p(one) ; p(three) ; p(two)');
    await undo(page);
    await expect.poll(() => outline(page)).toBe('p(one) ; p(two) ; p(three)');
    expect(await caret(page), 'undo gives the caret back').toBe('t|wo');
    await redo(page);
    await expect.poll(() => outline(page)).toBe('p(one) ; p(three) ; p(two)');
    expect(await violations(page)).toEqual([]);
  });

  test('a multi-block selection moves as one run, forward and backward, and stays selected', async ({ page }) => {
    await buildTree(page, [Pp('a'), Pp('bb'), Pp('cc'), Pp('dd'), Pp('e')]);
    await selectRange(page, 'bb', 1, 'dd', 1);
    await press(page, UP);
    await expect.poll(() => outline(page)).toBe('p(bb) ; p(cc) ; p(dd) ; p(a) ; p(e)');
    await flushRender(page);
    expect(await caret(page), 'the selection still spans the same characters').toBe('bb@1 -> dd@1');
    await press(page, DOWN);
    await press(page, DOWN);
    await expect.poll(() => outline(page)).toBe('p(a) ; p(e) ; p(bb) ; p(cc) ; p(dd)');
    await press(page, DOWN);
    await flushRender(page);
    expect(await outline(page), 'at the end: no-op').toBe('p(a) ; p(e) ; p(bb) ; p(cc) ; p(dd)');
    // backward
    await page.evaluate(() => {
      const n = (window as any).nabu;
      const get = (t: string) => [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t) as any;
      const a = get('cc').getDOMPoint(1), b = get('bb').getDOMPoint(0);
      window.getSelection()!.setBaseAndExtent(a.node, a.offset, b.node, b.offset);
    });
    await press(page, UP);
    await expect.poll(() => outline(page)).toBe('p(a) ; p(bb) ; p(cc) ; p(e) ; p(dd)');
    expect(await violations(page)).toEqual([]);
    await undo(page);
    await expect.poll(() => outline(page)).toBe('p(a) ; p(e) ; p(bb) ; p(cc) ; p(dd)');
  });

  test('a list item moves among the items of its list (with its sub-list) and never leaves it', async ({ page }) => {
    await buildDoc(page, [P('top'), UL(I('a', UL(I('a1'), I('a2'))), I('b'), I('c')), P('end')]);
    await focusAt(page, 'a', 1);
    await press(page, DOWN);
    await expect.poll(() => outline(page)).toBe('p(top) ; ul[b, a > ul[a1, a2], c] ; p(end)');
    await press(page, DOWN);
    await press(page, DOWN);
    await expect.poll(() => outline(page)).toBe('p(top) ; ul[b, c, a > ul[a1, a2]] ; p(end)');
    await press(page, DOWN); // last item of the list: stays in it
    await flushRender(page);
    expect(await outline(page)).toBe('p(top) ; ul[b, c, a > ul[a1, a2]] ; p(end)');
    // a sub-list item moves among its own siblings only
    await focusAt(page, 'a2', 1);
    await press(page, UP);
    await expect.poll(() => outline(page)).toBe('p(top) ; ul[b, c, a > ul[a2, a1]] ; p(end)');
    await press(page, UP);
    await flushRender(page);
    expect(await outline(page)).toBe('p(top) ; ul[b, c, a > ul[a2, a1]] ; p(end)');
    expect(await violations(page)).toEqual([]);
    await undo(page);
    await expect.poll(() => outline(page)).toBe('p(top) ; ul[b, c, a > ul[a1, a2]] ; p(end)');
  });

  test('inside a toggle body: moves among the body children, stops at the edges of the body', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('x'), Pp('y')]), Pp('after')]);
    await focusAt(page, 'y', 0);
    await press(page, UP);
    await expect.poll(() => tree(page)).toBe('p(before) ; toggle▾(Head){p(y) p(x)} ; p(after)');
    await press(page, UP);
    await flushRender(page);
    expect(await tree(page), 'the body edge is not crossed').toBe('p(before) ; toggle▾(Head){p(y) p(x)} ; p(after)');
    // the toggle itself moves as a block among the root blocks (caret in its header)
    await focusAt(page, 'Head', 1);
    await press(page, DOWN);
    await expect.poll(() => tree(page)).toBe('p(before) ; p(after) ; toggle▾(Head){p(y) p(x)}');
    expect(await violations(page)).toEqual([]);
    expect((await allText(page)).sort()).toEqual(['Head', 'after', 'before', 'x', 'y']);
  });

  test('a block crossing a region marker changes region (a marker is a block like any other)', async ({ page }) => {
    await buildTree(page, [Pp('Pre'), { type: 'region', props: { regionType: 'section-1', title: 'One' } }, Pp('a')]);
    await focusAt(page, 'a', 0);
    await press(page, UP);
    await expect.poll(() => page.evaluate(() => (window as any).nabu.tree.roots().map((r: any) => r.data.get('type') === 'region' ? 'R' : r.data.get('text').toString()).join(' ; '))).toBe('Pre ; a ; R');
    expect(await violations(page)).toEqual([]);
    await undo(page);
    await expect.poll(() => page.evaluate(() => (window as any).nabu.tree.roots().map((r: any) => r.data.get('type') === 'region' ? 'R' : r.data.get('text').toString()).join(' ; '))).toBe('Pre ; R ; a');
  });
});
