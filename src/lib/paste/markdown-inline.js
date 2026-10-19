/**
 * Inline markdown parser (CommonMark / GFM level) used by markdown paste and `importMarkdown`.
 *
 * Approach: one left-to-right scan builds a flat node list (text, code spans, delimiter runs, links, images…), then
 * CommonMark's delimiter-stack algorithm pairs the emphasis delimiters; links / images are resolved when their `]` is
 * met (inline destination, full / collapsed / shortcut reference). The tree is finally flattened to a Loro delta.
 *
 * Covered: `*em*` `**strong**` `***both***` `_em_` `__strong__` `~~strike~~` `<u>underline</u>`, code spans (any
 * backtick run length), backslash escapes, hard line breaks, inline links (`[t](url "title")`, `<dest with spaces>`,
 * balanced parentheses in URLs), reference links (`[t][ref]`, `[t][]`, `[t]`), autolinks (`<https://…>`, `<a@b.c>`),
 * GFM bare URLs (`https://…`, `www.…`, trailing punctuation excluded), images (`![alt](url)`, `![alt][ref]`).
 * Emphasis flanking is shared with the typing shortcuts (`behaviors/text/markdown-syntax.js`).
 *
 * Every URL goes through `sanitizeUrl`: an unsafe link keeps its text and loses the link; an unsafe image keeps its
 * alt text.
 *
 * Pure functions, no DOM, no runes.
 */

import { sanitizeUrl } from '../utils/html.js';
import { ASCII_PUNCTUATION, delimiterFlags } from '../behaviors/text/markdown-syntax.js';

/**
 * @typedef {{ href: string, title?: string }} LinkReference
 * @typedef {{ resolveRef?: (label: string) => LinkReference | null }} InlineOptions
 * @typedef {{ image: { alt: string, ref: string } }} ImageSegment
 * @typedef {{ delta: import('loro-crdt').Delta<string>[] }} TextSegment
 * @typedef {TextSegment | ImageSegment} InlineSegment
 */

// ── Link reference definitions ───────────────────────────────────────────────

