/**
 * Text forms of a region as a CONTAINER (ADR 018 §3.7): the markdown and HTML a region block is exported as, title and
 * body included. Composes the helpers of format.js (data comment, typed fields, safe JSON); pure functions, no runes.
 *
 * MARKDOWN: the data comment, then the title as an ATX heading of the type's level (clamped to 1..6), then the body:
 *
 *     <!-- region:chapter {"pov":"Anna"} -->
 *     ## The ferryman
 *
 *     Opening of the first section.
 *
 *  - an EMPTY title writes the comment alone (the body follows after a blank line); except when the body starts with a
 *    heading of its own, which would be read as the title: then a bare heading (`##`) stands for the empty title;
 *  - the END of a region is deduced when the markdown is read (next opening of the same or a higher level, end of the
 *    enclosing region, end of the document), so the closing comment `<!-- /region -->` is written ONLY when what follows
 *    the region would otherwise be swallowed by it: see {@link closingNeeded}.
 *
 * HTML: `<section data-nabu-region="chapter" data-nabu-fields='{…}'><h2>The ferryman</h2>…body…</section>`; always read back
 * exactly, nothing to infer.
 *
 * @import { RegionsConfig } from "./types.js";
 *
 * @typedef {'end' | 'close' | 'other' | number} Follow
 *   What comes right after a region in the text that is read back: `'end'` nothing (end of the document, or of the parent
 *   when the parent writes no closing comment of its own); `'close'` the closing comment of the parent; `'other'` any
 *   content that is not a region opening; a NUMBER the opening of a region of that level.
 */

import { escapeAttr } from '../../utils/html.js';
import { CLOSE_COMMENT, encodeTypeId, fieldsToText, headingLevel, levelOfType, safeJson } from './format.js';

/** The region type of some props: the given one, else the default type. @param {RegionsConfig} config @param {{ regionType?: string }} props @returns {string} */
function typeOf(config, props) {
    return typeof props.regionType === 'string' && props.regionType ? props.regionType : config.defaultType;
}

/** The heading level of a region type: its level clamped to 1..6 (the deepest declared level for an undeclared type). @param {RegionsConfig} config @param {string} regionType @returns {number} */
export function regionHeadingLevel(config, regionType) {
    return headingLevel(config.types.get(regionType)?.level ?? config.maxLevel);
}

/** The text-form fields: no `title` (it is the header, not data), richtext as inline markdown. @param {RegionsConfig} config @param {string} regionType @param {Record<string, any> | undefined} fields */
function dataFields(config, regionType, fields) {
    const { title: _title, ...rest } = fields ?? {};
    return fieldsToText(config, regionType, rest);
}

/**
 * Whether the closing comment must be written for a region of type `regionType` followed by `follow`: unless nothing follows,
 * or a region of the same or a higher level opens (reading it closes this region), what follows would be read INSIDE the
 * region. A region whose parent closes (`'close'`) is closed too: the parent's closing comment would close it otherwise.
 * @param {RegionsConfig} config @param {string} regionType @param {Follow} follow
 * @returns {boolean}
 */
export function closingNeeded(config, regionType, follow) {
    if (follow === 'end') return false;
    if (typeof follow === 'number') return follow > levelOfType(config, regionType);
    return true;
}

/**
 * What follows a region in the text, from its following siblings (as markdown) and what follows its parent.
 * @param {Iterable<{ region: number } | string>} after  the following siblings, nearest first, read lazily: a region is `{ region: level }`, anything else its markdown
 * @param {Follow} tail  what follows the parent (or the document: `'end'`)
 * @returns {Follow}
 */
export function followOf(after, tail) {
    for (const next of after) {
        if (typeof next === 'string') { if (next) return 'other'; continue; }
        return next.region;
    }
    return tail;
}

/** The type of some props: the given one, else the default type. @param {RegionsConfig} config @param {{ regionType?: string }} props @returns {string} */
export function regionTypeOf(config, props) {
    return typeOf(config, props);
}

/**
 * A region as markdown.
 * @param {RegionsConfig} config
 * @param {{ regionType?: string, fields?: Record<string, any> }} props
 * @param {string} titleMarkdown  the title as inline markdown
 * @param {string[]} body  the markdown of each body block
 * @param {{ close?: boolean }} [options]  `close`: write the closing comment (see {@link closingNeeded})
 * @returns {string}
 */
export function regionBlockToMarkdown(config, props, titleMarkdown, body, { close = false } = {}) {
    const regionType = typeOf(config, props);
    const comment = `<!-- region:${encodeTypeId(regionType)} ${safeJson(dataFields(config, regionType, props.fields))} -->`;
    const hashes = '#'.repeat(regionHeadingLevel(config, regionType));
    const blocks = body.filter(Boolean);
    // An empty title is the comment alone, unless the body opens with a heading (it would be read as the title).
    const heading = titleMarkdown ? `${hashes} ${titleMarkdown}` : /^ {0,3}#{1,6}(?:[ \t]|$)/.test(blocks[0] ?? '') ? hashes : '';
    return [heading ? `${comment}\n${heading}` : comment, ...blocks, ...(close ? [CLOSE_COMMENT] : [])].join('\n\n');
}

/**
 * A region as HTML.
 * @param {RegionsConfig} config
 * @param {{ regionType?: string, fields?: Record<string, any> }} props
 * @param {string} titleHtml  the title as inline HTML (already escaped)
 * @param {string[]} body  the HTML of each body block
 * @returns {string}
 */
export function regionBlockToHtml(config, props, titleHtml, body) {
    const regionType = typeOf(config, props);
    const level = regionHeadingLevel(config, regionType);
    const json = safeJson(dataFields(config, regionType, props.fields));
    return `<section data-nabu-region="${escapeAttr(regionType)}" data-nabu-fields='${escapeAttr(json)}'><h${level}>${titleHtml}</h${level}>${body.join('')}</section>`;
}
