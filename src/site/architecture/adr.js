/**
 * The pure part of the decision records (no file system, no Nabu): the header block of an ADR (`**Status:** …`, `**Date:** …`,
 * `**Original:** [French](fr/…)`), its status, its routes and its GitHub URLs. `adr.server.js` reads `docs/adr/`, the pages draw what this
 * returns. Unit tested as is (tests/unit/site-architecture.test.js).
 */
import { REPO_URL, REPO_BRANCH } from '../docs/content.js';

export const ADR_DIR = 'docs/adr';

/** `/architecture/decisions/016` @param {number} number */
export const adrHref = (number) => `/architecture/decisions/${pad(number)}`;

/** @param {number} n */
export const pad = (n) => String(n).padStart(3, '0');

/** @param {string} path repo-relative */
export const githubBlob = (path) => `${REPO_URL}/blob/${REPO_BRANCH}/${path}`;

/** @typedef {'accepted' | 'superseded' | 'proposed' | 'unknown'} AdrStatus */

/**
 * The status of a record from its `**Status:**` text. "Superseded" is read from the text ("… superseded by ADR 018"), not from the
 * first word: ADR 016 is `Accepted (…) — data model superseded by ADR 018 (…)` and its data model is what was replaced, so it is shown
 * as superseded and points at its successor. "Supersedes" (the OTHER direction, on the successor) never matches.
 * @param {string} text
 * @returns {{ status: AdrStatus, supersededBy: number | null }}
 */
export function parseStatus(text) {
  const by = /\bsuperseded\s+by\s+ADR\s*0*(\d+)/i.exec(text);
  if (by) return { status: 'superseded', supersededBy: Number(by[1]) };
  if (/^\s*proposed\b/i.test(text)) return { status: 'proposed', supersededBy: null };
  if (/^\s*accepted\b/i.test(text)) return { status: 'accepted', supersededBy: null };
  return { status: 'unknown', supersededBy: null };
}

/** Markdown of a short text, flattened to plain text (the status detail of a proposal). @param {string} md */
export const plain = (md) =>
  md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * @typedef {{
 *   number: number, id: string, slug: string, file: string, title: string, status: AdrStatus, statusText: string,
 *   supersededBy: number | null, supersedes: number[], date: string, original: string | null, body: string,
 * }} Adr
 */

/**
 * Parse an ADR file. The header is the run of `**Key:** value` lines right under the H1 (blank lines between them allowed), optionally
 * closed by a `---`; the body is everything after it (the H1 and the header are drawn by the page, not by the document).
 * @param {string} raw
 * @param {string} file repo-relative path, `docs/adr/016-regions.md`
 * @returns {Adr}
 */
export function parseAdr(raw, file) {
  const name = file.split('/').pop() ?? file;
  const m = /^(\d{3})-(.+)\.md$/.exec(name);
  if (!m) throw new Error(`${file}: an ADR file is named NNN-slug.md`);
  const number = Number(m[1]);
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const h1 = /^#\s+(.+)$/.exec(lines[i] ?? '');
  if (!h1) throw new Error(`${file}: the first line must be the H1 "# ADR NNN: Title"`);
  const title = h1[1].replace(/^ADR\s*\d+\s*[—–:-]\s*/i, '').trim();
  i++;

  // The header: the contiguous run of `**Key:** value` lines under the H1 (a blank line ends it, so a body paragraph that starts with a bold label is safe).
  while (i < lines.length && !lines[i].trim()) i++;
  /** @type {Record<string, string>} */
  const fields = {};
  for (; i < lines.length; i++) {
    const kv = /^\*\*([^*:]+):\*\*\s*(.*)$/.exec(lines[i]);
    if (!kv) break;
    fields[kv[1].trim().toLowerCase()] = kv[2].trim();
  }
  while (i < lines.length && (!lines[i].trim() || /^---+\s*$/.test(lines[i]))) i++;

  const statusText = fields.status ?? '';
  const { status, supersededBy } = parseStatus(statusText);
  const original = /\]\(([^)\s]+)\)/.exec(fields.original ?? '')?.[1] ?? null;
  const supersedes = [...new Set([...(fields.supersedes ?? '').matchAll(/\bADR\s*0*(\d+)/gi)].map((x) => Number(x[1])))];

  return {
    number, id: pad(number), slug: m[2], file, title, status, statusText, supersededBy, supersedes,
    date: fields.date ?? '', original, body: lines.slice(i).join('\n').trimEnd() + '\n',
  };
}

/**
 * Where a relative link found in an ADR (`fr/016.md`, `017-commands.md#x`, `../design/copy-paste.md`) points on the site: another
 * record is its page, any other repo file its page on GitHub. Absolute URLs, `/routes` and `#anchors` are left alone (null).
 * @param {string} href @param {string} [fromDir]
 * @returns {string | null}
 */
export function resolveAdrLink(href, fromDir = ADR_DIR) {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return null;
  const [pathPart, hash = ''] = href.split(/(?=#)/);
  const parts = [];
  for (const seg of `${fromDir}/${pathPart}`.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  const path = parts.join('/');
  const adr = /^docs\/adr\/(\d{3})-[^/]+\.md$/.exec(path);
  if (adr) return adrHref(Number(adr[1])) + hash;
  return githubBlob(path) + hash;
}

/** Rewrite every relative link of an ADR body with {@link resolveAdrLink} (fenced and inline code are left alone). @param {string} md */
export function prepareAdrBody(md) {
  let fence = false;
  return md
    .split('\n')
    .map((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) { fence = !fence; return line; }
      if (fence) return line;
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, k) => (k % 2 ? part : part.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (all, href, title) => {
          const to = resolveAdrLink(href);
          return to ? `](${to}${title})` : all;
        })))
        .join('');
    })
    .join('\n');
}

/**
 * A plain-text description of a record for `<meta name="description">`: the first paragraph of its first section, flattened and cut.
 * @param {string} body
 */
export function describeAdr(body) {
  const para = body
    .split(/\n{2,}/)
    .map((b) => b.replace(/^(#{1,6}[^\n]*\n)+/, '').trim()) // a heading glued to its paragraph (no blank line) is not part of it
    .find((b) => b && !/^(#|[-*>|`~]|\d+[.)]\s)/.test(b));
  const text = plain(para ?? '');
  if (text.length <= 170) return text;
  const cut = text.slice(0, 170);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)).replace(/[,;:.\s]+$/, '') + '…';
}

/**
 * The list view of the records, with what the timeline and the pages need beyond one file: the neighbours, the date a superseded record
 * was replaced (the date of its successor) and the count per status.
 * @param {Adr[]} adrs
 */
export function recordsModel(adrs) {
  const sorted = [...adrs].sort((a, b) => a.number - b.number);
  const byNumber = new Map(sorted.map((a) => [a.number, a]));
  const counts = { all: sorted.length, accepted: 0, superseded: 0, proposed: 0, unknown: 0 };
  for (const a of sorted) counts[a.status]++;
  return {
    adrs: sorted,
    counts,
    /** @param {number} n */
    get: (n) => byNumber.get(n) ?? null,
    /** @param {number} n */
    neighbours(n) {
      const i = sorted.findIndex((a) => a.number === n);
      return { prev: i > 0 ? sorted[i - 1] : null, next: i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null };
    },
    /** @param {Adr} a */
    replacedOn: (a) => (a.supersededBy ? byNumber.get(a.supersededBy)?.date ?? null : null),
  };
}