const DEFINITION_RE = /^ {0,3}\[((?:[^\[\]\\]|\\.)+)\]:[ \t]*(<(?:[^<>\n\\]|\\.)*>|[^\s<]\S*)(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?[ \t]*$/;
const FENCE_RE = /^ {0,3}(```|~~~)/;

/** @param {string} s */
export function normalizeLabel(s) {
    return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** @param {string} s */
function unescapeMarkdown(s) {
    return s.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/**
 * Pull the link reference definitions (`[ref]: url "title"`, one line each) out of the markdown lines. Fenced code is
 * left untouched, footnote definitions (`[^1]:`) are not links. The first definition of a label wins.
 * @param {string[]} lines
 * @returns {{ lines: string[], resolveRef: ((label: string) => LinkReference | null) | undefined }}
 */
export function extractLinkDefinitions(lines) {
    /** @type {Map<string, LinkReference>} */
    const defs = new Map();
    /** @type {string[]} */
    const kept = [];
    let fence = '';
    for (const line of lines) {
        const f = FENCE_RE.exec(line);
        if (f) {
            if (!fence) fence = f[1];
            else if (f[1] === fence) fence = '';
            kept.push(line);
            continue;
        }
        const m = !fence && line.includes(']:') ? DEFINITION_RE.exec(line) : null;
        if (!m || m[1].startsWith('^')) { kept.push(line); continue; }
        const key = normalizeLabel(m[1]);
        let dest = m[2];
        dest = dest.startsWith('<') ? dest.slice(1, -1) : dest;
        if (key && !defs.has(key)) defs.set(key, { href: unescapeMarkdown(dest) });
    }
    return { lines: kept, resolveRef: defs.size ? (label) => defs.get(normalizeLabel(label)) ?? null : undefined };
}

// ── Scanner ──────────────────────────────────────────────────────────────────

const AUTOLINK_RE = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const EMAIL_RE = /<([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const UNDERLINE_TAG_RE = /<(\/?)u>/y;
const BARE_URL_RE = /(?:https?:\/\/[\p{L}\p{N}][^\s<]*|www\.[A-Za-z0-9][^\s<]*)/iuy;
const BARE_MIN_RE = /^(?:https?:\/\/[\p{L}\p{N}]|www\.[A-Za-z0-9])/iu;
/** A bare URL starts at the line start, after whitespace, or after one of these. */
const BARE_BOUNDARY = '*_~(';
const TRAILING_PUNCT = '?!.,:;*_~\'"';

/**
 * @typedef {{ t: 'text', s: string }
 *   | { t: 'code', s: string }
 *   | { t: 'br' }
 *   | { t: 'delim', ch: string, len: number, orig: number, canOpen: boolean, canClose: boolean }
 *   | { t: 'em', mark: string, children: Node[] }
 *   | { t: 'link', href: string, children: Node[] }
 *   | { t: 'image', href: string, children: Node[] }} Node
 */

/**
 * Parse the destination (and ignored title) of an inline link, starting right after the `(`.
 * @param {string} src
 * @param {number} p
 * @returns {{ href: string, end: number } | null}
 */
function parseDestination(src, p) {
    const n = src.length;
    let i = p;
    while (i < n && /\s/.test(src[i])) i++;
    let href = '';
    if (src[i] === '<') {
        i++;
        while (i < n && src[i] !== '>') {
            const ch = src[i];
            if (ch === '\n' || ch === '<') return null;
            if (ch === '\\' && ASCII_PUNCTUATION.includes(src[i + 1] ?? '')) { href += src[i + 1]; i += 2; continue; }
            href += ch;
            i++;
        }
        if (src[i] !== '>') return null;
        i++;
    } else {
        let depth = 0;
        while (i < n) {
            const ch = src[i];
            if (ch === '\\' && ASCII_PUNCTUATION.includes(src[i + 1] ?? '')) { href += src[i + 1]; i += 2; continue; }
            if (/[\s\u0000-\u001f]/.test(ch)) break;
            if (ch === '(') depth++;
            else if (ch === ')') { if (depth === 0) break; depth--; }
            href += ch;
            i++;
        }
        if (depth !== 0) return null;
    }
    let j = i;
    while (j < n && /\s/.test(src[j])) j++;
    if (j > i && (src[j] === '"' || src[j] === "'" || src[j] === '(')) {
        const close = src[j] === '(' ? ')' : src[j];
        let k = j + 1;
        while (k < n && src[k] !== close) k += src[k] === '\\' ? 2 : 1;
        if (k >= n) return null;
        j = k + 1;
        while (j < n && /\s/.test(src[j])) j++;
    }
    if (src[j] !== ')') return null;
    return { href, end: j + 1 };
}

/**
 * Resolve the `]` at `close` into a link / image destination, or null (literal).
 * @param {string} src
 * @param {number} close
 * @param {{ start: number }} opener
 * @param {InlineOptions} opts
 * @returns {{ href: string, end: number } | null}
 */
function resolveBracket(src, close, opener, opts) {
    const after = close + 1;
    if (src[after] === '(') {
        const d = parseDestination(src, after + 1);
        if (d) return d;
    }
    const resolve = opts.resolveRef;
    if (!resolve) return null;
    const label = src.slice(opener.start, close);
    if (!label.trim()) return null;
    if (src[after] === '[') {
        const m = /^\[((?:[^\[\]\\]|\\.)*)\]/.exec(src.slice(after, after + 1002));
        if (m) {
            const ref = resolve(m[1].trim() ? m[1] : label);
            return ref ? { href: ref.href, end: after + m[0].length } : null; // followed by a label: never a shortcut
        }
    }
    const ref = resolve(label);
    return ref ? { href: ref.href, end: after } : null;
}

/**
 * CommonMark's "process emphasis" on a node list: pair closing delimiters with the nearest compatible opener.
 * Unmatched delimiters are left in place (flattened to literal text later).
 * @param {Node[]} nodes  mutated
 */
function processEmphasis(nodes) {
    let ci = 0;
    while (ci < nodes.length) {
        const closer = nodes[ci];
        if (closer.t !== 'delim' || !closer.canClose || closer.len === 0) { ci++; continue; }
        let oi = -1;
        for (let k = ci - 1; k >= 0; k--) {
            const o = nodes[k];
            if (o.t !== 'delim' || o.ch !== closer.ch || !o.canOpen || o.len === 0) continue;
            if (o.ch === '~') { if (o.len === 2 && closer.len === 2) { oi = k; break; } continue; }
            // "Multiple of 3" rule: an opener that can also close (or a closer that can also open) only pairs when
            // the lengths do not sum to a multiple of 3, unless both are.
            if (o.ch !== 'u' && (o.canClose || closer.canOpen) && (o.orig + closer.orig) % 3 === 0 && !(o.orig % 3 === 0 && closer.orig % 3 === 0)) continue;
            oi = k;
            break;
        }
        if (oi < 0) { ci++; continue; }
        const opener = /** @type {Extract<Node, { t: 'delim' }>} */ (nodes[oi]);
        const use = opener.ch === '~' ? 2 : opener.ch === 'u' ? 1 : opener.len >= 2 && closer.len >= 2 ? 2 : 1;
        const mark = opener.ch === '~' ? 'strikethrough' : opener.ch === 'u' ? 'underline' : use === 2 ? 'bold' : 'italic';
        const inner = nodes.slice(oi + 1, ci);
        opener.len -= use;
        closer.len -= use;
        nodes.splice(oi + 1, ci - oi - 1, { t: 'em', mark, children: inner });
        ci = oi + 2;
        if (opener.len === 0) { nodes.splice(oi, 1); ci--; }
        if (closer.len === 0) nodes.splice(ci, 1);
    }
}

/**
 * Strip GFM-excluded trailing punctuation from a bare URL candidate.
 * @param {string} url
 * @returns {string}
 */
function trimBareUrl(url) {
    for (;;) {
        const last = url[url.length - 1];
        if (!last) return url;
        if (TRAILING_PUNCT.includes(last)) {
            const entity = last === ';' ? /&[A-Za-z0-9]+;$/.exec(url) : null; // `&amp;` is not punctuation… but is not a URL end either
            url = entity ? url.slice(0, -entity[0].length) : url.slice(0, -1);
        } else if (last === ')') {
            const open = (url.match(/\(/g) || []).length;
            const close = (url.match(/\)/g) || []).length;
            if (close > open) url = url.slice(0, -1);
            else return url;
        } else return url;
    }
}

/**
 * @param {string} src
 * @param {InlineOptions} opts
 * @returns {Node[]}
 */
function scan(src, opts) {
    const n = src.length;
    /** @type {Node[]} */
    const nodes = [];
    /** @type {Array<{ node: Node, image: boolean, active: boolean, start: number }>} */
    const brackets = [];
    let buf = '';
    let i = 0;

    const flush = () => { if (buf) { nodes.push({ t: 'text', s: buf }); buf = ''; } };
    const skipSpaces = () => { while (src[i] === ' ' || src[i] === '\t') i++; };
    /** Strip the spaces before a newline (from the pending buffer, or the last text node); returns how many. */
    const stripTrailingSpaces = () => {
        let stripped = 0;
        const strip = (/** @type {string} */ s) => {
            const m = / +$/.exec(s);
            if (!m) return s;
            stripped += m[0].length;
            return s.slice(0, -m[0].length);
        };
        buf = strip(buf);
        if (!buf) {
            const last = nodes[nodes.length - 1];
            if (last && last.t === 'text') last.s = strip(last.s);
        }
        return stripped;
    };

    while (i < n) {
        const c = src[i];

        // A line break inside the text stays a `\n` of the block (callout / quote bodies are joined with it). Paragraph
        // lines are joined BEFORE parsing (soft break = space, hard break = `\n`), see Paragraph.fromMarkdown.
        if (c === '\n') {
            stripTrailingSpaces();
            i++;
            skipSpaces();
            flush();
            nodes.push({ t: 'br' });
            continue;
        }

        if (c === '\\') {
            const next = src[i + 1];
            if (next === '\n') { flush(); nodes.push({ t: 'br' }); i += 2; skipSpaces(); continue; }
            if (next !== undefined && ASCII_PUNCTUATION.includes(next)) { buf += next; i += 2; continue; }
            buf += c;
            i++;
            continue;
        }

        if (c === '`') {
            let j = i;
            while (src[j] === '`') j++;
            const len = j - i;
            let found = -1;
            for (let k = j; k < n;) {
                const p = src.indexOf('`', k);
                if (p < 0) break;
                let q = p;
                while (src[q] === '`') q++;
                if (q - p === len) { found = p; break; }
                k = q;
            }
            if (found < 0) { buf += src.slice(i, j); i = j; continue; }
            let content = src.slice(j, found).replace(/\n/g, ' ');
            if (content.length > 2 && content.startsWith(' ') && content.endsWith(' ') && content.trim()) content = content.slice(1, -1);
            flush();
            nodes.push({ t: 'code', s: content });
            i = found + len;
            continue;
        }

        if (c === '*' || c === '_' || c === '~') {
            let j = i;
            while (src[j] === c) j++;
            const len = j - i;
            if (c === '~' && len !== 2) { buf += src.slice(i, j); i = j; continue; }
            const { canOpen, canClose } = delimiterFlags(c, src[i - 1] ?? '', src[j] ?? '');
            flush();
            nodes.push({ t: 'delim', ch: c, len, orig: len, canOpen, canClose });
            i = j;
            continue;
        }

        if (c === '[' || (c === '!' && src[i + 1] === '[')) {
            const image = c === '!';
            flush();
            /** @type {Node} */
            const node = { t: 'text', s: image ? '![' : '[' };
            nodes.push(node);
            i += image ? 2 : 1;
            brackets.push({ node, image, active: true, start: i });
            continue;
        }

        if (c === ']') {
            const opener = brackets[brackets.length - 1];
            if (!opener) { buf += c; i++; continue; }
            brackets.pop();
            const res = opener.active ? resolveBracket(src, i, opener, opts) : null;
            if (!res) { buf += c; i++; continue; }
            flush();
            const idx = nodes.indexOf(opener.node);
            const children = nodes.splice(idx + 1);
            processEmphasis(children);
            nodes[idx] = opener.image ? { t: 'image', href: res.href, children } : { t: 'link', href: res.href, children };
            if (!opener.image) for (const b of brackets) if (!b.image) b.active = false; // links do not nest
            i = res.end;
            continue;
        }

        if (c === '<') {
            AUTOLINK_RE.lastIndex = i;
            const auto = AUTOLINK_RE.exec(src);
            if (auto) {
                if (sanitizeUrl(auto[1], { kind: 'link' }) === null) buf += auto[0];
                else { flush(); nodes.push({ t: 'link', href: auto[1], children: [{ t: 'text', s: auto[1] }] }); }
                i += auto[0].length;
                continue;
            }
            EMAIL_RE.lastIndex = i;
            const mail = EMAIL_RE.exec(src);
            if (mail) {
                flush();
                nodes.push({ t: 'link', href: 'mailto:' + mail[1], children: [{ t: 'text', s: mail[1] }] });
                i += mail[0].length;
                continue;
            }
            UNDERLINE_TAG_RE.lastIndex = i;
            const tag = UNDERLINE_TAG_RE.exec(src);
            if (tag) {
                const closing = tag[1] === '/';
                flush();
                nodes.push({ t: 'delim', ch: 'u', len: 1, orig: 1, canOpen: !closing, canClose: closing });
                i += tag[0].length;
                continue;
            }
            buf += c;
            i++;
            continue;
        }

        if (c === 'h' || c === 'H' || c === 'w' || c === 'W') {
            const prev = src[i - 1];
            if (prev === undefined || /\s/.test(prev) || BARE_BOUNDARY.includes(prev)) {
                BARE_URL_RE.lastIndex = i;
                const m = BARE_URL_RE.exec(src);
                if (m) {
                    let url = m[0];
                    if (brackets.length) { const cut = url.indexOf(']'); if (cut >= 0) url = url.slice(0, cut); }
                    url = trimBareUrl(url);
                    if (BARE_MIN_RE.test(url)) {
                        flush();
                        nodes.push({ t: 'link', href: /^www\./i.test(url) ? 'http://' + url : url, children: [{ t: 'text', s: url }] });
                        i += url.length;
                        continue;
                    }
                }
            }
        }

        buf += c;
        i++;
    }

    flush();
    processEmphasis(nodes);
    return nodes;
}

