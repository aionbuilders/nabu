import { Extension } from '../utils/extensions.js';
import { sanitizeUrl } from '../utils/html.js';

// ── Inline mark mapping: HTML tag → Nabu mark name ──────────────────────────
const MARK_TAGS = {
    strong: 'bold', b: 'bold',
    em: 'italic', i: 'italic',
    u: 'underline',
    code: 'code',
    s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough',
};

// ── Tags skipped when parsing inline content ────────────────────────────────
// Structural/block elements that create their own blocks, not inline marks.
// ul/ol/li are handled as children by their parent block's fromHTML.
const SKIP_IN_INLINE = new Set([
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'script', 'style', 'noscript', 'iframe',
]);

// ── Tags whose content is NEVER read as text (active / embedded content) ─────
// Kept apart from SKIP_IN_INLINE: that set also drives block-container detection.
const DROP_IN_INLINE = new Set([
    'object', 'embed', 'applet', 'template', 'svg', 'math', 'frame', 'frameset', 'canvas', 'audio', 'video', 'img',
]);

// ── Tags that never contribute anything, at any level (P-47: scripts / styles never produce text) ──
const NEVER_CONTENT = new Set([
    'script', 'style', 'noscript', 'iframe', 'template', 'head', 'title', 'meta', 'link', 'base', 'colgroup', 'col',
    'object', 'embed', 'applet', 'svg', 'math', 'frame', 'frameset', 'canvas', 'audio',
]);

// ── Tags treated as transparent containers: flattened at the top level ───────
// A div/section containing block children is not itself a block — expand it.
const TRANSPARENT_CONTAINERS = new Set([
    'div', 'section', 'article', 'main', 'header', 'footer',
    'aside', 'nav', 'form', 'figure', 'figcaption', 'details', 'summary',
    'address', 'hgroup', 'fieldset', 'legend', 'center', 'menu', 'dir',
]);

// ── Structure the engine has no block for (yet): its content is kept as paragraphs, never lost ──
const STRUCTURAL = new Set([
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
]);

// ── Elements that start / end a line when they appear INSIDE inline content (`<blockquote><p>a</p><p>b</p>`) ──
const LINE_BOUNDARY = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article', 'aside', 'header', 'footer',
    'main', 'nav', 'figure', 'figcaption', 'address', 'dd', 'dt', 'dl', 'fieldset', 'form', 'center', 'details',
    'summary', 'hr', 'pre',
]);

// ── `white-space` values under which spaces are significant (not collapsed) ──
const PRESERVE_WHITESPACE = new Set(['pre', 'pre-wrap', 'break-spaces']);

/** Namespace prefixes of Office markup (`<o:p>`, `<v:shape>`, `<w:sdt>`…) that never carry text. */
const OFFICE_PREFIXES = new Set(['o', 'v', 'w']);

// ── Inline style reading ─────────────────────────────────────────────────────

/** @type {Readonly<Record<string, string>>} */
const NO_STYLE = Object.freeze({});

/**
 * Parse the `style` attribute of an element into `{ property: value }` (lower-cased, `!important` removed, the last
 * declaration of a property wins). Reads the attribute itself rather than the CSSOM so that `mso-*` / vendor
 * properties can never be mistaken for the standard property they look like, whatever the DOM implementation.
 * @param {Element} el
 * @returns {Readonly<Record<string, string>>}
 */
export function parseStyle(el) {
    const raw = el.getAttribute?.('style');
    if (!raw) return NO_STYLE;
    /** @type {Record<string, string>} */
    const out = {};
    let depth = 0;
    /** @type {string | null} */
    let quote = null;
    let start = 0;
    const flush = (/** @type {number} */ end) => {
        const decl = raw.slice(start, end);
        const i = decl.indexOf(':');
        if (i > 0) {
            const name = decl.slice(0, i).trim().toLowerCase();
            const value = decl.slice(i + 1).replace(/!\s*important/i, '').trim().toLowerCase();
            if (name) out[name] = value;
        }
        start = end + 1;
    };
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ';' && depth === 0) flush(i);
    }
    flush(raw.length);
    return out;
}

