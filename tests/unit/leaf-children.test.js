// @ts-nocheck
/**
 * Generic core rule: a block whose class cannot hold children (not a MegaBlock) never keeps child nodes.
 * Retyping a node into such a block (or moving a node under one) moves its children out to right after it,
 * in order, in the same transaction. The test uses FICTIONAL block types (`crate`, a container; `pebble`, a
 * leaf) and no list extension: the rule knows no concrete block type.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { Block } from '$lib/blocks/block.svelte.js';
import { MegaBlock } from '$lib/blocks/megablock.svelte.js';
import { extension } from '$lib/utils/extensions.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';

class Crate extends MegaBlock {}
class Pebble extends Block {}
class Marble extends MegaBlock {}

async function makeEditor() {
  const engine = new Nabu({
    extensions: [
      extension('crate', { block: Crate }),
      extension('pebble', { block: Pebble }),
      extension('marble', { block: Marble }),
    ],
  });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  engine.undoManager.clear();
  return engine;
}

const make = (engine, type, label, parent = null) => {
  const node = engine.tree.createNode(parent?.id.toString());
  node.data.set('type', type);
  node.data.set('label', label);
  return node;
};
const outline = (node) => {
  const kids = (node.children() ?? []).map(outline);
  return `${node.data.get('type')}:${node.data.get('label')}${kids.length ? `[${kids.join(', ')}]` : ''}`;
};
const doc = (engine) => engine.tree.roots().filter((n) => n.data.get('label')).map(outline);

describe('children of a block that cannot hold any', () => {
  it('retyping a container into a leaf moves its children right after it, in order', async () => {
    const engine = await makeEditor();
    const a = make(engine, 'pebble', 'a');
    const box = make(engine, 'crate', 'box');
    make(engine, 'pebble', 'c1', box);
    make(engine, 'pebble', 'c2', box);
    make(engine, 'pebble', 'z');
    await engine.commit();
    expect(doc(engine)).toEqual(['pebble:a', 'crate:box[pebble:c1, pebble:c2]', 'pebble:z']);
    const ids = Object.fromEntries(box.children().map((c) => [c.data.get('label'), c.id.toString()]));

    box.data.set('type', 'pebble');
    await engine.commit();

    expect(doc(engine)).toEqual(['pebble:a', 'pebble:box', 'pebble:c1', 'pebble:c2', 'pebble:z']);
    // moved, not recreated: the ids (hence the carets) survive
    expect(engine.tree.roots().filter((n) => /^c/.test(n.data.get('label') ?? '')).map((n) => n.id.toString())).toEqual([ids.c1, ids.c2]);
  });

  it('nested: the children land in the parent container, after the retyped node', async () => {
    const engine = await makeEditor();
    const outer = make(engine, 'crate', 'outer');
    const x = make(engine, 'crate', 'x', outer);
    make(engine, 'pebble', 'after', outer);
    make(engine, 'pebble', 'x1', x);
    make(engine, 'crate', 'x2', x);
    await engine.commit();

    x.data.set('type', 'pebble');
    await engine.commit();

    expect(doc(engine)).toEqual(['crate:outer[pebble:x, pebble:x1, crate:x2, pebble:after]']);
  });

  it('is part of the retyping transaction: one undo step restores everything', async () => {
    const engine = await makeEditor();
    const box = make(engine, 'crate', 'box');
    make(engine, 'pebble', 'c1', box);
    await engine.commit();
    engine.undoManager.clear();

    await engine.transact(() => box.data.set('type', 'pebble'));
    expect(doc(engine)).toEqual(['pebble:box', 'pebble:c1']);

    engine.undo();
    expect(doc(engine)).toEqual(['crate:box[pebble:c1]']);
    expect(engine.undoManager.canUndo()).toBe(false);
  });

  it('a node moved UNDER a leaf is evicted too', async () => {
    const engine = await makeEditor();
    const leaf = make(engine, 'pebble', 'leaf');
    const other = make(engine, 'pebble', 'other');
    await engine.commit();

    other.move(leaf, 0);
    await engine.commit();

    expect(doc(engine)).toEqual(['pebble:leaf', 'pebble:other']);
  });

  it('containers keep their children, and a container retyped into another container too', async () => {
    const engine = await makeEditor();
    const box = make(engine, 'crate', 'box');
    make(engine, 'pebble', 'c1', box);
    await engine.commit();

    box.data.set('type', 'marble');
    await engine.commit();

    expect(doc(engine)).toEqual(['marble:box[pebble:c1]']);
  });

  it('a block:transform to a leaf type keeps every child (programmatic data.set + transformBlock path)', async () => {
    const engine = new Nabu({
      extensions: [extension('crate', { block: Crate }), extension('pebble', { block: Pebble }), BlockExtension],
    });
    await engine.commit();
    const box = make(engine, 'crate', 'box');
    make(engine, 'pebble', 'c1', box);
    await engine.commit();
    engine.selection = { anchorBlock: engine.blocks.get(box.id.toString()), focusBlock: null, sync: vi.fn(), setCursor: vi.fn() };

    await engine.exec('block:transform', { type: 'pebble' });

    expect(doc(engine)).toEqual(['pebble:box', 'pebble:c1']);
  });
});
