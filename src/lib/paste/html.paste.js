import { Extension } from '../utils/extensions.js';

// ── Inline mark mapping: HTML tag → Nabu mark name ──────────────────────────
const MARK_TAGS = {
    strong: 'bold', b: 'bold',
    em: 'italic', i: 'italic',
    u: 'underline',
    code: 'code',
    s: 'strikethrough', del: 'strikethrough', strike: 'strikethrough',
};

// ── Tags to skip entirely when parsing inline content ────────────────────────
// These represent structural/block elements that create new blocks, not inline marks.
// ul/ol/li are handled as children by their parent block's fromHTML.
const SKIP_IN_INLINE = new Set([
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'script', 'style', 'noscript', 'iframe',
]);

// ── Tags treated as transparent containers: flattened at the top level ───────
// A div/section containing block children is not itself a block — expand it.
const TRANSPARENT_CONTAINERS = new Set([
    'div', 'section', 'article', 'main', 'header', 'footer',
    'aside', 'nav', 'form', 'figure', 'figcaption', 'details', 'summary',
]);

/**
 * Returns true if any direct child of el is a structural block element.
 * Used to decide whether a transparent container should be flattened.
 * Derives block detection from the registered ruleset — no hardcoded block types.
 * @param {Element} el
 * @param {Array<{ rule: { selector: string } }>} ruleset
 * @returns {boolean}
 */
function hasBlockChildren(el, ruleset) {
    for (const child of el.children) {
        const tag = child.tagName.toLowerCase();
        if (SKIP_IN_INLINE.has(tag) || TRANSPARENT_CONTAINERS.has(tag)) return true;
        for (const { rule } of ruleset) {
            try { if (child.matches(rule.selector)) return true; } catch { continue; }
        }
    }
    return false;
}

/**
 * Parse the inline content of a DOM element into a Loro-compatible delta array.
 * Recurses into inline and unknown elements, inheriting marks.
 * Skips block-level children (ul, ol, table…) — those are handled by fromHTML.
 *
 * @param {Element} el
 * @param {Record<string, true>} [marks]
 * @returns {import('loro-crdt').Delta<string>[]}
 */
export function parseInline(el, marks = {}) {
    /** @type {import('loro-crdt').Delta<string>[]} */
    const ops = [];
    for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent;
            if (text) {
                ops.push(
                    Object.keys(marks).length
                        ? { insert: text, attributes: { ...marks } }
                        : { insert: text }
                );
            }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const el2 = /** @type {Element} */ (child);
            const tag = el2.tagName.toLowerCase();
            if (tag === 'br') { ops.push({ insert: '\n' }); continue; }
            if (SKIP_IN_INLINE.has(tag)) continue;
            const markName = MARK_TAGS[tag];
            const styleMarks = { ...marks };
            if (markName) styleMarks[markName] = true;
            // Detect marks from inline styles (e.g. Google Docs uses font-weight:700 on <span>)
            if (el2.nodeType === Node.ELEMENT_NODE) {
                const style = /** @type {HTMLElement} */ (el2).style;
                if (style) {
                    const fw = style.fontWeight;
                    if (fw === 'bold' || fw === '700' || fw === '800' || fw === '900') styleMarks['bold'] = true;
                    if (style.fontStyle === 'italic') styleMarks['italic'] = true;
                    if (style.textDecoration?.includes('underline')) styleMarks['underline'] = true;
                    if (style.textDecoration?.includes('line-through')) styleMarks['strikethrough'] = true;
                }
            }
            ops.push(...parseInline(el2, styleMarks));
        }
    }
    return ops;
}

/**
 * Build the ordered ruleset from all BlockClasses registered in nabu.
 * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
 * @returns {Array<{ BlockClass: any, rule: { selector: string, props?: Record<string,any> } }>}
 */
function buildRuleset(nabu) {
    /** @type {Array<{ BlockClass: any, rule: any }>} */
    const ruleset = [];
    for (const [, BlockClass] of nabu.registry) {
        const rules = BlockClass.htmlRules;
        if (!Array.isArray(rules)) continue;
        for (const rule of rules) ruleset.push({ BlockClass, rule });
    }
    return ruleset;
}

/**
 * Match a DOM element against the registered ruleset and call the matching
 * block class's static fromHTML(). Falls back to a plain paragraph if nothing
 * matches but the element has text content.
 *
 * @param {Element} el
 * @param {Array} ruleset
 * @param {Object} helpers
 * @returns {import('../utils/extensions.js').PasteBlock | null}
 */
function parseBlock(el, ruleset, helpers) {
    if (el.nodeType !== Node.ELEMENT_NODE) return null;
    for (const { BlockClass, rule } of ruleset) {
        try { if (!el.matches(rule.selector)) continue; } catch { continue; }
        if (rule.filter && !rule.filter(el)) continue;
        return BlockClass.fromHTML(el, helpers, rule);
    }
    return null;
}

/**
 * Parse a top-level element, flattening transparent containers.
 * Returns an array because one DOM element may expand into multiple PasteBlocks.
 *
 * @param {Element} el
 * @param {Array} ruleset
 * @param {Object} helpers
 * @returns {import('../utils/extensions.js').PasteBlock[]}
 */
function parseTopLevel(el, ruleset, helpers) {
    if (el.nodeType !== Node.ELEMENT_NODE) return [];
    const tag = el.tagName.toLowerCase();
    if (TRANSPARENT_CONTAINERS.has(tag) && hasBlockChildren(el, ruleset)) {
        return [...el.children].flatMap(child => parseTopLevel(child, ruleset, helpers));
    }
    const pb = parseBlock(el, ruleset, helpers);
    if (pb) return [pb];
    // Unknown element with block children: treat as transparent.
    // Handles Google Docs' <b style="font-weight:normal"> wrapper and similar quirks.
    if (hasBlockChildren(el, ruleset)) {
        return [...el.children].flatMap(child => parseTopLevel(child, ruleset, helpers));
    }
    return [];
}

export const HtmlPasteExtension = new Extension('html-paste', {
    pasteInterpreters: [
        {
            format: 'text/html',
            priority: 50,
            /**
             * @param {string} raw
             * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
             * @returns {import('../utils/extensions.js').PasteFragment | null}
             */
            interpret(raw, nabu) {
                try {
                    const doc = new DOMParser().parseFromString(raw, 'text/html');
                    const body = doc.body;
                    if (!body) return null;

                    const ruleset = buildRuleset(nabu);

                    /** @type {{ parseInline: typeof parseInline, parseBlock: (el: Element) => any, parseChildren: (el: Element) => any[] }} */
                    const helpers = {
                        parseInline: (el) => parseInline(el),
                        parseBlock:  (el) => parseBlock(el, ruleset, helpers),
                        parseChildren: (el) => [...el.children]
                            .map(child => parseBlock(child, ruleset, helpers))
                            .filter(Boolean),
                    };

                    const blocks = [...body.children]
                        .flatMap(el => parseTopLevel(el, ruleset, helpers));

                    return blocks.length ? { blocks } : null;
                } catch {
                    return null;
                }
            }
        }
    ]
});
