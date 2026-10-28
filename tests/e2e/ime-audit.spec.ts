/**
 * E2E — IME / COMPOSITION AUDIT (theme 8b).
 *
 * Real IME events are driven through the Chrome DevTools Protocol:
 *   Input.imeSetComposition  -> compositionstart / compositionupdate + beforeinput(insertCompositionText) + the DOM mutation
 *   Input.insertText         -> commits the running composition (compositionend with data = the committed text)
 * A key an IME swallows (Enter to commit, Backspace to edit the composition, Escape to cancel) reaches the page as a keydown
 * with key "Process" / keyCode 229 and `isComposing`; `imeKey` sends that.
 *
 * LIMITS of this simulation (it is NOT a real OS IME): no candidate window, no OS-level reconversion, no Android/iOS virtual keyboard
 * quirks (those send a different event order: composition + deleteContentBackward + insertCompositionText with Gboard, keyCode 229
 * on every key, `beforeinput` without a preceding keydown, spelling-correct "replace word" composition...), no macOS press-and-hold
 * accent popup, no Firefox / WebKit event order (compositionend BEFORE the last input event in Chromium vs. after in Firefox/Safari).
 * Mobile virtual keyboards are a separate future theme.
 *
 * The expectations describe the CORRECT behaviour; a scenario the product does not meet is a `test.fixme('… — FINDING: …')`.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press, getJson, exec, flushRender, waitForEditor } from './helpers/editor.js';
import { undo, redo, bold } from './helpers/keyboard.js';
import { buildBlocks, buildTree, flat, tree, Para, H, Code, Tog, Pp } from './helpers/blocks.js';
import { buildDoc, P, UL, I, outline, caret, focusAt, focusEnd, focusEmpty, selectRange, collectErrors, allText } from './helpers/model.js';
import type { CDPSession } from '@playwright/test';

let errors: ReturnType<typeof collectErrors>;
let cdp: CDPSession;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
  cdp = await page.context().newCDPSession(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

// ── helpers ────────────────────────────────────────────────────────────────

/** One composition step: the text in the composition string, the caret inside it (default: at its end). */
const ime = (text: string, at: number = text.length) =>
  cdp.send('Input.imeSetComposition', { text, selectionStart: at, selectionEnd: at });
/** Commit the running composition with `text` (what the IME decided to insert). */
const commit = (text: string) => cdp.send('Input.insertText', { text });
/** A key the IME swallows: the page sees a keydown with key "Process" / keyCode 229 (and `isComposing`). */
const imeKey = async (code: string) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: code, code, windowsVirtualKeyCode: code === 'Enter' ? 13 : code === 'Backspace' ? 8 : 27 });
};

const composing = (page: Page) => page.evaluate(() => (window as any).nabu.composing as boolean);
const canUndo = (page: Page) => page.evaluate(() => (window as any).nabu.undoManager.canUndo());
const settle = async (page: Page) => { await flushRender(page); await page.evaluate(() => new Promise((r) => setTimeout(r, 60))); await flushRender(page); };

/** The id of the (unique) block whose model text is `text`. */
const idOf = (page: Page, text: string) => page.evaluate((t) => {
  const hits = [...(window as any).nabu.blocks.values()].filter((b: any) => b.behaviors?.get('text')?.text === t && document.querySelector(`[data-block-id="${b.id}"]`));
  if (hits.length !== 1) throw new Error(`expected exactly one block with text "${t}", found ${hits.length}`);
  return (hits[0] as any).id as string;
}, text);

/** The rendered text of a block's OWN text element (the first text-bearing element, children blocks excluded). */
const domText = (page: Page, id: string) => page.evaluate((i) => {
  const root = document.querySelector(`[data-block-id="${i}"]`)!;
  const own = (root.querySelector('[contenteditable], .nabu-text, .nabu-region-title, [data-nabu-text]') as HTMLElement | null) ?? (root as HTMLElement);
  return own.textContent ?? '';
}, id);

/** Text of the first block (root level) minus the render filler: delta runs `{ text, bold?, link? }`. */
async function runs(page: Page, index = 0): Promise<Array<Record<string, any>>> {
  const json = await getJson(page);
  return json.blocks[index].content ?? [];
}

