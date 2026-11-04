/**
 * @module @aionbuilders/nabu/format
 *
 * Reading a document without the editor: turn the `serialize('json')` export (or a Loro-style delta) into HTML, markdown or
 * plain text. Pure JavaScript: nothing here imports Loro, Svelte or the DOM, so a read-only page or a server loads this entry
 * without the WebAssembly (importing the same names from `@aionbuilders/nabu` does load it), and plain Node and Bun can import it.
 * The import graph of this file is pinned by `tests/unit/format.test.js`.
 *
 * @example
 * import { jsonToText, deltaToHtml } from '@aionbuilders/nabu/format';
 */

export { deltaToHtml, deltaToMarkdown } from './behaviors/text/delta-format.js';
export { sanitizeUrl, escapeHtml } from './utils/html.js';
export { JSON_FORMAT_VERSION, isSupportedJsonVersion } from './utils/extensions.js';

/** The text of a block's `content`: a plain string (code), or the `text` of its runs. Marks are ignored. @param {unknown} content */
function contentText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((run) => (typeof run?.text === 'string' ? run.text : '')).join('');
}

/** @param {any} blocks @returns {string[]} the non-empty texts of `blocks` */
function textsOf(blocks) {
    return (Array.isArray(blocks) ? blocks : []).map(blockText).filter((text) => text !== '');
}

/**
 * One block: its own text, then its children's, in order. A list and a list item join with a single newline, anything else
 * with a blank line.
 * @param {any} block
 * @returns {string}
 */
function blockText(block) {
    if (!block || typeof block !== 'object') return '';
    const parts = [contentText(block.content), ...textsOf(block.children)].filter((text) => text !== '');
    return parts.join(block.type === 'list' || block.type === 'list-item' ? '\n' : '\n\n');
}

/**
 * The plain text of a document: what a person typed, without markup. Takes a `serialize('json')` export, or its `blocks`
 * array, and is what `serialize('text')` computes, so the browser and a server working from the same JSON get the identical string.
 *
 * The rule:
 * - A block's text is its characters as typed: no escaping, no markup, marks and links ignored, a line break inside the block
 *   kept as `\n`. Nothing is trimmed.
 * - Blocks are separated by a blank line (`\n\n`). The items of a list and their nested items are separated by a single `\n`,
 *   with no bullet or number.
 * - A block without text (divider, image, video, file) and an empty block contribute nothing, so no blank lines pile up.
 * - A container (toggle, callout, region...) gives its own text (a region: its title), then its children's, in order.
 * - It reads the `content` of any block, so a block from an extension is covered without registering anything.
 *
 * To keep proof of what a person wrote, store the string you received: do not recompute it later with a newer version of the library.
 * @param {{ blocks?: any[] } | any[]} json a `serialize('json')` export or its `blocks`
 * @returns {string}
 */
export function jsonToText(json) {
    return textsOf(Array.isArray(json) ? json : json?.blocks).join('\n\n');
}
