// @ts-nocheck
/**
 * The `countWords` option: an app supplies its own word counter (here a Word-like one, where a hyphenated compound is one
 * word). It is stored as `nabu.countWords`, used by the text behavior, and every `wordCount` that sums blocks follows.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { countWords as internalCountWords } from '#lib/utils/words.js';
import { countWords as rootCountWords, createEditor, createDocumentEditor, createPersistedEditor as rootPersisted } from '@aionbuilders/nabu';
import { countWords as formatCountWords } from '@aionbuilders/nabu/format';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { ToggleExtension } from '#lib/blocks/toggle/index.js';
import { BlockExtension } from '#lib/blocks/block.extension.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { RegionsExtension, Regions } from '#lib/blocks/region/index.js';
import { createPersistedEditor } from '#lib/persistence/persistence.js';

/** Word's rule: whitespace-separated tokens that hold a letter or a digit. */
const wordLike = (text) => text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
const SAMPLE = "passe-t-il Dix-huit l'homme";

const EXTENSIONS = [ParagraphExtension, ListExtension, ListItemExtension, ToggleExtension, RichTextExtension, RegionsExtension(), BlockExtension];
async function makeEditor(init = {}) {
  const engine = new Nabu({ extensions: EXTENSIONS, ...init });
  await engine.commit();
  return engine;
}

describe('the default counter', () => {
  it('is the exported function, and counts as before', async () => {
    const engine = await makeEditor({ lang: 'fr' });
    expect(engine.countWords).toBe(internalCountWords);
    const block = engine.insert('paragraph', { text: SAMPLE });
    await engine.commit();
    expect(block.wordCount).toBe(internalCountWords(SAMPLE, 'fr'));
    expect(block.wordCount).toBeGreaterThan(3);
  });
});

describe('a supplied counter', () => {
  it('is stored on the engine and used by a text block', async () => {
    const engine = await makeEditor({ lang: 'fr', countWords: wordLike });
    expect(engine.countWords).toBe(wordLike);
    const block = engine.insert('paragraph', { text: SAMPLE });
    await engine.commit();
    expect(block.wordCount).toBe(3);
  });

  it('is used by the sums: list items, toggles, regions, preamble', async () => {
    const engine = await makeEditor({ countWords: wordLike });
    engine.insert('paragraph', { text: SAMPLE }); // preamble: 3
    const region = engine.insert('region', { regionType: 'chapter', title: 'Some title' });
    engine.insert('paragraph', { text: SAMPLE }, region.id, 0); // 3
    const list = engine.insert('list', {}, region.id, 1);
    const item = engine.insert('list-item', { text: SAMPLE }, list.id, 0); // 3
    const toggle = engine.insert('toggle', { text: 'passe-t-il' }, region.id, 2); // 1
    engine.insert('paragraph', { text: 'Dix-huit' }, toggle.id, 0); // 1
    await engine.commit();
    expect(item.wordCount).toBe(3);
    expect(toggle.wordCount).toBe(2);
    const regions = Regions.get(engine);
    expect(regions.preamble.wordCount).toBe(3);
    const [r] = regions.list;
    expect(r.wordCount).toBe(3 + 3 + 2);
    expect(r.ownWordCount).toBe(3 + 3 + 2);
    expect(r.block.wordCount).toBe(8);
  });

  it('stays reactive in the text, at block and region level', async () => {
    const engine = await makeEditor({ countWords: wordLike });
    const region = engine.insert('region', { regionType: 'chapter', title: 'T' });
    const block = engine.insert('paragraph', { text: 'one two' }, region.id, 0);
    await engine.commit();
    const [r] = Regions.get(engine).list;
    let seen;
    const stop = $effect.root(() => { $effect(() => { seen = [block.wordCount, r.wordCount]; }); });
    await tick();
    expect(seen).toEqual([2, 2]);
    block.behavior.insert(7, ' passe-t-il');
    await engine.commit();
    await tick();
    expect(seen).toEqual([3, 3]);
    stop();
  });

  it('receives the lang of the editor, and the new one when it changes', async () => {
    const counter = vi.fn(wordLike);
    const engine = await makeEditor({ lang: 'fr', countWords: counter });
    const block = engine.insert('paragraph', { text: 'a b' });
    await engine.commit();
    let seen;
    const stop = $effect.root(() => { $effect(() => { seen = block.wordCount; }); });
    await tick();
    expect(counter).toHaveBeenLastCalledWith('a b', 'fr');
    engine.lang = 'en';
    await tick();
    expect(counter).toHaveBeenLastCalledWith('a b', 'en');
    expect(seen).toBe(2);
    stop();
  });

  it('works through createEditor and a preset factory', async () => {
    const counter = (text, lang) => 1;
    expect(createEditor({ countWords: counter }).countWords).toBe(counter);
    const engine = createDocumentEditor({ lang: 'fr', countWords: wordLike });
    expect(engine.countWords).toBe(wordLike);
    await engine.importMarkdown(SAMPLE);
    expect(engine.children.reduce((n, b) => n + b.wordCount, 0)).toBe(3);
  });

  it('is forwarded by createPersistedEditor', async () => {
    expect(rootPersisted).toBe(createPersistedEditor);
    const engine = await createPersistedEditor({ docId: 'word-counter', preset: EXTENSIONS, debounce: 3_600_000, countWords: wordLike });
    expect(engine.countWords).toBe(wordLike);
    const block = engine.insert('paragraph', { text: SAMPLE });
    await engine.commit();
    expect(block.wordCount).toBe(3);
  });
});

describe('an invalid option', () => {
  it('warns and uses the default', () => {
    const warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {});
    for (const bad of [42, 'nope', {}]) {
      warn.mockClear();
      const engine = new Nabu({ extensions: EXTENSIONS, countWords: bad });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('countWords'));
      expect(engine.countWords).toBe(internalCountWords);
    }
    warn.mockRestore();
  });
});

describe('the public exports', () => {
  it('are the same function as the internal one, with identical results', () => {
    expect(rootCountWords).toBe(internalCountWords);
    expect(formatCountWords).toBe(internalCountWords);
    for (const [text, lang] of [['The quick brown fox', 'en'], [SAMPLE, 'fr'], ['我今天去了北京天安门', 'zh'], ['', undefined]]) {
      expect(formatCountWords(text, lang)).toBe(internalCountWords(text, lang));
      expect(rootCountWords(text, lang)).toBe(internalCountWords(text, lang));
    }
  });
});
