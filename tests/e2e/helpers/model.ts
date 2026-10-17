/**
 * Model-level helpers for structural E2E tests: build a document from a small spec, dump the MODEL tree
 * (read straight from the Loro tree, not from the DOM) as a compact one-line outline, describe the caret,
 * check structural invariants, place a caret / selection by text, and collect console errors.
 *
 * Outline notation (see `outline`):
 *   list      -> `ul[...]` | `ol[...]` | `todo[...]`   (items separated by ", ")
 *   list-item -> `text` | `text > ul[...]`              (todo items: `[ ] text` / `[x] text`; empty text: `∅`)
 *   other     -> `p(text)` / `heading(text)` ...
 *   roots are joined with " ; "
 */

import { type Page, expect } from '@playwright/test';
import { flushRender } from './editor.js';

// ── Fixture spec ───────────────────────────────────────────────────────────

export type ItemSpec = { text: string; checked?: boolean; sub?: ListSpec };
export type ListSpec = { kind: 'list'; listType: 'bullet' | 'ordered' | 'todo'; start?: number; items: ItemSpec[] };
export type ParaSpec = { kind: 'p'; text: string };
export type BlockSpec = ListSpec | ParaSpec;

/** `P('text')` -> a root paragraph. */
export const P = (text: string): ParaSpec => ({ kind: 'p', text });
/** `I('text', sub?)` -> a list item, optionally with a sublist. `checked` is meaningful in todo lists. */
export const I = (text: string, sub?: ListSpec | { checked?: boolean; sub?: ListSpec }): ItemSpec => {
  if (sub && (sub as ListSpec).kind === 'list') return { text, sub: sub as ListSpec };
  return { text, ...(sub as any) };
};
/** `UL(items...)` / `OL(items...)` / `TODO(items...)` -> a list. */
export const UL = (...items: ItemSpec[]): ListSpec => ({ kind: 'list', listType: 'bullet', items });
export const OL = (...items: ItemSpec[]): ListSpec => ({ kind: 'list', listType: 'ordered', items });
export const TODO = (...items: ItemSpec[]): ListSpec => ({ kind: 'list', listType: 'todo', items });

/** Replace the whole document with the given root blocks (programmatic fixture, undo history cleared). */
export async function buildDoc(page: Page, blocks: BlockSpec[]) {
  await page.evaluate(async (specs) => {
    const n = (window as any).nabu;
    for (const c of [...n.children]) n.delete(c);
    const addList = (spec: any, parentId: string | null, index: number | null) => {
      const list = n.insert('list', { listType: spec.listType, ...(spec.start ? { start: spec.start } : {}) }, parentId, index);
      spec.items.forEach((it: any, i: number) => {
        const props: any = { text: it.text };
        if (it.checked !== undefined) props.checked = it.checked;
        else if (spec.listType === 'todo') props.checked = false;
        const item = n.insert('list-item', props, list.id, i);
        if (it.sub) addList(it.sub, item.id, null);
      });
    };
    specs.forEach((s: any, i: number) => {
      if (s.kind === 'p') n.insert('paragraph', { text: s.text }, null, i);
      else addList(s, null, i);
    });
    await n.commit();
    n.undoManager.clear();
  }, blocks);
  await page.waitForFunction(() => {
    const n = (window as any).nabu;
    const count = (nodes: any[]): number => nodes.reduce((s, x) => s + 1 + count(x.children() ?? []), 0);
    return document.querySelectorAll('[data-block-id]').length === count(n.tree.roots());
  });
}

// ── Model dump ─────────────────────────────────────────────────────────────

