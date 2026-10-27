/**
 * The public API is three entry points (audit C-01). Each pins the EXACT sorted list of its runtime exports: adding or removing
 * a name is a conscious, breaking-or-additive API decision, and must be made here (and in CHANGELOG.md) on purpose.
 *
 *   @aionbuilders/nabu          src/lib/index.js     using the editor
 *   @aionbuilders/nabu/ui       src/lib/ui/index.js  the optional UI components
 *   @aionbuilders/nabu/extend   src/lib/extend.js    writing blocks and extensions
 */
import { describe, it, expect } from 'vitest';

// Names are sorted with the default sort (code-unit order), as `Object.keys(...).sort()` returns them.
const ROOT = [
  'BlockExtension',
  'BlockquoteExtension',
  'CLIPBOARD_FORMAT_VERSION',
  'CalloutExtension',
  'CodeExtension',
  'DEFAULT_REGION_MESSAGES',
  'DEFAULT_REGION_TYPES',
  'DialogueExtension',
  'DividerExtension',
  'DocumentPreset',
  'FileExtension',
  'FileRejectedError',
  'Files',
  'FullPreset',
  'HeadingExtension',
  'HtmlPasteExtension',
  'ImageExtension',
  'JSON_FORMAT_VERSION',
  'ListExtension',
  'ListItemExtension',
  'MarkdownPasteExtension',
  'MarkdownShortcutsExtension',
  'MemoryOutbox',
  'MinimalPreset',
  'Nabu',
  'NabuEditor',
  'NabuPasteExtension',
  'ParagraphExtension',
  'PlainTextPasteExtension',
  'REASON_CODES',
  'Region',
  'Regions',
  'RegionsExtension',
  'RichTextExtension',
  'TextPreset',
  'Todos',
  'ToggleExtension',
  'TypographyExtension',
  'VideoExtension',
  'createDialogueExtension',
  'createDocumentEditor',
  'createEditor',
  'createFullEditor',
  'createMinimalEditor',
  'createPersistedEditor',
  'createRegionsExtension',
  'createTextEditor',
  'deltaToHtml',
  'deltaToMarkdown',
  'formatChord',
  'insertImageFromFile',
  'insertMediaFromFile',
  'isSupportedJsonVersion',
  'sanitizeUrl',
];

const UI = [
  'CommandChooser',
  'CommandInvite',
  'DEFAULT_SLASH_COMMANDS',
  'DragHandle',
  'FloatingToolbar',
  'SlashMenu',
  'SlashMenuController',
];

const EXTEND = [
  'Block',
  'BlockComponent',
  'Extension',
  'MegaBlock',
  'RESERVED_CHORDS',
  'RichText',
  'TextBehavior',
  'TextBlock',
  'canonicalChord',
  'chordId',
  'detectPlatform',
  'escapeAttr',
  'escapeHtml',
  'eventChord',
  'eventChordId',
  'extension',
  'hasCommandModifier',
  'isReservedChord',
  'parseChord',
];

// Importing a Svelte-heavy entry is slow the first time (compilation).
const TIMEOUT = 60000;

describe('public API', () => {
  it('@aionbuilders/nabu exports exactly the pinned names', async () => {
    const mod = await import('$lib/index.js');
    expect(Object.keys(mod).sort()).toEqual(ROOT);
  }, TIMEOUT);

  it('@aionbuilders/nabu/ui exports exactly the pinned names', async () => {
    const mod = await import('$lib/ui/index.js');
    expect(Object.keys(mod).sort()).toEqual(UI);
  }, TIMEOUT);

  it('@aionbuilders/nabu/extend exports exactly the pinned names', async () => {
    const mod = await import('$lib/extend.js');
    expect(Object.keys(mod).sort()).toEqual(EXTEND);
  }, TIMEOUT);

  it('no name is exported by two entries (each name has one home)', () => {
    const all = [...ROOT, ...UI, ...EXTEND];
    expect(new Set(all).size).toBe(all.length);
  });

  it('every export is defined', async () => {
    for (const path of ['$lib/index.js', '$lib/ui/index.js', '$lib/extend.js']) {
      const mod = await import(/* @vite-ignore */ path);
      for (const [name, value] of Object.entries(mod)) expect(value, `${path} → ${name}`).not.toBeUndefined();
    }
  }, TIMEOUT);

  it('the root entry builds a working editor', async () => {
    const { createMinimalEditor } = await import('$lib/index.js');
    const engine = createMinimalEditor();
    expect(engine).toBeTruthy();
    expect(typeof engine.exec).toBe('function');
  }, TIMEOUT);
});
