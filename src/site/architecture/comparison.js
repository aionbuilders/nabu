/**
 * "Nabu and the others": the data of /architecture/others. Built from the research notes kept in the repo
 * (docs/architecture/sources/comparison-2026-10-27.md), checked on 2026-10-27. Wording of the lists and the cards follows the design board
 * (ArchOthers).
 *
 * EVERY cell of the table (and every field of the cards) carries the URL of its source, copied from the notes, or, for the Nabu column,
 * the file of this repository that states it. A cell without a URL has no link and is marked `unverified: true`; a cell that has a URL but
 * that the notes flag as unverified (read through a search snippet, say) is `unverified: true` too and says why in `note`.
 * PRICES are left out on purpose: the notes flag them as unverified.
 * The notes are written for the copywriter, with the tags [npm] = https://registry.npmjs.org/<package> and [gh] = the repo: the URLs below
 * are those, written out.
 */
import { githubBlob } from './adr.js';

export const COMPARISON_CHECKED = '2026-10-27';
export const COMPARISON_NOTES = 'docs/architecture/sources/comparison-2026-10-27.md';
export const COMPARISON_TITLE = 'Nabu and the others';
export const COMPARISON_LEAD =
  'If you write Svelte and need a rich editor, these are your real options. Where Nabu is different, where the others are clearly ahead, and how we checked.';
export const COMPARISON_DESCRIPTION =
  'Nabu next to the editors a Svelte developer can really choose: Tiptap, ProseKit, svelte-lexical and Svedit. Where Nabu is different, where the others are clearly ahead, a side-by-side table with a source for every cell.';

/**
 * TODO: a separate, deep Nabu vs Svedit comparison is coming. Set `href` (and it shows, under "Your real options in Svelte") once the page exists.
 * @type {{ label: string, href: string | null }}
 */
export const SVEDIT_DEPTH = { label: 'Nabu vs Svedit in depth →', href: null };

/** @param {string} pkg */
const npm = (pkg) => `https://registry.npmjs.org/${pkg}`;
/** @param {string} path a file of the Nabu repo */
const repo = (path) => githubBlob(path);

/**
 * @typedef {{ text: string, url?: string, unverified?: boolean, note?: string }} Cell
 *   `url` is the source; without one the cell is `unverified`. `note` is shown as the tooltip of the cell.
 */

/** The five cards of "Your real options in Svelte". Fields are cells. @type {Array<{ name: string, tag: string, url: string, nabu?: boolean, engine: Cell, collab: Cell, blurb: string }>} */
export const OPTIONS = [
  {
    name: 'Tiptap',
    tag: 'official guide · svelte-tiptap',
    url: 'https://tiptap.dev/docs/editor/getting-started/install/svelte',
    engine: { text: 'ProseMirror', url: 'https://tiptap.dev/docs/editor/getting-started/overview' },
    collab: { text: 'Yjs; cloud is paid, Hocuspocus is open source', url: 'https://tiptap.dev/docs/collaboration/getting-started/overview' },
    blurb: 'The most complete ecosystem. Svelte is reached through a guide or a community wrapper.',
  },
  {
    name: 'ProseKit',
    tag: 'official Svelte adapter',
    url: 'https://prosekit.dev/',
    engine: { text: 'ProseMirror', url: 'https://prosekit.dev/' },
    collab: { text: 'Yjs or Loro bindings', url: 'https://prosekit.dev/' },
    blurb: 'A ProseMirror framework that speaks Svelte. Headless, flexible.',
  },
  {
    name: 'svelte-lexical',
    tag: 'community wrapper',
    url: 'https://github.com/umaranis/svelte-lexical',
    engine: { text: 'Lexical (Meta)', url: 'https://github.com/umaranis/svelte-lexical' },
    collab: { text: 'Yjs provider', url: 'https://lexical.dev/docs/collaboration/react' },
    blurb: 'Lexical’s engine, wrapped. React is its first home.',
  },
  {
    name: 'Svedit',
    tag: 'Svelte 5 native · alpha',
    url: 'https://github.com/michael/svedit',
    engine: { text: 'its own', url: 'https://github.com/michael/svedit' },
    collab: { text: 'not stated', url: 'https://github.com/michael/svedit' },
    blurb: 'The closest to Nabu: Svelte 5, one contenteditable. Younger, no collaboration story.',
  },
  {
    name: 'Nabu',
    tag: 'Svelte 5 native · beta',
    url: repo('README.md'),
    nabu: true,
    engine: { text: 'its own, on a Loro CRDT', url: repo('docs/adr/001-single-contenteditable.md') },
    collab: { text: 'CRDT inside; tabs sync; network: bring your own', url: repo('docs/guides/persistence-and-sync.md') },
    blurb: 'The document is the CRDT. Saving, merging tabs and files are built in.',
  },
];

