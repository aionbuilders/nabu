// @ts-nocheck
/**
 * Unit tests for P-06 placeholders: option normalization, per-type resolution
 * (defaults declared as `static placeholder` on block classes, `placeholders.text`
 * overrides incl. function / false) and the reactive `block.placeholder`
 * (emptiness + `show: 'focus' | 'empty'`).
 * Uses a real Nabu with a reactive stub selection (no DOM selection in unit tests).
 */

import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { BlockquoteExtension } from '#lib/blocks/blockquote/index.js';
import { normalizePlaceholders, resolvePlaceholderText, getPlaceholder } from '#lib/utils/placeholders.js';
import { Paragraph } from '#lib/blocks/paragraph/paragraph.svelte.js';
import { Heading } from '#lib/blocks/heading/heading.svelte.js';
import { createEditor, createMinimalEditor } from '#lib/presets.js';

const extensions = [ParagraphExtension, HeadingExtension, BlockquoteExtension];

/** Editor with a paragraph, a level-2 heading and an (empty) blockquote; cursor stub is reactive. */
async function makeEditor(placeholders) {
  const engine = new Nabu({ extensions, ...(placeholders !== undefined ? { placeholders } : {}) });
  const sel = $state({ anchorBlock: null, isCollapsed: true });
  engine.selection = sel;
  const paragraph = engine.insert('paragraph', {});
  const heading = engine.insert('heading', { level: 2 });
  const quote = engine.insert('blockquote', {});
  await engine.commit();
  return { engine, sel, paragraph, heading, quote };
}

describe('normalizePlaceholders', () => {
  it('defaults: enabled, show "focus", no overrides (omitted / true / {})', () => {
    for (const opt of [undefined, true, {}]) {
      expect(normalizePlaceholders(opt)).toEqual({ enabled: true, show: 'focus', text: {} });
    }
  });

  it('false disables everything', () => {
    expect(normalizePlaceholders(false).enabled).toBe(false);
  });

  it('keeps show "empty" and the text overrides; unknown show falls back to "focus"', () => {
    const text = { paragraph: 'Type here' };
    expect(normalizePlaceholders({ show: 'empty', text })).toEqual({ enabled: true, show: 'empty', text });
    expect(normalizePlaceholders({ show: 'nope' }).show).toBe('focus');
  });
});

describe('resolvePlaceholderText', () => {
  const block = (type, ph) => ({ type, constructor: { placeholder: ph }, level: 3 });

  it('uses the class default (string)', () => {
    expect(resolvePlaceholderText(block('x', 'Hello'))).toBe('Hello');
  });

  it('resolves a class default given as a function of the block', () => {
    expect(resolvePlaceholderText(block('x', (b) => `H${b.level}`))).toBe('H3');
  });

  it('returns "" when the class declares nothing', () => {
    expect(resolvePlaceholderText(block('x', undefined))).toBe('');
  });

  it('per-type override wins over the class default', () => {
    expect(resolvePlaceholderText(block('x', 'Hello'), { x: 'Custom' })).toBe('Custom');
  });

  it('override as a function receives the block', () => {
    expect(resolvePlaceholderText(block('x', 'Hello'), { x: (b) => `Level ${b.level}` })).toBe('Level 3');
  });

  it('override false (or a function returning false) disables the type', () => {
    expect(resolvePlaceholderText(block('x', 'Hello'), { x: false })).toBe('');
    expect(resolvePlaceholderText(block('x', 'Hello'), { x: () => false })).toBe('');
  });

  it('overrides for other types do not leak', () => {
    expect(resolvePlaceholderText(block('x', 'Hello'), { y: 'Nope' })).toBe('Hello');
  });
});

describe('block class defaults (extension-first)', () => {
  it('block classes declare their default text', () => {
    expect(Paragraph.placeholder).toBe('Start writing...');
    expect(Heading.placeholder({ level: 4 })).toBe('Heading 4');
  });

  it('the deprecated getPlaceholder() still returns the same strings', () => {
    expect(getPlaceholder('paragraph')).toBe(Paragraph.placeholder);
    expect(getPlaceholder('heading', 4)).toBe('Heading 4');
    expect(getPlaceholder('unknown')).toBe('');
  });
});

