/**
 * Text forms of a region (ADR 018 §3.7, container model): the helpers shared by the markdown / HTML export (serialize.js)
 * and by the import (the block statics). Pure functions, no runes, no DOM, no engine.
 *
 * MARKDOWN, the opening of a region is the DATA comment, optionally followed by the TITLE as an ATX heading:
 *
 *     <!-- region:chapter {"pov":"Anna"} -->
 *     ## La forêt
 *
 *  - line 1, the DATA comment, is the source of truth for the type and the fields: `region:<type>` then the fields as
 *    minimal JSON (keys sorted, `<` / `>` / `&` and the line separators written as `\uXXXX`, so the JSON can never contain
 *    `-->` or markup). The title is NOT among the fields. RICHTEXT fields are written as inline MARKDOWN strings (a Loro
 *    delta is unreadable) and parsed back with the inline parser: marks and links survive, whitespace at the edge of a mark
 *    does not (the same limits as a paragraph).
 *  - line 2, the heading, IS the title (inline markdown); its level is ignored on import (the type decides). It is
 *    optional: a comment followed by anything else (a blank line, a paragraph) is a region with an EMPTY title. A bare
 *    `##` is an empty heading, also an empty title (written only when the body starts with a heading of its own, which
 *    would otherwise be read as the title).
 *  - the END of a region is not written when it can be deduced: see {@link scanRegion} for the rules, and serialize.js for
 *    when the closing comment `<!-- /region -->` is written.
 *
 * HTML: one element, `<section data-nabu-region="chapter" data-nabu-fields='{…}'><h2>title</h2>…body…</section>`.
 *
 * Only these exact constructs are recognised on the way in. Anything else stays what it was: a heading without the comment
 * is a heading, any other HTML comment is text, a comment with invalid JSON is text, a plain `<h2>` / `<section>` is itself.
 */

import { sanitizeUrl } from '../../utils/html.js';
import { deltaToMarkdown } from '../../behaviors/text/text.behavior.svelte.js';
import { parseMarkdownInline } from '../../paste/markdown-inline.js';
import { fieldSpec } from './types.js';

/**
 * @import { RegionsConfig } from "./types.js";
 */

/** The data comment, whole line: `<!-- region:<type> {json} -->`. The type is percent-encoded when it has other characters. */
const COMMENT_RE = /^<!-- region:([A-Za-z0-9_%-]+) (\{.*\}) -->[ \t]*$/;
/** The title line that may follow it: an ATX heading, possibly empty (`##`). Group 2 is the inline markdown of the title. */
const TITLE_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
/** The closing comment, whole line. */
const CLOSE_RE = /^<!-- \/region -->[ \t]*$/;
/** A fence opening / closing (the same shapes as the toggle's: a comment inside a code block is not a construct). */
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
/** Upper bound of the JSON a marker comment / attribute is allowed to carry (a hand-made payload is not trusted). */
const MAX_JSON = 1_000_000;

/** The heading level of a region level: 1..6 (never an arbitrary value in a tag name). @param {unknown} level @returns {number} */
export function headingLevel(level) {
    const n = Math.trunc(Number(level));
    return n >= 1 && n <= 6 ? n : n > 6 ? 6 : 1;
}

/** Whether a string is a plain object (what a `fields` JSON must be). @param {unknown} v @returns {v is Record<string, any>} */
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} v @returns {v is Array<{ insert: string, attributes?: Record<string, any> }>} */
const isDelta = (v) => Array.isArray(v) && v.every((op) => op && typeof op === 'object' && typeof (/** @type {any} */ (op)).insert === 'string');

