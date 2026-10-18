// @ts-nocheck
/**
 * Unit tests for P-36 .. P-39 — Enter / Backspace / Delete behaviours of Heading, Dialogue, Callout, Code, Divider.
 *  - P-36 Heading split: middle -> two headings, end -> paragraph below, start -> empty paragraph above.
 *  - P-37 Dialogue: the block-type-specific onSplit wins over the generic Paragraph one (Block#ascend owner priority);
 *    configurable dash (`createDialogueExtension`), markdown export / import.
 *  - P-38 Callout: Backspace at offset 0 of a non-empty callout is a no-op.
 *  - P-39 Code: Backspace at 0 -> paragraph; Divider: Delete at the end of the block before it deletes it.
 * Real Nabu with a stubbed selection (there is no DOM selection in unit tests).
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { Block } from '$lib/blocks/block.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { DialogueExtension, createDialogueExtension, Dialogue } from '$lib/blocks/dialogue/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/index.js';
import { BlockExtension } from '$lib/blocks/block.extension.js';

async function makeEditor(extra = [DialogueExtension]) {
  const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ...extra, BlockExtension],
  });
  await engine.commit();
  engine.selection = { anchorBlock: null, focusBlock: null, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn(), startOffset: 0 };
  engine.undoManager.clear();
  return engine;
}

/** Replace the editor content by `specs` ([type, text, props]) and return the blocks. */
async function build(engine, specs) {
  for (const b of [...engine.children]) engine.delete(b);
  const blocks = specs.map(([type, text = '', props = {}]) => engine.insert(type, { text, ...props }));
  await engine.commit();
  return blocks.map((b) => engine.blocks.get(b.id));
}

const flat = (engine) => engine.children.map((b) => `${b.type}${b.level ? b.level : ''}(${b.text ?? ''})`).join(' ; ');

/** Pin the model caret of a block (no DOM selection in unit tests). */
function pin(engine, block, from) {
  Object.defineProperty(block.behaviors.get('text'), 'selection', {
    configurable: true,
    get: () => ({ from, to: from, isCollapsed: true }),
  });
  engine.selection.anchorBlock = block;
  engine.selection.focusBlock = block;
  engine.selection.startOffset = from;
}

/** What TextBehavior#handleInsertParagraph does for a collapsed caret. */
function enter(block, offset) {
  const c = block.behavior.container;
  return block.ascend('onSplit', null, { offset, delta: c.sliceDelta(offset, c.length) });
}

/** Fire the onBeforeInput hooks the way Nabu#dispatchEventToSelection does. */
function key(engine, block, inputType) {
  const event = { inputType, data: null, preventDefault: vi.fn() };
  for (const hook of engine.hooks.get('onBeforeInput')) {
    if (hook(engine, event, block) === engine.BREAK) return true;
  }
  return false;
}

describe('Block#ascend — the hooks of the extension owning the block type run first', () => {
  const mk = (hooks, owners) => {
    const nabu = { blocks: new Map(), blocksByType: new Map(), hooks: new Map([['onSplit', hooks]]), hookOwners: owners, warn: vi.fn() };
    const node = { id: { toString: () => 'n1' }, data: { get: (k) => (k === 'type' ? 'dialogue' : null) }, parent: () => null, index: () => 0 };
    return new Block(nabu, node);
  };

  it('a generic hook registered FIRST does not shadow the owner hook', () => {
    const generic = vi.fn().mockReturnValue('generic');
    const own = vi.fn().mockReturnValue('own');
    const owners = new WeakMap([[generic, 'paragraph'], [own, 'dialogue']]);
    expect(mk([generic, own], owners).ascend('onSplit', null, {})).toBe('own');
    expect(generic).not.toHaveBeenCalled();
  });

  it('falls back to the generic hook when the owner hook declines', () => {
    const generic = vi.fn().mockReturnValue('generic');
    const own = vi.fn().mockReturnValue(false);
    const owners = new WeakMap([[generic, 'paragraph'], [own, 'dialogue']]);
    expect(mk([generic, own], owners).ascend('onSplit', null, {})).toBe('generic');
  });

  it('keeps registration order without owners (mock nabu)', () => {
    const a = vi.fn().mockReturnValue('a');
    const b = vi.fn().mockReturnValue('b');
    expect(mk([a, b], undefined).ascend('onSplit', null, {})).toBe('a');
  });
});

