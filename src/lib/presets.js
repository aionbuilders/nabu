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
    ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ToggleExtension, ImageExtension, VideoExtension, FileExtension, ListExtension, ListItemExtension, DialogueExtension, RichTextExtension, TypographyExtension, MarkdownShortcutsExtension, PlainTextPasteExtension, HtmlPasteExtension, MarkdownPasteExtension, NabuPasteExtension, BlockExtension,
];

// ---------------------------------------------------------------------------
// Factory — generic createEditor
// ---------------------------------------------------------------------------

/**
 * Create a Nabu editor instance from a preset and optional extra extensions.
 *
 * @param {object} [options]
 * @param {typeof ParagraphExtension[]} [options.preset] - Base preset (default: FullPreset)
 * @param {typeof ParagraphExtension[]} [options.extensions] - Extra extensions to append
 * @param {import('./files/files.svelte.js').FilesConfig} [options.files] - File/upload config (forwarded to Nabu)
 * @param {import('./utils/placeholders.js').PlaceholdersOption} [options.placeholders] - Forwarded to Nabu
 * @param {boolean} [options.spellcheck] - Forwarded to Nabu (default `true`)
 * @param {string} [options.lang] - Forwarded to Nabu (BCP 47 tag of the content)
 * @returns {Nabu}
 *
 * @example
 * const engine = createEditor({ preset: DocumentPreset, extensions: [MyCustomExtension] });
 */
export function createEditor({ preset = FullPreset, extensions = [], ...init } = {}) {
    // Forward any remaining Nabu init options (e.g. `files`, `snapshot`) so the
    // ergonomic factories expose the full constructor surface, not just extensions.
    return new Nabu({ ...init, extensions: [...preset, ...extensions] });
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
