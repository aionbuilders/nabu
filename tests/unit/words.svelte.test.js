// @ts-nocheck
/**
 * Word counting (P-123): `Intl.Segmenter` in the language of the editor, the whitespace split as a fallback.
 * The count is a `$derived` of the text, so typing re-counts only the block being edited.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { countWords } from '#lib/utils/words.js';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { createDocumentEditor } from '#lib/presets.js';

describe('countWords', () => {
  it('empty and blank texts have no word', () => {
    for (const text of ['', ' ', '   \n\t ', '— – …', '« »']) expect(countWords(text, 'en')).toBe(0);
  });

  it('English: words separated by spaces, punctuation is not a word', () => {
    expect(countWords('Hello world', 'en')).toBe(2);
    expect(countWords('  Hello,   world!  How are you?  ', 'en')).toBe(5);
    expect(countWords('one\ntwo\tthree', 'en')).toBe(3);
    expect(countWords("It's a dog's life, isn't it?", 'en')).toBe(6); // an apostrophe inside a word keeps it whole
    expect(countWords('Pi is 3.14 and 1,000 is a thousand', 'en')).toBe(8); // numbers with separators are one word
  });

  it('French: apostrophes and « » quotation marks', () => {
    expect(countWords("L'homme n'a pas dit « bonjour ».", 'fr')).toBe(5); // L'homme, n'a, pas, dit, bonjour
  });

  it('French: guillemets and dashes standing alone are not words', () => {
    expect(countWords('« Bonjour », dit-il — puis il partit.', 'fr')).toBe(6); // Bonjour, dit, il, puis, il, partit
    expect(countWords('« » — –', 'fr')).toBe(0);
  });

  it('Chinese: a sentence is several words, not one', () => {
    const n = countWords('我今天去了北京天安门', 'zh');
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(10);
    expect(countWords('你好，世界！', 'zh')).toBe(2); // 你好 + 世界 (the punctuation is not counted)
  });

  it('Japanese: kanji, hiragana and katakana', () => {
    const n = countWords('私は昨日東京に行きました。', 'ja');
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(12);
    expect(countWords('これはテストです', 'ja')).toBeGreaterThan(2);
  });

  it('mixed scripts: Latin words and CJK runs add up', () => {
    const n = countWords('Nabu は 素晴らしい editor です', 'ja');
    expect(n).toBeGreaterThanOrEqual(5);
    expect(countWords('Use Nabu 编辑器 today', 'zh')).toBeGreaterThanOrEqual(4);
  });

  it('works without a language, and with a locale the platform rejects', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('one two three', 'zz-not-a-real-locale-tag-xx')).toBe(3);
  });
});

describe('countWords without Intl.Segmenter', () => {
  it('falls back to the whitespace split', async () => {
    vi.resetModules();
    const original = Intl.Segmenter;
    // @ts-ignore
    Intl.Segmenter = undefined;
    try {
      const { countWords: fallback } = await import('#lib/utils/words.js');
      expect(fallback('Hello  world, « bonjour » now', 'fr')).toBe(6); // "«" and "»" count: they are whitespace-separated tokens
      expect(fallback('我今天去了北京天安门', 'zh')).toBe(1); // the known limit of the fallback
      expect(fallback('   ')).toBe(0);
    } finally {
      Intl.Segmenter = original;
      vi.resetModules();
    }
  });
});

const makeEditor = async (lang) => {
  const engine = new Nabu({ extensions: [ParagraphExtension, RichTextExtension], lang });
  await engine.commit();
  return engine;
};

describe('wordCount of a block follows the text and the language of the editor', () => {
  it('counts a Chinese paragraph by words, and a French one by its words', async () => {
    const zh = await makeEditor('zh');
    zh.insert('paragraph', { text: '我今天去了北京天安门' });
    await zh.commit();
    const block = zh.children.find((b) => b.text);
    expect(block.wordCount).toBeGreaterThan(3);
    const fr = await makeEditor('fr');
    fr.insert('paragraph', { text: "L'homme dit « bonjour »." });
    await fr.commit();
    expect(fr.children.find((b) => b.text).wordCount).toBe(3);
  });

  it('is reactive in the text (typing)', async () => {
    const engine = await makeEditor('en');
    const block = engine.insert('paragraph', { text: 'one two' });
    await engine.commit();
    let seen;
    const stop = $effect.root(() => { $effect(() => { seen = block.wordCount; }); });
    await tick();
    expect(seen).toBe(2);
    block.behavior.insert(7, ' three');
    await engine.commit();
    await tick();
    expect(seen).toBe(3);
    stop();
  });

  it('a document sums its blocks (regions, lists, toggles use the same behavior count)', async () => {
    const engine = createDocumentEditor({ lang: 'zh' });
    await engine.commit();
    await engine.importMarkdown('你好，世界！\n\n- 我们 喜欢 编辑器\n\nHello big world');
    await engine.commit();
    const total = engine.children.reduce((sum, b) => sum + b.wordCount, 0);
    expect(total).toBeGreaterThanOrEqual(2 + 3 + 3);
  });

  it('does not re-segment the other blocks when one is typed in', async () => {
    const engine = await makeEditor('en');
    const a = engine.insert('paragraph', { text: 'alpha beta' });
    const b = engine.insert('paragraph', { text: 'gamma delta' });
    await engine.commit();
    const spy = vi.spyOn(Intl, 'Segmenter');
    let counts;
    const stop = $effect.root(() => { $effect(() => { counts = [a.wordCount, b.wordCount]; }); });
    await tick();
    spy.mockClear();
    const segment = vi.spyOn(Intl.Segmenter.prototype, 'segment');
    a.behavior.insert(10, ' epsilon!');
    await engine.commit();
    await tick();
    expect(counts).toEqual([3, 2]);
    expect(segment.mock.calls.length).toBeLessThanOrEqual(1); // only the edited block, only the token with punctuation
    segment.mockRestore();
    spy.mockRestore();
    stop();
  });
});