/**
 * Apply the inline style of an element over the marks inherited from the tags: the style has the last word
 * (`<b style="font-weight:normal">` is NOT bold, `<span style="font-weight:700">` is). Only the marks Nabu knows are
 * touched; colors, fonts, sizes and backgrounds are ignored.
 * @param {Record<string, any>} marks mutated in place
 * @param {Readonly<Record<string, string>>} style
 */
function applyStyleToMarks(marks, style) {
    const fw = style['font-weight'];
    if (fw) {
        if (fw === 'bold') marks.bold = true;
        else if (fw === 'normal' || fw === 'lighter') delete marks.bold;
        else if (/^\d+$/.test(fw)) { if (Number(fw) >= 600) marks.bold = true; else delete marks.bold; }
    }
    const fs = style['font-style'];
    if (fs) {
        if (fs === 'italic' || fs.startsWith('oblique')) marks.italic = true;
        else if (fs === 'normal') delete marks.italic;
    }
    const td = style['text-decoration-line'] ?? style['text-decoration'];
    if (td) {
        const words = td.split(/\s+/);
        if (words.includes('none')) { delete marks.underline; delete marks.strikethrough; }
        // The underline of a link is the link's own look, not a mark the author put on the text.
        if (words.includes('underline') && !marks.link) marks.underline = true;
        if (words.includes('line-through')) marks.strikethrough = true;
    }
}

/**
 * Whether an element contributes nothing at all: scripts / styles / embedded content, Office markup (`<o:p>`), Word list
 * markers (`mso-list:Ignore`), hidden elements.
 * @param {Element} el
 * @param {string} tag lower-cased tag name
 * @param {Readonly<Record<string, string>>} style
 * @returns {boolean}
 */
function isJunk(el, tag, style) {
    if (NEVER_CONTENT.has(tag)) return true;
    const colon = tag.indexOf(':');
    if (colon > 0 && OFFICE_PREFIXES.has(tag.slice(0, colon))) return true;
    if (tag === 'xml') return true;
    if (style['mso-list']?.startsWith('ignore')) return true;
    if (style['mso-hide'] === 'all' || style.display === 'none' || style.visibility === 'hidden') return true;
    return el.hasAttribute?.('hidden') ?? false;
}

// ── Links ────────────────────────────────────────────────────────────────────

/**
 * Unwrap a Google redirect link (`https://www.google.com/url?q=<target>&sa=D&…`, also `&url=`) to its target.
 * Returns `null` when `href` is not such a link, or when its target is missing, relative, malformed or unsafe.
 * @param {string} href
 * @returns {string | null}
 */
export function unwrapGoogleRedirect(href) {
    let url;
    try { url = new URL(href.trim()); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'www.google.com' && host !== 'google.com') return null;
    if (url.pathname !== '/url') return null;
    const target = url.searchParams.get('q') || url.searchParams.get('url');
    if (!target || !/^(?:https?:|mailto:|tel:)/i.test(target.trim())) return null;
    const clean = target.trim();
    return sanitizeUrl(clean, { kind: 'link' }) !== null ? clean : null;
}

/**
 * The href a pasted link gets: a Google redirect is unwrapped to its (sanitized) target; otherwise the href itself when
 * `sanitizeUrl` accepts it; `null` when unsafe (the text is kept, just not as a link).
 * @param {string | null} href
 * @returns {string | null}
 */
export function resolveLinkHref(href) {
    if (!href) return null;
    const target = unwrapGoogleRedirect(href);
    if (target !== null) return target;
    return sanitizeUrl(href, { kind: 'link' }) !== null ? href : null;
}

// ── Inline content → delta ───────────────────────────────────────────────────

/**
 * @typedef {Object} TextToken
 * @property {string} s
 * @property {Record<string, any>} marks
 * @property {boolean} preserve  spaces are significant (`white-space: pre | pre-wrap | break-spaces`)
 * @property {boolean} verbatim  inside a `<pre>`: not even NBSP is touched
 */
/** @typedef {TextToken | { br: true } | { brk: true }} Token  `br`: a `<br>`; `brk`: a block boundary met inside inline content */

/**
 * Collect the text and line breaks under `el` as a flat token list, with the marks that apply to each text run.
 * @param {Node} el
 * @param {Record<string, any>} marks
 * @param {boolean} preserve
 * @param {boolean} verbatim
 * @param {Token[]} out
 */
