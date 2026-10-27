import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseFrontmatter, slugify, createSlugger, buildNav, resolveMdLink, prepareMarkdown, docHref, editUrl, SECTIONS, REPO_URL, CUSTOM_PAGES,
} from '../../src/site/docs/content.js';
import { docsNav, allDocPages, getDocPage, getChangelog } from '../../src/site/docs/content.server.js';

// The content pipeline of the documentation site (src/site/docs): frontmatter, navigation model, heading slugs, link rewriting.

describe('parseFrontmatter', () => {
  it('reads the flat key: value form, numbers included, and returns the body', () => {
    const { data, body } = parseFrontmatter('---\ntitle: Regions\ndescription: Structure: parts, chapters\nsection: guides\norder: 40\n---\n\n# Regions\n');
    expect(data).toEqual({ title: 'Regions', description: 'Structure: parts, chapters', section: 'guides', order: 40 });
    expect(body).toBe('\n# Regions\n');
  });

  it('strips quotes, tolerates CRLF and a BOM', () => {
    const { data, body } = parseFrontmatter('﻿---\r\ntitle: "Quoted: yes"\r\n---\r\nText');
    expect(data.title).toBe('Quoted: yes');
    expect(body).toBe('Text');
  });

  it('a file without frontmatter is all body', () => {
    expect(parseFrontmatter('# Changelog\n')).toEqual({ data: {}, body: '# Changelog\n' });
    // a horizontal rule on the first line is not a frontmatter
    expect(parseFrontmatter('---\nnot closed').data).toEqual({});
  });
});

describe('slugify / createSlugger', () => {
  it('follows the GitHub rules the Markdown links were written against', () => {
    expect(slugify('Input rules: markdown shortcuts')).toBe('input-rules-markdown-shortcuts');
    expect(slugify('The lang option')).toBe('the-lang-option');
    expect(slugify('Option 2: HTML from the JSON export')).toBe('option-2-html-from-the-json-export');
    expect(slugify('nabu.internals (unstable)')).toBe('nabuinternals-unstable');
    expect(slugify('  Éléments   ')).toBe('éléments');
  });

  it('keeps the ids of a page unique', () => {
    const slug = createSlugger();
    expect([slug('Example'), slug('Example'), slug('Example'), slug('Other')]).toEqual(['example', 'example-1', 'example-2', 'other']);
    expect(slug('???')).toBe('section');
  });
});

describe('buildNav', () => {
  const page = (section, slug, order, title = slug) => ({ section, slug, title, description: '', order, href: docHref(section, slug), file: `docs/${section}/${slug}.md` });
  const nav = buildNav([
    page('guides', 'b', 20), page('recipes', 'r', 1), page('guides', 'a', 10), page('getting-started', 'g', 1), page('guides', 'c', 20, 'a-title-sorts-first'), page('adr', 'x', 1),
  ]);

  it('orders the sections as declared, the pages by order then title, and drops unknown sections', () => {
    expect(nav.sections.map((s) => s.id)).toEqual(['getting-started', 'guides', 'recipes']);
    expect(nav.order.map((p) => p.slug)).toEqual(['g', 'a', 'c', 'b', 'r']);
  });

  it('gives DocsNav its sections and the previous / next of a page across sections', () => {
    expect(nav.navSections[1]).toEqual({ id: 'guides', title: 'Guides', groups: [{ items: [
      { label: 'a', href: '/docs/guides/a', mono: false }, { label: 'a-title-sorts-first', href: '/docs/guides/c', mono: false }, { label: 'b', href: '/docs/guides/b', mono: false },
    ] }] });
    expect(nav.neighbours('/docs/guides/a')).toMatchObject({ prev: { slug: 'g' }, next: { slug: 'c' } });
    expect(nav.neighbours('/docs/getting-started/g').prev).toBeNull();
    expect(nav.neighbours('/docs/recipes/r').next).toBeNull();
    expect(nav.neighbours('/docs/nowhere')).toEqual({ prev: null, next: null });
  });
});

describe('resolveMdLink', () => {
  it('turns a link to a published page into its route, anchor kept', () => {
    expect(resolveMdLink('./regions.md', 'docs/guides')).toBe('/docs/guides/regions');
    expect(resolveMdLink('./regions.md#theming', 'docs/guides')).toBe('/docs/guides/regions#theming');
    expect(resolveMdLink('../recipes/read-only-viewer.md', 'docs/guides')).toBe('/docs/recipes/read-only-viewer');
    expect(resolveMdLink('../getting-started/presets.md#remove-extensions-from-a-preset', 'docs/guides')).toBe('/docs/getting-started/presets#remove-extensions-from-a-preset');
    expect(resolveMdLink('docs/guides/theming.md', '')).toBe('/docs/guides/theming');
  });

  it('sends what is not published (adr, design, README) to GitHub, and the changelog to its page', () => {
    expect(resolveMdLink('../adr/014-asset-storage.md', 'docs/guides')).toBe(`${REPO_URL}/blob/main/docs/adr/014-asset-storage.md`);
    expect(resolveMdLink('../../README.md', 'docs/guides')).toBe(`${REPO_URL}/blob/main/README.md`);
    expect(resolveMdLink('../../CHANGELOG.md#unreleased', 'docs/guides')).toBe('/changelog#unreleased');
  });

  it('leaves every other link alone', () => {
    for (const href of ['https://loro.dev', 'https://x.dev/a.md', '#anchor', '/api/root/createEditor', 'mailto:a@b.c', 'url', 'javascript:alert(1)', './image.png']) {
      expect(resolveMdLink(href, 'docs/guides')).toBeNull();
    }
  });
});

