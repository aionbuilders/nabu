// @ts-nocheck
/**
 * Re-parenting keeps the Block tree in sync (P-79): a node that leaves the ROOT for a container has no `oldParent` in the Loro
 * diff, so `nabu.children` (the root list the editor renders) used to keep the moved block.
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ToggleExtension } from '$lib/blocks/toggle/index.js';

const text = (b) => b.node.data.get('text')?.toString() ?? '';
const roots = (engine) => engine.children.map((b) => `${text(b)}${b.children?.length ? `{${b.children.map(text).join(' ')}}` : ''}`).filter((s) => s !== '').join(' ; ');
const find = (engine, t) => [...engine.blocks.values()].find((b) => text(b) === t);

async function make() {
  const engine = new Nabu({ extensions: [ParagraphExtension, ToggleExtension] });
  engine.insert('paragraph', { text: 'outside' }, null, 0);
  const tog = engine.insert('toggle', { text: 'Head' }, null, 1);
  engine.insert('paragraph', { text: 'inner' }, tog.id, 0);
  await engine.commit();
  return engine;
}

describe('nabu.children follows a re-parenting', () => {
  it('root -> container: the block leaves the root list', async () => {
    const engine = await make();
    find(engine, 'outside').node.move(find(engine, 'Head').node);
    await engine.commit();
    expect(roots(engine)).toBe('Head{inner outside}');
    expect(engine.children.filter((b) => text(b) === 'outside')).toEqual([]);
  });

  it('container -> root, and root <-> container through undo / redo', async () => {
    const engine = await make();
    engine.undoManager.clear();
    find(engine, 'inner').node.move(undefined, 0);
    await engine.commit();
    expect(roots(engine)).toBe('inner ; outside ; Head');
    engine.undo();
    await engine.commit();
    expect(roots(engine)).toBe('outside ; Head{inner}');
    engine.redo();
    await engine.commit();
    expect(roots(engine)).toBe('inner ; outside ; Head');
  });

  it('container -> container', async () => {
    const engine = await make();
    const other = engine.insert('toggle', { text: 'Other' }, null, 2);
    await engine.commit();
    find(engine, 'inner').node.move(other.node);
    await engine.commit();
    expect(roots(engine)).toBe('outside ; Head ; Other{inner}');
  });
});