// ── Flatten ──────────────────────────────────────────────────────────────────

/** @param {Node[]} nodes @returns {string} */
function plainText(nodes) {
    let out = '';
    for (const n of nodes) {
        if (n.t === 'text' || n.t === 'code') out += n.s;
        else if (n.t === 'br') out += ' ';
        else if (n.t === 'delim') out += n.ch === 'u' ? '' : n.ch.repeat(n.len);
        else out += plainText(n.children);
    }
    return out;
}

/**
 * @typedef {{ insert: string, attributes?: Record<string, any> } | { image: { alt: string, ref: string }, marks: Record<string, any> }} Item
 */

/**
 * @param {Node[]} nodes
 * @param {Record<string, any>} marks
 * @param {Item[]} out
 */
function flatten(nodes, marks, out) {
    /** @param {string} s @param {Record<string, any>} m */
    const text = (s, m) => { if (s) out.push(Object.keys(m).length ? { insert: s, attributes: { ...m } } : { insert: s }); };
    for (const n of nodes) {
        switch (n.t) {
            case 'text': text(n.s, marks); break;
            case 'code': text(n.s, { ...marks, code: true }); break;
            case 'br': text('\n', marks); break;
            case 'delim': text(n.ch === 'u' ? (n.canOpen ? '<u>' : '</u>') : n.ch.repeat(n.len), marks); break;
            case 'em': flatten(n.children, { ...marks, [n.mark]: true }, out); break;
            case 'link': {
                const safe = n.href && marks.link === undefined ? sanitizeUrl(n.href, { kind: 'link' }) : null;
                flatten(n.children, safe === null ? marks : { ...marks, link: n.href }, out);
                break;
            }
            case 'image': {
                const alt = plainText(n.children);
                if (n.href && sanitizeUrl(n.href, { kind: 'media' }) !== null) out.push({ image: { alt, ref: n.href }, marks });
                else text(alt, marks);
                break;
            }
        }
    }
}

