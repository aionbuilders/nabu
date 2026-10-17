// @ts-nocheck
/**
 * Unit tests for the generic block capability flags, with a FICTIONAL block type (the engine must
 * not know any concrete block):
 *  - P-31: `transformsEnabled === false` blocks are never transformed by markdown shortcuts;
 *  - P-32: `pastesAsPlainText` blocks take the clipboard text verbatim (no interpreter, one undo step);
 *  - P-33: create(..., index 0) inserts FIRST (index 0 is not "append").
 */

import { describe, it, expect, vi } from 'vitest';
import { LoroText } from 'loro-crdt';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { Paragraph } from '$lib/blocks/paragraph/paragraph.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/blockquote.extension.js';
import { DividerExtension } from '$lib/blocks/divider/divider.extension.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { CodeBlock } from '$lib/blocks/code/code.svelte.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { PlainTextPasteExtension } from '$lib/paste/plain-text.paste.js';
import { extension } from '$lib/utils/extensions';

/** A made-up text block: no transforms, verbatim paste. */
class Fiction extends Paragraph {
  transformsEnabled = false;
  pastesAsPlainText = true;
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'fiction');
    const container = node.data.setContainer('text', new LoroText());
    if (props.text) container.insert(0, props.text);
    return new Fiction(nabu, node);
  }
}
const FictionExtension = extension('fiction', { block: Fiction, component: null });

async function makeEditor(extra = []) {
  const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension,
      ListExtension, ListItemExtension, FictionExtension, MarkdownPasteExtension, PlainTextPasteExtension, ...extra],
  });
  await engine.commit();
  engine.undoManager.clear();
  return engine;
}

/** Pin the model selection of `block` (there is no DOM selection in unit tests). */
function pin(engine, block, from, to = from) {
  Object.defineProperty(block.behaviors.get('text'), 'selection', {
    configurable: true,
    get: () => ({ from, to, isCollapsed: from === to }),
  });
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: from === to, sync: vi.fn(), setCursor: vi.fn(), startOffset: from };
}

const snapshot = (engine) => engine.tree.roots().map(r => `${r.data.get('type')}(${r.data.get('text')?.toString() ?? ''})`);
const flush = () => new Promise(r => setTimeout(r, 20));

