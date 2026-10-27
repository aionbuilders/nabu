/**
 * @import { Extension } from './utils/extensions.js';
 */

import { Nabu } from './blocks/nabu.svelte.js';
import { ParagraphExtension } from './blocks/paragraph/index.js';
import { HeadingExtension } from './blocks/heading/index.js';
import { ListExtension, ListItemExtension } from './blocks/list/index.js';
import { DialogueExtension } from './blocks/dialogue/index.js';
import { BlockquoteExtension } from './blocks/blockquote/index.js';
import { DividerExtension } from './blocks/divider/index.js';
import { CodeExtension } from './blocks/code/index.js';
import { CalloutExtension } from './blocks/callout/index.js';
import { ToggleExtension } from './blocks/toggle/index.js';
import { RichTextExtension, TypographyExtension, MarkdownShortcutsExtension } from './behaviors/text/index.js';
import { PlainTextPasteExtension, NabuPasteExtension, HtmlPasteExtension, MarkdownPasteExtension } from './paste/index.js';
import { BlockExtension } from './blocks/block.extension.js';
import { ImageExtension } from './blocks/image/index.js';
import { VideoExtension } from './blocks/video/index.js';
import { FileExtension } from './blocks/file/index.js';
import { RegionsExtension } from './blocks/region/index.js';

// ---------------------------------------------------------------------------
// Presets — composable extension arrays
// ---------------------------------------------------------------------------

/** Paragraph only. The simplest possible editor. */
export const MinimalPreset = [ParagraphExtension, PlainTextPasteExtension, HtmlPasteExtension, NabuPasteExtension, BlockExtension];

/** Paragraph + rich text marks (bold, italic, underline, code, strikethrough). */
export const TextPreset = [ParagraphExtension, RichTextExtension, TypographyExtension, MarkdownShortcutsExtension, PlainTextPasteExtension, HtmlPasteExtension, NabuPasteExtension, MarkdownPasteExtension, BlockExtension];

/** Paragraph + headings + rich text. Document-like, no lists. */
export const DocumentPreset = [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ToggleExtension, ImageExtension, VideoExtension, FileExtension, RichTextExtension, TypographyExtension, MarkdownShortcutsExtension, PlainTextPasteExtension, HtmlPasteExtension, MarkdownPasteExtension, NabuPasteExtension, BlockExtension];

/** All built-in block types + rich text. */
export const FullPreset =     [
    ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ToggleExtension, ImageExtension, VideoExtension, FileExtension, ListExtension, ListItemExtension, DialogueExtension, RegionsExtension(), RichTextExtension, TypographyExtension, MarkdownShortcutsExtension, PlainTextPasteExtension, HtmlPasteExtension, MarkdownPasteExtension, NabuPasteExtension, BlockExtension,
];

/**
 * Default `tab` option of each preset (P-41): what Tab / Shift+Tab do in a plain text block. Small editors (comment box,
 * description) let Tab leave like a `<textarea>`; document editors keep the caret and offer Escape then Tab to leave.
 * An explicit `tab` option always wins; a preset that is not listed (custom array) gets `'focus'`.
 * @type {Map<unknown, 'focus' | 'stay' | 'indent'>}
 */
const TAB_DEFAULTS = new Map([[MinimalPreset, 'focus'], [TextPreset, 'focus'], [DocumentPreset, 'stay'], [FullPreset, 'stay']]);

/**
 * The default `tab` mode of a preset (see `TAB_DEFAULTS`).
 * @param {unknown} preset
 * @returns {'focus' | 'stay' | 'indent'}
 */
export const tabDefaultFor = (preset) => TAB_DEFAULTS.get(preset) ?? 'focus';

// ---------------------------------------------------------------------------
// Factory — generic createEditor
// ---------------------------------------------------------------------------

/**
 * Options of the editor factories: every `NabuInit` option (`files`, `placeholders`, `snapshot`, `keymap`, `tab`, `lang`…, forwarded to
 * `Nabu`) plus the `preset` the factory starts from. `extensions` are appended to the preset's.
 * - `preset`: base extensions (default: `FullPreset`, or the preset of the named factory).
 * - `tab`: default by preset: Minimal / Text `'focus'`, Document / Full `'stay'`, a custom preset array `'focus'`.
 * @typedef {Omit<import('./blocks/nabu.svelte.js').NabuInit, 'extensions'> & { preset?: Extension[], extensions?: Extension[] }} EditorOptions
 */

/**
 * Create a Nabu editor instance from a preset and optional extra extensions.
 *
 * @param {EditorOptions} [options]
 * @returns {Nabu}
 *
 * @example
 * const engine = createEditor({ preset: DocumentPreset, extensions: [MyCustomExtension] });
 */
export function createEditor({ preset = FullPreset, extensions = [], ...init } = {}) {
    // Forward any remaining Nabu init options (e.g. `files`, `snapshot`) so the
    // ergonomic factories expose the full constructor surface, not just extensions.
    return new Nabu({ tabDefault: tabDefaultFor(preset), ...init, extensions: [...preset, ...extensions] });
}

// ---------------------------------------------------------------------------
// Named shortcuts
// ---------------------------------------------------------------------------

/**
 * Paragraph-only editor. Ideal as a simple textarea replacement.
 * @param {EditorOptions} [options]  every `NabuInit` option (`files`, `snapshot`, `keymap`…) and extra `extensions`
 */
export const createMinimalEditor = (options = {}) =>
    createEditor({ preset: MinimalPreset, ...options });

/**
 * Paragraph + rich text marks. Good for comment boxes, descriptions.
 * @param {EditorOptions} [options]  every `NabuInit` option (`files`, `snapshot`, `keymap`…) and extra `extensions`
 */
export const createTextEditor = (options = {}) =>
    createEditor({ preset: TextPreset, ...options });

/**
 * Paragraph + headings + rich text. Good for articles, notes.
 * @param {EditorOptions} [options]  every `NabuInit` option (`files`, `snapshot`, `keymap`…) and extra `extensions`
 */
export const createDocumentEditor = (options = {}) =>
    createEditor({ preset: DocumentPreset, ...options });

/**
 * All built-in blocks + rich text. The full Nabu experience.
 * @param {EditorOptions} [options]  every `NabuInit` option (`files`, `snapshot`, `keymap`…) and extra `extensions`
 */
export const createFullEditor = (options = {}) =>
    createEditor({ preset: FullPreset, ...options });

// ---------------------------------------------------------------------------
// Persisted factory
// ---------------------------------------------------------------------------

export { createPersistedEditor } from './persistence/persistence.js';
