/**
 * Reads the documentation sources (server only, at build time): `docs/{getting-started,guides,recipes}/*.md` and `CHANGELOG.md`.
 * Nothing else under `docs/` is published (no adr, audit, archive, design).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CUSTOM_PAGES, SECTIONS, buildNav, docHref, editUrl, parseFrontmatter } from './content.js';

const ROOT = process.cwd();

/** @param {string} file repo-relative */
const read = (file) => readFileSync(resolve(ROOT, file), 'utf8');

/** @type {{ pages: import('./content.js').DocPage[], bodies: Map<string, string> } | null} */
let cache = null;

function load() {
  if (cache) return cache;
  /** @type {import('./content.js').DocPage[]} */
  const pages = [];
  const bodies = new Map();
  for (const section of SECTIONS) {
    const dir = `docs/${section.id}`;
    for (const name of readdirSync(resolve(ROOT, dir)).filter((/** @type {string} */ n) => n.endsWith('.md')).sort()) {
      const file = `${dir}/${name}`;
      const slug = name.replace(/\.md$/, '');
      const { data, body } = parseFrontmatter(read(file));
      if (typeof data.title !== 'string') throw new Error(`${file}: frontmatter needs a \`title\``);
      if (data.section !== undefined && data.section !== section.id) throw new Error(`${file}: frontmatter section "${data.section}" does not match its folder`);
      pages.push({
        section: section.id,
        slug,
        title: data.title,
        description: typeof data.description === 'string' ? data.description : '',
        order: typeof data.order === 'number' ? data.order : 1000,
        href: docHref(section.id, slug),
        file,
      });
      bodies.set(file, body);
    }
  }
  cache = { pages, bodies };
  return cache;
}

/** The whole documentation, in sidebar order: the Markdown pages and the custom (Svelte) ones. */
export const docsNav = () => buildNav([...load().pages, ...CUSTOM_PAGES]);

/** Every `{ section, slug }` that has a MARKDOWN page: what `entries()` of the dynamic route hands to the prerenderer (custom pages have their own route). */
export const allDocPages = () => load().pages.map((p) => ({ section: p.section, slug: p.slug }));

/**
 * @param {string} section @param {string} slug
 * @returns {{ page: import('./content.js').DocPage, body: string, dir: string, edit: string } | null}
 */
export function getDocPage(section, slug) {
  const { pages, bodies } = load();
  const page = pages.find((p) => p.section === section && p.slug === slug);
  if (!page) return null;
  return { page, body: /** @type {string} */ (bodies.get(page.file)), dir: `docs/${page.section}`, edit: editUrl(page.file) };
}

/** The changelog source. */
export function getChangelog() {
  const { body } = parseFrontmatter(read('CHANGELOG.md'));
  return { body, dir: '', edit: editUrl('CHANGELOG.md') };
}