describe('P-31 — transformsEnabled === false blocks ignore markdown shortcuts', () => {
  for (const [typed, label] of [['#', '# '], ['##', '## '], ['>', '> '], ['---', '--- '], ['-', '- ']]) {
    it(`"${label}" typed in a fictional no-transform block stays plain typing`, async () => {
      const engine = await makeEditor();
      Fiction.create(engine, 'fiction', { text: typed });
      await engine.commit();
      const fiction = engine.children.find(b => b.type === 'fiction');
      pin(engine, fiction, typed.length);
      const beforeinput = vi.fn(() => false);
      fiction.beforeinput = beforeinput;
      const event = { inputType: 'insertText', data: ' ', preventDefault: vi.fn() };

      engine.dispatchEventToSelection('beforeinput', event, 'onBeforeInput');
      await flush();

      expect(fiction.type).toBe('fiction');
      expect(fiction.text).toBe(typed);
      expect(event.preventDefault).not.toHaveBeenCalled(); // the keystroke proceeds as normal typing
      expect(beforeinput).toHaveBeenCalledTimes(1);
    });
  }

  it('control: the same shortcut still transforms a regular paragraph', async () => {
    const engine = await makeEditor();
    const p = engine.children[0];
    p.insert(0, '#');
    await engine.commit();
    pin(engine, p, 1);
    const event = { inputType: 'insertText', data: ' ', preventDefault: vi.fn() };
    engine.dispatchEventToSelection('beforeinput', event, 'onBeforeInput');
    await flush();
    expect(engine.tree.roots()[0].data.get('type')).toBe('heading');
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('deletion hooks still run in a no-transform block', async () => {
    const engine = await makeEditor();
    const seen = [];
    engine.hooks.get('onBeforeInput').push((n, e, b) => { seen.push(e.inputType); });
    Fiction.create(engine, 'fiction', { text: '' });
    await engine.commit();
    const block = engine.children.find(b => b.type === 'fiction');
    pin(engine, block, 0);
    block.beforeinput = vi.fn(() => false);
    engine.dispatchEventToSelection('beforeinput', { inputType: 'deleteContentBackward', preventDefault: vi.fn() }, 'onBeforeInput');
    engine.dispatchEventToSelection('beforeinput', { inputType: 'insertText', data: 'a', preventDefault: vi.fn() }, 'onBeforeInput');
    expect(seen).toEqual(['deleteContentBackward']);
  });

  it('Nabu.shortcut() refuses on a no-transform block (nothing inserted, transform not run)', async () => {
    const engine = await makeEditor();
    Fiction.create(engine, 'fiction', { text: '#' });
    await engine.commit();
    const block = engine.children.find(b => b.type === 'fiction');
    pin(engine, block, 1);
    const transform = vi.fn();
    await engine.shortcut(block, ' ', transform);
    expect(transform).not.toHaveBeenCalled();
    expect(block.text).toBe('#');
  });

  it('the real CodeBlock opts out too', async () => {
    const engine = await makeEditor();
    engine.insert('code', { text: '#' });
    await engine.commit();
    const code = engine.children.find(b => b.type === 'code');
    expect(code).toBeInstanceOf(CodeBlock);
    pin(engine, code, 1);
    const event = { inputType: 'insertText', data: ' ', preventDefault: vi.fn() };
    code.beforeinput = vi.fn(() => false);
    engine.dispatchEventToSelection('beforeinput', event, 'onBeforeInput');
    await flush();
    expect(engine.children.find(b => b.type === 'code')).toBeTruthy();
    expect(engine.children.some(b => b.type === 'heading')).toBe(false);
  });
});

describe('P-32 — pastesAsPlainText blocks take the clipboard verbatim', () => {
  const clip = (formats) => ({ preventDefault: vi.fn(), clipboardData: { getData: (f) => formats[f] ?? '' } });
  const text = '# comment\n\n- not a list\nlast';

  async function setup(initial = 'ab') {
    const engine = await makeEditor();
    Fiction.create(engine, 'fiction', { text: initial });
    await engine.commit();
    engine.undoManager.clear();
    return { engine, block: engine.children.find(b => b.type === 'fiction') };
  }

  it('inserts text/plain at the caret: one block, `# ` and blank lines kept', async () => {
    const { engine, block } = await setup();
    pin(engine, block, 2);
    engine.handlePaste(clip({ 'text/plain': text, 'text/html': '<h1>x</h1>' }));
    await tick(); await engine.commit();
    expect(snapshot(engine).filter(s => !s.startsWith('paragraph'))).toEqual(['fiction(ab# comment\n\n- not a list\nlast)']);
    expect(engine.tree.roots().length).toBe(2); // the default paragraph + the fictional block, nothing spilled
  });

  it('replaces the selection', async () => {
    const { engine, block } = await setup('abcd');
    pin(engine, block, 1, 3);
    engine.handlePaste(clip({ 'text/plain': 'X\n\nY' }));
    await tick(); await engine.commit();
    expect(block.text).toBe('aX\n\nYd');
  });

  it('is a single undo step', async () => {
    const { engine, block } = await setup();
    pin(engine, block, 2);
    engine.handlePaste(clip({ 'text/plain': text }));
    await tick(); await engine.commit();
    engine.undo();
    await flush();
    expect(engine.children.find(b => b.type === 'fiction').text).toBe('ab');
  });

  it('a regular paragraph still goes through the interpreters (control)', async () => {
    const engine = await makeEditor();
    const p = engine.children[0];
    pin(engine, p, 0);
    engine.handlePaste(clip({ 'text/plain': '# Title\n\nbody' }));
    await tick(); await engine.commit();
    expect(engine.tree.roots().length).toBeGreaterThan(1);
  });

  it('CodeBlock sets the flag; Block defaults to false', async () => {
    const engine = await makeEditor();
    engine.insert('code', { text: 'x' });
    await engine.commit();
    expect(engine.children.find(b => b.type === 'code').pastesAsPlainText).toBe(true);
    expect(engine.children[0].pastesAsPlainText).toBe(false);
  });
});

describe('P-33 — create at index 0 inserts first', () => {
  it('Paragraph.create(..., 0) goes before existing blocks', async () => {
    const engine = await makeEditor();
    Paragraph.create(engine, 'paragraph', { text: 'second' });
    Paragraph.create(engine, 'paragraph', { text: 'first' }, null, 0);
    await engine.commit();
    expect(engine.tree.roots()[0].data.get('text').toString()).toBe('first');
  });

  it('CodeBlock.create(..., 0) goes first', async () => {
    const engine = await makeEditor();
    CodeBlock.create(engine, 'code', { text: 'c' }, null, 0);
    await engine.commit();
    expect(engine.tree.roots()[0].data.get('type')).toBe('code');
  });

  it('nabu.insert(type, props, parentId, 0) honours index 0 inside a parent', async () => {
    const engine = await makeEditor();
    engine.insert('list', { listType: 'bullet' });
    const list = engine.tree.roots().find(r => r.data.get('type') === 'list');
    engine.insert('list-item', { text: 'b' }, list.id.toString());
    engine.insert('list-item', { text: 'a' }, list.id.toString(), 0);
    await engine.commit();
    expect(list.children().map(c => c.data.get('text').toString())).toEqual(['a', 'b']);
  });
});
