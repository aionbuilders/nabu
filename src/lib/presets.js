import { Nabu } from './blocks/nabu.svelte.js';
import { ParagraphExtension } from './blocks/paragraph/index.js';
import { HeadingExtension } from './blocks/heading/index.js';
import { ListExtension, ListItemExtension } from './blocks/list/index.js';
import { DialogueExtension } from './blocks/dialogue/index.js';
import { RichTextExtension } from './behaviors/text/index.js';
import { PlainTextPasteExtension, NabuPasteExtension, HtmlPasteExtension, MarkdownPasteExtension } from './paste/index.js';

// ---------------------------------------------------------------------------
// Presets — composable extension arrays
// ---------------------------------------------------------------------------

/** Paragraph only. The simplest possible editor. */
export const MinimalPreset = [ParagraphExtension, PlainTextPasteExtension, HtmlPasteExtension, NabuPasteExtension];

/** Paragraph + rich text marks (bold, italic, underline, code, strikethrough). */
export const TextPreset = [ParagraphExtension, RichTextExtension, PlainTextPasteExtension, HtmlPasteExtension, NabuPasteExtension];

/** Paragraph + headings + rich text. Document-like, no lists. */
export const DocumentPreset = [ParagraphExtension, HeadingExtension, RichTextExtension, PlainTextPasteExtension, HtmlPasteExtension, MarkdownPasteExtension, NabuPasteExtension];

/** All built-in block types + rich text. */
export const FullPreset = [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, DialogueExtension, RichTextExtension, PlainTextPasteExtension, HtmlPasteExtension, MarkdownPasteExtension, NabuPasteExtension];

// ---------------------------------------------------------------------------
// Factory — generic createEditor
// ---------------------------------------------------------------------------

/**
 * Create a Nabu editor instance from a preset and optional extra extensions.
 *
 * @param {object} [options]
 * @param {typeof ParagraphExtension[]} [options.preset] - Base preset (default: FullPreset)
 * @param {typeof ParagraphExtension[]} [options.extensions] - Extra extensions to append
 * @returns {Nabu}
 *
 * @example
 * const engine = createEditor({ preset: DocumentPreset, extensions: [MyCustomExtension] });
 */
export function createEditor({ preset = FullPreset, extensions = [] } = {}) {
    return new Nabu({ extensions: [...preset, ...extensions] });
}

// ---------------------------------------------------------------------------
// Named shortcuts
// ---------------------------------------------------------------------------

/**
 * Paragraph-only editor. Ideal as a simple textarea replacement.
 * @param {{ extensions?: typeof ParagraphExtension[] }} [options]
 */
export const createMinimalEditor = (options = {}) =>
    createEditor({ preset: MinimalPreset, ...options });

/**
 * Paragraph + rich text marks. Good for comment boxes, descriptions.
 * @param {{ extensions?: typeof ParagraphExtension[] }} [options]
 */
export const createTextEditor = (options = {}) =>
    createEditor({ preset: TextPreset, ...options });

/**
 * Paragraph + headings + rich text. Good for articles, notes.
 * @param {{ extensions?: typeof ParagraphExtension[] }} [options]
 */
export const createDocumentEditor = (options = {}) =>
    createEditor({ preset: DocumentPreset, ...options });

/**
 * All built-in blocks + rich text. The full Nabu experience.
 * @param {{ extensions?: typeof ParagraphExtension[] }} [options]
 */
export const createFullEditor = (options = {}) =>
    createEditor({ preset: FullPreset, ...options });

// ---------------------------------------------------------------------------
// Persisted factory
// ---------------------------------------------------------------------------

export { createPersistedEditor } from './persistence/persistence.js';