/** One-line outline of the MODEL tree (Loro), see the file header for the notation. */
export async function outline(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const text = (node: any) => {
      const t = node.data.get('text');
      const s = t ? t.toString() : '';
      return s === '' ? '∅' : s;
    };
    const walk = (node: any, parentList: any): string => {
      const type = node.data.get('type');
      const kids: any[] = node.children() ?? [];
      if (type === 'list') {
        const lt = node.data.get('listType') || 'bullet';
        const tag = lt === 'ordered' ? 'ol' : lt === 'todo' ? 'todo' : 'ul';
        return `${tag}[${kids.map((k) => walk(k, node)).join(', ')}]`;
      }
      if (type === 'list-item') {
        const todo = parentList?.data.get('listType') === 'todo';
        const mark = todo ? (node.data.get('checked') ? '[x] ' : '[ ] ') : '';
        const sub = kids.length ? ' > ' + kids.map((k) => walk(k, node)).join(' ') : '';
        return `${mark}${text(node)}${sub}`;
      }
      const short = type === 'paragraph' ? 'p' : type;
      return `${short}(${text(node)})${kids.length ? '{' + kids.map((k) => walk(k, node)).join(' ') + '}' : ''}`;
    };
    return n.tree.roots().map((r: any) => walk(r, null)).join(' ; ');
  });
}

/**
 * Structural invariants of the model tree + render: list-items only under lists, lists only at root or under
 * a list-item, no empty list, every Loro node has a live Block instance whose `children` match the tree, and
 * the DOM holds exactly one `[data-block-id]` element per node. Returns the list of violations (empty = valid).
 */
export async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const out: string[] = [];
    const ids = new Set<string>();
    const walk = (node: any, parent: any) => {
      const id = node.id.toString();
      const type = node.data.get('type');
      ids.add(id);
      const kids: any[] = node.children() ?? [];
      const ptype = parent ? parent.data.get('type') : null;
      if (type === 'list-item' && ptype !== 'list') out.push(`list-item ${id} has parent ${ptype}`);
      if (type === 'list' && ptype !== null && ptype !== 'list-item') out.push(`list ${id} has parent ${ptype}`);
      if (type === 'list' && kids.length === 0) out.push(`empty list ${id}`);
      if (type === 'list') for (const k of kids) if (k.data.get('type') !== 'list-item') out.push(`list ${id} has child ${k.data.get('type')}`);
      if (type === 'list-item') {
        const lists = kids.filter((k) => k.data.get('type') === 'list');
        if (lists.length > 1) out.push(`list-item ${id} has ${lists.length} sublists`);
        if (lists.length !== kids.length) out.push(`list-item ${id} has a non-list child`);
      }
      const block = n.blocks.get(id);
      if (!block) out.push(`no Block instance for ${type} ${id}`);
      else {
        const have = (block.children ?? []).map((c: any) => c.id).join(',');
        const want = kids.map((k) => k.id.toString()).join(',');
        if (have !== want) out.push(`block ${id} children [${have}] != tree [${want}]`);
        if ((block.type) !== type) out.push(`block ${id} type ${block.type} != tree ${type}`);
      }
      kids.forEach((k) => walk(k, node));
    };
    n.tree.roots().forEach((r: any) => walk(r, null));
    const domIds = [...document.querySelectorAll('[data-block-id]')].map((e) => e.getAttribute('data-block-id')!);
    if (domIds.length !== ids.size) out.push(`DOM has ${domIds.length} blocks, tree has ${ids.size}`);
    for (const d of domIds) if (!ids.has(d)) out.push(`DOM block ${d} not in tree`);
    if (new Set(domIds).size !== domIds.length) out.push('duplicated data-block-id in the DOM');
    return out;
  });
}

/** Assert the tree is structurally valid. */
export async function expectValid(page: Page) {
  expect(await violations(page)).toEqual([]);
}

/** All text of the document's leaf texts, concatenated in document order (to check nothing was lost / duplicated). */
export async function allText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const out: string[] = [];
    const walk = (node: any) => {
      const t = node.data.get('text');
      if (t) out.push(t.toString());
      (node.children() ?? []).forEach(walk);
    };
    n.tree.roots().forEach(walk);
    return out;
  });
}

// ── Caret ──────────────────────────────────────────────────────────────────

/**
 * Describe the current selection against the MODEL: the collapsed caret is the anchor block's text with a
 * `|` at the offset ("Par|ent"); a range inside one block is `a⟦bc⟧d`; a cross-block range is
 * `⟦first|…|last⟧` form `anchorText@offset -> focusText@offset`. `null` when nothing is selected.
 */