/** A region type id as it is written after `region:` (characters outside `[A-Za-z0-9_-]` become `%XX`). @param {string} id @returns {string} */
export function encodeTypeId(id) {
    return id.replace(/[^A-Za-z0-9_-]/gu, (c) => {
        try { return encodeURIComponent(c).replace(/[^%A-Za-z0-9]/g, (x) => '%' + x.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')); } catch { return '_'; }
    });
}

/** @param {string} encoded @returns {string | null} */
function decodeTypeId(encoded) {
    try { return decodeURIComponent(encoded); } catch { return null; }
}

/**
 * Minimal JSON for a comment / attribute: no whitespace, keys sorted at every level, and every character that could end
 * the comment (`>`), open markup (`<`, `&`) or split a line (U+2028 / U+2029) written as a `\uXXXX` escape (still valid JSON).
 * @param {unknown} value
 * @returns {string}
 */
export function safeJson(value) {
    /** @param {any} v @returns {any} */
    const sorted = (v) => Array.isArray(v) ? v.map(sorted) : isPlainObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
    return JSON.stringify(sorted(value)).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * The fields of a marker in their TEXT form: richtext fields (declared as such, held as a Loro delta) become inline
 * markdown strings; everything else is kept; empty richtext fields and `undefined`s are left out (minimal).
 * @param {RegionsConfig} config @param {string} regionType @param {Record<string, any> | undefined} fields
 * @returns {Record<string, any>}
 */
export function fieldsToText(config, regionType, fields) {
    const def = config.types.get(regionType);
    /** @type {Record<string, any>} */
    const out = {};
    for (const [name, value] of Object.entries(fields ?? {})) {
        if (value === undefined) continue;
        if (fieldSpec(def, name)?.kind === 'richtext' && isDelta(value)) {
            const md = deltaToMarkdown(value);
            if (md) out[name] = md;
            continue;
        }
        out[name] = value;
    }
    return out;
}

/** Drops the link marks `sanitizeUrl` refuses (text kept). @param {Array<{ insert: string, attributes?: Record<string, any> }>} delta */
export function sanitizeFieldDelta(delta) {
    return delta.map((op) => {
        const link = op.attributes?.link;
        if (link === undefined || link === null || link === false) return op;
        if (typeof link === 'string' && sanitizeUrl(link, { kind: 'link' }) !== null) return op;
        const { link: _drop, ...attributes } = /** @type {Record<string, any>} */ (op.attributes);
        return Object.keys(attributes).length ? { ...op, attributes } : { insert: op.insert };
    });
}

/**
 * The inverse of {@link fieldsToText}: richtext fields (declared as such, held as a markdown string) are parsed back to a
 * delta; the other values are kept as they are (the block validates the declared ones when it is created: a wrong value is
 * dropped there, with a warning). `__proto__` is never copied.
 * @param {RegionsConfig} config @param {string} regionType @param {Record<string, any>} fields
 * @returns {Record<string, any>}
 */
export function fieldsFromText(config, regionType, fields) {
    const def = config.types.get(regionType);
    /** @type {Record<string, any>} */
    const out = {};
    for (const [name, value] of Object.entries(fields)) {
        if (name === '__proto__') continue;
        if (fieldSpec(def, name)?.kind === 'richtext' && typeof value === 'string') {
            const delta = sanitizeFieldDelta(/** @type {any} */ (parseMarkdownInline(value)));
            if (delta.length) out[name] = delta;
            continue;
        }
        out[name] = value;
    }
    return out;
}

/** The closing comment written when the end of a region cannot be deduced. */
export const CLOSE_COMMENT = '<!-- /region -->';

/** Whether a markdown line is exactly the closing comment. @param {string} line @returns {boolean} */
export const isCloseComment = (line) => CLOSE_RE.test(line);

/**
 * The level a region type has WHEN IT IS READ BACK: its declared level; an undeclared type is read as the default type
 * (see {@link parseRegionComment}). This is the level the end-of-region inference compares.
 * @param {RegionsConfig} config @param {string} regionType @returns {number}
 */
export function levelOfType(config, regionType) {
    return (config.types.get(regionType) ?? config.types.get(config.defaultType))?.level ?? config.maxLevel;
}

/**
 * Reads ONE line as the data comment: `{ regionType, fields }`, or `null` when it is not EXACTLY the construct (wrong shape,
 * invalid JSON, JSON that is not an object): it stays literal text. An undeclared type falls back to the default type (the
 * fields are kept).
 * @param {RegionsConfig} config @param {string | undefined} line
 * @returns {{ regionType: string, fields: Record<string, any> } | null}
 */
export function parseRegionComment(config, line) {
    if (!line || !line.startsWith('<!-- region:')) return null;
    const m = COMMENT_RE.exec(line);
    if (!m || m[2].length > MAX_JSON) return null;
    const id = decodeTypeId(m[1]);
    if (id === null) return null;
    /** @type {unknown} */
    let json;
    try { json = JSON.parse(m[2]); } catch { return null; }
    if (!isPlainObject(json)) return null;
    const regionType = config.types.has(id) ? id : config.defaultType;
    return { regionType, fields: fieldsFromText(config, regionType, json) };
}

/**
 * Index of the line that closes the fence opened on line `at`, or -1 when `at` is not a fence opening. An UNCLOSED fence runs
 * to the end of the text (that is what the code block rule does with it): `lines.length` is returned.
 * @param {string[]} lines @param {number} at
 * @returns {number}
 */
function fenceEnd(lines, at) {
    const open = FENCE_OPEN_RE.exec(lines[at]);
    if (!open) return -1;
    for (let k = at + 1; k < lines.length; k++) {
        const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines[k]);
        if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) return k;
    }
    return lines.length;
}

/**
 * The region that opens on line `at` of `lines`, with its extent (markdown import, paste AND `importMarkdown`):
 *
 *  - the OPENING is the data comment ({@link parseRegionComment}); the line RIGHT AFTER it is the title when it is an ATX
 *    heading (`title` = its inline markdown, `bodyStart` = the line after it), else the title is empty and the body starts
 *    on the line after the comment;
 *  - the END is, whichever comes first (comments inside fenced code are not constructs):
 *      1. its explicit `<!-- /region -->` (consumed with the region). A closing comment closes the INNERMOST region still
 *         open, so the one of a sub-region is not taken for this region's;
 *      2. the next opening comment of a region whose level is <= this region's level (it closes this region and every
 *         sub-region still open; a DEEPER one nests: it starts a sub-region, which the body parse reads in turn);
 *      3. the end of the lines (the end of the enclosing region, which hands its body lines over, or of the document).
 *
 * @param {RegionsConfig} config @param {string[]} lines @param {number} at
 * @returns {{ regionType: string, fields: Record<string, any>, title: string, bodyStart: number, bodyEnd: number, end: number } | null}
 *   `lines.slice(bodyStart, bodyEnd)` is the body; `end` is the first line NOT consumed (after the closing comment, if any).
 */
export function scanRegion(config, lines, at) {
    const opening = parseRegionComment(config, lines[at]);
    if (!opening) return null;
    const level = levelOfType(config, opening.regionType);
    const heading = TITLE_RE.exec(lines[at + 1] ?? '');
    const title = heading?.[2] ?? '';
    const bodyStart = at + (heading ? 2 : 1);
    /** Levels of the sub-regions opened and not closed yet. @type {number[]} */
    const open = [];
    let bodyEnd = lines.length;
    let end = lines.length;
    for (let j = bodyStart; j < lines.length; j++) {
        const line = lines[j];
        const fence = fenceEnd(lines, j);
        if (fence >= 0) { j = fence; continue; }
        if (CLOSE_RE.test(line)) {
            if (open.length) { open.pop(); continue; }
            bodyEnd = j; end = j + 1;
            break;
        }
        const next = parseRegionComment(config, line);
        if (!next) continue;
        const nextLevel = levelOfType(config, next.regionType);
        while (open.length && open[open.length - 1] >= nextLevel) open.pop();
        if (nextLevel <= level) { bodyEnd = end = j; break; }
        open.push(nextLevel);
    }
    return { ...opening, title: title.trim() ? title : '', bodyStart, bodyEnd, end };
}

/**
 * Reads an element carrying `data-nabu-region`: `{ regionType, fields }`, or `null` when the type is not a plausible id.
 * A fields attribute that is missing, too long, not JSON or not an object gives no fields (the region is still a region).
 * An undeclared type falls back to the default type.
 * @param {RegionsConfig} config @param {Element} el
 * @returns {{ regionType: string, fields: Record<string, any> } | null}
 */
export function parseRegionHtml(config, el) {
    const id = el.getAttribute('data-nabu-region')?.trim() ?? '';
    if (!id || id.length > 200) return null;
    const regionType = config.types.has(id) ? id : config.defaultType;
    /** @type {Record<string, any>} */
    let fields = {};
    const raw = el.getAttribute('data-nabu-fields');
    if (raw && raw.length <= MAX_JSON) {
        try {
            const json = JSON.parse(raw);
            if (isPlainObject(json)) fields = fieldsFromText(config, regionType, json);
        } catch { /* invalid JSON: a marker without fields */ }
    }
    return { regionType, fields };
}