/** "Where Nabu is different". */
export const DIFFERENT = [
  { title: 'Svelte 5 native', text: 'No wrapper around another engine. Blocks are Svelte components, state is runes.' },
  { title: 'The CRDT is the document', text: 'Not a binding that syncs another model: the Loro tree and text are what you edit.' },
  { title: 'Local-first in the box', text: 'IndexedDB, merge across tabs, backup and quarantine, an asset store. Elsewhere: y-indexeddb and your own wiring.' },
  { title: 'Nothing paid', text: 'MIT. No cloud tier, no GPL packages.' },
  { title: 'Undo that puts the caret back', text: 'Even after remote edits, on stable Loro cursors.' },
];

/** "Where the others are clearly ahead". */
export const AHEAD = [
  { title: 'Maturity', text: 'Years in production, tens of thousands of stars. Nabu: beta, one author, first alpha in March 2026.' },
  { title: 'Tables', text: 'Tiptap, ProseMirror, Lexical, BlockNote, Plate have them. Nabu has none.' },
  { title: 'Network collaboration', text: 'Ready-made servers and providers. Nabu gives you the CRDT bytes; you write the transport.' },
  { title: 'Mobile and browsers', text: 'Years of Android fixes elsewhere. Nabu is tested in Chromium only.' },
  { title: 'Weight', text: 'Loro’s WebAssembly is 1.2 MB gzipped. Yjs is 28 KB.' },
  { title: 'Reach', text: 'Nabu is Svelte only. Others serve React, Vue and plain JS.' },
];

/** "So, which one?" */
export const WHICH = [
  { name: 'Tiptap', text: 'if you need tables, network collaboration and a large ecosystem of extensions today, and a paid cloud for collaboration is fine.' },
  { name: 'ProseKit', text: 'if you want ProseMirror’s maturity with a Svelte adapter and room to build your own UI.' },
  { name: 'Nabu', text: 'if you build in Svelte 5, your documents must survive crashes, tabs and offline without a server, and you can ship a beta.', nabu: true },
];
export const WHICH_MORE = { label: 'What Nabu doesn’t do well (yet)', href: '/architecture/limits' };

/**
 * The editors of the table. The first six are shown by default (the real options, the references and Nabu); "All 10 editors" adds the rest.
 * @type {Array<{ id: string, name: string, extra?: boolean, nabu?: boolean }>}
 */
export const EDITORS = [
  { id: 'prosemirror', name: 'ProseMirror' },
  { id: 'tiptap', name: 'Tiptap' },
  { id: 'lexical', name: 'Lexical' },
  { id: 'slate', name: 'Slate / Plate', extra: true },
  { id: 'blocknote', name: 'BlockNote' },
  { id: 'editorjs', name: 'Editor.js', extra: true },
  { id: 'quill', name: 'Quill', extra: true },
  { id: 'milkdown', name: 'Milkdown', extra: true },
  { id: 'svedit', name: 'Svedit' },
  { id: 'nabu', name: 'Nabu', nabu: true },
];

export const ROWS = [
  { id: 'svelte', label: 'Svelte' },
  { id: 'contenteditable', label: 'Contenteditable' },
  { id: 'collab', label: 'Collaboration' },
  { id: 'offline', label: 'Offline storage' },
  { id: 'tables', label: 'Tables' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'licence', label: 'Licence' },
  { id: 'version', label: 'Version' },
];

