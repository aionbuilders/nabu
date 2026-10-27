/**
 * The pure part of the architecture chapters (no file system, no Nabu): the frontmatter contract with the chapter files
 * (`docs/architecture/chapters/NN-slug.md`: `title`, `description`, `chapter`, `adrs`, optional `xray`), their routes, and the split of a
 * chapter body into its first paragraph (the lead) and the rest, so that the live widget can sit between the two.
 * `chapters.server.js` reads the files. Unit tested as is (tests/unit/site-architecture.test.js).
 */
import { parseFrontmatter } from '../docs/content.js';
import { githubBlob } from './adr.js';
import { CHAPTERS_FALLBACK, STORY_LINKS } from './data.js';

export const CHAPTERS_DIR = 'docs/architecture/chapters';

/** `/architecture/chapters/the-life-of-a-keystroke` @param {string} slug */
export const chapterHref = (slug) => `/architecture/chapters/${slug}`;

/**
 * The ADR numbers of an `adrs` frontmatter key, inline (`adrs: [7, 8]`) or as a block list (`adrs:` then `  - 7`).
 * @param {string} raw the whole file
 * @returns {number[]}
 */
export function parseAdrList(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
  if (!fm) return [];
  const lines = fm.split('\n');
  const at = lines.findIndex((l) => /^adrs:/.test(l));
  if (at < 0) return [];
  const inline = lines[at].slice(5).trim();
  const found = [];
  if (inline) found.push(...(inline.match(/\d+/g) ?? []));
  else {
    for (const l of lines.slice(at + 1)) {
      const item = /^\s*-\s*(\d+)\b/.exec(l);
      if (!item) break;
      found.push(item[1]);
    }
  }
  return [...new Set(found.map(Number))];
}

/**
 * @typedef {{
 *   n: number, slug: string, file: string, href: string, title: string, description: string, adrs: number[], xray: string | null, body: string,
 * }} Chapter
 */

/**
 * @param {string} raw @param {string} file repo-relative, `docs/architecture/chapters/03-the-life-of-a-keystroke.md`
 * @returns {Chapter}
 */
export function parseChapter(raw, file) {
  const name = file.split('/').pop() ?? file;
  const m = /^(\d+)-(.+)\.md$/.exec(name);
  if (!m) throw new Error(`${file}: a chapter file is named NN-slug.md`);
  const { data, body } = parseFrontmatter(raw);
  if (typeof data.title !== 'string' || !data.title) throw new Error(`${file}: frontmatter needs a \`title\``);
  if (typeof data.chapter !== 'number' || !Number.isInteger(data.chapter) || data.chapter < 1) throw new Error(`${file}: frontmatter needs a \`chapter\` number`);
  return {
    n: data.chapter,
    slug: m[2],
    file,
    href: chapterHref(m[2]),
    title: data.title,
    description: typeof data.description === 'string' ? data.description : '',
    adrs: parseAdrList(raw),
    xray: typeof data.xray === 'string' && data.xray ? data.xray : null,
    body,
  };
}

/** `03` @param {number} n */
export const chapterNumber = (n) => String(n).padStart(2, '0');

/**
 * Where a relative link of a chapter points: another chapter (`./04-where-is-the-caret.md`) or a record (`../../adr/007-event-ascension.md`)
 * is its page on the site, any other repo file its page on GitHub. Absolute URLs, `/routes` and `#anchors` are left alone (null).
 * @param {string} href @param {Set<string>} [files] the chapter file names that exist (`04-where-is-the-caret.md`): a link to a missing chapter goes to GitHub
 * @returns {string | null}
 */
export function resolveChapterLink(href, files = new Set()) {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return null;
  const [pathPart, hash = ''] = href.split(/(?=#)/);
  const parts = [];
  for (const seg of `${CHAPTERS_DIR}/${pathPart}`.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  const path = parts.join('/');
  const adr = /^docs\/adr\/(\d{3})-[^/]+\.md$/.exec(path);
  if (adr) return `/architecture/decisions/${adr[1]}${hash}`;
  const chapter = /^docs\/architecture\/chapters\/(\d+)-([^/]+)\.md$/.exec(path);
  if (chapter && files.has(`${chapter[1]}-${chapter[2]}.md`)) return chapterHref(chapter[2]) + hash;
  return githubBlob(path) + hash;
}

/** Rewrite the relative links of a chapter body (fenced and inline code left alone). @param {string} md @param {Set<string>} [files] */
export function prepareChapterBody(md, files = new Set()) {
  let fence = false;
  return md
    .split('\n')
    .map((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) { fence = !fence; return line; }
      if (fence) return line;
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, k) => (k % 2 ? part : part.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (all, href, title) => {
          const to = resolveChapterLink(href, files);
          return to ? `](${to}${title})` : all;
        })))
        .join('');
    })
    .join('\n');
}

