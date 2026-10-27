// @ts-nocheck
/**
 * The `fields` map of a region is a MERGEABLE child (`ensureMergeableMap`, Loro 1.13+): two peers creating it concurrently
 * converge instead of one losing its writes. A document written earlier (REGULAR `fields` child) still reads and writes.
 */

import { describe, it, expect, vi } from 'vitest';
import { LoroDoc, LoroMap } from 'loro-crdt';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { RegionsExtension } from '#lib/blocks/region/index.js';
import { fieldsMap } from '#lib/blocks/region/region.svelte.js';

/** Two peers sharing one region node whose data has NO `fields` yet. */
function twoPeers() {
  const a = new LoroDoc(); a.setPeerId(1);
  const b = new LoroDoc(); b.setPeerId(2);
  const tree = a.getTree('tree');
  const node = tree.createNode();
  node.data.set('type', 'region');
  node.data.set('regionType', 'scene');
  a.commit();
  b.import(a.export({ mode: 'update' }));
  return { a, b, idA: node.id, nodeOf: (doc, id) => doc.getTree('tree').getNodeByID(id) };
}

const sync = (a, b) => {
  const fromA = a.export({ mode: 'update', from: b.version() });
  const fromB = b.export({ mode: 'update', from: a.version() });
  b.import(fromA); a.import(fromB);
};

describe('region fields map (mergeable)', () => {
  it('two peers that each create the fields map concurrently keep BOTH writes', () => {
    const { a, b, idA, nodeOf } = twoPeers();
    const na = nodeOf(a, idA), nb = nodeOf(b, idA);
    fieldsMap(na.data).set('pov', 'Anna');
    fieldsMap(nb.data).set('mood', 'dark');
    a.commit(); b.commit();
    sync(a, b);
    for (const doc of [a, b]) {
      const map = nodeOf(doc, idA).data.get('fields');
      expect(map.kind()).toBe('Map');
      expect(map.toJSON()).toEqual({ pov: 'Anna', mood: 'dark' });
    }
    expect(nodeOf(a, idA).data.get('fields').id).toBe(nodeOf(b, idA).data.get('fields').id);
  });

  it('is idempotent on one peer: a second call returns the same map', () => {
    const { a, idA, nodeOf } = twoPeers();
    const data = nodeOf(a, idA).data;
    const first = fieldsMap(data);
    first.set('x', 1);
    const second = fieldsMap(data);
    expect(second.id).toBe(first.id);
    expect(second.get('x')).toBe(1);
  });

  it('an old document (REGULAR fields child) still reads and writes, and the regular child is kept', () => {
    const { a, b, idA, nodeOf } = twoPeers();
    const na = nodeOf(a, idA);
    na.data.setContainer('fields', new LoroMap()).set('pov', 'Old');
    a.commit();
    b.import(a.export({ mode: 'update' }));
    const regularId = nodeOf(a, idA).data.get('fields').id;
    // both peers reach it with the helper: no throw, same container, writes merge
    fieldsMap(nodeOf(a, idA).data).set('a', 1);
    fieldsMap(nodeOf(b, idA).data).set('b', 2);
    a.commit(); b.commit();
    sync(a, b);
    for (const doc of [a, b]) {
      const map = nodeOf(doc, idA).data.get('fields');
      expect(map.id).toBe(regularId);
      expect(map.toJSON()).toEqual({ pov: 'Old', a: 1, b: 2 });
    }
  });

  it('a snapshot round trip keeps a mergeable fields map readable', () => {
    const { a, idA, nodeOf } = twoPeers();
    fieldsMap(nodeOf(a, idA).data).set('pov', 'Anna');
    a.commit();
    const copy = new LoroDoc();
    copy.import(a.export({ mode: 'snapshot' }));
    expect(nodeOf(copy, idA).data.get('fields').toJSON()).toEqual({ pov: 'Anna' });
  });
});

describe('RegionBlock with a mergeable / regular fields map', () => {
  const FIELDS = { note: { level: 1, fields: { pov: 'text', synopsis: 'richtext' } } };
  async function make() {
    const engine = new Nabu({ extensions: [ParagraphExtension, RichTextExtension, RegionsExtension({ types: FIELDS }), BlockExtension] });
    await engine.commit();
    engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(), startOffset: 0 };
    return engine;
  }

  it('create() makes a mergeable map; setField / fields / richtext work through it', async () => {
    const engine = await make();
    for (const b of [...engine.children]) engine.delete(b);
    const region = engine.insert('region', { regionType: 'note', title: 'T', fields: { pov: 'Anna' } }, null, 0);
    await engine.commit();
    const map = region.node.data.get('fields');
    expect(map.kind()).toBe('Map');
    expect(region.fields.pov).toBe('Anna');
    expect(region.setField('synopsis', 'Once upon')).toBe(true);
    expect(region.setField('pov', 'Bob')).toBe(true);
    await engine.commit();
    expect(region.node.data.get('fields').id).toBe(map.id);
    expect(region.fields).toMatchObject({ pov: 'Bob', synopsis: 'Once upon' });
    expect(region.richtext('synopsis').toString()).toBe('Once upon');
  });

  it('a region whose fields map is a regular child (old document) still reads and writes', async () => {
    const engine = await make();
    for (const b of [...engine.children]) engine.delete(b);
    const region = engine.insert('region', { regionType: 'note', title: 'T' }, null, 0);
    await engine.commit();
    const data = region.node.data;
    data.delete('fields');
    data.setContainer('fields', new LoroMap()).set('pov', 'Old');
    await engine.commit();
    region.setField('synopsis', 'new');
    expect(region.setField('pov', 'Older')).toBe(true);
    await engine.commit();
    expect(data.get('fields').toJSON()).toMatchObject({ pov: 'Older' });
    expect(region.fields).toMatchObject({ pov: 'Older', synopsis: 'new' });
    expect(region.richtext('synopsis').toString()).toBe('new');
  });
});