/** @param {Record<string, any> | undefined} a @param {Record<string, any> | undefined} b */
function sameAttributes(a, b) {
    const ka = Object.keys(a ?? {});
    const kb = Object.keys(b ?? {});
    return ka.length === kb.length && ka.every((k) => a?.[k] === b?.[k]);
}

/**
 * Merge adjacent text ops with identical attributes into one.
 * @param {Item[]} items
 * @returns {import('loro-crdt').Delta<string>[]}
 */
function toDelta(items) {
    /** @type {import('loro-crdt').Delta<string>[]} */
    const delta = [];
    for (const it of items) {
        if (!('insert' in it) || !it.insert) continue;
        const last = /** @type {any} */ (delta[delta.length - 1]);
        if (last && sameAttributes(last.attributes, it.attributes)) last.insert += it.insert;
        else delta.push(it.attributes ? { insert: it.insert, attributes: { ...it.attributes } } : { insert: it.insert });
    }
    return delta;
}

/**
 * Parse inline markdown into a sequence of text segments (a Loro delta each) and image segments: an image splits
 * the text around it. Unsafe image URLs stay as their alt text.
 * @param {string} text
 * @param {InlineOptions} [options]
 * @returns {InlineSegment[]}
 */
export function parseMarkdownSegments(text, options = {}) {
    if (!text) return [];
    /** @type {Item[]} */
    const items = [];
    flatten(scan(text, options), {}, items);
    /** @type {InlineSegment[]} */
    const segments = [];
    /** @type {Item[]} */
    let run = [];
    const closeRun = () => {
        const delta = toDelta(run);
        if (delta.length) segments.push({ delta });
        run = [];
    };
    for (const it of items) {
        if ('image' in it) { closeRun(); segments.push({ image: it.image }); } else run.push(it);
    }
    closeRun();
    return segments;
}

/**
 * Parse inline markdown text into a Loro-compatible delta array:
 *   `**bold *italic* still bold**` → [bold, bold+italic, bold]; `[t](url)` → text with a `link` mark.
 * An image becomes its alt text (use {@link parseMarkdownSegments} to keep images as blocks).
 *
 * @param {string} text
 * @param {Record<string, any>} [marks]  marks inherited by every run
 * @param {InlineOptions} [options]
 * @returns {import('loro-crdt').Delta<string>[]}
 */
export function parseMarkdownInline(text, marks = {}, options = {}) {
    if (!text) return [];
    /** @type {Item[]} */
    const items = [];
    flatten(scan(text, options), marks, items);
    return toDelta(items.map((it) => ('image' in it
        ? (it.image.alt ? { insert: it.image.alt, ...(Object.keys(it.marks).length ? { attributes: it.marks } : {}) } : { insert: '' })
        : it)));
}