const PM_GUIDE = 'https://prosemirror.net/docs/guide/';
const GH = (/** @type {string} */ p) => `https://github.com/${p}`;

/** `CELLS[row][editor]`. @type {Record<string, Record<string, Cell>>} */
export const CELLS = {
  svelte: {
    prosemirror: { text: 'adapter', url: npm('@prosemirror-adapter/svelte') },
    tiptap: { text: 'guide · wrapper', url: 'https://tiptap.dev/docs/editor/getting-started/install/svelte' },
    lexical: { text: 'wrapper', url: npm('svelte-lexical') },
    slate: { text: 'none', url: GH('ianstormtaylor/slate'), note: 'React only: Slate is "built on top of React"' },
    blocknote: { text: 'none', url: 'https://www.blocknotejs.org/', note: 'React-first; no Svelte package found' },
    editorjs: { text: 'vanilla JS', url: GH('codex-team/editor.js'), unverified: true, note: 'No official Svelte package found; community wrappers not checked' },
    quill: { text: 'vanilla JS', unverified: true, note: 'No official Svelte package found; wrappers not checked' },
    milkdown: { text: 'none', unverified: true, note: 'No official Svelte package on npm; the ready-made UI depends on Vue' },
    svedit: { text: 'native', url: GH('michael/svedit') },
    nabu: { text: 'native', url: repo('package.json') },
  },
  contenteditable: {
    prosemirror: { text: 'one', url: PM_GUIDE },
    tiptap: { text: 'one', url: 'https://tiptap.dev/docs/editor/getting-started/overview' },
    lexical: { text: 'one', url: 'https://lexical.dev/docs/intro' },
    slate: { text: 'one', url: 'https://docs.slatejs.org/' },
    blocknote: { text: 'one', url: GH('TypeCellOS/BlockNote') },
    editorjs: { text: 'one per block', url: 'https://editorjs.io/' },
    quill: { text: 'one', unverified: true, note: 'The single-contenteditable detail was not found on a fetched page' },
    milkdown: { text: 'one', url: GH('Milkdown/milkdown') },
    svedit: { text: 'one', url: GH('michael/svedit') },
    nabu: { text: 'one', url: repo('docs/adr/001-single-contenteditable.md') },
  },
  collab: {
    prosemirror: { text: 'OT; Yjs/Loro bindings', url: PM_GUIDE },
    tiptap: { text: 'Yjs; paid cloud', url: 'https://tiptap.dev/docs/collaboration/getting-started/overview' },
    lexical: { text: 'Yjs', url: 'https://lexical.dev/docs/collaboration/react' },
    slate: { text: 'none; Yjs bindings', url: GH('ianstormtaylor/slate') },
    blocknote: { text: 'Yjs, free', url: 'https://www.blocknotejs.org/docs/features/collaboration' },
    editorjs: { text: 'none (planned)', url: GH('codex-team/editor.js') },
    quill: { text: 'none built in', url: 'https://quilljs.com/docs/delta' },
    milkdown: { text: 'Yjs', url: 'https://milkdown.dev/docs/plugin/collaborative-editing' },
    svedit: { text: 'not stated', url: GH('michael/svedit') },
    nabu: { text: 'Loro inside; BYO transport', url: repo('docs/guides/persistence-and-sync.md') },
  },
  offline: {
    prosemirror: { text: 'none built in', url: PM_GUIDE, note: 'No built-in offline persistence' },
    tiptap: { text: 'y-indexeddb guide', url: 'https://tiptap.dev/docs/guides/offline-support' },
    lexical: { text: 'via provider', url: 'https://lexical.dev/docs/collaboration/react' },
    slate: { text: 'Plate: IndexedDB provider', url: 'https://unpkg.com/@platejs/yjs/README.md' },
    blocknote: { text: 'y-indexeddb', url: 'https://www.blocknotejs.org/docs/features/collaboration' },
    editorjs: { text: 'none found', unverified: true, note: 'No offline persistence found' },
    quill: { text: 'none found', unverified: true, note: 'No offline persistence found' },
    milkdown: { text: 'not stated', unverified: true, note: 'Not stated on the pages read' },
    svedit: { text: 'not stated', url: GH('michael/svedit') },
    nabu: { text: 'built in', url: repo('docs/guides/persistence-and-sync.md') },
  },
  tables: {
    prosemirror: { text: 'yes', url: GH('ProseMirror/prosemirror-tables') },
    tiptap: { text: 'yes', url: 'https://tiptap.dev/docs/editor/extensions/nodes/table' },
    lexical: { text: 'yes', url: 'https://lexical.dev/docs/packages/lexical-table' },
    slate: { text: 'via Plate', url: npm('@platejs/table') },
    blocknote: { text: 'yes', url: 'https://www.blocknotejs.org/docs/features/blocks/tables' },
    editorjs: { text: 'separate tool', url: npm('@editorjs/table') },
    quill: { text: 'third-party', url: GH('slab/quill/issues/117') },
    milkdown: { text: 'GFM preset', unverified: true, note: 'Tables come with the GFM preset; the UI was not verified' },
    svedit: { text: 'no', url: GH('michael/svedit'), note: 'Tables are not supported in the HTML paste import (README)' },
    nabu: { text: 'no', url: repo('docs/audit/2026-10.md') },
  },
  mobile: {
    prosemirror: { text: 'years of fixes', url: 'https://unpkg.com/prosemirror-view@1.42.8/CHANGELOG.md' },
    tiptap: { text: 'not stated', unverified: true, note: 'No statement found; it inherits ProseMirror’s behaviour' },
    lexical: { text: 'active fixes', url: GH('facebook/lexical/releases') },
    slate: { text: 'newer, "more bugs"', url: 'https://docs.slatejs.org/general/faq', unverified: true, note: 'Read from a search snippet, not checked against the live page' },
    blocknote: { text: 'experimental', url: 'https://www.blocknotejs.org/examples/ui-components/experimental-mobile-formatting-toolbar' },
    editorjs: { text: 'not stated', url: GH('codex-team/editor.js') },
    quill: { text: 'phones supported', url: 'https://quilljs.com/' },
    milkdown: { text: 'not stated', unverified: true, note: 'No statement found' },
    svedit: { text: 'experimental', url: GH('michael/svedit') },
    nabu: { text: 'untested', url: repo('docs/guides/ime-and-languages.md') },
  },
  licence: {
    prosemirror: { text: 'MIT', url: npm('prosemirror-view') },
    tiptap: { text: 'MIT + paid platform', url: 'https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap' },
    lexical: { text: 'MIT', url: GH('facebook/lexical') },
    slate: { text: 'MIT + paid add-on', url: 'https://pro.platejs.org/pricing' },
    blocknote: { text: 'MPL-2.0 + GPL/commercial', url: 'https://www.blocknotejs.org/pricing' },
    editorjs: { text: 'Apache-2.0', url: GH('codex-team/editor.js') },
    quill: { text: 'BSD-3-Clause', url: GH('slab/quill') },
    milkdown: { text: 'MIT', url: GH('Milkdown/milkdown') },
    svedit: { text: 'MIT', url: GH('michael/svedit') },
    nabu: { text: 'MIT', url: repo('package.json') },
  },
  version: {
    prosemirror: { text: '1.42 (2016)', url: npm('prosemirror-view') },
    tiptap: { text: '3.32 (2020)', url: npm('@tiptap/core') },
    lexical: { text: '0.52', url: npm('lexical') },
    slate: { text: '0.147 beta', url: npm('slate') },
    blocknote: { text: '0.56', url: npm('@blocknote/core') },
    editorjs: { text: '2.31 (2015)', url: npm('@editorjs/editorjs') },
    quill: { text: '2.0 (2012)', url: GH('slab/quill/blob/main/CHANGELOG.md') },
    milkdown: { text: '7.23 (2021)', url: npm('@milkdown/core') },
    svedit: { text: '0.15 alpha', url: npm('svedit') },
    nabu: { text: '0.1 beta (2026)', url: repo('CHANGELOG.md') },
  },
};
