/**
 * Unit tests for link mark serialization (TÂCHE 8).
 */

import { describe, it, expect } from 'vitest';
import { deltaToMarkdown, deltaToHtml } from '#lib/behaviors/text/text.behavior.svelte.js';

describe('Link serialization', () => {
  it('deltaToMarkdown produces [text](href)', () => {
    const delta = [{ insert: 'Nabu', attributes: { link: 'https://example.com' } }];
    expect(deltaToMarkdown(delta)).toBe('[Nabu](https://example.com)');
  });

  it('deltaToMarkdown wraps formatted text inside the link', () => {
    const delta = [{ insert: 'Nabu', attributes: { link: 'https://example.com', bold: true } }];
    expect(deltaToMarkdown(delta)).toBe('[**Nabu**](https://example.com)');
  });

  it('deltaToHtml produces an <a href> tag', () => {
    const delta = [{ insert: 'Nabu', attributes: { link: 'https://example.com' } }];
    expect(deltaToHtml(delta)).toBe('<a href="https://example.com">Nabu</a>');
  });

  it('deltaToHtml escapes the href', () => {
    const delta = [{ insert: 'x', attributes: { link: 'https://a.com/?q=<b>' } }];
    expect(deltaToHtml(delta)).toBe('<a href="https://a.com/?q=&lt;b&gt;">x</a>');
  });

  it('plain marks are unaffected', () => {
    const delta = [{ insert: 'bold', attributes: { bold: true } }];
    expect(deltaToMarkdown(delta)).toBe('**bold**');
    expect(deltaToHtml(delta)).toBe('<strong>bold</strong>');
  });
});