export async function caret(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const s = window.getSelection();
    if (!s || !s.anchorNode || !s.focusNode) return null;
    const pos = (node: Node, off: number) => {
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
      const id = el?.closest('[data-block-id]')?.getAttribute('data-block-id');
      const block = id ? n.blocks.get(id) : null;
      const tb = block?.behaviors?.get('text');
      if (!block || !tb) return null;
      return { block, text: tb.text as string, offset: tb.calculateOffset(node, off, block.element) as number };
    };
    const a = pos(s.anchorNode, s.anchorOffset);
    const f = pos(s.focusNode, s.focusOffset);
    if (!a || !f) return `<caret outside any text block: ${s.anchorNode.nodeName}@${s.anchorOffset}>`;
    if (a.block === f.block) {
      const lo = Math.min(a.offset, f.offset), hi = Math.max(a.offset, f.offset);
      return lo === hi ? a.text.slice(0, lo) + '|' + a.text.slice(lo) : a.text.slice(0, lo) + '⟦' + a.text.slice(lo, hi) + '⟧' + a.text.slice(hi);
    }
    return `${a.text}@${a.offset} -> ${f.text}@${f.offset}`;
  });
}

/** Place a collapsed caret at `offset` of the (unique) text block whose text is `text`. */
export async function focusAt(page: Page, text: string, offset: number) {
  await selectRange(page, text, offset, text, offset);
}

/** Place the caret at the end of the block whose text is `text`. */
export async function focusEnd(page: Page, text: string) {
  await selectRange(page, text, -1, text, -1);
}

/** Select from (`fromText`, `fromOffset`) to (`toText`, `toOffset`); offset -1 = end of the block's text. */
export async function selectRange(page: Page, fromText: string, fromOffset: number, toText: string, toOffset: number) {
  await page.evaluate(async ([ft, fo, tt, to]) => {
    const n = (window as any).nabu;
    const find = (t: string) => {
      const hits = [...n.blocks.values()].filter((b: any) => {
        const tb = b.behaviors?.get('text');
        return tb && tb.text === t && document.querySelector(`[data-block-id="${b.id}"]`);
      });
      if (hits.length !== 1) throw new Error(`expected exactly one block with text "${t}", found ${hits.length}`);
      return hits[0] as any;
    };
    const fb = find(ft as string), tb = find(tt as string);
    const fOff = (fo as number) < 0 ? fb.behaviors.get('text').text.length : fo;
    const tOff = (to as number) < 0 ? tb.behaviors.get('text').text.length : to;
    await n.focus({ from: { block: fb, offset: fOff }, to: { block: tb, offset: tOff } });
  }, [fromText, fromOffset, toText, toOffset] as [string, number, string, number]);
  await flushRender(page);
}

/** Focus the empty block (the unique one with empty text, or the n-th, 0-based) and put the caret in it. */
export async function focusEmpty(page: Page, nth = 0) {
  await page.evaluate(async (k) => {
    const n = (window as any).nabu;
    const hits = [...n.blocks.values()].filter((b: any) => {
      const tb = b.behaviors?.get('text');
      return tb && tb.text === '' && document.querySelector(`[data-block-id="${b.id}"]`);
    });
    // document order
    hits.sort((x: any, y: any) => {
      const ex = document.querySelector(`[data-block-id="${x.id}"]`)!, ey = document.querySelector(`[data-block-id="${y.id}"]`)!;
      return ex.compareDocumentPosition(ey) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    const b = hits[k as number] as any;
    if (!b) throw new Error(`no empty block #${k}`);
    await n.focus({ from: { block: b, offset: 0 }, to: { block: b, offset: 0 } });
  }, nth);
  await flushRender(page);
}

// ── Console errors ─────────────────────────────────────────────────────────

/** Start collecting page errors / console errors; call `.list()` at the end of a test. */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return; // missing favicon etc., not an editor error
    errors.push(`console.error: ${t}`);
  });
  return { list: () => errors };
}