describe('block.placeholder — show: "empty"', () => {
  it('every empty block shows its default, whatever the cursor', async () => {
    const { paragraph, heading, quote } = await makeEditor({ show: 'empty' });
    expect(paragraph.placeholder).toBe('Start writing...');
    expect(heading.placeholder).toBe('Heading 2');
    expect(quote.placeholder).toBe('Quote...');
  });

  it('a non-empty block shows nothing, and the value follows typing reactively', async () => {
    const { paragraph } = await makeEditor({ show: 'empty' });
    expect(paragraph.placeholder).toBe('Start writing...');
    paragraph.insert(0, 'x');
    await paragraph.commit();
    flushSync();
    expect(paragraph.placeholder).toBe('');
    paragraph.delete({ index: 0, length: 1 });
    await paragraph.commit();
    flushSync();
    expect(paragraph.placeholder).toBe('Start writing...');
  });
});

describe('block.placeholder — show: "focus" (default)', () => {
  it('only the empty block holding the collapsed cursor shows its placeholder', async () => {
    const { sel, paragraph, heading } = await makeEditor();
    expect(paragraph.placeholder).toBe('');
    expect(heading.placeholder).toBe('');

    sel.anchorBlock = paragraph;
    flushSync();
    expect(paragraph.placeholder).toBe('Start writing...');
    expect(heading.placeholder).toBe('');

    sel.anchorBlock = heading;
    flushSync();
    expect(paragraph.placeholder).toBe('');
    expect(heading.placeholder).toBe('Heading 2');
  });

  it('is hidden for a non-collapsed selection', async () => {
    const { sel, paragraph } = await makeEditor();
    sel.anchorBlock = paragraph;
    sel.isCollapsed = false;
    flushSync();
    expect(paragraph.placeholder).toBe('');
  });

  it('is hidden as soon as the focused block is no longer empty', async () => {
    const { sel, paragraph } = await makeEditor({ show: 'focus' });
    sel.anchorBlock = paragraph;
    flushSync();
    expect(paragraph.placeholder).toBe('Start writing...');
    paragraph.insert(0, 'a');
    await paragraph.commit();
    flushSync();
    expect(paragraph.placeholder).toBe('');
  });
});

describe('block.placeholder — options', () => {
  it('placeholders: false → no placeholder at all', async () => {
    const { sel, paragraph, heading } = await makeEditor(false);
    sel.anchorBlock = paragraph;
    flushSync();
    expect(paragraph.placeholder).toBe('');
    expect(heading.placeholder).toBe('');
  });

  it('placeholders: true behaves like the defaults', async () => {
    const { sel, paragraph } = await makeEditor(true);
    expect(paragraph.placeholder).toBe('');
    sel.anchorBlock = paragraph;
    flushSync();
    expect(paragraph.placeholder).toBe('Start writing...');
  });

  it('text overrides: string, function and false per type', async () => {
    const { paragraph, heading, quote } = await makeEditor({
      show: 'empty',
      text: {
        paragraph: 'Type something',
        heading: (b) => `Title (h${b.level})`,
        blockquote: false,
      },
    });
    expect(paragraph.placeholder).toBe('Type something');
    expect(heading.placeholder).toBe('Title (h2)');
    expect(quote.placeholder).toBe('');
  });

  it('a block type with no default and no override shows nothing', () => {
    expect(resolvePlaceholderText({ type: 'custom', constructor: {} }, {})).toBe('');
  });

  it('the option can be changed at runtime by reassigning nabu.placeholders', async () => {
    const { engine, paragraph } = await makeEditor({ show: 'empty' });
    expect(paragraph.placeholder).toBe('Start writing...');
    engine.placeholders = normalizePlaceholders(false);
    flushSync();
    expect(paragraph.placeholder).toBe('');
  });
});

describe('factories forward the placeholders option', () => {
  it('createEditor / createMinimalEditor pass it to Nabu', async () => {
    expect(createEditor({ preset: [ParagraphExtension], placeholders: false }).placeholders.enabled).toBe(false);
    expect(createMinimalEditor({ placeholders: { show: 'empty' } }).placeholders.show).toBe('empty');
    expect(createMinimalEditor().placeholders).toEqual({ enabled: true, show: 'focus', text: {} });
  });
});
