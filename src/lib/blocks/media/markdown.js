/**
 * Markdown syntax of the media blocks: `![alt](ref)` for an image, `[label](ref)` for a video / file. The alt text and the
 * label are escaped like any inline text and the destination is wrapped in `<…>` when it holds spaces or unbalanced
 * parentheses, so that what the importer reads back is the same `alt` / `ref`.
 */

import { markdownDestination } from "../../behaviors/text";
import { escapeMarkdownText } from "../../behaviors/text/markdown-syntax.js";

/**
 * @param {string} alt
 * @param {string} ref
 * @returns {string}
 */
export function markdownImage(alt, ref) {
    return '![' + escapeMarkdownText(alt) + '](' + markdownDestination(ref) + ')';
}

/**
 * @param {string} label
 * @param {string} ref
 * @returns {string}
 */
export function markdownMediaLink(label, ref) {
    return '[' + escapeMarkdownText(label) + '](' + markdownDestination(ref) + ')';
}
