/**
 * Default placeholder text for empty blocks, keyed by block type.
 * Used by block components via the `data-placeholder` attribute,
 * rendered by the global CSS rule in Nabu.svelte.
 *
 * @param {string} type
 * @param {number} [level] - Heading level (1–6)
 * @returns {string}
 */
export function getPlaceholder(type, level = 1) {
    switch (type) {
        case 'paragraph':  return 'Start writing...';
        case 'heading':    return `Heading ${level}`;
        case 'dialogue':   return 'Dialogue...';
        case 'blockquote': return 'Quote...';
        case 'code':       return 'Code…';
        case 'callout':    return 'Callout…';
        case 'toggle':     return 'Toggle…';
        default:           return '';
    }
}
