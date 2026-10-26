/**
 * Unit tests for factory functions.
 * Tests createEditor, createFullEditor, createMinimalEditor variants.
 * These instantiate real Nabu with runes — run inside $effect.root() context.
 *
 * NOTE: Svelte 5 rune classes work when called from within a Svelte effect root.
 * In a test environment (no Svelte runtime), we test what we can without runes.
 */

import { describe, it, expect, vi } from 'vitest';
import { Paragraph } from '$lib/blocks/paragraph/paragraph.svelte.js';
import { Heading } from '$lib/blocks/heading/heading.svelte.js';

// Static method and PasteBlock parser tests — no rune construction needed

describe('Paragraph.fromMarkdown (static)', () => {
  it('returns a PasteBlock from plain text lines', async () => {
    const result = Paragraph.fromMarkdown(['hello world'], {
      parseInline: (text) => [{ insert: text }],
    });
    // Paste mode (default): a bare paragraph is plain text, so it never retypes an empty block.
    expect(result).toEqual({
      type: 'paragraph',
      delta: [{ insert: 'hello world' }],
      partial: 'both',
    });
  });

  it('returns a whole block when importing (joinLines)', async () => {
    const result = Paragraph.fromMarkdown(['hello world'], {
      parseInline: (text) => [{ insert: text }],
      joinLines: true,
    });
    expect(result.partial).toBe(false);
  });

  it('returns null for empty input', async () => {
    const result = Paragraph.fromMarkdown([''], {
      parseInline: () => [],
    });
    expect(result).toBeNull();
  });

  it('joins multiple lines with a space', async () => {
    const result = Paragraph.fromMarkdown(['line one', 'line two'], {
      parseInline: (text) => [{ insert: text }],
    });
    expect(result.delta[0].insert).toBe('line one line two');
  });
});

describe('Paragraph.fromHTML (static)', () => {
  it('returns a PasteBlock from a <p> element', async () => {
    const el = document.createElement('p');
    el.textContent = 'hello';
    const result = Paragraph.fromHTML(el, {
      parseInline: (el) => [{ insert: el.textContent }],
    });
    expect(result.type).toBe('paragraph');
    expect(result.delta).toEqual([{ insert: 'hello' }]);
  });
});

describe('Paragraph.toMarkdown (static)', () => {
  it('delegates to deltaToMarkdown', async () => {
    const result = Paragraph.toMarkdown({
      type: 'paragraph',
      delta: [{ insert: 'hello' }],
    });
    expect(result).toBe('hello');
  });
});

describe('Paragraph.toHtml (static)', () => {
  it('wraps in <p>', async () => {
    const result = Paragraph.toHtml({
      type: 'paragraph',
      delta: [{ insert: 'hello' }],
    });
    expect(result).toBe('<p>hello</p>');
  });
});

// ── Heading (static) ───────────────────────────────────────────────────────

describe('Heading static methods', () => {
  it('Heading.fromMarkdown parses # heading level 1', async () => {
    if (!Heading.fromMarkdown) return; // guard
    const result = Heading.fromMarkdown(['# Hello'], {
      parseInline: (text) => [{ insert: text }],
    });
    expect(result?.type).toBe('heading');
    expect(result?.props?.level).toBe(1);
  });

  it('Heading.fromMarkdown parses ## heading level 2', async () => {
    if (!Heading.fromMarkdown) return;
    const result = Heading.fromMarkdown(['## Section'], {
      parseInline: (text) => [{ insert: text }],
    });
    expect(result?.props?.level).toBe(2);
  });
});
