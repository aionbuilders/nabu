/**
 * Pasting an HTML `<table>` while the editor has no table block (yet): EACH ROW becomes ONE paragraph, its cells
 * separated by a TAB character. The same lines a spreadsheet puts in `text/plain` (TSV), with the inline marks of the cells
 * kept.
 *
 *  - blocks nested in a cell (paragraphs, lists, another table…) are flattened to text, joined with spaces;
 *  - a header row is a row like the others; a `colspan` adds the empty cells it covers (the columns stay aligned);
 *  - a row without any text is dropped; a `<caption>` is a paragraph of its own, before the rows.
 *
 * It is registered by the paragraph block as a LOW-PRIORITY html rule (see `Paragraph.htmlRules`): a future table block
 * declares its own rule for `table` at a higher priority and takes over without anything else to change.
 *
 * @import { PasteBlock } from "../../utils/extensions.js";
 */

/** Elements of a cell that carry structure the paragraph cannot hold: replaced by their content, then a space. */
const NESTED_STRUCTURE = 'table, thead, tbody, tfoot, tr, td, th, caption, ul, ol, li, dl, dt, dd';
/** Largest `colspan` honoured (a hostile value must not allocate a huge row). */
const MAX_COLSPAN = 50;

/**
 * A cell with its nested structure unwrapped: nested tables / lists become spans of text followed by a space. The result is
 * a detached `<div>` holding a `<span>` that carries the cell's own style (a `font-weight:bold` on a `<td>` bolds its text):
 * `parseInline` reads the children of the element it is given, not the element itself.
 * @param {Element} cell
 * @returns {Element}
 */
function flattenCell(cell) {
    const doc = cell.ownerDocument;
    const copy = /** @type {Element} */ (cell.cloneNode(true));
    // Document order lists an element before its descendants: walk it backwards so inner elements go first.
    for (const nested of [...copy.querySelectorAll(NESTED_STRUCTURE)].reverse()) {
        const span = doc.createElement('span');
        while (nested.firstChild) span.appendChild(nested.firstChild);
        span.appendChild(doc.createTextNode(' '));
        nested.replaceWith(span);
    }
    const root = doc.createElement('div');
    const own = doc.createElement('span');
    const style = cell.getAttribute('style');
    if (style) own.setAttribute('style', style);
    while (copy.firstChild) own.appendChild(copy.firstChild);
    root.appendChild(own);
    return root;
}

/**
 * The delta of a cell on ONE line: line breaks (`<br>`, block boundaries) become spaces, runs of spaces collapse, the ends
 * are trimmed. Marks are kept.
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @returns {import('loro-crdt').Delta<string>[]}
 */
function oneLine(delta) {
    /** @type {import('loro-crdt').Delta<string>[]} */
    const out = [];
    for (const op of delta) {
        if (typeof op.insert !== 'string') continue;
        const text = op.insert.replace(/[\r\n\t]+/g, ' ');
        out.push(op.attributes ? { insert: text, attributes: op.attributes } : { insert: text });
    }
    // collapse spaces across op boundaries, then trim both ends
    let previousSpace = true; // a leading space is dropped
    for (const op of out) {
        let collapsed = '';
        for (const ch of /** @type {string} */ (op.insert)) {
            const space = ch === ' ';
            if (space && previousSpace) continue;
            collapsed += ch;
            previousSpace = space;
        }
        op.insert = collapsed;
    }
    for (let i = out.length - 1; i >= 0; i--) {
        out[i].insert = /** @type {string} */ (out[i].insert).replace(/ +$/, '');
        if (out[i].insert) break;
    }
    return out.filter((op) => op.insert);
}

/**
 * @param {Element} table
 * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
 * @returns {PasteBlock[]}
 */
export function tableToRowParagraphs(table, { parseInline }) {
    /** @type {PasteBlock[]} */
    const blocks = [];
    const caption = [...table.children].find((c) => c.localName === 'caption');
    if (caption) {
        const delta = oneLine(parseInline(flattenCell(caption)));
        if (delta.length) blocks.push({ type: 'paragraph', delta, partial: false });
    }
    // Rows of THIS table: its own rows (in a section or not), never those of a table nested in a cell.
    const rows = [...table.querySelectorAll('tr')].filter((tr) => tr.closest('table') === table);
    for (const tr of rows) {
        /** @type {import('loro-crdt').Delta<string>[]} */
        const delta = [];
        let cells = 0;
        for (const cell of tr.children) {
            const tag = cell.tagName.toLowerCase();
            if (tag !== 'td' && tag !== 'th') continue;
            if (cells++) delta.push({ insert: '\t' });
            delta.push(...oneLine(parseInline(flattenCell(cell))));
            const span = Math.min(MAX_COLSPAN, Math.max(1, parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1));
            for (let i = 1; i < span; i++) { delta.push({ insert: '\t' }); cells++; }
        }
        if (!delta.some((op) => typeof op.insert === 'string' && /\S/.test(op.insert))) continue; // no text in the row
        blocks.push({ type: 'paragraph', delta, partial: false });
    }
    return blocks;
}