describe('P-36 Heading split', () => {
  it('middle: both halves are headings of the same level', async () => {
    const engine = await makeEditor();
    const [h] = await build(engine, [['heading', 'Title', { level: 3 }]]);
    enter(h, 2);
    await engine.commit();
    expect(flat(engine)).toBe('heading3(Ti) ; heading3(tle)');
  });

  it('end: a paragraph below', async () => {
    const engine = await makeEditor();
    const [h] = await build(engine, [['heading', 'Title', { level: 2 }]]);
    enter(h, 5);
    await engine.commit();
    expect(flat(engine)).toBe('heading2(Title) ; paragraph()');
  });

  it('start of a non-empty heading: an empty paragraph above, heading intact, caret at the start of the heading', async () => {
    const engine = await makeEditor();
    const [, h] = await build(engine, [['paragraph', 'a'], ['heading', 'Title', { level: 2 }]]);
    enter(h, 0);
    await engine.commit();
    await Promise.resolve();
    expect(flat(engine)).toBe('paragraph(a) ; paragraph() ; heading2(Title)');
    expect(engine.selection.setCursor).toHaveBeenCalledWith(expect.objectContaining({ id: h.id }), 0);
  });

  it('empty heading: unchanged (heading kept, paragraph below)', async () => {
    const engine = await makeEditor();
    const [h] = await build(engine, [['heading', '', { level: 2 }]]);
    enter(h, 0);
    await engine.commit();
    expect(flat(engine)).toBe('heading2() ; paragraph()');
  });
});

describe('P-37 Dialogue split dispatch', () => {
  it('Enter in a non-empty dialogue: the tail is a dialogue', async () => {
    const engine = await makeEditor();
    const [d] = await build(engine, [['dialogue', 'talk']]);
    enter(d, 2);
    await engine.commit();
    expect(flat(engine)).toBe('dialogue(ta) ; dialogue(lk)');
  });

  it('Enter at the end of a non-empty dialogue: a new empty dialogue line', async () => {
    const engine = await makeEditor();
    const [d] = await build(engine, [['dialogue', 'talk']]);
    enter(d, 4);
    await engine.commit();
    expect(flat(engine)).toBe('dialogue(talk) ; dialogue()');
  });

  it('Enter on an EMPTY dialogue: it becomes a paragraph (no empty dialogue left behind)', async () => {
    const engine = await makeEditor();
    const [d] = await build(engine, [['dialogue', '']]);
    enter(d, 0);
    await engine.commit();
    expect(flat(engine)).toBe('paragraph()');
  });

  it('other blocks without their own handler still get the generic paragraph split', async () => {
    const engine = await makeEditor();
    const [q] = await build(engine, [['blockquote', 'quote']]);
    enter(q, 2);
    await engine.commit();
    expect(flat(engine)).toBe('blockquote(qu) ; paragraph(ote)');
  });
});

describe('P-37 Dialogue dash', () => {
  it('default instance: en dash, exported as markdown with it', async () => {
    const engine = await makeEditor();
    const [d] = await build(engine, [['dialogue', 'hello']]);
    expect(Dialogue.dash).toBe('–');
    expect(d.dash).toBe('–');
    expect(d.serialize('markdown')).toBe('– hello');
    expect(engine.registry.get('dialogue').toMarkdown({ delta: [{ insert: 'hello' }] })).toBe('– hello');
  });

  it('createDialogueExtension({ dash }) configures display and export; blocks stay Dialogue instances', async () => {
    const engine = await makeEditor([createDialogueExtension({ dash: '—' })]);
    const [d] = await build(engine, [['dialogue', 'hello']]);
    expect(d).toBeInstanceOf(Dialogue);
    expect(d.dash).toBe('—');
    expect(d.serialize('markdown')).toBe('— hello');
    // a block created by the registered class (Dialogue.create) and a block loaded back share the configured dash
    const created = engine.insert('dialogue', { text: 'x' });
    expect(created.dash).toBe('—');
    // the default instance is not affected
    expect(DialogueExtension.block).toBe(Dialogue);
    expect(createDialogueExtension().block).toBe(Dialogue);
  });

  it('markdown import recognizes both – and —', () => {
    const [rule] = Dialogue.markdownRules;
    const helpers = { parseInline: (t) => [{ insert: t }] };
    for (const mark of ['–', '—']) {
      const line = `${mark} Tu viens ?`;
      expect(rule.detect.test(line)).toBe(true);
      expect(Dialogue.fromMarkdown([line], helpers)).toEqual({ type: 'dialogue', delta: [{ insert: 'Tu viens ?' }], partial: false });
    }
    expect(rule.detect.test('- item')).toBe(false);
    expect(rule.detect.test('-- x')).toBe(false);
  });
});

