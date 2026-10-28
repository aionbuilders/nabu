// Hand-written inputs of the API reference generator (scripts/api-model.js). Everything else comes from the JSDoc.

export const ENTRIES = [
  {
    id: 'root',
    specifier: '@aionbuilders/nabu',
    title: 'Using the editor',
    file: 'src/lib/index.js',
    summary: 'Create an editor, mount it, pick the built-in extensions and reach its subsystems.',
  },
  {
    id: 'ui',
    specifier: '@aionbuilders/nabu/ui',
    title: 'UI components',
    file: 'src/lib/ui/index.js',
    summary: 'The optional UI: formatting toolbar, slash menu, drag handle and command-confirmation surfaces.',
  },
  {
    id: 'extend',
    specifier: '@aionbuilders/nabu/extend',
    title: 'Writing blocks and extensions',
    file: 'src/lib/extend.js',
    summary: 'The extension() factory, the block base classes, the text behavior and the stable contract of a third-party block.',
  },
];

/** Classes of the stable `@public` contract that are not exported by name: documented under `extend`. */
export const CONTRACT_EXTRA = ['NabuSelection', 'SvelteSelection', 'CommandRegistry'];

/** Classes whose members tagged `@public` are the stable contract (pinned by tests/unit/extend-contract.test.js). */
export const CONTRACT_CLASSES = ['Nabu', 'Block', 'TextBlock', 'MegaBlock', 'TextBehavior', 'NabuSelection', 'SvelteSelection', 'CommandRegistry'];

/** Svelte components: they have no TypeDoc model, the generator reads the `.svelte` source. */
export const COMPONENT_SUMMARY = {
  NabuEditor: 'The contenteditable root: renders the document of an editor and wires every event to the engine.',
  SlashMenu: 'The "/" menu: a filterable list of blocks to insert, anchored at the caret.',
  DragHandle: 'The handle shown next to a block to drag it elsewhere in the document.',
  BlockComponent: 'Renders one block with the component its extension registered. Used by container blocks to render their children.',
  RichText: 'Renders the delta of a text block: marks, links and the trailing-line filler.',
};

/** Fallback description of a component prop that has none in the source. */
export const PROP_FALLBACK = {
  engine: 'The editor this component works on (a `Nabu` instance).',
  block: 'The block to render.',
  delta: 'The Loro delta to render: the `insert` strings and their marks.',
};

const G = '/docs/guides/';
const S = '/docs/getting-started/';

/** export name -> [label, href]. A small hand-written table; the guide pages live under /docs/<section>/<slug>. */
export const RELATED_GUIDE = {
  createPersistedEditor: ['Persistence and sync', G + 'persistence-and-sync'],
  HistoryConfig: ['Persistence and sync', G + 'persistence-and-sync'],
  CompactOptions: ['Persistence and sync', G + 'persistence-and-sync'],
  CompactResult: ['Persistence and sync', G + 'persistence-and-sync'],
  Recovery: ['Persistence and sync', G + 'persistence-and-sync'],
  Regions: ['Regions', G + 'regions'],
  Region: ['Regions', G + 'regions'],
  RegionsExtension: ['Regions', G + 'regions'],
  createRegionsExtension: ['Regions', G + 'regions'],
  DEFAULT_REGION_TYPES: ['Regions', G + 'regions'],
  DEFAULT_REGION_MESSAGES: ['Regions', G + 'regions'],
  RegionTypeInit: ['Regions', G + 'regions'],
  RegionTypeDef: ['Regions', G + 'regions'],
  RegionsConfig: ['Regions', G + 'regions'],
  RegionMessages: ['Regions', G + 'regions'],
  extension: ['Extensions', G + 'extensions'],
  Extension: ['Extensions', G + 'extensions'],
  ExtensionInit: ['Extensions', G + 'extensions'],
  ExtensionHooks: ['Extensions', G + 'extensions'],
  Block: ['Extensions', G + 'extensions'],
  TextBlock: ['Extensions', G + 'extensions'],
  MegaBlock: ['Extensions', G + 'extensions'],
  TextBehavior: ['Extensions', G + 'extensions'],
  NabuInternals: ['Extensions: Stability', G + 'extensions'],
  NabuSelection: ['Extensions', G + 'extensions'],
  SvelteSelection: ['Extensions', G + 'extensions'],
  CommandDef: ['Commands and keymap', G + 'commands-and-keymap'],
  CommandContext: ['Commands and keymap', G + 'commands-and-keymap'],
  CommandConfirm: ['Commands and keymap', G + 'commands-and-keymap'],
  CommandInfo: ['Commands and keymap', G + 'commands-and-keymap'],
  CommandRegistry: ['Commands and keymap', G + 'commands-and-keymap'],
  CommandInvite: ['Commands and keymap', G + 'commands-and-keymap'],
  CommandChooser: ['Commands and keymap', G + 'commands-and-keymap'],
  parseChord: ['Commands and keymap', G + 'commands-and-keymap'],
  canonicalChord: ['Commands and keymap', G + 'commands-and-keymap'],
  chordId: ['Commands and keymap', G + 'commands-and-keymap'],
  eventChord: ['Commands and keymap', G + 'commands-and-keymap'],
  eventChordId: ['Commands and keymap', G + 'commands-and-keymap'],
  isReservedChord: ['Commands and keymap', G + 'commands-and-keymap'],
  RESERVED_CHORDS: ['Commands and keymap', G + 'commands-and-keymap'],
  hasCommandModifier: ['Commands and keymap', G + 'commands-and-keymap'],
  detectPlatform: ['Commands and keymap', G + 'commands-and-keymap'],
  formatChord: ['Commands and keymap', G + 'commands-and-keymap'],
  deltaToMarkdown: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  deltaToHtml: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  MarkdownPasteExtension: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  HtmlPasteExtension: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  NabuPasteExtension: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  PlainTextPasteExtension: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  CLIPBOARD_FORMAT_VERSION: ['Clipboard and Markdown', G + 'clipboard-and-markdown'],
  createEditor: ['Presets', S + 'presets'],
  createMinimalEditor: ['Presets', S + 'presets'],
  createTextEditor: ['Presets', S + 'presets'],
  createDocumentEditor: ['Presets', S + 'presets'],
  createFullEditor: ['Presets', S + 'presets'],
  MinimalPreset: ['Presets', S + 'presets'],
  TextPreset: ['Presets', S + 'presets'],
  DocumentPreset: ['Presets', S + 'presets'],
  FullPreset: ['Presets', S + 'presets'],
  EditorOptions: ['Presets', S + 'presets'],
  Nabu: ['Your first editor', S + 'first-editor'],
  NabuEditor: ['Your first editor', S + 'first-editor'],
  NabuInit: ['Your first editor', S + 'first-editor'],
};
