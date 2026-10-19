/**
 * Pasting / importing a GFM pipe table while the editor has no table block (yet): EACH ROW becomes ONE paragraph, its
 * cells separated by a TAB character, the inline markdown of the cells parsed. The header row is a row like the others,
 * the delimiter row (`|---|:--:|`, whose colons only say how a cell is aligned) is dropped, the alignment is lost.
 * The same shape as a pasted HTML table (see table.html.js).
 *
 *  - a table is a header row, a delimiter row with the SAME number of cells, then the rows (a line with a pipe) up to a
 *    blank line or the start of another block; without a delimiter row it is plain text;
 *  - a row with fewer cells is padded with empty ones, extra cells are dropped (GFM); `\|` is a pipe inside a cell;
 *  - a row without any text is dropped.
 *
 * It is registered by the paragraph block as a LOW-PRIORITY markdown rule (see `Paragraph.markdownRules`): a future table
 * block declares its own rule at a higher priority and takes over without anything else to change.
 *
 * @import { PasteBlock } from "../../utils/extensions.js";
 */

const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * The cells of a table row: split on the pipes that are not escaped, the edge pipes dropped, each cell trimmed.
 * @param {string} line
 * @returns {string[]}
 */
export function splitRow(line) {
    let row = line.trim();
    if (row.startsWith('|')) row = row.slice(1);
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
    /** @type {string[]} */
    const cells = [];
    let cell = '';
    for (let i = 0; i < row.length; i++) {
        if (row[i] === '\\' && i + 1 < row.length) { cell += row[i] + row[i + 1]; i++; continue; }
        if (row[i] === '|') { cells.push(cell.trim()); cell = ''; continue; }
        cell += row[i];
    }
    cells.push(cell.trim());
    return cells;
}

/**
 * Whether a table starts at line `i`: a header row with a pipe, then a delimiter row (with a pipe) of the same width.
 * @param {string[]} lines
 * @param {number} i
 * @returns {boolean}
 */
export function isTableStart(lines, i) {
    const header = lines[i];
    const delimiter = lines[i + 1];
    if (header === undefined || delimiter === undefined) return false;
    if (!header.includes('|') || !delimiter.includes('|') || !DELIMITER_ROW.test(delimiter)) return false;
    return splitRow(header).length === splitRow(delimiter).length;
}

/**
 * Number of lines of the table that starts at `i`.
 * @param {string[]} lines
 * @param {number} i
 * @param {{ interrupts?: (lines: string[], k: number) => boolean }} [helpers]
 * @returns {number}
 */
export function tableLength(lines, i, helpers) {
    let j = i + 2;
    while (j < lines.length && lines[j].trim() && lines[j].includes('|') && !helpers?.interrupts?.(lines, j)) j++;
    return j - i;
}

/**
 * @param {string[]} lines  the table lines: header, delimiter, rows
 * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
 * @returns {PasteBlock[] | null}
 */
export function markdownTableToRowParagraphs(lines, { parseInline }) {
    const width = splitRow(lines[0]).length;
    /** @type {PasteBlock[]} */
    const blocks = [];
    for (const line of [lines[0], ...lines.slice(2)]) {
        const cells = splitRow(line).slice(0, width);
        while (cells.length < width) cells.push('');
        /** @type {import('loro-crdt').Delta<string>[]} */
        const delta = [];
        cells.forEach((cell, k) => {
            if (k) delta.push({ insert: '\t' });
            delta.push(...parseInline(cell));
        });
        if (!delta.some((op) => typeof op.insert === 'string' && /\S/.test(op.insert))) continue; // no text in the row
        blocks.push({ type: 'paragraph', delta, partial: false });
    }
    return blocks.length ? blocks : null;
}