function collect(el, marks, preserve, verbatim, out) {
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            const s = child.textContent;
            if (s) out.push({ s, marks, preserve, verbatim });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el2 = /** @type {Element} */ (child);
            const tag = el2.tagName.toLowerCase();
            if (tag === 'br') { out.push({ br: true }); continue; }
            const style = parseStyle(el2);
            if (isJunk(el2, tag, style) || SKIP_IN_INLINE.has(tag) || DROP_IN_INLINE.has(tag)) continue;
            const next = { ...marks };
            const markName = /** @type {Record<string, string>} */ (MARK_TAGS)[tag];
            if (markName) next[markName] = true;
            // <a href> → link mark (value = href). Unsafe hrefs (javascript:, data:…) are dropped: the text stays, as plain text.
            if (tag === 'a') {
                const href = resolveLinkHref(el2.getAttribute('href'));
                if (href !== null) next.link = href;
            }
            applyStyleToMarks(next, style);
            const ws = style['white-space'];
            const nextPreserve = tag === 'pre' ? true : ws ? PRESERVE_WHITESPACE.has(ws) : preserve;
            const boundary = LINE_BOUNDARY.has(tag);
            if (boundary) out.push({ brk: true });
            collect(el2, next, nextPreserve, verbatim || tag === 'pre', out);
            if (boundary) out.push({ brk: true });
        }
    }
}

/**
 * @typedef {Object} Cell one character of the flattened inline content
 * @property {string} c
 * @property {Record<string, any> | null} marks null for a line break
 * @property {boolean} preserve
 * @property {boolean} verbatim
 * @property {'br' | 'brk' | null} brk
 * @property {boolean} [collapsible] a space that came out of HTML whitespace collapsing (and may still be trimmed)
 */

/** Spaces for the NBSP rule: a U+00A0 touching one of these (or a line / block edge) is a plain space. */
const SPACE_LIKE = /[ \t\r\f ]/;
/** HTML whitespace (collapsible): space, tab, line feed, carriage return, form feed. NOT the unicode spaces. */
const HTML_WS = /^[ \t\n\r\f]$/;

/**
 * Turn the token list into a delta, applying the whitespace rules of external HTML (P-57):
 *  - HTML whitespace collapses to one space and is trimmed at the edges of a line (CSS), except under
 *    `white-space: pre | pre-wrap | break-spaces` where it is kept; `<br>` is a line break;
 *  - U+00A0 between two visible characters is KEPT ("10 km", "Bonjour :"); next to another space or at the edge of a
 *    line / block it is a regular space (then collapsed like any space);
 *  - every other character (U+202F, U+2007, U+2060, U+00AD, ZWJ, ZWNJ…) is left untouched.
 * @param {Token[]} tokens
 * @param {{ keepEdges?: boolean }} [options]  `keepEdges`: keep one collapsed space at the edges (a fragment of a line)
 * @returns {import('loro-crdt').Delta<string>[]}
 */
