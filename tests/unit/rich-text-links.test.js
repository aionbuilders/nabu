/**
 * Links of the rich text (src/lib/utils/links.js): only a link to another site opens in a new tab. Relative links, `#anchors` and links to the page's own
 * origin open in place; an external one keeps `target="_blank" rel="noopener noreferrer"`.
 */
import { describe, it, expect } from 'vitest';
import { isExternalLink, linkAttributes } from '#lib/utils/links.js';

describe('isExternalLink', () => {
  const origin = 'https://nabu.aion.builders';

  it('relative links, anchors, query strings and non-http schemes are not external', () => {
    for (const href of ['/docs', '/docs/guides/persistence-and-sync#saves', '#try', '?tab=2', 'docs/page', '../up', 'mailto:a@b.c', 'tel:+33123456789']) {
      expect(isExternalLink(href, origin), href).toBe(false);
    }
  });

  it('an absolute link to the same origin is not external, one to another host is', () => {
    expect(isExternalLink('https://nabu.aion.builders/docs', origin)).toBe(false);
    expect(isExternalLink('https://github.com/aionbuilders/nabu', origin)).toBe(true);
    expect(isExternalLink('http://nabu.aion.builders/docs', origin)).toBe(true); // another origin (scheme)
    expect(isExternalLink('https://nabu.aion.builders.evil.test/', origin)).toBe(true);
    expect(isExternalLink('//example.com/x', origin)).toBe(true); // protocol-relative
    expect(isExternalLink('  HTTPS://Example.com ', origin)).toBe(true);
  });

  it('without an origin (server rendering) every absolute http(s) URL is external, a relative one is not', () => {
    expect(isExternalLink('https://example.com')).toBe(true);
    expect(isExternalLink('/docs')).toBe(false);
    expect(isExternalLink('#top')).toBe(false);
  });

  it('a non-string is not external', () => {
    expect(isExternalLink(undefined, origin)).toBe(false);
    expect(isExternalLink(null, origin)).toBe(false);
  });
});

describe('linkAttributes (what RichText puts on an <a>)', () => {
  // RichText.svelte is a one-liner over this function; the rendered result is checked in a real browser (tests/e2e/site-docs.spec.ts, "links between pages stay in the tab"):
  // the unit environment has no client build of Svelte to mount a component with.
  const origin = 'https://nabu.aion.builders';

  it('an external link opens in a new tab, safely', () => {
    expect(linkAttributes('https://example.com/page', origin)).toEqual({ target: '_blank', rel: 'noopener noreferrer' });
  });

  it('relative links, anchors and same-origin links open in place, with no target nor rel', () => {
    for (const href of ['/docs/guides/regions', '#try', 'page.html', 'mailto:hello@example.com', 'https://nabu.aion.builders/docs']) {
      expect(linkAttributes(href, origin), href).toEqual({ target: undefined, rel: undefined });
    }
  });
});
