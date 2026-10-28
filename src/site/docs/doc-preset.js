/**
 * The extension set of a documentation page: what a Markdown document needs (text, headings, lists, quote, code, divider, links and marks,
 * the Markdown importer, and the other blocks that Markdown can make), with the headings and code blocks redrawn for the site (anchors, Shiki colours) and the read-only table block.
 * Shared by the build (doc.server.js builds the document with it) and the page (the browser rebuilds the same engine from the snapshot):
 * both MUST list the same extensions, in the same order.
 *
 * Public entry points only: the root entry and `/extend`.
 */
import {
  ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, ListExtension, ListItemExtension,
  ToggleExtension, CalloutExtension, DialogueExtension, RegionsExtension, ImageExtension,
  RichTextExtension, MarkdownPasteExtension, createEditor,
} from '#lib';
import { extension } from '#lib/extend.js';
import DocHeading from './DocHeading.svelte';
import DocCode from './DocCode.svelte';
import { DocTableBlock } from './table.svelte.js';

// "Redraw a block" (guide: Theming): an extension of the same name, with only a component, replaces how that type is drawn.
const redrawn = [extension('heading', { component: DocHeading }), extension('code', { component: DocCode })];

export const docPreset = () => [
  ParagraphExtension,
  HeadingExtension,
  BlockquoteExtension,
  DividerExtension,
  CodeExtension,
  ListExtension,
  ListItemExtension,
  // The blocks Nabu's Markdown syntax makes (a toggle is `<details>`, a callout `> [!NOTE]`, a region an HTML comment, a dialogue line `-- `, an image
  // `![alt](url)`, a to-do `- [ ]`, the last one being a list): a page may show any of them, as live examples.
  ToggleExtension,
  CalloutExtension,
  DialogueExtension,
  RegionsExtension(),
  ImageExtension,
  RichTextExtension,
  MarkdownPasteExtension,
  // @ts-ignore — static-side variance on create() / fromMarkdown(), as for every built-in block
  extension('table', { block: DocTableBlock }),
  ...redrawn,
];

/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** @param {string} b64 */
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** A read-only engine for a page, EMPTY (the build fills it with `importMarkdown`). */
export const createDocEngine = () => createEditor({ preset: docPreset(), lang: 'en', readonly: true });

/**
 * The document of a page as a string that travels in the page data (a Loro shallow snapshot, base64).
 * @param {import('#lib').Nabu} engine
 */
export const exportSnapshot = (engine) => toBase64(engine.doc.export({ mode: 'shallow-snapshot', frontiers: engine.doc.frontiers() }));

/**
 * The engine of a page, built SYNCHRONOUSLY from its snapshot: the server render and the hydration in the browser both call this, get the
 * same tree with the same block ids, and so draw the same markup (an engine filled asynchronously could not be hydrated).
 * @param {string} snapshot from `exportSnapshot`
 * @param {string} [lang] the language of the text (`lang` of the editor element): 'en', 'fr' for the one page that has a French text
 */
export const loadDocEngine = (snapshot, lang = 'en') => createEditor({ preset: docPreset(), lang, readonly: true, snapshot: fromBase64(snapshot) });
