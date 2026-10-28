/**
 * @module @aionbuilders/nabu
 *
 * Using the editor: create one (factories and presets), mount it (`NabuEditor`), pick the built-in extensions, reach its
 * subsystems and use the few serialization helpers an integrator calls.
 *
 * Two companion entry points:
 * - `@aionbuilders/nabu/ui`     the optional UI components (toolbar, slash menu, drag handle…);
 * - `@aionbuilders/nabu/extend` writing your own blocks and extensions.
 *
 * Everything not exported here is internal and may change without notice. Region operations (split, merge, move…)
 * are reached through commands: `nabu.exec('region:…')`.
 */

// ---------------------------------------------------------------------------
// Creating an editor
// ---------------------------------------------------------------------------

export {
    createEditor,
    createMinimalEditor,
    createTextEditor,
    createDocumentEditor,
    createFullEditor,
    createPersistedEditor,
    MinimalPreset,
    TextPreset,
    DocumentPreset,
    FullPreset,
} from './presets.js';
export { Nabu } from './blocks/nabu.svelte.js';
export { default as NabuEditor } from './blocks/Nabu.svelte';

// ---------------------------------------------------------------------------
// Built-in extensions (compose your own preset from these)
// ---------------------------------------------------------------------------

export { BlockExtension } from './blocks/block.extension.js';
export { ParagraphExtension } from './blocks/paragraph/index.js';
export { HeadingExtension } from './blocks/heading/index.js';
export { ListExtension, ListItemExtension } from './blocks/list/index.js';
export { BlockquoteExtension } from './blocks/blockquote/index.js';
export { DividerExtension } from './blocks/divider/index.js';
export { CodeExtension } from './blocks/code/index.js';
export { CalloutExtension } from './blocks/callout/index.js';
export { ToggleExtension } from './blocks/toggle/index.js';
export { ImageExtension } from './blocks/image/index.js';
export { VideoExtension } from './blocks/video/index.js';
export { FileExtension } from './blocks/file/index.js';
export { DialogueExtension, createDialogueExtension } from './blocks/dialogue/index.js';
export { RegionsExtension, createRegionsExtension, DEFAULT_REGION_TYPES, DEFAULT_REGION_MESSAGES } from './blocks/region/index.js';

// Text behaviors
export { RichTextExtension, TypographyExtension, MarkdownShortcutsExtension } from './behaviors/text/index.js';

// Paste
export { PlainTextPasteExtension, NabuPasteExtension, HtmlPasteExtension, MarkdownPasteExtension } from './paste/index.js';

// ---------------------------------------------------------------------------
// Subsystems reached from an editor (`Files.get(nabu)`, `Regions.get(nabu)` or `nabu.regions`, `Todos.get(nabu)`…)
// ---------------------------------------------------------------------------

export { Files, FileRejectedError, MemoryOutbox, REASON_CODES } from './files/index.js';
export { Regions, Region } from './blocks/region/index.js';
export { Todos } from './blocks/list/index.js';

// Insert media from a File you already hold (drop zone, custom button). From a URL or a picker: `nabu.exec('image:insert' | 'image:pick')`.
export { insertImageFromFile } from './blocks/image/index.js';
export { insertMediaFromFile } from './blocks/media/index.js';

// Document / clipboard format versions
export { JSON_FORMAT_VERSION, CLIPBOARD_FORMAT_VERSION, isSupportedJsonVersion } from './utils/extensions.js';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export { deltaToMarkdown, deltaToHtml } from './behaviors/text/index.js';
export { sanitizeUrl } from './utils/html.js';
export { formatChord } from './utils/keys.js';

// ---------------------------------------------------------------------------
// Types (JSDoc typedefs, importable as `import('@aionbuilders/nabu').NabuInit`…)
// ---------------------------------------------------------------------------

/** @typedef {import('./blocks/nabu.svelte.js').NabuInit} NabuInit The options of an editor: `new Nabu(init)`, the factories and `createPersistedEditor`. */
/**
 * @typedef {import('./presets.js').EditorOptions} EditorOptions
 * The options of the editor factories (`createEditor` and the preset factories): every `NabuInit` option plus the `preset` to start from.
 */
/** @typedef {import('./files/files.svelte.js').FilesConfig} FilesConfig The `files` option: uploads, limits, embedding. */
/** @typedef {import('./files/files.svelte.js').EmbeddedAsset} EmbeddedAsset */
/** @typedef {import('./utils/placeholders.js').PlaceholdersOption} PlaceholdersOption */
/** @typedef {import('./utils/placeholders.js').PlaceholdersConfig} PlaceholdersConfig */
/** @typedef {import('./utils/placeholders.js').PlaceholderText} PlaceholderText */
/** @typedef {import('./utils/commands.js').CommandDef} CommandDef A command declared by an extension (`commands`). */
/** @typedef {import('./utils/commands.js').CommandContext} CommandContext */
/** @typedef {import('./utils/commands.js').CommandConfirm} CommandConfirm */
/** @typedef {import('./utils/commands.js').CommandInfo} CommandInfo */
/** @typedef {import('./utils/command-confirm.svelte.js').CommandConfirmOptions} CommandConfirmOptions */
/** @typedef {import('./utils/command-confirm.svelte.js').ConfirmMessages} ConfirmMessages */
/** @typedef {import('./blocks/region/types.js').RegionTypeInit} RegionTypeInit Declaration of a region type. */
/** @typedef {import('./blocks/region/types.js').RegionTypeDef} RegionTypeDef */
/** @typedef {import('./blocks/region/types.js').RegionsConfig} RegionsConfig */
/** @typedef {import('./blocks/region/types.js').FieldKind} FieldKind */
/** @typedef {import('./blocks/region/types.js').FieldSpec} FieldSpec */
/** @typedef {import('./blocks/region/types.js').Numbering} Numbering */
/** @typedef {import('./blocks/region/messages.js').RegionMessages} RegionMessages */
/** @typedef {import('./blocks/region/messages.js').RegionMessageParams} RegionMessageParams */
/** @typedef {import('./blocks/region/messages.js').RegionNameParams} RegionNameParams */
/** @typedef {import('./blocks/region/messages.js').RegionTypeParams} RegionTypeParams */
/** @typedef {import('./persistence/history.js').HistoryConfig} HistoryConfig */
/** @typedef {import('./persistence/history.js').CompactOptions} CompactOptions */
/** @typedef {import('./persistence/compact.js').CompactResult} CompactResult */
/** @typedef {import('./persistence/recovery.js').Recovery} Recovery */
/** @typedef {import('./utils/keys.js').Chord} Chord */
/** @typedef {import('./utils/keys.js').Platform} Platform */