describe('P-38 Callout Backspace', () => {
  it('at offset 0 of a NON-empty callout: prevented, nothing changes', async () => {
    const engine = await makeEditor();
    const [p, c] = await build(engine, [['paragraph', 'before'], ['callout', 'note', { variant: 'tip' }]]);
    pin(engine, c, 0);
    expect(key(engine, c, 'deleteContentBackward')).toBe(true);
    await engine.commit();
    expect(flat(engine)).toBe('paragraph(before) ; callout(note)');
    expect(engine.children[1].variant).toBe('tip');
  });

  it('empty callout: still becomes a paragraph', async () => {
    const engine = await makeEditor();
    const [c] = await build(engine, [['callout', '']]);
    pin(engine, c, 0);
    expect(key(engine, c, 'deleteContentBackward')).toBe(true);
    await engine.commit();
    expect(flat(engine)).toBe('paragraph()');
  });

  it('mid-text Backspace is left to the browser / text behaviour', async () => {
    const engine = await makeEditor();
    const [c] = await build(engine, [['callout', 'note']]);
    pin(engine, c, 2);
    expect(key(engine, c, 'deleteContentBackward')).toBe(false);
  });
});

describe('P-39 Code Backspace / Divider Delete', () => {
  it('Backspace at 0 of a non-empty code block: paragraph with the same text, language dropped', async () => {
    const engine = await makeEditor();
    const [p, code] = await build(engine, [['paragraph', 'para'], ['code', 'ab', { language: 'js' }]]);
    pin(engine, code, 0);
    expect(key(engine, code, 'deleteContentBackward')).toBe(true);
    await engine.commit();
    expect(flat(engine)).toBe('paragraph(para) ; paragraph(ab)');
    expect(engine.children[1].node.data.get('language') ?? null).toBeNull();
  });

  it('Backspace in the middle of a code block is untouched', async () => {
    const engine = await makeEditor();
    const [code] = await build(engine, [['code', 'ab']]);
    pin(engine, code, 1);
    expect(key(engine, code, 'deleteContentBackward')).toBe(false);
  });

  it('Delete at the end of the block before a divider deletes the divider, text and caret kept', async () => {
    const engine = await makeEditor();
    const [a, hr, b] = await build(engine, [['paragraph', 'above'], ['divider'], ['paragraph', 'below']]);
    pin(engine, a, 5);
    expect(key(engine, a, 'deleteContentForward')).toBe(true);
    await engine.commit();
    await Promise.resolve();
    expect(flat(engine)).toBe('paragraph(above) ; paragraph(below)');
    expect(engine.selection.setCursor).toHaveBeenCalledWith(expect.objectContaining({ id: a.id }), 5);
    // ONE undo step restores it
    engine.undoManager.undo();
    await engine.commit();
    expect(engine.children.map((x) => x.type)).toEqual(['paragraph', 'divider', 'paragraph']);
  });

  it('Delete elsewhere (not at the end / next is not a divider) is left alone', async () => {
    const engine = await makeEditor();
    const [a, hr, b] = await build(engine, [['paragraph', 'above'], ['divider'], ['paragraph', 'below']]);
    pin(engine, a, 2);
    expect(key(engine, a, 'deleteContentForward')).toBe(false);
    pin(engine, b, 5);
    expect(key(engine, b, 'deleteContentForward')).toBe(false);
  });
});
