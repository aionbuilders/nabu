/**
 * A Loro text delta as HTML or markdown. Pure functions: no Loro, no Svelte, no DOM, so the integrator's read-only pages and
 * servers reach them through `@aionbuilders/nabu/format` without loading the WebAssembly (see `src/lib/format.js`).
 * `text.behavior.svelte.js` re-exports them: the editor and the main entry keep their old import path.
 */

import { escapeHtml, escapeAttr, sanitizeUrl } from "../../utils/html.js";
import { escapeMarkdownText, escapeBlockStart } from "./markdown-syntax.js";

/**
 * Converts a Loro text delta to inline HTML.
 * Marks are rendered as semantic HTML tags.
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @returns {string}
 */
export function deltaToHtml(delta) {
    return delta.map(op => {
        if (typeof op.insert !== 'string') return '';
        let text = escapeHtml(op.insert);
        const attrs = op.attributes || {};
        if (attrs.code)          text = `<code>${text}</code>`;
        if (attrs.bold)          text = `<strong>${text}</strong>`;
        if (attrs.italic)        text = `<em>${text}</em>`;
        if (attrs.underline)     text = `<u>${text}</u>`;
        if (attrs.strikethrough) text = `<s>${text}</s>`;
        if (attrs.link) {
            // An unsafe href (javascript:, data:…) never becomes a live link: the label survives, the <a> does not.
            const href = sanitizeUrl(attrs.link, { kind: 'link' });
            if (href !== null) text = `<a href="${escapeAttr(href)}">${text}</a>`;
        }
        return text;
    }).join('');
}

/**
 * Converts a Loro text delta to inline Markdown.
 * A line break (`\n` in the text) is exported as a markdown hard break (backslash + newline), unless `rawBreaks`
 * (a block that re-reads its own lines, like a callout body, keeps the plain newline).
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @param {{ rawBreaks?: boolean }} [options]
 * @returns {string}
 */
export function deltaToMarkdown(delta, { rawBreaks = false } = {}) {
    const ops = delta.filter((op) => typeof op.insert === 'string' && op.insert);
    let out = '';
    for (let i = 0; i < ops.length;) {
        const link = ops[i].attributes?.link;
        let j = i + 1;
        while (j < ops.length && ops[j].attributes?.link === link) j++;
        const run = markdownRuns(ops.slice(i, j), rawBreaks); // same href (or none): ONE `[…](href)`, marks inside
        out += link ? `[${run}](${markdownDestination(String(link))})` : run;
        i = j;
    }
    return escapeBlockStart(out);
}

/** Mark delimiters, outermost first (nesting order). Code is not here: a code span takes no other mark. */
const MARK_DELIMITERS = /** @type {const} */ ([
    ['underline', '<u>', '</u>'],
    ['strikethrough', '~~', '~~'],
    ['bold', '**', '**'],
    ['italic', '*', '*'],
]);

/**
 * Runs of text (no link boundary inside) as markdown. A mark spanning several runs is ONE delimiter pair
 * (`**a *b* c**`); whitespace at the edge of a span moves outside the delimiters (`**a **` would not parse).
 * @param {any[]} ops
 * @param {boolean} rawBreaks
 * @returns {string}
 */
function markdownRuns(ops, rawBreaks) {
    /** @type {Array<{ text?: string, raw?: boolean, open?: string, close?: string }>} */
    let tokens = [];
    /** @type {number[]} */
    let active = [];
    const closeFrom = (/** @type {number} */ k) => {
        for (let j = active.length - 1; j >= k; j--) tokens.push({ close: MARK_DELIMITERS[active[j]][2] });
        active = active.slice(0, k);
    };
    for (const op of ops) {
        const attrs = op.attributes || {};
        if (attrs.code) { closeFrom(0); tokens.push({ text: markdownCodeSpan(op.insert), raw: true }); continue; }
        const want = MARK_DELIMITERS.map((m, idx) => (attrs[m[0]] ? idx : -1)).filter((idx) => idx >= 0);
        let k = 0;
        while (k < active.length && k < want.length && active[k] === want[k]) k++;
        closeFrom(k);
        for (let j = k; j < want.length; j++) tokens.push({ open: MARK_DELIMITERS[want[j]][1] });
        active = want;
        tokens.push({ text: op.insert });
    }
    closeFrom(0);

    // Whitespace at the inner edge of a delimiter run moves outside it.
    for (let t = 0; t < tokens.length; t++) {
        if (tokens[t].open !== undefined && tokens[t - 1]?.open === undefined) {
            let j = t;
            while (tokens[j + 1]?.open !== undefined) j++;
            const next = tokens[j + 1];
            const m = next && next.text !== undefined && !next.raw ? /^\s+/.exec(next.text) : null;
            if (next && m) { next.text = /** @type {string} */ (next.text).slice(m[0].length); tokens.splice(t, 0, { text: m[0] }); t += 1; }
        } else if (tokens[t].close !== undefined && tokens[t - 1]?.close === undefined) {
            let j = t;
            while (tokens[j + 1]?.close !== undefined) j++;
            const prev = tokens[t - 1];
            const m = prev && prev.text !== undefined && !prev.raw ? /\s+$/.exec(prev.text) : null;
            if (prev && m) { prev.text = /** @type {string} */ (prev.text).slice(0, -m[0].length); tokens.splice(j + 1, 0, { text: m[0] }); }
        }
    }
    // Drop the delimiter pairs left empty.
    tokens = tokens.filter((tk) => tk.text !== '');
    for (let t = 0; t < tokens.length - 1;) {
        if (tokens[t].open !== undefined && tokens[t + 1].close !== undefined) { tokens.splice(t, 2); t = Math.max(0, t - 1); } else t++;
    }
    return tokens.map((tk) => tk.open ?? tk.close ?? (tk.raw ? tk.text : escapeMarkdownText(/** @type {string} */ (tk.text)).replace(/\n/g, rawBreaks ? '\n' : '\\\n'))).join('');
}

/** A code span: a backtick fence longer than any run inside, padded when the text touches a backtick or is space-wrapped. */
function markdownCodeSpan(/** @type {string} */ text) {
    const runs = new Set((text.match(/`+/g) || []).map((r) => r.length));
    let n = 1;
    while (runs.has(n)) n++;
    const fence = '`'.repeat(n);
    const pad = /^`|`$/.test(text) || (text.startsWith(' ') && text.endsWith(' ') && text.trim()) ? ' ' : '';
    return fence + pad + text + pad + fence;
}

/** A link destination: raw when plain, `<…>` when it holds whitespace, angle brackets or unbalanced parentheses. */
export function markdownDestination(/** @type {string} */ href) {
    let depth = 0;
    let balanced = true;
    for (const ch of href) {
        if (ch === '(') depth++;
        else if (ch === ')' && --depth < 0) balanced = false;
    }
    if (!href || depth !== 0 || !balanced || /[\s<>\u0000-\u001f]/.test(href)) return '<' + href.replace(/[<>\\]/g, (m) => '\\' + m) + '>';
    return href.replace(/\\/g, '\\\\');
}
