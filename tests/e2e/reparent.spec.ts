/**
 * E2E — re-parenting a block (P-79): a node moved between the ROOT and a container, or between two containers, is rendered
 * exactly once, in its new place; the old element is gone (no stale copy, no duplicated data-block-id).
 *
 * Root cause that was fixed: the tree subscription refreshed the new parent and the old parent, but a node that LEAVES the root
 * has no `oldParent` (the root is not a node), so the root list was never refreshed and kept rendering the moved block.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, flushRender } from './helpers/editor.js';
import { buildTree, Tog, Pp, tree } from './helpers/blocks.js';
import { violations, outline } from './helpers/model.js';

/** Move the node of the block whose text is `text` under the node of the block whose text is `parentText` (or the root). */
async function moveUnder(page: Page, text: string, parentText: string | null, index?: number) {
  await page.evaluate(async ([t, pt, idx]) => {
    const n = (window as any).nabu;
    const find = (x: string) => [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === x) as any;
    const node = find(t as string).node;
    const parent = pt === null ? undefined : find(pt as string).node;
    node.move(parent, idx ?? undefined);
    await n.commit();
  }, [text, parentText, index ?? null] as [string, string | null, number | null]);
  await flushRender(page);
}

async function domOnce(page: Page) {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('.nabu-editor [data-block-id]')].map((e) => e.getAttribute('data-block-id')!);
    return ids.length - new Set(ids).size;
  });
}

test.describe('P-79 · re-parenting renders each block once', () => {
  test.beforeEach(async ({ page }) => { await gotoEditor(page); });

  test('root → toggle body, and back to the root', async ({ page }) => {
    await buildTree(page, [Pp('outside'), Tog('Head', [Pp('inner')]), Pp('tail')]);
    await moveUnder(page, 'outside', 'Head');
    expect(await tree(page)).toBe('toggle▾(Head){p(inner) p(outside)} ; p(tail)');
    expect(await violations(page)).toEqual([]);
    expect(await domOnce(page)).toBe(0);

    await moveUnder(page, 'outside', null, 0);
    expect(await tree(page)).toBe('p(outside) ; toggle▾(Head){p(inner)} ; p(tail)');
    expect(await violations(page)).toEqual([]);
    expect(await domOnce(page)).toBe(0);
  });

  test('toggle → root (the first and the last body child)', async ({ page }) => {
    await buildTree(page, [Tog('Head', [Pp('one'), Pp('two'), Pp('three')])]);
    await moveUnder(page, 'one', null);
    expect(await tree(page)).toBe('toggle▾(Head){p(two) p(three)} ; p(one)');
    expect(await violations(page)).toEqual([]);
    await moveUnder(page, 'three', null, 0);
    expect(await tree(page)).toBe('p(three) ; toggle▾(Head){p(two)} ; p(one)');
    expect(await violations(page)).toEqual([]);
  });

  test('toggle → toggle', async ({ page }) => {
    await buildTree(page, [Tog('A', [Pp('a1'), Pp('a2')]), Tog('B', [Pp('b1')])]);
    await moveUnder(page, 'a2', 'B', 0);
    expect(await tree(page)).toBe('toggle▾(A){p(a1)} ; toggle▾(B){p(a2) p(b1)}');
    expect(await violations(page)).toEqual([]);
  });

  test('a root list → the sublist of a list item (and back out)', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      const l1 = n.insert('list', { listType: 'bullet' }, null, 0);
      n.insert('list-item', { text: 'a' }, l1.id, 0);
      n.insert('list-item', { text: 'b' }, l1.id, 1);
      const l2 = n.insert('list', { listType: 'ordered' }, null, 1);
      n.insert('list-item', { text: 'c' }, l2.id, 0);
      await n.commit();
      n.undoManager.clear();
    });
    await flushRender(page);
    expect(await outline(page)).toBe('ul[a, b] ; ol[c]');
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const a = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === 'a') as any;
      const ol = n.tree.roots()[1];
      ol.move(a.node);
      await n.commit();
    });
    await flushRender(page);
    expect(await outline(page)).toBe('ul[a > ol[c], b]');
    expect(await violations(page)).toEqual([]);
    expect(await domOnce(page)).toBe(0);

    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const a = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === 'a') as any;
      a.node.children()[0].move(undefined, 1);
      await n.commit();
    });
    await flushRender(page);
    expect(await outline(page)).toBe('ul[a, b] ; ol[c]');
    expect(await violations(page)).toEqual([]);
    expect(await domOnce(page)).toBe(0);
  });

  test('undo / redo of a re-parenting keeps the render in sync', async ({ page }) => {
    await buildTree(page, [Pp('outside'), Tog('Head', [Pp('inner')])]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const find = (x: string) => [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === x) as any;
      find('outside').node.move(find('Head').node);
      await n.commit();
      n.undo();
    });
    await flushRender(page);
    expect(await tree(page)).toBe('p(outside) ; toggle▾(Head){p(inner)}');
    expect(await violations(page)).toEqual([]);
    await page.evaluate(() => (window as any).nabu.redo());
    await flushRender(page);
    expect(await tree(page)).toBe('toggle▾(Head){p(inner) p(outside)}');
    expect(await violations(page)).toEqual([]);
  });
});