function buildDelta(tokens, { keepEdges = false } = {}) {
    /** @type {Cell[]} */
    const cells = [];
    for (const t of tokens) {
        if ('s' in t) {
            for (const c of t.s) cells.push({ c, marks: t.marks, preserve: t.preserve, verbatim: t.verbatim, brk: null });
        } else {
            cells.push({ c: '\n', marks: null, preserve: false, verbatim: false, brk: 'br' in t ? 'br' : 'brk' });
        }
    }

    // 1. NBSP: isolated between two visible characters → kept; next to a space or a line / block edge → regular space.
    const isEdge = (/** @type {Cell | undefined} */ cell) => !cell || cell.c === '\n';
    const spaceLike = (/** @type {Cell | undefined} */ cell) => !!cell && SPACE_LIKE.test(cell.c);
    const nbsp = [];
    for (let i = 0; i < cells.length; i++) {
        if (cells[i].c !== ' ' || cells[i].verbatim) continue;
        const l = cells[i - 1];
        const r = cells[i + 1];
        if (isEdge(l) || isEdge(r) || spaceLike(l) || spaceLike(r)) nbsp.push(i);
    }
    for (const i of nbsp) cells[i] = { ...cells[i], c: ' ' };

    // 2. Collapse HTML whitespace and trim line edges.
    /** @type {Cell[]} */
    const out = [];
    const last = () => out[out.length - 1];
    const dropTrailingSpaces = () => { while (out.length && last().collapsible) out.pop(); };
    for (const cell of cells) {
        if (cell.brk) {
            dropTrailingSpaces();
            if (cell.brk === 'brk' && (!out.length || last().c === '\n')) continue; // block boundaries never stack or lead
            out.push(cell);
        } else if (!cell.preserve && HTML_WS.test(cell.c)) {
            const prev = last();
            if (prev && (prev.collapsible || prev.c === '\n')) continue;
            if (!prev && !keepEdges) continue;
            out.push({ ...cell, c: ' ', collapsible: true });
        } else {
            out.push(cell);
        }
    }
    if (!keepEdges) dropTrailingSpaces();
    while (out.length && (last().brk || (!keepEdges && last().collapsible))) out.pop();

    // 3. Back to a delta, merging neighbours that carry the same marks.
    /** @type {import('loro-crdt').Delta<string>[]} */
    const ops = [];
    let prevKey = '';
    for (const cell of out) {
        const entries = cell.marks ? Object.entries(cell.marks).sort(([a], [b]) => (a < b ? -1 : 1)) : [];
        const key = entries.length ? JSON.stringify(entries) : '';
        const prev = ops[ops.length - 1];
        if (prev && key === prevKey) { prev.insert += cell.c; continue; }
        ops.push(key && cell.marks ? { insert: cell.c, attributes: { ...cell.marks } } : { insert: cell.c });
        prevKey = key;
    }
    return ops;
}

/**
 * Parse the inline content of a DOM element into a Loro-compatible delta array.
 * Recurses into inline and unknown elements, inheriting marks; the inline style of an element has the last word over
 * its tag; skips block-level children (ul, ol, table…) — those are handled by fromHTML. Whitespace follows the rules of
 * {@link buildDelta}.
 *
 * @param {Element} el
 * @param {Record<string, true>} [marks]
 * @param {{ keepEdges?: boolean }} [options]
 * @returns {import('loro-crdt').Delta<string>[]}
 */
export function parseInline(el, marks = {}, options) {
    const style = parseStyle(el);
    const ws = style['white-space'];
    const tag = el.tagName.toLowerCase();
    /** @type {Token[]} */
    const tokens = [];
    collect(el, { ...marks }, tag === 'pre' || (ws ? PRESERVE_WHITESPACE.has(ws) : false), tag === 'pre', tokens);
    return buildDelta(tokens, options);
}

// ── Block level ──────────────────────────────────────────────────────────────

/**
 * Build the ordered ruleset from all BlockClasses registered in nabu.
 * Sorted by rule priority descending so specific blocks (e.g. blockquote)
 * win over generic fallbacks (e.g. paragraph's blockquote selector).
 * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
 * @returns {Array<{ BlockClass: any, rule: { selector: string, priority?: number, props?: Record<string,any> } }>}
 */
function buildRuleset(nabu) {
    /** @type {Array<{ BlockClass: any, rule: any }>} */
    const ruleset = [];
    for (const [, BlockClass] of nabu.registry) {
        const rules = /** @type {{ htmlRules?: unknown }} */ (BlockClass).htmlRules;
        if (!Array.isArray(rules)) continue;
        for (const rule of rules) ruleset.push({ BlockClass, rule });
    }
    ruleset.sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0));
    return ruleset;
}

/**
 * The first rule of the ruleset an element matches, if any.
 * @param {Element} el
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @returns {{ BlockClass: any, rule: any } | null}
 */
function findRule(el, ruleset) {
    for (const entry of ruleset) {
        try { if (!el.matches(entry.rule.selector)) continue; } catch { continue; }
        if (entry.rule.filter && !entry.rule.filter(el)) continue;
        return entry;
    }
    return null;
}

/**
 * A text block with no text (and no children): `<p></p>`, `<p><br></p>`, `<p>&nbsp;</p>`, an empty list item… External HTML
 * only, never code. Generic: "has a delta array and nothing in it".
 * @param {import('../utils/extensions.js').PasteBlock} pb
 * @param {Element} el
 * @returns {boolean}
 */