/** Standard "compose then commit" check on a paragraph: returns nothing, asserts model + caret + DOM + state. */
async function expectCommitted(page: Page, expectedFlat: string, expectedCaret: string, id?: string, expectedDom?: string) {
  await expect.poll(() => flat(page)).toBe(expectedFlat);
  await expect.poll(() => caret(page)).toBe(expectedCaret);
  expect(await composing(page)).toBe(false);
  if (id && expectedDom !== undefined) expect(await domText(page, id)).toBe(expectedDom);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Dead keys / accents
// ═══════════════════════════════════════════════════════════════════════════

test.describe('1 · dead keys', () => {
  test('1a · acute accent at the end: `´` then `e` -> `é` (composition `´`, commit `é`); caret after; ONE undo step', async ({ page }) => {
    await buildBlocks(page, [Para('caf')]);
    await focusEnd(page, 'caf');
    const id = await idOf(page, 'caf');
    await ime('´');
    expect(await composing(page)).toBe(true);
    expect(await domText(page, id)).toBe('caf´'); // the browser shows the pending accent
    await commit('é');
    await expectCommitted(page, 'p(café)', 'café|', id, 'café');
    expect(await outline(page)).toBe('p(café)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(caf)'); // one step: nothing left of the accent
    expect(await canUndo(page)).toBe(false);
    await expect.poll(() => domText(page, id)).toBe('caf');
  });

  test('1b · circumflex in the middle: `^` then `o` -> `ô`, caret right after it, one undo step', async ({ page }) => {
    await buildBlocks(page, [Para('htel')]);
    await focusAt(page, 'htel', 1);
    const id = await idOf(page, 'htel');
    await ime('^');
    await commit('ô');
    await expectCommitted(page, 'p(hôtel)', 'hô|tel', id, 'hôtel');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(htel)');
    expect(await canUndo(page)).toBe(false);
  });

  test('1c · a dead key followed by a letter that does not combine commits BOTH characters (`´` + `x` -> `´x`)', async ({ page }) => {
    await buildBlocks(page, [Para('ab')]);
    await focusEnd(page, 'ab');
    await ime('´');
    await commit('´x');
    await expectCommitted(page, 'p(ab´x)', 'ab´x|');
  });

  test('1d · dead key then the editor goes on: the next typed keys are plain inserts at the caret', async ({ page }) => {
    await buildBlocks(page, [Para('caf')]);
    await focusEnd(page, 'caf');
    await ime('´');
    await commit('é');
    await expect.poll(() => caret(page)).toBe('café|');
    await page.keyboard.type('s');
    await expect.poll(() => flat(page)).toBe('p(cafés)');
    await expect.poll(() => caret(page)).toBe('cafés|');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Japanese / Chinese / Korean
// ═══════════════════════════════════════════════════════════════════════════

test.describe('2 · CJK', () => {
  test('2a · Japanese: k -> か -> かん -> 漢 -> commit `漢字`; model, DOM, caret; one undo step', async ({ page }) => {
    await buildBlocks(page, [Para('ab')]);
    await focusEnd(page, 'ab');
    const id = await idOf(page, 'ab');
    for (const s of ['k', 'か', 'かn', 'かん', 'かんj', 'かんじ', '漢字']) {
      await ime(s);
      expect(await composing(page)).toBe(true);
      expect(await domText(page, id)).toBe('ab' + s);
    }
    expect(await flat(page)).toBe('p(ab)'); // the model catches up at the end of the composition
    await commit('漢字');
    await expectCommitted(page, 'p(ab漢字)', 'ab漢字|', id, 'ab漢字');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(ab)');
    expect(await canUndo(page)).toBe(false);
  });

  test('2b · Chinese pinyin: `ni hao` -> 你好 (composition keeps the spaces, commit replaces them)', async ({ page }) => {
    await buildBlocks(page, [Para('x')]);
    await focusEnd(page, 'x');
    const id = await idOf(page, 'x');
    for (const s of ['n', 'ni', 'ni h', 'ni ha', 'ni hao']) await ime(s);
    expect(await domText(page, id)).toBe('xni hao');
    await commit('你好');
    await expectCommitted(page, 'p(x你好)', 'x你好|', id, 'x你好');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(x)');
  });

  test('2c · Korean: Hangul syllable building ㅎ -> 하 -> 한, the next syllable commits the previous one', async ({ page }) => {
    await buildBlocks(page, [Para('>')]);
    await focusEnd(page, '>');
    const id = await idOf(page, '>');
    await ime('ㅎ');
    await ime('하');
    await ime('한');
    expect(await domText(page, id)).toBe('>한');
    await commit('한'); // ㄱ arrives: the syllable 한 is final ...
    await expect.poll(() => flat(page)).toBe('p(>한)');
    expect(await composing(page)).toBe(false);
    await ime('ㄱ'); // ... and a new composition starts
    expect(await composing(page)).toBe(true);
    await ime('그');
    await ime('글');
    expect(await domText(page, id)).toBe('>한글');
    await commit('글');
    await expectCommitted(page, 'p(>한글)', '>한글|', id, '>한글');
    // undo takes it all back (one or two steps — merging is time based), never leaves a half syllable
    for (let i = 0; i < 3 && (await canUndo(page)); i++) await undo(page);
    await expect.poll(() => flat(page)).toBe('p(>)');
  });

  test('2d · Korean: a syllable followed by a SPACE commits both in one go (`한` + ` `)', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    await ime('ㅎ');
    await ime('하');
    await ime('한');
    await commit('한 ');
    await expectCommitted(page, 'p(한 )', '한 |');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Where the composition happens
// ═══════════════════════════════════════════════════════════════════════════

test.describe('3 · composition positions', () => {
  for (const [name, offset, expected, caretStr] of [
    ['start', 0, 'p(かなhello)', 'かな|hello'],
    ['middle', 2, 'p(heかなllo)', 'heかな|llo'],
    ['end', 5, 'p(helloかな)', 'helloかな|'],
  ] as const) {
    test(`3a · ${name} of a paragraph`, async ({ page }) => {
      await buildBlocks(page, [Para('hello')]);
      await focusAt(page, 'hello', offset);
      const id = await idOf(page, 'hello');
      await ime('か');
      await ime('かな');
      expect(await domText(page, id)).toBe(['hello'.slice(0, offset), 'かな', 'hello'.slice(offset)].join(''));
      await commit('かな');
      await expectCommitted(page, expected, caretStr, id, expected.slice(2, -1));
      await undo(page);
      await expect.poll(() => flat(page)).toBe('p(hello)');
    });
  }

  test('3b · inside BOLD text the committed text keeps the mark; one undo step', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await selectRange(page, 'hello world', 6, 'hello world', 11);
    await bold(page);
    expect((await runs(page)).filter((r) => r.bold).map((r) => r.text).join('')).toBe('world');
    await focusAt(page, 'hello world', 8); // wo|rld
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => flat(page)).toBe('p(hello woかなrld)');
    await expect.poll(() => caret(page)).toBe('hello woかな|rld');
    const r = await runs(page);
    expect(r.filter((x) => x.bold).map((x) => x.text).join('')).toBe('woかなrld');
    expect(r.filter((x) => !x.bold).map((x) => x.text).join('')).toBe('hello ');
  });

  test('3c · inside a LINK the committed text is part of the link', async ({ page }) => {
    await buildBlocks(page, [Para('see example now')]);
    await selectRange(page, 'see example now', 4, 'see example now', 11);
    await exec(page, 'link:set', { href: 'https://example.com' });
    await focusAt(page, 'see example now', 7); // exa|mple
    await ime('か');
    await commit('か');
    await expect.poll(() => flat(page)).toBe('p(see exaかmple now)');
    const r = await runs(page);
    expect(r.filter((x) => x.link).map((x) => x.text).join('')).toBe('exaかmple');
    expect(r.filter((x) => !x.link).map((x) => x.text).join('')).toBe('see  now');
    await expect.poll(() => caret(page)).toBe('see exaか|mple now');
  });

  test('3d · in a heading', async ({ page }) => {
    await buildBlocks(page, [H('Title', 2)]);
    await focusEnd(page, 'Title');
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expectCommitted(page, 'h2(Titleかな)', 'Titleかな|');
  });

  test('3e · in a list item (model outline, caret, structure untouched)', async ({ page }) => {
    await buildDoc(page, [{ kind: 'list', listType: 'bullet', items: [{ text: 'one' }, { text: 'two' }] }]);
    await focusEnd(page, 'one');
    const id = await idOf(page, 'one');
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => outline(page)).toBe('ul[oneかな, two]');
    await expect.poll(() => caret(page)).toBe('oneかな|');
    expect(await domText(page, id)).toBe('oneかな');
    await undo(page);
    await expect.poll(() => outline(page)).toBe('ul[one, two]');
  });

  test('3f · in a toggle header (the body is untouched)', async ({ page }) => {
    await buildTree(page, [Tog('Header', [Pp('child')])]);
    await focusEnd(page, 'Header');
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => tree(page)).toBe('toggle▾(Headerかな){p(child)}');
    await expect.poll(() => caret(page)).toBe('Headerかな|');
    expect(await composing(page)).toBe(false);
  });

  test('3g · in a code block (also inside, after a newline)', async ({ page }) => {
    await buildTree(page, [Code('x = 1\ny = 2', 'js')]);
    await focusAt(page, 'x = 1\ny = 2', 6); // start of line 2
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => tree(page)).toBe('code:js(x = 1\\nかなy = 2)');
    await expect.poll(() => caret(page)).toBe('x = 1\nかな|y = 2');
    await undo(page);
    await expect.poll(() => tree(page)).toBe('code:js(x = 1\\ny = 2)');
  });

  test('3h · in a region title (isolated field)', async ({ page }) => {
    await gotoEditor(page, { seed: 'regions' });
    await focusEnd(page, 'The bank');
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => outline(page)).toContain('R:section-2(The bankかな)');
    await expect.poll(() => caret(page)).toBe('The bankかな|');
    await expect(page.locator('.nabu-region-title').nth(1)).toHaveText('The bankかな');
    expect(await composing(page)).toBe(false);
  });

  test('3i · in an EMPTY paragraph: the placeholder goes away during the composition and is never inserted as text', async ({ page }) => {
    const para = page.locator('[data-block-type="paragraph"]').first();
    await focusEmpty(page);
    await expect(para).toHaveAttribute('data-placeholder', 'Start writing...');
    await ime('か');
    // the composed text is on screen: a placeholder painted over it would overlap the text
    await expect(para).toHaveAttribute('data-placeholder', '');
    await ime('かな');
    await expect(para).toHaveText('かな');
    await commit('かな');
    await expectCommitted(page, 'p(かな)', 'かな|');
    expect(await allText(page)).toEqual(['かな']);
    await expect(para).toHaveText('かな');
    await expect(para).toHaveAttribute('data-placeholder', '');
  });

  test('3i′ · composing in an empty paragraph inserts only the composed text (the placeholder is never text)', async ({ page }) => {
    await focusEmpty(page);
    await ime('か');
    await commit('か');
    await expectCommitted(page, 'p(か)', 'か|');
    expect(await allText(page)).toEqual(['か']);
    expect(await page.locator('[data-block-type="paragraph"]').first().textContent()).toBe('か');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(∅)');
  });

  test('3j′ · a canceled composition in an empty paragraph leaves the MODEL empty (nothing inserted)', async ({ page }) => {
    await focusEmpty(page);
    await ime('か');
    await ime('');
    await settle(page);
    expect(await flat(page)).toBe('p(∅)');
    expect(await allText(page)).toEqual(['']);
    expect(await composing(page)).toBe(false);
    expect(await canUndo(page)).toBe(false);
  });

  test('3j · a CANCELED composition in an empty paragraph brings the placeholder back and leaves the model empty', async ({ page }) => {
    const para = page.locator('[data-block-type="paragraph"]').first();
    await focusEmpty(page);
    await ime('か');
    await ime('');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(∅)');
    await expect(para).toHaveText('');
    await expect(para).toHaveAttribute('data-placeholder', 'Start writing...');
    await page.keyboard.type('z');
    await expect.poll(() => flat(page)).toBe('p(z)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Composition over a selection
// ═══════════════════════════════════════════════════════════════════════════

test.describe('4 · composition with a non-collapsed selection', () => {
  test('4a · within one block: the selection is replaced by the composed text, no duplication, one undo step', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await selectRange(page, 'hello world', 6, 'hello world', 11); // "world"
    const id = await idOf(page, 'hello world');
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expectCommitted(page, 'p(hello かな)', 'hello かな|', id, 'hello かな');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(hello world)'); // the selection text is back, once
    expect(await canUndo(page)).toBe(false);
  });

  test('4b · a selection that starts at the very beginning of the block', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await selectRange(page, 'hello world', 0, 'hello world', 5);
    await ime('か');
    await commit('か');
    await expectCommitted(page, 'p(か world)', 'か| world');
  });

  test('4c · over SEVERAL blocks: the range is replaced (blocks merged into one holding the composed text), nothing duplicated', async ({ page }) => {
    await buildBlocks(page, [Para('hello'), Para('there'), Para('world')]);
    await selectRange(page, 'hello', 2, 'world', 3); // he[llo there wor]ld
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => flat(page)).toBe('p(heかなld)');
    await expect.poll(() => caret(page)).toBe('heかな|ld');
    expect(await composing(page)).toBe(false);
  });

  test('4d · over SEVERAL blocks: the DOM matches the model during the composition and ONE undo brings the 3 blocks back', async ({ page }) => {
    await buildBlocks(page, [Para('hello'), Para('there'), Para('world')]);
    await selectRange(page, 'hello', 2, 'world', 3);
    await ime('か');
    expect(await composing(page)).toBe(true);
    expect(await flat(page)).toBe('p(held)'); // the range is already deleted in the model, head and tail merged
    await commit('か');
    await expectCommitted(page, 'p(heかld)', 'heか|ld');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(hello) ; p(there) ; p(world)');
    expect(await canUndo(page)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Keys during a composition
// ═══════════════════════════════════════════════════════════════════════════

test.describe('5 · Enter / Backspace / Escape during a composition', () => {
  test('5a · Enter swallowed by the IME (keyCode 229) COMMITS the composition and does NOT split the block', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await ime('かな');
    await imeKey('Enter');
    await commit('かな'); // what the IME does with that Enter
    await expect.poll(() => flat(page)).toBe('p(abcかな)'); // ONE block
    await expect.poll(() => caret(page)).toBe('abcかな|');
    expect(await composing(page)).toBe(false);
  });

  test('5b · a real Enter keydown (CDP key event, not 229) while composing: the block is not split and the text is not lost', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await ime('かな');
    await page.keyboard.press('Enter');
    await settle(page);
    // Either the composition was committed (abcかな) or still running: in no case two blocks, no loss, no duplicate.
    const f = await flat(page);
    expect(f).not.toContain(' ; ');
    if (await composing(page)) await commit('かな');
    await settle(page);
    expect(await flat(page)).toBe('p(abcかな)');
    expect(await composing(page)).toBe(false);
  });

  test('5c · Backspace edits the composition (かな -> か); the committed text before it is untouched', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    const id = await idOf(page, 'abc');
    await ime('か');
    await ime('かな');
    await imeKey('Backspace');
    await ime('か');
    expect(await domText(page, id)).toBe('abcか');
    await commit('か');
    await expectCommitted(page, 'p(abcか)', 'abcか|', id, 'abcか');
  });

  test('5d · Backspace that erases the WHOLE composition ends it empty; the committed text stays', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    const id = await idOf(page, 'abc');
    await ime('k');
    await imeKey('Backspace');
    await ime('');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(abc)');
    expect(await domText(page, id)).toBe('abc');
    expect(await composing(page)).toBe(false);
    await expect.poll(() => caret(page)).toBe('abc|');
    await page.keyboard.type('d'); // the editor still works
    await expect.poll(() => flat(page)).toBe('p(abcd)');
  });

  test('5e · a real Backspace keydown (CDP) in the middle of a composition does not delete the committed text before it', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('かな');
    await page.keyboard.press('Backspace');
    await settle(page);
    if (await composing(page)) await commit(await page.evaluate(() => document.querySelector('[data-block-type="paragraph"]')!.textContent!.slice(3)));
    await settle(page);
    const f = await flat(page);
    expect(f.startsWith('p(abc')).toBe(true); // "abc" survived, whatever became of the composed kana
    expect(await composing(page)).toBe(false);
  });

  test('5f · Escape cancels the composition: the text is restored, nothing inserted, the editor is usable', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    const id = await idOf(page, 'abc');
    await ime('か');
    await ime('かな');
    await imeKey('Escape');
    await ime(''); // the IME drops the composition string
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(abc)');
    expect(await domText(page, id)).toBe('abc');
    expect(await composing(page)).toBe(false);
    await expect.poll(() => caret(page)).toBe('abc|');
    await page.keyboard.type('d');
    await expect.poll(() => flat(page)).toBe('p(abcd)');
    expect(await canUndo(page)).toBe(true);
  });

  test('5g · a canceled composition is not an undo step: undo goes back to the text BEFORE it', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await ime('');
    await settle(page);
    expect(await canUndo(page)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Undo / redo
// ═══════════════════════════════════════════════════════════════════════════

test.describe('6 · undo / redo', () => {
  test('6a · undo right after a composition, then redo, then undo again (text, caret, no stale composition)', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await ime('かな');
    await commit('かな');
    await expect.poll(() => flat(page)).toBe('p(abcかな)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abc)');
    await expect.poll(() => caret(page)).toBe('abc|');
    await redo(page);
    await expect.poll(() => flat(page)).toBe('p(abcかな)');
    await expect.poll(() => caret(page)).toBe('abcかな|');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abc)');
    expect(await composing(page)).toBe(false);
  });

  test('6b · typing right after the undo of a composition inserts at the restored caret', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusAt(page, 'abc', 1);
    await ime('か');
    await commit('か');
    await expect.poll(() => flat(page)).toBe('p(aかbc)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(abc)');
    await page.keyboard.type('X');
    await expect.poll(() => flat(page)).toBe('p(aXbc)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Shortcuts / typography never fire in the middle of a composition
// ═══════════════════════════════════════════════════════════════════════════

test.describe('7 · markdown shortcuts and typography', () => {
  test('7a · `# ` composed (the space is part of the composition) does not turn the paragraph into a heading', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    await ime('#');
    await ime('# ');
    expect(await flat(page)).toBe('p(∅)');
    expect(await page.locator('[data-block-type="heading"]').count()).toBe(0);
    await commit('# ');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(# )');
    await expect.poll(() => caret(page)).toBe('# |');
  });

  test('7b · `- ` composed does not start a list', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    await ime('-');
    await ime('- ');
    await commit('- ');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(- )');
  });

  test('7c · `--` and straight quotes composed stay as typed (no smart dash / quote swap inside a composition)', async ({ page }) => {
    await buildBlocks(page, [Para('a')]);
    await focusEnd(page, 'a');
    await ime('--');
    await commit('--');
    await ime('"');
    await commit('"');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(a--")');
  });

  test('7d · the shortcut still works for text typed AFTER a composition: IME-committed `#`, then a real space -> heading', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    await ime('#');
    await commit('#');
    await settle(page);
    await expect.poll(() => caret(page)).toBe('#|');
    await page.keyboard.type(' ');
    await expect.poll(() => flat(page)).toBe('h1(∅)');
  });

  test('7e · a composed `/` does not open or break anything (text `/` is inserted; the editor stays usable)', async ({ page }) => {
    // NOTE: the slash menu / floating toolbar are keydown / selection driven; an IME `/` (fullwidth `／` on CJK layouts) is a composition.
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    await ime('/');
    await commit('/');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(/)');
    await page.keyboard.type('x');
    await expect.poll(() => flat(page)).toBe('p(/x)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Model changes under a running composition
// ═══════════════════════════════════════════════════════════════════════════

test.describe('8 · programmatic / remote model change during a composition', () => {
  test('8a · a block inserted elsewhere (window.nabu) does not break the composition', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await page.evaluate(async () => { const n = (window as any).nabu; n.insert('paragraph', { text: 'other' }, null, 1); await n.commit(); });
    await settle(page);
    expect(await composing(page)).toBe(true);
    await ime('かな');
    await commit('かな');
    await expect.poll(() => flat(page)).toBe('p(abcかな) ; p(other)');
    await expect.poll(() => caret(page)).toBe('abcかな|');
  });

  test('8b · the text of ANOTHER block edited programmatically during the composition', async ({ page }) => {
    await buildBlocks(page, [Para('abc'), Para('other')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === 'other') as any;
      b.behaviors.get('text').container.insert(0, '>>');
      await n.commit();
    });
    await settle(page);
    await ime('かな');
    await commit('かな');
    await expect.poll(() => flat(page)).toBe('p(abcかな) ; p(>>other)');
    await expect.poll(() => caret(page)).toBe('abcかな|');
  });

  test('8c · the SAME block edited programmatically (text inserted at its start) during the composition: both edits survive, once', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === 'abc') as any;
      b.behaviors.get('text').container.insert(0, '>>');
      await n.commit();
    });
    await settle(page);
    await ime('かな');
    await commit('かな');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(>>abcかな)');
    await expect.poll(() => caret(page)).toBe('>>abcかな|');
  });

  test('8c′ · a Loro update imported DIRECTLY (nabu.importRemote) into the SAME block during the composition shifts the composition anchor', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusEnd(page, 'abc');
    await ime('か');
    await page.evaluate(() => {
      const n = (window as any).nabu;
      const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === 'abc') as any;
      const peer = new (n.doc.constructor)();
      peer.import(n.doc.export({ mode: 'snapshot' }));
      peer.getText(b.behaviors.get('text').container.id).insert(0, '>>');
      peer.commit();
      n.importRemote(peer.export({ mode: 'update', from: n.doc.version() }));
    });
    await settle(page);
    await ime('かな');
    await commit('かな');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(>>abcかな)');
    await expect.poll(() => caret(page)).toBe('>>abcかな|');
    expect(await composing(page)).toBe(false);
  });

  test('8d · live sync (BroadcastChannel): a remote edit of ANOTHER block is held during the composition and applied after it', async ({ context }) => {
    const id = `e2e-ime-${Date.now()}-a`;
    const a = await context.newPage();
    const b = await context.newPage();
    await gotoEditor(a, { persist: id });
    await a.evaluate(async () => { const n = (window as any).nabu; for (const c of [...n.children]) n.delete(c); n.insert('paragraph', { text: 'base' }); n.insert('paragraph', { text: 'other' }); await n.commit(); await n.saveNow(); });
    await gotoEditor(b, { persist: id });
    await expect.poll(() => allText(b)).toContain('other');
    const cdpA = await context.newCDPSession(a);
    await focusEnd(a, 'base');
    await cdpA.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    expect(await a.evaluate(() => (window as any).nabu.composing)).toBe(true);
    await b.evaluate(async () => {
      const n = (window as any).nabu;
      const blk = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === 'other') as any;
      blk.behaviors.get('text').container.insert(0, '>>');
      await n.commit();
    });
    await a.waitForTimeout(400); // KEEP: a would-be (wrong) immediate import has had its chance
    expect(await allText(a)).not.toContain('>>other'); // held while composing
    expect(await a.evaluate(() => document.querySelector('[data-block-type="paragraph"]')!.textContent)).toBe('baseか');
    await cdpA.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
    await cdpA.send('Input.insertText', { text: 'かな' });
    await expect.poll(() => allText(a), { timeout: 5000 }).toEqual(['baseかな', '>>other']);
    await expect.poll(() => caret(a)).toBe('baseかな|');
    await expect.poll(() => allText(b), { timeout: 5000 }).toEqual(['baseかな', '>>other']);
  });

  test('8e · live sync: a remote edit of the SAME block (insert at its start) merges with the composed text', async ({ context }) => {
    const id = `e2e-ime-${Date.now()}-b`;
    const a = await context.newPage();
    const b = await context.newPage();
    await gotoEditor(a, { persist: id });
    await a.evaluate(async () => { const n = (window as any).nabu; for (const c of [...n.children]) n.delete(c); n.insert('paragraph', { text: 'base' }); await n.commit(); await n.saveNow(); });
    await gotoEditor(b, { persist: id });
    await expect.poll(() => allText(b)).toContain('base');
    const cdpA = await context.newCDPSession(a);
    await focusEnd(a, 'base');
    await cdpA.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    await b.evaluate(async () => {
      const n = (window as any).nabu;
      const blk = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text')?.text === 'base') as any;
      blk.behaviors.get('text').container.insert(0, '>>');
      await n.commit();
    });
    await a.waitForTimeout(300);
    await cdpA.send('Input.insertText', { text: 'か' });
    await expect.poll(() => allText(a), { timeout: 5000 }).toEqual(['>>baseか']);
    await expect.poll(() => caret(a)).toBe('>>baseか|');
    await expect.poll(() => allText(b), { timeout: 5000 }).toEqual(['>>baseか']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. After a committed composition, the editor keeps working (GitHub issue #6)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('9 · after a commit (issue #6: "Enter stops working after Japanese IME input")', () => {
  // ROOT CAUSE (issue #6): an empty block renders a lone "\n" text node. Chromium finds the running composition by plain-text offsets and
  // that mapping drifts by one per such node BEFORE the composition: the composed text landed in the previous block and the next
  // `compositionupdate` deleted the blocks in between, so the commit never came. Fixed by swapping those nodes for a <br> while a composition
  // runs (utils/composition.js). The first composition is not needed: any composition after empty blocks reproduces it.
  /** The nth block's text of the live DOM, per top-level paragraph, and whether it still renders the lone "\n" placeholder. */
  const placeholders = (page: Page) => page.evaluate(() =>
    [...document.querySelectorAll('[data-nabu-root] [data-block-type]')].map((el) => ({ type: (el as HTMLElement).dataset.blockType, text: el.textContent, br: el.querySelectorAll('br').length })));
  /** A full `a, あ, あい, 愛` composition committed with `愛`. */
  const composeAi = async (page: Page) => {
    for (const s of ['a', 'あ', 'あい', '愛']) await ime(s);
    await commit('愛');
    await settle(page);
  };

  test('9a · テスト, Enter, Enter, 愛: the Enters split the block, the text lands where typed', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    for (const s of ['t', 'て', 'てs', 'てす', 'てすt', 'てすと', 'テスト']) await ime(s);
    await commit('テスト');
    await settle(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await composeAi(page);
    await expect.poll(() => allText(page)).toEqual(['テスト', '', '愛']);
    expect(await composing(page)).toBe(false);
    await expect.poll(() => caret(page)).toBe('愛|');
    // the empty block in the middle still renders its placeholder, untouched by the workaround
    expect(await placeholders(page)).toEqual([
      { type: 'paragraph', text: 'テスト', br: 0 }, { type: 'paragraph', text: '\n', br: 0 }, { type: 'paragraph', text: '愛', br: 0 },
    ]);
  });

  test('9a2 · the same, then Enter and a third composition: the editor keeps working', async ({ page }) => {
    await buildBlocks(page, [Para('')]);
    await focusEmpty(page);
    await ime('か'); await commit('か'); await settle(page);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await composeAi(page);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await ime('に'); await commit('日'); await settle(page);
    await expect.poll(() => allText(page)).toEqual(['か', '', '愛', '', '日']);
    expect(await composing(page)).toBe(false);
    await expect.poll(() => caret(page)).toBe('日|');
    await page.keyboard.type('x');
    await expect.poll(() => allText(page)).toEqual(['か', '', '愛', '', '日x']);
  });

  test('9c · no first composition needed: the second of two empty paragraphs gets the composed text, the first stays empty', async ({ page }) => {
    await buildBlocks(page, [Para(''), Para('')]);
    await focusEmpty(page, 1);
    await composeAi(page);
    await expect.poll(() => flat(page)).toBe('p(∅) ; p(愛)');
    expect(await composing(page)).toBe(false);
    await expect.poll(() => caret(page)).toBe('愛|');
  });

  test('9d · the third of three empty paragraphs (two empty blocks before the composition)', async ({ page }) => {
    await buildBlocks(page, [Para(''), Para(''), Para('')]);
    await focusEmpty(page, 2);
    await composeAi(page);
    await expect.poll(() => flat(page)).toBe('p(∅) ; p(∅) ; p(愛)');
    expect(await composing(page)).toBe(false);
    expect(await placeholders(page)).toEqual([
      { type: 'paragraph', text: '\n', br: 0 }, { type: 'paragraph', text: '\n', br: 0 }, { type: 'paragraph', text: '愛', br: 0 },
    ]);
  });

  test('9e · composing at the END of a filled paragraph that follows empty ones', async ({ page }) => {
    await buildBlocks(page, [Para(''), Para(''), Para('ab')]);
    await focusEnd(page, 'ab');
    await ime('か'); await ime('漢');
    await commit('漢');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(∅) ; p(∅) ; p(ab漢)');
    await expect.poll(() => caret(page)).toBe('ab漢|');
    expect(await composing(page)).toBe(false);
  });

  test('9f · a heading and a list item after empty paragraphs', async ({ page }) => {
    await buildBlocks(page, [Para(''), Para(''), H('', 2)]);
    await focusEmpty(page, 2);
    await composeAi(page);
    await expect.poll(() => flat(page)).toBe('p(∅) ; p(∅) ; h2(愛)');
    await buildDoc(page, [P(''), P(''), UL(I(''))]);
    await focusEmpty(page, 2);
    await composeAi(page);
    await expect.poll(() => outline(page)).toContain('愛');
    await expect.poll(() => allText(page)).toEqual(['', '', '愛']);
    expect(await composing(page)).toBe(false);
  });

  test('9g · a composition canceled after empty paragraphs leaves the placeholders and the caret in place', async ({ page }) => {
    await buildBlocks(page, [Para(''), Para(''), Para('')]);
    await focusEmpty(page, 2);
    await ime('か'); await ime('かな');
    await imeKey('Escape');
    await ime('');
    await settle(page);
    await expect.poll(() => flat(page)).toBe('p(∅) ; p(∅) ; p(∅)');
    expect(await composing(page)).toBe(false);
    expect(await placeholders(page)).toEqual([
      { type: 'paragraph', text: '\n', br: 0 }, { type: 'paragraph', text: '\n', br: 0 }, { type: 'paragraph', text: '\n', br: 0 },
    ]);
    await page.keyboard.type('d');
    await expect.poll(() => flat(page)).toBe('p(∅) ; p(∅) ; p(d)');
  });

  test('9b · Backspace and Delete work after a commit', async ({ page }) => {
    await buildBlocks(page, [Para('ab')]);
    await focusEnd(page, 'ab');
    await ime('か'); await ime('かん'); await ime('漢');
    await commit('漢字');
    await settle(page);
    await page.keyboard.press('Backspace');
    await expect.poll(() => allText(page)).toEqual(['ab漢']);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Delete');
    await expect.poll(() => allText(page)).toEqual(['a漢']);
  });
});
