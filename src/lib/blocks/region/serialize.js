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
 * HTML: `<section data-nabu-region="chapter" data-nabu-fields='{…}'><h2>The ferryman</h2>…body…</section>`.
 *
 * TODO(ADR-018 lot C): the reading side (markdown / HTML import, end-of-region inference) is not written yet: these
 * forms are export-only for now, and the import rules of the block are disabled.
 *
 * @import { RegionsConfig } from "./types.js";
 */

import { escapeAttr } from '../../utils/html.js';
import { encodeTypeId, fieldsToText, headingLevel, safeJson } from './format.js';

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
 * A region as markdown.
 * @param {RegionsConfig} config
 * @param {{ regionType?: string, fields?: Record<string, any> }} props
 * @param {string} titleMarkdown  the title as inline markdown
 * @param {string[]} body  the markdown of each body block
 * @returns {string}
 */
export function regionBlockToMarkdown(config, props, titleMarkdown, body) {
    const regionType = typeOf(config, props);
    const comment = `<!-- region:${encodeTypeId(regionType)} ${safeJson(dataFields(config, regionType, props.fields))} -->`;
    const hashes = '#'.repeat(regionHeadingLevel(config, regionType));
    const heading = titleMarkdown ? `${hashes} ${titleMarkdown}` : hashes;
    return [`${comment}\n${heading}`, ...body.filter(Boolean)].join('\n\n');
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