function isEmptyTextBlock(pb, el) {
    if (!Array.isArray(pb.delta) || pb.children?.length) return false;
    if (el.closest?.('pre')) return false;
    return pb.delta.every((op) => typeof op.insert !== 'string' || !/\S/.test(op.insert));
}

/**
 * Match a DOM element against the registered ruleset and call the matching block class's static `fromHTML()`. The rule's
 * `fromHTML` may return one PasteBlock, several (a table gives one paragraph per row) or nothing. Empty text blocks (see
 * {@link isEmptyTextBlock}) are dropped.
 *
 * @param {Element} el
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @param {Object} helpers
 * @param {Element[]} [siblings]  the following siblings the rule absorbed (see {@link claimSiblings})
 * @returns {import('../utils/extensions.js').PasteBlock[]}
 */
function parseBlocks(el, ruleset, helpers, siblings = []) {
    if (el.nodeType !== Node.ELEMENT_NODE) return [];
    const entry = findRule(el, ruleset);
    if (!entry) return [];
    const out = entry.BlockClass.fromHTML(el, helpers, entry.rule, siblings);
    const list = Array.isArray(out) ? out : out ? [out] : [];
    return list.filter((pb) => pb && !isEmptyTextBlock(pb, el));
}

/**
 * The first block of {@link parseBlocks}, or `null`.
 * @param {Element} el
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @param {Object} helpers
 * @returns {import('../utils/extensions.js').PasteBlock | null}
 */
function parseBlock(el, ruleset, helpers) {
    return parseBlocks(el, ruleset, helpers)[0] ?? null;
}

/**
 * A block class may ask to absorb the siblings that follow its element (`static htmlSiblings(el, rule, helpers)` returns
 * them, in order): the structure continues over several elements (Google Docs puts each nesting level of a list in its own
 * `<ul>`, Word writes a list as consecutive `<p>`). They reach `fromHTML` as 4th argument and are not read on their own.
 * Only blank text and comments may lie between the element and what it absorbs; the claim stops at the first thing that does not.
 * @param {Element} el
 * @param {{ BlockClass: any, rule: any }} entry
 * @param {any} helpers
 * @returns {{ siblings: Element[], nodes: Node[] }}  the absorbed elements, and every node covered (blank text / comments included)
 */
function claimSiblings(el, entry, helpers) {
    /** @type {Element[]} */
    const siblings = [];
    /** @type {Node[]} */
    const nodes = [];
    const ask = entry.BlockClass.htmlSiblings;
    if (typeof ask !== 'function') return { siblings, nodes };
    let wanted;
    try { wanted = new Set(ask.call(entry.BlockClass, el, entry.rule, helpers) ?? []); } catch { return { siblings, nodes }; }
    /** @type {Node[]} */
    let between = [];
    for (let n = el.nextSibling; n && siblings.length < wanted.size; n = n.nextSibling) {
        if (n.nodeType === Node.ELEMENT_NODE) {
            if (!wanted.has(/** @type {Element} */ (n))) break;
            siblings.push(/** @type {Element} */ (n));
            nodes.push(...between, n);
            between = [];
        } else if (n.nodeType === Node.COMMENT_NODE || (n.nodeType === Node.TEXT_NODE && !/\S/.test(n.textContent ?? ''))) {
            between.push(n);
        } else break;
    }
    return { siblings, nodes };
}

// ── Elements embedded in inline content (an <img> in a paragraph) ────────────

/**
 * Selector of the elements whose rule says `embed: true`: they may sit inside the inline content of another block, and
 * are then lifted out as blocks of their own.
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @returns {string}
 */
const embedSelector = (ruleset) => ruleset.filter((e) => e.rule.embed).map((e) => e.rule.selector).join(',');

/**
 * The embeddable elements of a block element that can be lifted out of it: reached through inline wrappers only (never
 * through a list / table / `<pre>` or another ruled block, which read their own content).
 * An embeddable element that gives no block (an `<img>` with an unsafe or missing source) is not lifted: it simply is not there.
 * @param {Element} host
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @param {any} helpers
 * @returns {Element[]}
 */
