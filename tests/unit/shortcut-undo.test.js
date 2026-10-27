// @ts-nocheck
/**
 * Unit tests for P-11 / P-13 / P-15 — undoing a block shortcut.
 *  - P-13: undo right after a block shortcut gives back exactly what was typed, trigger space included
 *    (Nabu.shortcut() inserts the trigger as a text commit, then transforms in its own structural step).
 *  - P-11: the caret is restored into the block that exists after the undo, even when Loro restored
 *    the destroyed block under a NEW id (resolved by tree path).
 *  - P-15: insertDivider is the one path of `--- ` and `divider:insert`.
 * Real Nabu with a stubbed selection (there is no DOM selection in unit tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { DividerExtension, insertDivider } from '#lib/blocks/divider/divider.extension.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';

async function makeEditor() {
  const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, DividerExtension, BlockExtension],
  });
  await engine.commit();
  const block = engine.children[0];
  const setCursor = vi.fn();
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor, startOffset: 0 };
  engine.undoManager.clear();
  return { engine, block, setCursor };
}

/** Type `text` into `block` (committed) and pin the model caret at its end (no DOM selection in unit tests). */
async function typed(engine, block, text) {
  block.insert(block.text.length, text);
  await engine.commit();
  Object.defineProperty(block.behaviors.get('text'), 'selection', {
    configurable: true,
    get: () => ({ from: block.text.length, to: block.text.length, isCollapsed: true }),
  });
  engine.selection.anchorBlock = block;
  engine.selection.startOffset = block.text.length;
}

/** Fire the block-shortcut hooks the way TextBehavior does for a typed space. */
function typeSpace(engine, block) {
  const event = { inputType: 'insertText', data: ' ', preventDefault: vi.fn() };
  for (const hook of engine.hooks.get('onBeforeInput')) {
    if (hook(engine, event, block) === engine.BREAK) return true;
  }
  return false;
}

const snapshot = (engine) => engine.tree.roots().map(r => ({
  type: r.data.get('type'),
  text: r.data.get('text')?.toString(),
  children: (r.children() ?? []).map(c => ({ type: c.data.get('type'), text: c.data.get('text')?.toString() })),
}));
const flush = () => new Promise(r => setTimeout(r, 20));

describe('P-13 — undo gives back the typed trigger, space included', () => {
  it('"# " -> heading; one undo -> paragraph "# "; redo -> heading; second undo path removes the typing', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, '#');
    expect(typeSpace(engine, block)).toBe(true);
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'heading', text: '', children: [] }]);

    engine.undo();
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'paragraph', text: '# ', children: [] }]);

    engine.redo();
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'heading', text: '', children: [] }]);

    engine.undo();
    await flush();
    engine.undo(); // the typing of "#" (and the trigger space, merged) is its own, earlier step
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'paragraph', text: '', children: [] }]);
  });

  it('the caret stored with the transform is right after the trigger (offset 2 in "# ")', async () => {
    const { engine, block, setCursor } = await makeEditor();
    await typed(engine, block, '#');
    typeSpace(engine, block);
    await flush();
    engine.undo();
    await vi.waitFor(() => expect(setCursor).toHaveBeenCalled());
    const [target, offset] = setCursor.mock.calls.at(-1);
    expect(target.text).toBe('# ');
    expect(offset).toBe(2);
  });

  it('a shortcut typed before existing text keeps it: "#abc" + space -> heading "abc"; undo -> "# abc"', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, '#abc');
    Object.defineProperty(block.behaviors.get('text'), 'selection', {
      configurable: true, get: () => ({ from: 1, to: 1, isCollapsed: true }),
    });
    typeSpace(engine, block);
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'heading', text: 'abc', children: [] }]);
    engine.undo();
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'paragraph', text: '# abc', children: [] }]);
  });
});

