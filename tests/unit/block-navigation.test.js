// @ts-nocheck
/**
 * Unit tests for `Block#findForward` / `findBackward`: document order, `hidesChildren`, and LINEAR cost (the first
 * version of `findForward` revisited the following siblings recursively: exponential when nothing matched).
 * The foldable container is a FICTIONAL type: the mechanism is generic.
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { MegaBlock } from '#lib/blocks/megablock.svelte.js';
import { extension } from '#lib/utils/extensions.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';

class FoldBlock extends MegaBlock {
  folded = false;
  get hidesChildren() { return this.folded; }
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'fold');
    return new FoldBlock(nabu, node);
  }
}
const FoldExtension = extension('fold', { block: FoldBlock });

/** Builds `specs` ({ type, text, children, folded }) as the whole document. */
async function build(specs) {
  const engine = new Nabu({ extensions: [ParagraphExtension, FoldExtension] });
  for (const c of [...engine.children]) engine.delete(c);
  const folded = [];
  const add = (spec, parentId, index) => {
    const block = engine.insert(spec.type ?? 'paragraph', spec.type === 'fold' ? {} : { text: spec.text ?? '' }, parentId, index);
    if (spec.folded) folded.push(block);
    (spec.children ?? []).forEach((child, i) => add(child, block.id, i));
  };
  specs.forEach((s, i) => add(s, null, i));
  await engine.commit();
  for (const f of folded) f.folded = true;
  return engine;
}

/** Every block in document order, hidden bodies skipped. */
function visible(engine) {
  const out = [];
  const walk = (blocks) => { for (const b of blocks) { out.push(b); if (b.children?.length && !b.hidesChildren) walk(b.children); } };
  walk(engine.children);
  return out;
}

const textOf = (b) => b?.behaviors.get('text')?.text;
const P = (text, children) => ({ text, ...(children ? { children } : {}) });
const F = (children, folded = false) => ({ type: 'fold', children, folded });

describe('Block#findForward / findBackward', () => {
  it('walk the blocks in document order (own body, following siblings, then the ancestors\' siblings)', async () => {
    const engine = await build([P('a'), F([P('b'), F([P('c'), P('d')]), P('e')]), P('f'), F([P('g')]), P('h')]);
    const order = visible(engine);
    const texts = order.map(textOf).filter((t) => t !== undefined);
    expect(texts).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);

    // Starting from each block, the successive matches of findForward are exactly the blocks after it.
    for (let i = 0; i < order.length; i++) {
      const seen = [];
      for (let b = order[i].findForward(() => true); b; b = b.findForward(() => true)) seen.push(b);
      expect(seen).toEqual(order.slice(i + 1));
    }
    // ...and findBackward the blocks before it, in reverse order... except that a container is reached AFTER its body
    // going backward only through its last descendant (documented behaviour: a previous sibling yields its last descendant).
    for (let i = 0; i < order.length; i++) {
      const first = order[i].findBackward((b) => textOf(b) !== undefined);
      const expected = order.slice(0, i).filter((b) => textOf(b) !== undefined).at(-1) ?? null;
      expect(first).toBe(expected);
    }
  });

  it('respect hidesChildren: a folded body is never entered, from outside or from the container itself', async () => {
    const engine = await build([P('a'), F([P('b'), P('c')], true), P('d')]);
    const [a, fold, d] = engine.children;
    const hasText = (b) => textOf(b) !== undefined;
    expect(a.findForward(hasText)).toBe(d);
    expect(fold.findForward(hasText)).toBe(d);
    expect(d.findBackward(hasText)).toBe(a);
    expect(fold.children.length).toBe(2);
  });

  it('finds a match inside a following sibling\'s body, and returns the FIRST in document order', async () => {
    const engine = await build([P('a'), F([P('x1'), P('x2')]), P('x3')]);
    const [a] = engine.children;
    expect(textOf(a.findForward((b) => textOf(b)?.startsWith('x')))).toBe('x1');
    const last = engine.children[2];
    expect(textOf(last.findBackward((b) => textOf(b)?.startsWith('x')))).toBe('x2');
  });

  it('a long flat document with a predicate that never matches is walked once per block (no blow-up)', async () => {
    const engine = await build(Array.from({ length: 200 }, (_, i) => P(`p${i}`)));
    let calls = 0;
    const started = performance.now();
    const found = engine.children[0].findForward(() => { calls++; return false; });
    expect(found).toBeNull();
    expect(calls).toBe(199); // each following block tested exactly once
    expect(performance.now() - started).toBeLessThan(1000);

    calls = 0;
    expect(engine.children[199].findBackward(() => { calls++; return false; })).toBeNull();
    expect(calls).toBe(199);
  });

  it('a deep and wide tree is also walked once per block', async () => {
    const wide = (n) => Array.from({ length: n }, (_, i) => P(`x${i}`));
    const engine = await build([F([F([F(wide(30)), F(wide(30))]), F([F(wide(30)), F(wide(30))])]), ...wide(60)]);
    const total = visible(engine).length;
    let calls = 0;
    expect(engine.children[0].findForward(() => { calls++; return false; })).toBeNull();
    expect(calls).toBe(total - 1);
  });
});
