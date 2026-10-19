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
        const rules = BlockClass.markdownRules;
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
                    // Link reference definitions (`[ref]: url`) are collected first and produce no block.
                    const { lines, resolveRef } = extractLinkDefinitions(raw.split(/\r?\n/));
                    const ruleset = buildMarkdownRuleset(nabu);
                    if (!ruleset.length) return null;

                    const inlineOptions = { resolveRef };
                    const helpers = {
                        parseInline: (/** @type {string} */ text) => parseMarkdownInline(text, {}, inlineOptions),
                        parseInlineSegments: (/** @type {string} */ text) => parseMarkdownSegments(text, inlineOptions),
                        joinLines: !!options?.joinLines,
                    };

                    /** @type {import('../utils/extensions.js').PasteBlock[]} */
                    const blocks = [];
                    let i = 0;

                    while (i < lines.length) {
                        // Skip blank lines between blocks
                        if (!lines[i].trim()) { i++; continue; }

                        let matched = false;
                        for (const { BlockClass, rule } of ruleset) {
                            // Normalize detect: regex or function
                            if (rule.detect instanceof RegExp) rule.detect.lastIndex = 0;
                            const detects = rule.detect instanceof RegExp
                                ? rule.detect.test(lines[i])
                                : rule.detect(lines[i], lines, i);

                            if (!detects) continue;

                            const count = rule.consume(lines, i, helpers);
                            const consumed = lines.slice(i, i + count);
                            const pb = BlockClass.fromMarkdown(consumed, helpers, rule);

                            if (pb) {
                                if (Array.isArray(pb)) blocks.push(...pb); // a paragraph split around inline images
                                else blocks.push(pb);
                                i += count;
                                matched = true;
                                break;
                            }
                        }

                        if (!matched) i++; // safety: skip unrecognized line
                    }

                    return blocks.length ? { blocks } : null;
                } catch {
                    return null;
                }
            }
        }
    ]
});
