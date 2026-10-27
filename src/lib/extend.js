/**
 * @module @aionbuilders/nabu/extend
 *
 * Writing your own blocks and extensions: the `extension()` factory, the block base classes, the text behavior and the
 * helpers a block needs (keyboard chords, HTML escaping). Mount-time pieces (editor, presets, built-in extensions) are in
 * `@aionbuilders/nabu`.
 *
 * Stability (audit P-119): the members of `Nabu`, `Block`, `TextBlock`, `MegaBlock`, `TextBehavior`, the selection and the
 * command registry tagged `@public` in their JSDoc are the stable contract of a third-party block or extension (pinned by
 * `tests/unit/extend-contract.test.js`). `nabu.internals` exposes the rest of the machinery and is UNSTABLE: it may change in
 * any minor version. See `docs/guides/extensions.md`, "Stability".
 *
 * @example
 * import { extension, TextBlock, TextBehavior, RichText } from '@aionbuilders/nabu/extend';
 */

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

export { extension, Extension } from './utils/extensions.js';

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export { Block } from './blocks/block.svelte.js';
export { TextBlock } from './blocks/text-block.svelte.js';
export { MegaBlock } from './blocks/megablock.svelte.js';
export { default as BlockComponent } from './blocks/Block.svelte';

// ---------------------------------------------------------------------------
// Text behavior
// ---------------------------------------------------------------------------

export { TextBehavior } from './behaviors/text/index.js';
export { default as RichText } from './behaviors/text/RichText.svelte';

// ---------------------------------------------------------------------------
// Keyboard chords (command `keys`)
// ---------------------------------------------------------------------------

export {
    parseChord,
    canonicalChord,
    chordId,
    eventChord,
    eventChordId,
    isReservedChord,
    RESERVED_CHORDS,
    hasCommandModifier,
    detectPlatform,
} from './utils/keys.js';

// ---------------------------------------------------------------------------
// HTML escaping (serializers)
// ---------------------------------------------------------------------------

export { escapeHtml, escapeAttr } from './utils/html.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A node of the document tree: `NabuNode<{ type: 'x', … }>`.
 * @template {Object<string, any>} [T=Record<string, any>]
 * @typedef {import('./blocks/nabu.svelte.js').NabuNode<T>} NabuNode
 */
/** @typedef {import('./utils/extensions.js').ExtensionInit} ExtensionInit */
/** @typedef {import('./utils/extensions.js').ExtensionHooks} ExtensionHooks */
/** @typedef {import('./utils/extensions.js').SplitData} SplitData What the `onSplit` hook receives: the caret offset and the tail of the text. */
/** @typedef {import('./utils/extensions.js').InputRule} InputRule */
/** @typedef {import('./utils/extensions.js').PasteBlock} PasteBlock */
/** @typedef {import('./utils/extensions.js').PasteFragment} PasteFragment */
/** @typedef {import('./utils/extensions.js').PasteInterpreter} PasteInterpreter */
/** @typedef {import('./utils/extensions.js').PasteInterpretOptions} PasteInterpretOptions */
/** @typedef {import('./utils/extensions.js').PasteFileHandler} PasteFileHandler */
/** @typedef {import('./utils/extensions.js').HtmlRule} HtmlRule A rule of a block's `static htmlRules`. */
/** @typedef {import('./utils/extensions.js').HtmlHelpers} HtmlHelpers What a block's `static fromHTML` receives. */
/** @typedef {import('./utils/extensions.js').MarkdownRule} MarkdownRule A rule of a block's `static markdownRules`. */
/** @typedef {import('./utils/extensions.js').MarkdownHelpers} MarkdownHelpers What a block's `static fromMarkdown` receives. */
/** @typedef {import('./utils/extensions.js').SerializeContext} SerializeContext The second argument of a block's `static toMarkdown` / `toHtml`. */
/** @typedef {import('./blocks/nabu.svelte.js').NabuInternals} NabuInternals The shape of `nabu.internals`. UNSTABLE: may change in any minor version. */
/** @typedef {import('./utils/commands.js').CommandDef} CommandDef */
/** @typedef {import('./utils/commands.js').CommandContext} CommandContext */
/** @typedef {import('./utils/keys.js').Chord} Chord */
/** @typedef {import('./utils/keys.js').Platform} Platform */