function findEmbeds(host, ruleset, helpers) {
    const selector = embedSelector(ruleset);
    if (!selector) return [];
    let candidates;
    try { candidates = [...host.querySelectorAll(selector)]; } catch { return []; }
    return candidates.filter((embed) => {
        if (!findRule(embed, ruleset)?.rule.embed || !parseBlocks(embed, ruleset, helpers).length) return false;
        for (let a = embed.parentElement; a && a !== host; a = a.parentElement) {
            const tag = a.tagName.toLowerCase();
            if (STRUCTURAL.has(tag) || tag === 'pre' || tag === 'code' || findRule(a, ruleset)) return false;
        }
        return true;
    });
}

/**
 * @typedef {{ el: Element } | { embed: Element }} Piece
 */

/**
 * Cut `node` around the `embeds` it contains: the content before an embed, the embed, the content after, each side being
 * a shallow copy of `node` (and of the inline wrappers on the way) holding its slice of the children.
 * @param {Element} node
 * @param {Set<Element>} embeds
 * @returns {Piece[]}
 */
function splitAround(node, embeds) {
    /** @type {Piece[]} */
    const pieces = [];
    let current = /** @type {Element} */ (node.cloneNode(false));
    const flush = () => { if (current.childNodes.length) pieces.push({ el: current }); current = /** @type {Element} */ (node.cloneNode(false)); };
    for (const child of node.childNodes) {
        if (child.nodeType !== Node.ELEMENT_NODE) { current.appendChild(child.cloneNode(true)); continue; }
        const el = /** @type {Element} */ (child);
        if (embeds.has(el)) { flush(); pieces.push({ embed: el }); continue; }
        if ([...embeds].some((e) => el.contains(e))) {
            for (const piece of splitAround(el, embeds)) {
                if ('embed' in piece) { flush(); pieces.push(piece); } else current.appendChild(piece.el);
            }
        } else current.appendChild(el.cloneNode(true));
    }
    if (current.childNodes.length) pieces.push({ el: current });
    return pieces;
}

/**
 * How an element takes part in the block structure:
 *  - `skip`: contributes nothing (script, style, hidden, Office markup, embedded content);
 *  - `block`: a registered block rule matches it (its `fromHTML` reads the whole element);
 *  - `container`: only a wrapper (div, section, table cell, a `<b>` around paragraphs…): its children are read in turn;
 *  - `inline`: text-level content, grouped with its neighbours into one paragraph.
 * @param {Element} el
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @returns {'skip' | 'block' | 'container' | 'inline'}
 */
function classify(el, ruleset) {
    const tag = el.tagName.toLowerCase();
    if (isJunk(el, tag, parseStyle(el))) return 'skip';
    if (findRule(el, ruleset)) return 'block';
    if (DROP_IN_INLINE.has(tag)) return 'skip';
    if (TRANSPARENT_CONTAINERS.has(tag) || STRUCTURAL.has(tag)) return 'container';
    // An unknown element wrapping block children (Google Docs' <b style="font-weight:normal"> wrapper…) is transparent.
    for (const child of el.children) {
        const kind = classify(child, ruleset);
        if (kind === 'block' || kind === 'container') return 'container';
    }
    return 'inline';
}

/**
 * Read the children of a container: block elements become blocks, container elements are expanded, and the loose inline
 * content between them (text, `<br>`, `<span>`, `<b>`…) is grouped into implicit paragraphs, so that no text is lost
 * next to a `<script>` / `<style>` or a sibling block (P-47).
 *
 * @param {Node} parent
 * @param {Array<{ BlockClass: any, rule: any }>} ruleset
 * @param {any} helpers
 * @param {{ onRun?: (p: Element) => import('../utils/extensions.js').PasteBlock | null }} [hooks]
 * @returns {import('../utils/extensions.js').PasteBlock[]}
 */
