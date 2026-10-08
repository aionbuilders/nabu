/**
 * Placeholders — hint text displayed in empty blocks.
 *
 * Defaults are declared by each block class (`static placeholder`), the editor
 * option `placeholders` (see {@link PlaceholdersOption}) switches them on/off,
 * chooses when they show, and overrides them per block type. The resolved value
 * is exposed reactively as `block.placeholder` and rendered by a CSS rule in
 * Nabu.svelte through the `data-placeholder` attribute.
 */

/**
 * @typedef {string | false | ((block: any) => string | false)} PlaceholderText
 * A string, `false` (no placeholder) or a function of the block returning one of those.
 */

/**
 * @typedef {Object} PlaceholdersConfig
 * @property {'focus' | 'empty'} [show] - `'focus'` (default): only the empty block holding the collapsed cursor
 *   shows its placeholder. `'empty'`: every empty block shows it.
 * @property {Record<string, PlaceholderText>} [text] - Per block type overrides (`false` disables that type).
 */

/**
 * `false`: no placeholders. `true` / omitted: defaults. Object: see {@link PlaceholdersConfig}.
 * @typedef {boolean | PlaceholdersConfig} PlaceholdersOption
 */

/**
 * @typedef {Object} ResolvedPlaceholders
 * @property {boolean} enabled
 * @property {'focus' | 'empty'} show
 * @property {Record<string, PlaceholderText>} text
 */

/**
 * Normalizes the `placeholders` editor option.
 * @param {PlaceholdersOption} [option]
 * @returns {ResolvedPlaceholders}
 */
export function normalizePlaceholders(option = true) {
    if (option === false) return { enabled: false, show: 'focus', text: {} };
    const config = option && typeof option === 'object' ? option : {};
    return {
        enabled: true,
        show: config.show === 'empty' ? 'empty' : 'focus',
        text: config.text ?? {},
    };
}

/**
 * Resolves the placeholder text of a block: the per-type override from the
 * editor option if any, else the block class default (`static placeholder`).
 * Returns '' when there is nothing to show (no default, or disabled with `false`).
 * It does not look at emptiness / focus — that is `block.placeholder`'s job.
 *
 * @param {{ type: string, constructor: { placeholder?: PlaceholderText } }} block
 * @param {Record<string, PlaceholderText>} [overrides]
 * @returns {string}
 */
export function resolvePlaceholderText(block, overrides = {}) {
    const override = overrides[block.type];
    /** @type {PlaceholderText | undefined} */
    let value = override !== undefined ? override : block.constructor.placeholder;
    if (typeof value === 'function') value = value(block);
    return typeof value === 'string' ? value : '';
}

/**
 * Built-in default placeholder text, keyed by block type.
 *
 * @deprecated Kept for backward compatibility only. It ignores the editor
 * `placeholders` option and custom block types; blocks now declare their own
 * default through `static placeholder` and expose the resolved value as
 * `block.placeholder`.
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
