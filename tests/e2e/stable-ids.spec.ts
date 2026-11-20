/**
 * E2E — stable block ids (ADR 019, lot B): with the `stableIds` option, real keys keep the uid where a reader would say "same block",
 * and undo / redo give every uid back exactly. Each result is read through `nabu.blockByUid`.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, press, flushRender } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { buildDoc, P, focusAt, focusEmpty } from './helpers/model.js';

/** Every live node in document order: `[text, uid]`. */
async function uids(page: Page): Promise<Array<[string, string]>> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const out: Array<[string, string]> = [];
    const walk = (node: any) => {
      out.push([node.data.get('text')?.toString() ?? '', node.data.get('uid')]);
      for (const c of node.children() ?? []) walk(c);
    };
    n.tree.roots().forEach(walk);
    return out;
  });
}

/** The text of the live block that carries `uid` (`null` when there is none). */
async function textByUid(page: Page, uid: string): Promise<string | null> {
  return page.evaluate((u) => {
    const b = (window as any).nabu.blockByUid(u);
    return b ? b.behaviors.get('text')?.text ?? '' : null;
  }, uid);
}

const uidList = (rows: Array<[string, string]>) => rows.map((r) => r[1]);
const unique = (list: string[]) => new Set(list).size === list.length;

test.describe('stable block ids', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page, { options: { stableIds: true } }); });

  test('Enter at the start of a paragraph: the block with the text keeps the uid; undo and redo give the uids back exactly', async ({ page }) => {
    await buildDoc(page, [P('one'), P('two'), P('three')]);
    const before = await uids(page);
    const twoUid = before.find((r) => r[0] === 'two')![1];

    await focusAt(page, 'two', 0);
    await press(page, 'Enter');
    await flushRender(page);
    const after = await uids(page);
    expect(after.map((r) => r[0])).toEqual(['one', '', 'two', 'three']);
    expect(unique(uidList(after))).toBe(true);
    expect(after.find((r) => r[0] === 'two')![1]).toBe(twoUid);
    expect(await textByUid(page, twoUid)).toBe('two');
    expect(after[1][1]).not.toBe(twoUid);

    await undo(page);
    await flushRender(page);
    expect(await uids(page)).toEqual(before);
    for (const [text, uid] of before) expect(await textByUid(page, uid)).toBe(text);

    await redo(page);
    await flushRender(page);
    expect(await uids(page)).toEqual(after);
  });

  test('Backspace into an empty block: the merged block has the uid of the text; undo and redo give the uids back exactly', async ({ page }) => {
    await buildDoc(page, [P('one'), P(''), P('three')]);
    const before = await uids(page);
    const threeUid = before.find((r) => r[0] === 'three')![1];

    await focusAt(page, 'three', 0);
    await press(page, 'Backspace');
    await flushRender(page);
    const after = await uids(page);
    expect(after.map((r) => r[0])).toEqual(['one', 'three']);
    expect(after[1][1]).toBe(threeUid);
    expect(await textByUid(page, threeUid)).toBe('three');
    expect(unique(uidList(after))).toBe(true);

    await undo(page);
    await flushRender(page);
    expect(await uids(page)).toEqual(before);

    await redo(page);
    await flushRender(page);
    expect(await uids(page)).toEqual(after);
  });

  test('Enter in the middle keeps the uid on the first half', async ({ page }) => {
    await buildDoc(page, [P('abcdef')]);
    const [[, uid]] = await uids(page);
    await focusAt(page, 'abcdef', 3);
    await press(page, 'Enter');
    await flushRender(page);
    const after = await uids(page);
    expect(after.map((r) => r[0])).toEqual(['abc', 'def']);
    expect(after[0][1]).toBe(uid);
    expect(await textByUid(page, uid)).toBe('abc');
    expect(unique(uidList(after))).toBe(true);
  });

  test('a block deleted by a selection, then Ctrl+Z: the same uid is found again', async ({ page }) => {
    await buildDoc(page, [P('one'), P('two'), P('three')]);
    const before = await uids(page);
    const threeUid = before.find((r) => r[0] === 'three')![1];
    // from the start of "two" to the start of "three": the block "three" is merged away
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const find = (t: string) => [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t) as any;
      await n.focus({ from: { block: find('two'), offset: 0 }, to: { block: find('three'), offset: 0 } });
    });
    await flushRender(page);
    await press(page, 'Backspace');
    await flushRender(page);
    expect(await textByUid(page, threeUid)).toBeNull();

    await undo(page);
    await flushRender(page);
    expect(await textByUid(page, threeUid)).toBe('three');
    expect(await uids(page)).toEqual(before);
  });

  test('an empty block deleted with Delete before a text block: the text keeps its uid', async ({ page }) => {
    await buildDoc(page, [P('one'), P(''), P('three')]);
    const before = await uids(page);
    const threeUid = before.find((r) => r[0] === 'three')![1];
    await focusEmpty(page);
    await press(page, 'Delete');
    await flushRender(page);
    const after = await uids(page);
    expect(after.map((r) => r[0])).toEqual(['one', 'three']);
    expect(after[1][1]).toBe(threeUid);
    await undo(page);
    await flushRender(page);
    expect(await uids(page)).toEqual(before);
  });
});
