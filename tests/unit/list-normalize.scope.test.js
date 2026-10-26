// @ts-nocheck
/**
 * The list normalizer visits only what the pending transaction touched (P-106). Differential test: the same random sequences of
 * low-level edits (create / move / delete / retype / listType change of lists, items and paragraphs, several commits per run)
 * are applied to two editors, one normalized by the scoped normalizer, the other by the full scan (`{ full: true }`). After every commit both documents must have the same outline, and be valid. (When an EMPTY list sits next to a list of its
 * own type, which of the two survives depends on the visit order, in both: node identities are not compared.)
 */

import { describe, it, expect, vi } from 'vitest';
import { LoroText } from 'loro-crdt';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension, Paragraph } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '$lib/blocks/list/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { normalizeLists } from '$lib/blocks/list/normalize.js';

/** A list extension whose normalizer is the full scan. */
const FullListExtension = { ...ListExtension, hooks: { ...ListExtension.hooks, onBeforeTransaction: (nabu) => normalizeLists(nabu, { full: true }) } };

async function makeEditor(full) {
  const engine = new Nabu({ extensions: [ParagraphExtension, full ? FullListExtension : ListExtension, ListItemExtension, BlockExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return engine;
}

/** mulberry32 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function outline(node) {
  const type = node.data.get('type');
  const kids = (node.children() ?? []).map(outline);
  if (type === 'list') return `list:${node.data.get('listType')}[${kids.join(', ')}]`;
  const label = `${type === 'list-item' ? 'item' : 'p'}:${node.data.get('text')?.toString()}`;
  return kids.length ? `${label}[${kids.join(', ')}]` : label;
}
const snapshot = (engine) => engine.tree.roots().map(outline);

/** Every node, in document order, with its depth-first path. */
function allNodes(engine) {
  const out = [];
  const walk = (node) => { out.push(node); for (const child of node.children() ?? []) walk(child); };
  for (const root of engine.tree.roots()) walk(root);
  return out;
}
const isInside = (node, ancestor) => {
  for (let cur = node; cur; cur = cur.parent()) if (cur.id.toString() === ancestor.id.toString()) return true;
  return false;
};

/** Violations of the list schema in a document. */
function violations(engine) {
  const bad = [];
  const check = (siblings) => {
    siblings.forEach((node, i) => {
      const type = node.data.get('type');
      const children = node.children() ?? [];
      if (type === 'list') {
        // (an empty list is NOT a violation here: a list the transaction created and left empty is under construction, by design)
        if (children.some((c) => c.data.get('type') !== 'list-item')) bad.push('foreign child of a list');
        const prev = siblings[i - 1];
        if (prev?.data.get('type') === 'list' && (prev.data.get('listType') || 'bullet') === (node.data.get('listType') || 'bullet')) bad.push('adjacent lists');
      }
      if (type === 'list-item' && children.some((c) => c.data.get('type') !== 'list')) bad.push('item with a non-list child');
      check(children);
    });
  };
  check(engine.tree.roots());
  return bad;
}

let counter = 0;
/** One random edit, described by indices into the document order so that it replays identically on both editors. */
function planEdit(random, size) {
  return {
    kind: Math.floor(random() * 7),
    a: Math.floor(random() * size),
    b: Math.floor(random() * (size + 1)), // size = the root
    index: random(),
    type: Math.floor(random() * 3),
    fill: true,
    name: `n${counter++}`,
  };
}

function applyEdit(engine, edit) {
  const nodes = allNodes(engine);
  const pick = (i) => nodes[i % nodes.length];
  const parentOf = (i) => (i >= nodes.length ? null : nodes[i]);
  const place = (parent, index, moving = null) => {
    let n = parent ? (parent.children() ?? []).length : engine.tree.roots().length;
    if (moving && (moving.parent()?.id.toString() ?? null) === (parent?.id.toString() ?? null)) n--; // it leaves its slot first
    return Math.floor(index * (n + 1));
  };
  const pid = (parent) => parent?.id.toString() ?? null;
  switch (edit.kind) {
    case 0: { // create a paragraph / item / list (+ an item inside, usually)
      const parent = parentOf(edit.b);
      const at = place(parent, edit.index);
      if (edit.type === 0) Paragraph.create(engine, 'paragraph', { text: edit.name }, pid(parent), at);
      else if (edit.type === 1) ListItem.create(engine, 'list-item', { text: edit.name }, pid(parent), at);
      else {
        const list = List.create(engine, 'list', { listType: edit.index < 0.5 ? 'bullet' : 'ordered' }, pid(parent), at);
        if (edit.fill) ListItem.create(engine, 'list-item', { text: edit.name }, list.id);
      }
      break;
    }
    case 1: case 2: { // move
      const node = pick(edit.a);
      const parent = parentOf(edit.b);
      if (parent && isInside(parent, node)) break;
      node.move(parent ?? undefined, place(parent, edit.index, node));
      break;
    }
    case 3: { // delete (never the last root)
      const node = pick(edit.a);
      if (engine.tree.roots().length <= 1 && !node.parent()) break;
      engine.tree.delete(node.id);
      break;
    }
    case 4: { // retype
      const node = pick(edit.a);
      const type = ['paragraph', 'list-item', 'list'][edit.type];
      if (node.data.get('type') === type) break;
      node.data.set('type', type);
      // The node keeps its other fields: make them the same whichever node ends up surviving a merge (identities may differ, see below).
      if (type === 'list') { node.data.set('listType', 'bullet'); node.data.delete('text'); } else node.data.setContainer('text', new LoroText()).insert(0, '~');
      break;
    }
    case 5: { // listType
      const node = pick(edit.a);
      if (node.data.get('type') === 'list') node.data.set('listType', node.data.get('listType') === 'bullet' ? 'ordered' : 'bullet');
      break;
    }
    default: { // a second edit in the same commit: move to the root
      const node = pick(edit.a);
      node.move(undefined, place(null, edit.index, node));
    }
  }
}

describe('list normalizer — scoped scan equals the full scan', () => {
  for (let seed = 1; seed <= 120; seed++) {
    it(`random edits, seed ${seed}`, async () => {
      const random = rng(seed);
      const scoped = await makeEditor(false);
      const full = await makeEditor(true);
      for (const engine of [scoped, full]) {
        for (let i = 0; i < 8; i++) { // a first, valid document
          if (i % 3 === 0) Paragraph.create(engine, 'paragraph', { text: `s${i}` }, null);
          else {
            const list = List.create(engine, 'list', { listType: i % 2 ? 'bullet' : 'ordered' }, null);
            ListItem.create(engine, 'list-item', { text: `s${i}` }, list.id);
            ListItem.create(engine, 'list-item', { text: `t${i}` }, list.id);
          }
        }
        await engine.commit();
      }
      for (let step = 0; step < 14; step++) {
        const edits = [];
        const count = 1 + Math.floor(random() * 3);
        for (let i = 0; i < count; i++) edits.push(planEdit(random, allNodes(full).length));
        for (const engine of [scoped, full]) {
          for (const edit of edits) applyEdit(engine, edit);
          await engine.commit();
        }
        expect(snapshot(scoped)).toEqual(snapshot(full));
        expect(violations(scoped)).toEqual([]);
      }
    });
  }
});