describe('prepareMarkdown', () => {
  it('rewrites the links of the text, with their title', () => {
    const md = 'See [regions](./regions.md#theming) and [the ADR](../adr/014-asset-storage.md "title"), or [Loro](https://loro.dev).';
    expect(prepareMarkdown(md, 'docs/guides')).toBe(
      `See [regions](/docs/guides/regions#theming) and [the ADR](${REPO_URL}/blob/main/docs/adr/014-asset-storage.md "title"), or [Loro](https://loro.dev).`,
    );
  });

  it('never touches fenced or inline code', () => {
    const md = ['Use `[a](./b.md)` like this:', '', '```md', '[a](./b.md)', '```', '', '~~~', '[a](./b.md)', '~~~', '', '[real](./b.md)'].join('\n');
    expect(prepareMarkdown(md, 'docs/guides').split('\n')).toEqual([
      'Use `[a](./b.md)` like this:', '', '```md', '[a](./b.md)', '```', '', '~~~', '[a](./b.md)', '~~~', '', '[real](/docs/guides/b)',
    ]);
  });

  it('drops the `test` flag of a fence, and nothing else of the info string', () => {
    const md = ['```js test', 'a', '```', '```svelte', 'b', '```', '````js test', '```', '````', '```', 'c', '```'].join('\n');
    expect(prepareMarkdown(md, 'docs/guides').split('\n')).toEqual(['```js', 'a', '```', '```svelte', 'b', '```', '````js', '```', '````', '```', 'c', '```']);
  });

  it('a longer fence is closed by a fence at least as long (a fence inside a fence is code)', () => {
    const md = ['````md', '```js test', '[x](./y.md)', '```', '````', '[z](./y.md)'].join('\n');
    expect(prepareMarkdown(md, 'docs/guides').split('\n')).toEqual(['````md', '```js test', '[x](./y.md)', '```', '````', '[z](/docs/guides/y)']);
  });
});

describe('the real sources', () => {
  const nav = docsNav();

  it('publish the three sections and nothing else of docs/', () => {
    expect(nav.sections.map((s) => s.id)).toEqual(SECTIONS.map((s) => s.id));
    const files = nav.order.filter((p) => !p.custom).map((p) => p.file);
    expect(files.length).toBeGreaterThanOrEqual(14);
    expect(files.every((f) => /^docs\/(getting-started|guides|recipes)\/[\w-]+\.md$/.test(f))).toBe(true);
    expect(allDocPages()).toHaveLength(files.length); // the custom pages have their own route: the dynamic one never builds them
  });

  it('put the custom (Svelte) pages in the sidebar and in previous / next, at their place', () => {
    expect(CUSTOM_PAGES.length).toBeGreaterThan(0);
    for (const c of CUSTOM_PAGES) {
      expect(nav.order.some((p) => p.href === c.href && p.custom)).toBe(true);
      expect(getDocPage(c.section, c.slug), `${c.href} is not a Markdown page`).toBeNull();
      expect(allDocPages().some((p) => p.section === c.section && p.slug === c.slug)).toBe(false);
      expect(existsSync(join(process.cwd(), c.file)), c.file).toBe(true);
    }
    // "Tour of the blocks": Getting started, after "Your first editor", before "Presets"
    const { prev, next } = nav.neighbours('/docs/getting-started/tour-of-the-blocks');
    expect([prev?.href, next?.href]).toEqual(['/docs/getting-started/first-editor', '/docs/getting-started/presets']);
  });

  it('every page has a title, a description and a unique route', () => {
    for (const p of nav.order) {
      expect(p.title, p.file).toBeTruthy();
      expect(p.description, p.file).toBeTruthy();
    }
    expect(new Set(nav.order.map((p) => p.href)).size).toBe(nav.order.length);
  });

  it('start with the installation page, the first thing a reader needs', () => {
    expect(nav.order[0].href).toBe('/docs/getting-started/installation');
  });

  it('every internal link of every page resolves to a published page', () => {
    const routes = new Set(nav.order.map((p) => p.href));
    for (const p of nav.order.filter((x) => !x.custom)) { // (a custom page has no Markdown: tour-page.test.js holds its links)
      const found = getDocPage(p.section, p.slug);
      const md = prepareMarkdown(found.body, found.dir);
      expect(md).not.toMatch(/\]\((?:\.{1,2}\/)[^)]*\.md/); // no relative .md link left (outside code, where they would be examples)
      for (const [, href] of md.matchAll(/\]\((\/docs\/[^)#\s]+)/g)) expect(routes.has(href), `${p.file} -> ${href}`).toBe(true);
    }
  });

  it('the edit link points at the md file, the changelog is read from the root', () => {
    expect(getDocPage('guides', 'regions').edit).toBe(editUrl('docs/guides/regions.md'));
    expect(getDocPage('guides', 'nope')).toBeNull();
    const changelog = getChangelog();
    expect(changelog.body).toMatch(/^# Changelog/);
    expect(changelog.dir).toBe('');
  });
});
