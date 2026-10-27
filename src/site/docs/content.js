/**
 * The pure part of the documentation content pipeline (no file system, no Nabu): frontmatter, the navigation model, heading
 * slugs, and the rewriting of the Markdown links of a page into site routes. `content.server.js` reads the files, `doc.server.js`
 * builds the Nabu document. Kept dependency-free so that it is unit-tested as is (tests/unit/site-docs-content.test.js).
 */


export const REPO_URL = 'https://github.com/aionbuilders/nabu';
export const REPO_BRANCH = 'main';

/** The published sections, in the order of the sidebar. Their md files live in `docs/<id>/`. Nothing else under `docs/` is published. */
export const SECTIONS = [
  { id: 'getting-started', title: 'Getting started', blurb: 'Install Nabu, mount an editor, pick a preset.' },
  { id: 'guides', title: 'Guides', blurb: 'One topic at a time: extensions, commands, persistence, regions, theming, clipboard, accessibility.' },
  { id: 'recipes', title: 'Recipes', blurb: 'Short, complete answers to a concrete need.' },
];

/** `/docs/<section>/<slug>` @param {string} section @param {string} slug */
export const docHref = (section, slug) => `/docs/${section}/${slug}`;

/**
 * Split a Markdown file into its YAML frontmatter and its body. Only the flat `key: value` form the docs use is read (strings,
 * numbers, optionally quoted); a file without frontmatter gives `data = {}` and the whole text as body.
 * @param {string} raw
 * @returns {{ data: Record<string, string | number>, body: string }}
 */
export function parseFrontmatter(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  /** @type {Record<string, string | number>} */
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^(["']).*\1$/.test(value) && value.length >= 2) value = value.slice(1, -1);
    data[kv[1]] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return { data, body: text.slice(m[0].length) };
}

/**
 * The heading anchor of a text, GitHub style (what the Markdown links of the docs were written against): lower case, everything
 * but letters, digits, `_`, `-` and spaces removed, each space a hyphen.
 * @param {string} text
 */
export const slugify = (text) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

/** A slug generator that keeps the ids of one page unique: the second "Example" is `example-1`. */
export function createSlugger() {
  const seen = new Map();
  return (/** @type {string} */ text) => {
    const base = slugify(text) || 'section';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}

/**
 * @typedef {{ section: string, slug: string, title: string, description: string, order: number, href: string, file: string, custom?: boolean }} DocPage
 * A page of the documentation. `file` is its source in the repo: a Markdown file, or, for a `custom` page, the Svelte page that draws it.
 */

/**
 * The pages of the documentation that are NOT Markdown: a Svelte page of its own (`src/routes/(site)/docs/<section>/<slug>/+page.svelte`, which
 * takes precedence over the Markdown route `[section]/[slug]`). They sit in the sidebar, in the previous / next links and in the index of
 * `/docs` like any other page, at their `order` in their section; they have no Markdown body, so the dynamic route never builds them.
 * @type {DocPage[]}
 */
export const CUSTOM_PAGES = [
  {
    section: 'getting-started',
    slug: 'tour-of-the-blocks',
    title: 'Tour of the blocks',
    description: 'One short story written with every block Nabu ships, then a card for each block: what it is, how to make one, and its state, live. What happens as you type and as you paste.',
    order: 3,
    href: docHref('getting-started', 'tour-of-the-blocks'),
    file: 'src/routes/(site)/docs/getting-started/tour-of-the-blocks/+page.svelte',
    custom: true,
  },
];

/**
 * The navigation model of the documentation. `sections` is what `DocsNav` takes; `order` is every page in reading order (the
 * sidebar from top to bottom), which gives the previous / next links. Pages of an unknown section are left out; inside a
 * section they sort by `order`, then by title. A `custom` page (see {@link CUSTOM_PAGES}) is a page like the others.
 * @param {DocPage[]} pages
 */
export function buildNav(pages) {
  const sections = SECTIONS.map((s) => {
    const own = pages
      .filter((p) => p.section === s.id)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return { ...s, pages: own };
  }).filter((s) => s.pages.length);
  const order = sections.flatMap((s) => s.pages);
  return {
    sections,
    order,
    /** What `DocsNav` renders. */
    navSections: sections.map((s) => ({
      id: s.id,
      title: s.title,
      groups: [{ items: s.pages.map((p) => ({ label: p.title, href: p.href, mono: false })) }],
    })),
    /** @param {string} href */
    neighbours(href) {
      const i = order.findIndex((p) => p.href === href);
      return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null };
    },
  };
}

const PUBLISHED = new Set(SECTIONS.map((s) => s.id));
const MD_TARGET = /^(?!(?:[a-z][a-z0-9+.-]*:|\/\/|#))([^?#]*\.md)(#[^\s]*)?$/i;

/**
 * `posix.normalize(posix.join(dir, rel))` without `node:path`: this module is also imported by client code.
 * @param {string} dir @param {string} rel
 */
function joinPath(dir, rel) {
  /** @type {string[]} */
  const out = [];
  for (const part of `${dir}/${rel}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Where a relative `.md` link found in `fromDir` (a repo-relative directory, `docs/guides` or `` for the root) points on the site:
 * a published page becomes its route, anything else in the repo (an ADR, the README, a design note) its page on GitHub.
 * @param {string} target the href as written, e.g. `../recipes/read-only-viewer.md#option-1`
 * @param {string} fromDir
 * @returns {string | null} null when `target` is not a relative Markdown link
 */
export function resolveMdLink(target, fromDir) {
  const m = MD_TARGET.exec(target);
  if (!m) return null;
  const path = joinPath(fromDir, m[1]);
  const hash = m[2] ?? '';
  const parts = path.split('/');
  if (parts[0] === 'docs' && parts.length === 3 && PUBLISHED.has(parts[1])) {
    return docHref(parts[1], parts[2].replace(/\.md$/, '')) + hash;
  }
  if (path === 'CHANGELOG.md') return '/changelog' + hash;
  return `${REPO_URL}/blob/${REPO_BRANCH}/${path}${hash}`;
}

/**
 * Prepare the Markdown of a page for the Nabu importer: relative `.md` links become site routes (or GitHub URLs), and the
 * `test` flag of the code fences used by the tested examples (```` ```js test ````) is dropped from the language. Fenced code and
 * inline code are never touched.
 * @param {string} md
 * @param {string} fromDir repo-relative directory of the file (`docs/guides`)
 */
export function prepareMarkdown(md, fromDir) {
  const lines = md.split('\n');
  /** @type {{ char: string, len: number } | null} */
  let fence = null;
  return lines
    .map((line) => {
      const f = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (f && f[2][0] === fence.char && f[2].length >= fence.len && !f[3].trim()) fence = null;
        return line;
      }
      if (f) {
        fence = { char: f[2][0], len: f[2].length };
        const info = f[3].trim().split(/\s+/).filter((w) => w !== 'test');
        return f[1] + f[2] + info.join(' ');
      }
      // Links outside inline code spans only.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 ? part : part.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (all, href, title) => {
          const to = resolveMdLink(href, fromDir);
          return to ? `](${to}${title})` : all;
        })))
        .join('');
    })
    .join('\n');
}

/**
 * The "Edit this page" URL of a repo file.
 * @param {string} file repo-relative path, `docs/guides/regions.md`
 */
export const editUrl = (file) => `${REPO_URL}/edit/${REPO_BRANCH}/${file}`;
