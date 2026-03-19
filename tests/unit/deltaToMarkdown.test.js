/**
 * Unit tests for deltaToMarkdown() and deltaToHtml()
 * Pure functions — no DOM, no runes, no Svelte.
 */

import { describe, it, expect } from 'vitest';
import { deltaToMarkdown, deltaToHtml } from '$lib/behaviors/text/text.behavior.svelte.js';

// ── deltaToMarkdown ────────────────────────────────────────────────────────

describe('deltaToMarkdown', () => {
  it('returns plain text for ops with no attributes', () => {
    expect(deltaToMarkdown([{ insert: 'hello world' }])).toBe('hello world');
  });

  it('wraps bold text with **', () => {
    expect(deltaToMarkdown([{ insert: 'bold', attributes: { bold: true } }])).toBe('**bold**');
  });

  it('wraps italic text with *', () => {
    expect(deltaToMarkdown([{ insert: 'em', attributes: { italic: true } }])).toBe('*em*');
  });

  it('wraps bold+italic with ***', () => {
    expect(deltaToMarkdown([{ insert: 'both', attributes: { bold: true, italic: true } }])).toBe('***both***');
  });

  it('wraps inline code with backticks', () => {
    expect(deltaToMarkdown([{ insert: 'x', attributes: { code: true } }])).toBe('`x`');
  });

  it('wraps strikethrough with ~~', () => {
    expect(deltaToMarkdown([{ insert: 's', attributes: { strikethrough: true } }])).toBe('~~s~~');
  });

  it('wraps underline with <u>', () => {
    expect(deltaToMarkdown([{ insert: 'u', attributes: { underline: true } }])).toBe('<u>u</u>');
  });

  it('handles mixed runs', () => {
    const delta = [
      { insert: 'plain ' },
      { insert: 'bold', attributes: { bold: true } },
      { insert: ' end' },
    ];
    expect(deltaToMarkdown(delta)).toBe('plain **bold** end');
  });

  it('returns empty string for empty delta', () => {
    expect(deltaToMarkdown([])).toBe('');
  });

  it('skips non-string inserts', () => {
    // @ts-ignore - intentionally testing non-string op
    expect(deltaToMarkdown([{ insert: 42 }])).toBe('');
  });

  it('code takes priority over bold (code is tested first)', () => {
    // code is checked first in the if-chain
    expect(
      deltaToMarkdown([{ insert: 'x', attributes: { code: true, bold: true } }]),
    ).toBe('`x`');
  });
});

// ── deltaToHtml ────────────────────────────────────────────────────────────

describe('deltaToHtml', () => {
  it('returns escaped plain text', () => {
    expect(deltaToHtml([{ insert: 'a & b < c > d' }])).toBe('a &amp; b &lt; c &gt; d');
  });

  it('wraps bold with <strong>', () => {
    expect(deltaToHtml([{ insert: 'B', attributes: { bold: true } }])).toBe('<strong>B</strong>');
  });

  it('wraps italic with <em>', () => {
    expect(deltaToHtml([{ insert: 'I', attributes: { italic: true } }])).toBe('<em>I</em>');
  });

  it('wraps underline with <u>', () => {
    expect(deltaToHtml([{ insert: 'U', attributes: { underline: true } }])).toBe('<u>U</u>');
  });

  it('wraps code with <code>', () => {
    expect(deltaToHtml([{ insert: 'C', attributes: { code: true } }])).toBe('<code>C</code>');
  });

  it('wraps strikethrough with <s>', () => {
    expect(deltaToHtml([{ insert: 'S', attributes: { strikethrough: true } }])).toBe('<s>S</s>');
  });

  it('nests marks: bold inside code wrapping', () => {
    // code → bold → text chain
    expect(deltaToHtml([{ insert: 'X', attributes: { code: true, bold: true } }])).toBe(
      '<strong><code>X</code></strong>',
    );
  });

  it('handles mixed ops', () => {
    const delta = [
      { insert: 'Hello ' },
      { insert: 'world', attributes: { bold: true } },
    ];
    expect(deltaToHtml(delta)).toBe('Hello <strong>world</strong>');
  });

  it('returns empty string for empty delta', () => {
    expect(deltaToHtml([])).toBe('');
  });
});