function parseNodes(parent, ruleset, helpers, hooks = {}) {
    /** @type {import('../utils/extensions.js').PasteBlock[]} */
    const blocks = [];
    /** @type {Node[]} */
    let run = [];
    /** @type {Set<Node>} nodes already read as part of the block that absorbed them */
    const claimed = new Set();
    const flush = () => {
        if (!run.length) return;
        const owner = parent.ownerDocument ?? /** @type {Document} */ (parent);
        const p = owner.createElement('p');
        for (const node of run) p.appendChild(node.cloneNode(true));
        run = [];
        if (hooks.onRun) { const pb = hooks.onRun(p); if (pb) blocks.push(pb); }
        else blocks.push(...parseBlocks(p, ruleset, helpers));
    };
    for (const node of [...parent.childNodes]) {
        if (claimed.has(node)) continue;
        if (node.nodeType === Node.TEXT_NODE) { run.push(node); continue; }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = /** @type {Element} */ (node);
        const kind = classify(el, ruleset);
        if (kind === 'skip') continue;
        if (kind === 'inline') { run.push(el); continue; }
        flush();
        if (kind === 'block') {
            const entry = /** @type {{ BlockClass: any, rule: any }} */ (findRule(el, ruleset));
            const { siblings, nodes } = claimSiblings(el, entry, helpers);
            for (const n of nodes) claimed.add(n);
            // An <img> inside a paragraph: text before, the image block, text after.
            const embeds = entry.rule.embed || siblings.length ? [] : findEmbeds(el, ruleset, helpers);
            if (embeds.length) {
                for (const piece of splitAround(el, new Set(embeds))) {
                    blocks.push(...('embed' in piece ? parseBlocks(piece.embed, ruleset, helpers) : parseBlocks(piece.el, ruleset, helpers)));
                }
            } else {
                blocks.push(...parseBlocks(el, ruleset, helpers, siblings));
            }
        } else {
            blocks.push(...parseNodes(el, ruleset, helpers));
        }
    }
    flush();
    return blocks;
}

export const HtmlPasteExtension = new Extension('html-paste', {
    pasteInterpreters: [
        {
            format: 'text/html',
            priority: 50,
            // A spreadsheet range comes with an image of it next to its table: the table is what was copied.
            outranksFiles: (raw) => /<table[\s>]/i.test(raw),
            /**
             * @param {string} raw
             * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
             * @returns {import('../utils/extensions.js').PasteFragment | null}
             */
            interpret(raw, nabu) {
                try {
                    const doc = new DOMParser().parseFromString(raw, 'text/html');
                    const body = doc.body;
                    if (!body) return null;

                    const ruleset = buildRuleset(nabu);
                    // Set while the implicit paragraph of an inline-only fragment is read: its edge spaces are meaningful.
                    let keepEdges = false;

                    /** @type {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[], parseBlock: (el: Element) => any, parseBlocks: (el: Element) => any[], parseChildren: (el: Element) => any[] }} */
                    const helpers = {
                        parseInline: (el) => parseInline(el, {}, { keepEdges }),
                        parseBlock:  (el) => parseBlock(el, ruleset, helpers),
                        parseBlocks: (el) => parseBlocks(el, ruleset, helpers),
                        parseChildren: (el) => [...el.children].flatMap(child => parseBlocks(child, ruleset, helpers)),
                    };

                    // Inline-only HTML (a part of a line copied from Docs / a browser): ONE inline fragment, merged at the
                    // caret like a plain-text paste, marks kept.
                    const inlineOnly = [...body.childNodes].every((n) => n.nodeType !== Node.ELEMENT_NODE
                        || ['skip', 'inline'].includes(classify(/** @type {Element} */ (n), ruleset)));
                    let blocks;
                    if (inlineOnly) {
                        blocks = parseNodes(body, ruleset, helpers, {
                            onRun: (p) => {
                                // Whitespace-only text directly under <body> is source formatting, not content.
                                const blank = (/** @type {Node | null} */ n) => n?.nodeType === Node.TEXT_NODE && !/\S/.test(n.textContent ?? '');
                                while (blank(p.firstChild)) p.removeChild(/** @type {Node} */ (p.firstChild));
                                while (blank(p.lastChild)) p.removeChild(/** @type {Node} */ (p.lastChild));
                                keepEdges = true;
                                try {
                                    const pb = parseBlock(p, ruleset, helpers);
                                    return pb ? { ...pb, partial: /** @type {const} */ ('both') } : null;
                                } finally { keepEdges = false; }
                            },
                        });
                    } else {
                        blocks = parseNodes(body, ruleset, helpers);
                    }

                    // `external`: the content comes from outside the editor (a web page, Docs…): remote media URLs may be imported.
                    return blocks.length ? { blocks, external: true } : null;
                } catch {
                    return null;
                }
            }
        }
    ]
});