/**
 * Split a chapter body after its first paragraph. A leading `# Title` is dropped (the page draws the title from the frontmatter). The
 * first paragraph is the first top-level block that is plain text: not a heading, quote or callout, list, fence, table, divider, image
 * or HTML. Whatever comes before it (rare) stays with it. `rest` is empty when the chapter is one paragraph.
 * @param {string} body
 * @returns {{ lead: string, rest: string }}
 */
export function splitLead(body) {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  if (/^#\s+\S/.test(lines[start] ?? '')) start++;

  // top-level blocks: runs of lines separated by blank lines, a fenced code block being one block
  /** @type {string[][]} */
  const blocks = [];
  let cur = /** @type {string[]} */ ([]);
  let fence = '';
  for (const line of lines.slice(start)) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      cur.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) { fence = ''; blocks.push(cur); cur = []; }
      continue;
    }
    if (f) { if (cur.length) blocks.push(cur); cur = [line]; fence = f[1]; continue; }
    if (!line.trim()) { if (cur.length) blocks.push(cur); cur = []; continue; }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);

  const isParagraph = (/** @type {string[]} */ b) => !/^( {0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|`{3}|~{3}|\||<|!\[|(-{3,}|\*{3,}|_{3,})\s*$)|-- )/.test(b[0]);
  const at = blocks.findIndex(isParagraph);
  if (at < 0) return { lead: '', rest: blocks.map((b) => b.join('\n')).join('\n\n') };
  return {
    lead: blocks.slice(0, at + 1).map((b) => b.join('\n')).join('\n\n'),
    rest: blocks.slice(at + 1).map((b) => b.join('\n')).join('\n\n'),
  };
}

/**
 * The seven chapters of the story as the landing and the rail list them: the file when there is one (title, description and ADRs from its
 * frontmatter, linked), else the fallback entry (not linked).
 * @param {Chapter[]} chapters the chapters that exist
 * @returns {Array<{ n: number, title: string, description: string, adrs: number[], href: string | null, slug: string | null }>}
 */
export function storyList(chapters) {
  return CHAPTERS_FALLBACK.map((f) => {
    const c = chapters.find((x) => x.n === f.n);
    return c
      ? { n: f.n, title: c.title, description: c.description || f.description, adrs: c.adrs.length ? c.adrs : f.adrs, href: c.href, slug: c.slug }
      : { n: f.n, title: f.title, description: f.description, adrs: f.adrs, href: null, slug: null };
  });
}

/**
 * What follows a chapter in the story: the next chapter that exists, else the limits. @param {number} n @param {ReturnType<typeof storyList>} story
 * @returns {{ label: string, href: string }}
 */
export function nextAfter(n, story) {
  const next = story.find((s) => s.n > n && s.href);
  return next ? { label: `${chapterNumber(next.n)} · ${next.title}`, href: /** @type {string} */ (next.href) } : { label: STORY_LINKS[0].label, href: STORY_LINKS[0].href };
}

/** The chapter that comes before, if it exists. @param {number} n @param {ReturnType<typeof storyList>} story */
export function prevBefore(n, story) {
  const prev = [...story].reverse().find((s) => s.n < n && s.href);
  return prev ? { label: `${chapterNumber(prev.n)} · ${prev.title}`, href: /** @type {string} */ (prev.href) } : null;
}

/**
 * The ADRs of a chapter as one line, `ADR 001 · 003`; a record followed by the one that replaced it reads `ADR 016 → 018`.
 * @param {number[]} adrs @param {Map<number, number | null>} supersededBy record number -> the record that replaced it (if any)
 */
export function adrLine(adrs, supersededBy = new Map()) {
  if (!adrs.length) return '';
  const pad = (/** @type {number} */ n) => String(n).padStart(3, '0');
  let out = `ADR ${pad(adrs[0])}`;
  for (let i = 1; i < adrs.length; i++) out += `${supersededBy.get(adrs[i - 1]) === adrs[i] ? ' → ' : ' · '}${pad(adrs[i])}`;
  return out;
}
