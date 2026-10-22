/**
 * Text forms of a region marker (ADR 016 §3.6, lot 3): the markdown and HTML a marker is exported as, and the exact
 * constructs that are read back. Pure functions, no runes, no DOM, no engine.
 *
 * MARKDOWN: two lines.
 *
 *     <!-- region:chapter {"title":"La forêt"} -->
 *     ## Chapitre 2 — La forêt
 *
 *  - line 1, the DATA comment, is the source of truth: `region:<type>` then the fields as minimal JSON (keys sorted,
 *    `<` / `>` / `&` and the line separators written as `\uXXXX`, so the JSON can never contain `-->` or markup).
 *    RICHTEXT fields are written as inline MARKDOWN strings (a Loro delta is unreadable) and parsed back with the inline
 *    parser: marks and links survive, whitespace at the edge of a mark does not (the same limits as a paragraph).
 *  - line 2, the readable ECHO, is a heading of level clamp(level, 1, 6) holding the computed label. It is for humans and
 *    other tools: the importer CONSUMES it (it never becomes a heading block) and ignores its text.
 *
 * HTML: one element, `<hN data-nabu-region="chapter" data-nabu-fields='{…}'>label</hN>` (same JSON, same richtext form).
 *
 * Only these exact constructs are recognised on the way in. Anything else stays what it was: a heading without the comment
 * is a heading, any other HTML comment is text, a comment with invalid JSON is text, a plain `<h2>` is a heading.
 */

import { escapeAttr, escapeHtml, sanitizeUrl } from '../../utils/html.js';
import { escapeMarkdownText } from '../../behaviors/text/markdown-syntax.js';
import { deltaToMarkdown } from '../../behaviors/text/text.behavior.svelte.js';
import { parseMarkdownInline } from '../../paste/markdown-inline.js';
import { fieldSpec } from './types.js';

/**
 * @import { RegionsConfig } from "./types.js";
 */

/** The data comment, whole line: `<!-- region:<type> {json} -->`. The type is percent-encoded when it has other characters. */
const COMMENT_RE = /^<!-- region:([A-Za-z0-9_%-]+) (\{.*\}) -->[ \t]*$/;
/** The readable echo that follows it: an ATX heading (the only thing a marker echo can be). */
const ECHO_RE = /^ {0,3}#{1,6}[ \t]+\S/;
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

/**
 * The echo of a marker: the heading level (clamped) and the text (the computed label, or the type id when the label is
 * empty, so that the echo line is never missing and a real heading after a marker is never taken for it).
 * @param {{ label?: unknown, level?: unknown }} echo @param {RegionsConfig} config @param {string} regionType
 * @returns {{ level: number, text: string }}
 */
function echoOf(echo, config, regionType) {
    const def = config.types.get(regionType);
    const level = headingLevel(echo.level ?? def?.level ?? config.maxLevel);
    const label = typeof echo.label === 'string' ? echo.label.replace(/\s+/g, ' ').trim() : '';
    return { level, text: label || regionType };
}

/**
 * A marker as markdown: the data comment, then the readable heading.
 * @param {RegionsConfig} config @param {{ regionType?: string, fields?: Record<string, any> }} props
 * @param {{ label?: unknown, level?: unknown }} [echo]  computed by the registry (`label` / `level`); a fallback is derived without it
 * @returns {string}
 */
export function regionToMarkdown(config, props, echo = {}) {
    const regionType = typeof props.regionType === 'string' && props.regionType ? props.regionType : config.defaultType;
    const { level, text } = echoOf(echo, config, regionType);
    const comment = `<!-- region:${encodeTypeId(regionType)} ${safeJson(fieldsToText(config, regionType, props.fields))} -->`;
    return `${comment}\n${'#'.repeat(level)} ${escapeMarkdownText(text)}`;
}

/**
 * Reads the data comment on line `at`: `{ regionType, fields, length }` where `length` is 1, or 2 when the heading line
 * right after it (the echo) is consumed with it. `null` when the line is not EXACTLY the construct (wrong shape, invalid
 * JSON, JSON that is not an object): it stays literal text.
 * An undeclared type falls back to the default type (the fields are kept).
 * @param {RegionsConfig} config @param {string[]} lines @param {number} at
 * @returns {{ regionType: string, fields: Record<string, any>, length: number } | null}
 */
export function parseRegionMarkdown(config, lines, at) {
    const line = lines[at] ?? '';
    if (!line.startsWith('<!-- region:')) return null;
    const m = COMMENT_RE.exec(line);
    if (!m || m[2].length > MAX_JSON) return null;
    const id = decodeTypeId(m[1]);
    if (id === null) return null;
    /** @type {unknown} */
    let json;
    try { json = JSON.parse(m[2]); } catch { return null; }
    if (!isPlainObject(json)) return null;
    const regionType = config.types.has(id) ? id : config.defaultType;
    return { regionType, fields: fieldsFromText(config, regionType, json), length: ECHO_RE.test(lines[at + 1] ?? '') ? 2 : 1 };
}

/**
 * A marker as HTML: a heading element carrying the data. Everything interpolated is escaped.
 * @param {RegionsConfig} config @param {{ regionType?: string, fields?: Record<string, any> }} props
 * @param {{ label?: unknown, level?: unknown }} [echo]
 * @returns {string}
 */
export function regionToHtml(config, props, echo = {}) {
    const regionType = typeof props.regionType === 'string' && props.regionType ? props.regionType : config.defaultType;
    const { level, text } = echoOf(echo, config, regionType);
    const json = safeJson(fieldsToText(config, regionType, props.fields));
    return `<h${level} data-nabu-region="${escapeAttr(regionType)}" data-nabu-fields='${escapeAttr(json)}'>${escapeHtml(text)}</h${level}>`;
}

/**
 * Reads an element carrying `data-nabu-region`: `{ regionType, fields }`, or `null` when the type is not a plausible id.
 * A fields attribute that is missing, too long, not JSON or not an object gives no fields (the marker is still a marker).
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
