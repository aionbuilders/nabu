// @ts-nocheck
/**
 * The end marker of a region (ADR 018 §3.3, board 9 option B): the pure condition ("text of the parent follows") and its text
 * ("End of 1.2 · back to 1. The ferryman" / "… · outside regions"), overridable messages.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';
import { RichTextExtension } from '$lib/behaviors/text/index.js';
import { RegionsExtension } from '$lib/blocks/region/index.js';
import { createMessages } from '$lib/blocks/region/messages.js';
import { needsEndMarker, endMarkerText } from '$lib/blocks/region/end-marker.js';

const R = (regionType, title = '', children = []) => ({ type: 'region', regionType, title, children });
const P = (text = '') => ({ type: 'paragraph', text });

async function makeEditor(options) {
  const engine = new Nabu({ extensions: [ParagraphExtension, RichTextExtension, RegionsExtension(options), BlockExtension] });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(), startOffset: 0 };
  return engine;
}

async function build(engine, specs) {
  for (const b of [...engine.children]) engine.delete(b);
  const add = (spec, parentId, index) => {
    const props = spec.type === 'region' ? { regionType: spec.regionType, title: spec.title } : { text: spec.text };
    const block = engine.insert(spec.type, props, parentId, index);
    (spec.children ?? []).forEach((child, i) => add(child, block.id, i));
  };
  specs.forEach((spec, i) => add(spec, null, i));
  await engine.commit();
}

/** Which regions (by title) would draw an end marker, from the live blocks. */
const marked = (engine) => engine.regions.list
  .filter((r) => needsEndMarker(r.block.parent ? r.block.parent.children : engine.children, r.block))
  .map((r) => r.title);

describe('needsEndMarker', () => {
  it('only when the next sibling is NOT a region', () => {
    const siblings = [{ id: 'a', type: 'region' }, { id: 'b', type: 'paragraph' }, { id: 'c', type: 'region' }, { id: 'd', type: 'region' }, { id: 'e', type: 'list' }];
    expect(needsEndMarker(siblings, siblings[0])).toBe(true); // followed by a paragraph
    expect(needsEndMarker(siblings, siblings[2])).toBe(false); // followed by a region
    expect(needsEndMarker(siblings, siblings[3])).toBe(true); // followed by a list
    expect(needsEndMarker(siblings, siblings[4])).toBe(false); // last
  });

  it('a block that is not among the siblings (or the last one) needs none', () => {
    expect(needsEndMarker([], { id: 'x' })).toBe(false);
    expect(needsEndMarker([{ id: 'a', type: 'region' }], { id: 'a' })).toBe(false);
  });

  it('on a real document: root and nested', async () => {
    const engine = await makeEditor();
    await build(engine, [
      R('section-1', 'A', [R('section-2', 'A1', [P('x')]), P('between'), R('section-2', 'A2', [P('y')])]),
      P('outside'),
      R('section-1', 'B', [P('z')]),
      R('section-1', 'C', [P('w')]),
    ]);
    // A1 is followed by "between" (text of A), A2 closes A (last child), A is followed by "outside" (root text), B by a region, C is last
    expect(marked(engine)).toEqual(['A', 'A1']); // document order
  });
});

describe('endMarkerText', () => {
  it('inside a region: "End of {prefix} · back to {parent label}"', async () => {
    const engine = await makeEditor();
    await build(engine, [R('section-1', 'The ferryman', [R('section-2', 'The bank', [P('x')]), P('t')])]);
    const [parent, child] = engine.regions.list;
    expect(endMarkerText(createMessages(undefined), child)).toBe('End of 1.1 · back to 1. The ferryman');
    expect(endMarkerText(createMessages(undefined), parent)).toBe('End of 1. · outside regions');
  });

  it('the name is the prefix, else the title, else the type name', async () => {
    const engine = await makeEditor({ types: { note: { level: 1, name: 'Note', numbering: 'none', label: '{title}' } } });
    await build(engine, [R('note', 'Aside', [P('x')]), R('note', '', [P('y')])]);
    const [a, b] = engine.regions.list;
    expect(endMarkerText(createMessages(undefined), a)).toBe('End of Aside · outside regions');
    expect(endMarkerText(createMessages(undefined), b)).toBe('End of Note · outside regions');
  });

  it('every part is overridable (the owner writes French)', async () => {
    const engine = await makeEditor();
    await build(engine, [R('section-1', 'Un', [R('section-2', 'Deux', [P('x')])])]);
    const text = createMessages({ endOf: ({ name }) => `Fin de ${name}`, backTo: ({ name }) => `retour à ${name}`, outside: 'hors des régions' });
    const [parent, child] = engine.regions.list;
    expect(endMarkerText(text, child)).toBe('Fin de 1.1 · retour à 1. Un');
    expect(endMarkerText(text, parent)).toBe('Fin de 1. · hors des régions');
  });
});