describe('P-11 — the caret comes back into the block that exists after undo (list shortcut)', () => {
  it('"- " -> list; undo restores the paragraph "- " under a NEW id and puts the caret there', async () => {
    const { engine, block, setCursor } = await makeEditor();
    const oldId = block.id;
    await typed(engine, block, '-');
    typeSpace(engine, block);
    await flush();
    expect(snapshot(engine)[0].type).toBe('list');

    engine.undo();
    await flush();
    const roots = snapshot(engine);
    expect(roots).toEqual([{ type: 'paragraph', text: '- ', children: [] }]);
    const restored = engine.children[0];
    expect(restored.id).not.toBe(oldId); // Loro re-creates a node deleted then undone: ids can't be trusted

    await vi.waitFor(() => expect(setCursor).toHaveBeenCalled());
    const [target, offset] = setCursor.mock.calls.at(-1);
    expect(target).toBe(restored);       // not the stale, destroyed block
    expect(offset).toBe(2);
  });

  it('"3. " -> ordered list starting at 3; undo -> "3. "; redo -> the list again with its start', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, '3.');
    typeSpace(engine, block);
    await flush();
    expect(engine.children[0].type).toBe('list');
    expect(engine.children[0].start).toBe(3);

    engine.undo();
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'paragraph', text: '3. ', children: [] }]);
    engine.redo();
    await flush();
    expect(engine.children[0].type).toBe('list');
    expect(engine.children[0].start).toBe(3);
  });

  it('redo restores the caret into the (re-created) list item, resolved by tree path', async () => {
    const { engine, block, setCursor } = await makeEditor();
    await typed(engine, block, '-');
    typeSpace(engine, block);
    await flush();
    // the caret sits in the new list item when the undo is requested
    engine.selection.anchorBlock = engine.children[0].children[0];
    engine.selection.startOffset = 0;

    engine.undo();
    await flush();
    setCursor.mockClear();
    engine.redo();
    await flush();
    await vi.waitFor(() => expect(setCursor).toHaveBeenCalled());
    const [target] = setCursor.mock.calls.at(-1);
    expect(target.type).toBe('list-item');
    expect(target).toBe(engine.children[0].children[0]);
  });
});

describe('P-15 — insertDivider (shared by "--- " and divider:insert)', () => {
  it('an EMPTY paragraph becomes the divider; a new paragraph is created below', async () => {
    const { engine, block } = await makeEditor();
    const paragraph = insertDivider(engine, block);
    await engine.commit();
    expect(snapshot(engine).map(b => b.type)).toEqual(['divider', 'paragraph']);
    expect(engine.children[1].id).toBe(paragraph.id);
  });

  it('a NON-empty block gets the divider right after it, then a new paragraph', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, 'hello');
    const paragraph = insertDivider(engine, block);
    await engine.commit();
    expect(snapshot(engine).map(b => [b.type, b.text])).toEqual([['paragraph', 'hello'], ['divider', undefined], ['paragraph', '']]);
    expect(engine.children[2].id).toBe(paragraph.id);
  });

  it('a list item is not replaced: the divider goes after the whole list', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, '-');
    typeSpace(engine, block);
    await flush();
    const item = engine.children[0].children[0];
    insertDivider(engine, item);
    await engine.commit();
    expect(snapshot(engine).map(b => b.type)).toEqual(['list', 'divider', 'paragraph']);
    expect(snapshot(engine)[0].children.map(c => c.type)).toEqual(['list-item']);
  });

  it('the "--- " shortcut goes through it and is undone to "--- "', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, '---');
    typeSpace(engine, block);
    await flush();
    expect(snapshot(engine).map(b => b.type)).toEqual(['divider', 'paragraph']);
    engine.undo();
    await flush();
    expect(snapshot(engine)).toEqual([{ type: 'paragraph', text: '--- ', children: [] }]);
  });
});

describe('adjacent lists of different types do not destroy each other', () => {
  it('an ordered list typed right under a bullet list stays a separate list with its item', async () => {
    const { engine, block } = await makeEditor();
    await typed(engine, block, '-');
    typeSpace(engine, block);
    await flush();
    // a second paragraph right below the bullet list
    engine.insert('paragraph', {});
    await engine.commit();
    const second = engine.children[1];
    await typed(engine, second, '1.');
    typeSpace(engine, second);
    await flush();
    expect(snapshot(engine).map(b => [b.type, b.children.length])).toEqual([['list', 1], ['list', 1]]);
  });
});
