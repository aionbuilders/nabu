import { Extension } from '../utils/extensions.js';
import { parseMarkdownInline, parseMarkdownSegments, extractLinkDefinitions } from './markdown-inline.js';

export { parseMarkdownInline, parseMarkdownSegments } from './markdown-inline.js';

/**
 * Build the ordered markdown ruleset from all BlockClasses registered in nabu.
 * Sorted by priority descending (highest priority = tried first).
 *
 * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
 * @returns {Array<{ BlockClass: any, rule: any }>}
 */
function buildMarkdownRuleset(nabu) {
    /** @type {Array<{ BlockClass: any, rule: any }>} */
    const ruleset = [];
    for (const [, BlockClass] of nabu.registry) {
        const rules = /** @type {{ markdownRules?: unknown }} */ (BlockClass).markdownRules;
        if (!Array.isArray(rules)) continue;
        for (const rule of rules) ruleset.push({ BlockClass, rule });
    }
    ruleset.sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0));
    return ruleset;
}

export const MarkdownPasteExtension = new Extension('markdown-paste', {
    pasteInterpreters: [
        {
            format: 'text/plain',
            priority: 25,
            /**
             * @param {string} raw
             * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
             * @param {import('../utils/extensions.js').PasteInterpretOptions} [options]
             * @returns {import('../utils/extensions.js').PasteFragment | null}
             */
            interpret(raw, nabu, options) {
                try {
                    // BOM stripped, CRLF / CR normalised to LF. Link reference definitions (`[ref]: url`) are collected
                    // first and produce no block.
                    const { lines, resolveRef } = extractLinkDefinitions(raw.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/));
                    const ruleset = buildMarkdownRuleset(nabu);
                    if (!ruleset.length) return null;

                    const inlineOptions = { resolveRef };
                    const joinLines = !!options?.joinLines;
                    // The rules that start a block in the middle of a paragraph (CommonMark): a fence, a heading, a quote, a list…
                    const interrupters = ruleset.filter(({ rule }) => rule.interruptsParagraph);

                    /**
                     * The helpers a rule receives. `overrides` change the parsing mode for a nested parse (`parseBlocks`).
                     * @param {{ joinLines?: boolean, softBreak?: string }} overrides
                     * @returns {any}
                     */
                    const makeHelpers = (overrides) => {
                        /** @type {any} */
                        const helpers = {
                            parseInline: (/** @type {string} */ text) => parseMarkdownInline(text, {}, inlineOptions),
                            parseInlineSegments: (/** @type {string} */ text) => parseMarkdownSegments(text, inlineOptions),
                            joinLines,
                            ...overrides,
                        };
                        // Does line `k` start a block that ends the paragraph above it?
                        helpers.interrupts = (/** @type {string[]} */ ls, /** @type {number} */ k) => interrupters.some(({ rule }) =>
                            rule.interruptsParagraph === true ? detects(rule, ls, k, helpers) : rule.interruptsParagraph(ls[k], ls, k, helpers));
                        // Parse lines as a document of their own (the content of a quote…).
                        helpers.parseBlocks = (/** @type {string[]} */ ls, /** @type {object} */ over = {}) => parseBlocks(ls, makeHelpers({ ...overrides, ...over }));
                        return helpers;
                    };

                    /** @returns {boolean} */
                    const detects = (/** @type {any} */ rule, /** @type {string[]} */ ls, /** @type {number} */ k, /** @type {any} */ helpers) => {
                        // Normalize detect: regex or function
                        if (rule.detect instanceof RegExp) { rule.detect.lastIndex = 0; return rule.detect.test(ls[k]); }
                        return !!rule.detect(ls[k], ls, k, helpers);
                    };

                    /**
                     * @param {string[]} ls
                     * @param {any} helpers
                     * @returns {import('../utils/extensions.js').PasteBlock[]}
                     */
                    const parseBlocks = (ls, helpers) => {
                        /** @type {import('../utils/extensions.js').PasteBlock[]} */
                        const blocks = [];
                        let i = 0;

                        while (i < ls.length) {
                            // Skip blank lines between blocks
                            if (!ls[i].trim()) { i++; continue; }

                            let matched = false;
                            for (const { BlockClass, rule } of ruleset) {
                                if (!detects(rule, ls, i, helpers)) continue;

                                const count = Math.max(1, rule.consume(ls, i, helpers));
                                const consumed = ls.slice(i, i + count);
                                const pb = BlockClass.fromMarkdown(consumed, helpers, rule);

                                if (pb) {
                                    if (Array.isArray(pb)) blocks.push(...pb); // a paragraph split around inline images, a table, several lists
                                    else blocks.push(pb);
                                    i += count;
                                    matched = true;
                                    break;
                                }
                            }

                            if (!matched) i++; // safety: skip unrecognized line
                        }
                        return blocks;
                    };

                    const blocks = parseBlocks(lines, makeHelpers({}));
                    return blocks.length ? { blocks } : null;
                } catch {
                    return null;
                }
            }
        }
    ]
});
