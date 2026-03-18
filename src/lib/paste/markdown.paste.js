import { Extension } from '../utils/extensions.js';

// ── Inline mark patterns — ordered by specificity (longest patterns first) ───
// Each entry: { re (non-global, used for leftmost-match search), marks }
const INLINE_PATTERNS = [
    { re: /\*\*\*(.+?)\*\*\*/s, marks: { bold: true, italic: true } },
    { re: /\*\*(.+?)\*\*/s,     marks: { bold: true } },
    { re: /\*(.+?)\*/s,         marks: { italic: true } },
    { re: /~~(.+?)~~/s,         marks: { strikethrough: true } },
    { re: /`([^`]+)`/,          marks: { code: true } },
];

/**
 * Parse inline markdown text into a Loro-compatible delta array.
 * Uses a leftmost-match recursive strategy so nested marks work naturally:
 *   **bold *italic* still bold** → [bold, bold+italic, bold]
 *
 * @param {string} text
 * @param {Record<string, true>} [marks]
 * @returns {import('loro-crdt').Delta<string>[]}
 */
export function parseMarkdownInline(text, marks = {}) {
    if (!text) return [];

    // Find the leftmost (earliest index) pattern match across all patterns
    let earliest = /** @type {RegExpExecArray | null} */ (null);
    let earliestMarks = /** @type {Record<string, true>} */ ({});

    for (const pat of INLINE_PATTERNS) {
        const m = pat.re.exec(text);
        if (m && (earliest === null || m.index < earliest.index)) {
            earliest = m;
            earliestMarks = pat.marks;
        }
    }

    if (!earliest) {
        // No marks — emit plain text (with inherited marks)
        return [
            Object.keys(marks).length
                ? { insert: text, attributes: { ...marks } }
                : { insert: text }
        ];
    }

    const ops = /** @type {import('loro-crdt').Delta<string>[]} */ ([]);

    // Plain text before the match
    if (earliest.index > 0) {
        ops.push(...parseMarkdownInline(text.slice(0, earliest.index), marks));
    }

    // The matched span — recurse with merged marks
    ops.push(...parseMarkdownInline(earliest[1], { ...marks, ...earliestMarks }));

    // Text after the match
    const after = text.slice(earliest.index + earliest[0].length);
    if (after) ops.push(...parseMarkdownInline(after, marks));

    return ops;
}

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
             * @returns {import('../utils/extensions.js').PasteFragment | null}
             */
            interpret(raw, nabu) {
                try {
                    const lines = raw.split(/\r?\n/);
                    const ruleset = buildMarkdownRuleset(nabu);
                    if (!ruleset.length) return null;

                    const helpers = { parseInline: parseMarkdownInline };

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

                            const count = rule.consume(lines, i);
                            const consumed = lines.slice(i, i + count);
                            const pb = BlockClass.fromMarkdown(consumed, helpers, rule);

                            if (pb) {
                                blocks.push(pb);
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
