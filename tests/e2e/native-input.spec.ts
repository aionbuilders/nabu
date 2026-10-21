/**
 * E2E — native `beforeinput` types (P-72, P-73).
 *
 * Backspace removes a whole grapheme cluster (ZWJ emoji, flag, surrogate pair, letter + combining accent) in ONE press and
 * never leaves half of one. The editor prevents every native mutation, so the input types a browser / OS can send beyond
 * typing (spellcheck replacement, line deletions, transpose, yank, format commands) must be handled by the model: they are
 * dispatched here as synthetic `beforeinput` InputEvents on the editor root, exactly where the browser fires them.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, focusEditor, press } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { buildBlocks, Para, flat } from './helpers/blocks.js';
import { focusAt, selectRange, collectErrors, caret, expectValid } from './helpers/model.js';

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The text of every root text block (raw, no escaping). */
async function texts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).nabu.tree.roots().map((r: any) => r.data.get('text')?.toString() ?? ''));
}

/** The delta (text + marks) of the n-th root block. */
async function delta(page: Page, index = 0): Promise<any[]> {
  return page.evaluate((i) => (window as any).nabu.tree.roots()[i].data.get('text').toDelta(), index);
}

/** Marks-free view of a delta: Loro keeps the run boundaries of an unmarked span, so compare text + "has any mark". */
async function plain(page: Page, index = 0): Promise<{ text: string; marked: boolean }> {
  const d = await delta(page, index);
  return { text: d.map((op) => op.insert).join(''), marked: d.some((op) => !!op.attributes) };
}

/** The model offset of the caret in the (single) focused text block. */
async function offset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const s = window.getSelection()!;
    const el = s.focusNode!.nodeType === 1 ? (s.focusNode as Element) : s.focusNode!.parentElement;
    const block = n.blocks.get(el!.closest('[data-block-id]')!.getAttribute('data-block-id'));
    return block.behaviors.get('text').calculateOffset(s.focusNode, s.focusOffset, block.element) as number;
  });
}

type Fire = { data?: string; text?: string; target?: { block: string; from: number; to: number } };

/**
 * Dispatch a `beforeinput` InputEvent on the editor root. `text` goes in `dataTransfer` (text/plain), `target` is the
 * range `getTargetRanges()` reports (a StaticRange over the block with that text). Returns whether Nabu cancelled it.
 */
async function fire(page: Page, inputType: string, opts: Fire = {}): Promise<boolean> {
  return page.evaluate(({ inputType, opts }) => {
    const n = (window as any).nabu;
    const root = document.querySelector('[data-nabu-root]')!;
    let dataTransfer: DataTransfer | null = null;
    if (opts.text != null) { dataTransfer = new DataTransfer(); dataTransfer.setData('text/plain', opts.text); }
    const ev = new InputEvent('beforeinput', { inputType, data: opts.data ?? null, dataTransfer, bubbles: true, cancelable: true, composed: true });
    // Blink's constructor drops the types it never fires itself (deleteContent, deleteEntireSoftLine…): the event then reads ''.
    if (ev.inputType !== inputType) Object.defineProperty(ev, 'inputType', { value: inputType });
    if (opts.target) {
      const block = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === opts.target!.block && b.element?.isConnected) as any;
      const a = block.behaviors.get('text').getDOMPoint(opts.target.from);
      const b = block.behaviors.get('text').getDOMPoint(opts.target.to);
      const range = new StaticRange({ startContainer: a.node, startOffset: a.offset, endContainer: b.node, endOffset: b.offset });
      Object.defineProperty(ev, 'getTargetRanges', { value: () => [range] });
    }
    root.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, { inputType, opts });
}

test.describe('native input types', () => {
  let errors: ReturnType<typeof collectErrors>;
  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page);
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });
  test.afterEach(async ({ page }) => {
    expect(errors.list(), 'console / page errors').toEqual([]);
    await expectValid(page);
  });

  // ── Backspace: graphemes ────────────────────────────────────────────────
  const CLUSTERS: Array<[string, string]> = [
    ['ZWJ family emoji', '👨‍👩‍👧'],
    ['flag', '🇫🇷'],
    ['surrogate pair (𝒳)', '𝒳'],
    ['letter + combining accent', 'é'],
  ];

  for (const [name, cluster] of CLUSTERS) {
    test(`Backspace after a ${name} removes it in ONE press; Ctrl+Z brings it back`, async ({ page }) => {
      await buildBlocks(page, [Para(`ab${cluster}`)]);
      await focusAt(page, `ab${cluster}`, `ab${cluster}`.length);
      await press(page, 'Backspace');
      await expect.poll(() => texts(page)).toEqual(['ab']);
      expect((await texts(page))[0]).not.toMatch(LONE_SURROGATE);
      await expect.poll(() => offset(page)).toBe(2);
      await undo(page);
      await expect.poll(() => texts(page)).toEqual([`ab${cluster}`]);
      expect((await texts(page))[0]).not.toMatch(LONE_SURROGATE);
    });

    test(`Backspace after a ${name} in the MIDDLE of a text keeps its neighbours`, async ({ page }) => {
      const text = `ab${cluster}cd`;
      await buildBlocks(page, [Para(text)]);
      await focusAt(page, text, 2 + cluster.length);
      await press(page, 'Backspace');
      await expect.poll(() => texts(page)).toEqual(['abcd']);
      await expect.poll(() => offset(page)).toBe(2);
    });

    test(`ArrowLeft / ArrowRight over a ${name}: the model offset never lands inside it`, async ({ page }) => {
      const text = `a${cluster}b`;
      const end = 1 + cluster.length;
      await buildBlocks(page, [Para(text)]);
      await focusAt(page, text, text.length);
      await press(page, 'ArrowLeft');
      expect(await offset(page)).toBe(end);
      await press(page, 'ArrowLeft');
      expect(await offset(page)).toBe(1);
      await press(page, 'ArrowLeft');
      expect(await offset(page)).toBe(0);
      await press(page, 'ArrowRight');
      expect(await offset(page)).toBe(1);
      await press(page, 'ArrowRight');
      expect(await offset(page)).toBe(end);
      await press(page, 'ArrowRight');
      expect(await offset(page)).toBe(text.length);
    });
  }

  test('Backspace repeated eats a text of mixed clusters one by one, never a lone surrogate', async ({ page }) => {
    const text = 'x👨‍👩‍👧🇫🇷𝒳éy';
    await buildBlocks(page, [Para(text)]);
    await focusAt(page, text, text.length);
    for (const expected of ['x👨‍👩‍👧🇫🇷𝒳é', 'x👨‍👩‍👧🇫🇷𝒳', 'x👨‍👩‍👧🇫🇷', 'x👨‍👩‍👧', 'x', '']) {
      await press(page, 'Backspace');
      await expect.poll(() => texts(page)).toEqual([expected]);
      expect((await texts(page))[0]).not.toMatch(LONE_SURROGATE);
    }
  });

  // ── insertReplacementText ───────────────────────────────────────────────
  test('insertReplacementText: spellcheck replaces the target range, caret after it, one undo step', async ({ page }) => {
    await buildBlocks(page, [Para('the wrold is big')]);
    await focusAt(page, 'the wrold is big', 16);
    expect(await fire(page, 'insertReplacementText', { text: 'world', target: { block: 'the wrold is big', from: 4, to: 9 } })).toBe(true);
    await expect.poll(() => texts(page)).toEqual(['the world is big']);
    await expect.poll(() => caret(page)).toBe('the world| is big');
    await undo(page);
    await expect.poll(() => texts(page)).toEqual(['the wrold is big']);
    await redo(page);
    await expect.poll(() => texts(page)).toEqual(['the world is big']);
  });

  test('insertReplacementText keeps the marks of the replaced run', async ({ page }) => {
    await buildBlocks(page, [Para('a wrold b')]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.children[0].behaviors.get('text').container.mark({ start: 2, end: 7 }, 'bold', true);
      await n.commit();
      n.undoManager.clear();
    });
    await focusAt(page, 'a wrold b', 0);
    await fire(page, 'insertReplacementText', { data: 'world', target: { block: 'a wrold b', from: 2, to: 7 } });
    await expect.poll(() => texts(page)).toEqual(['a world b']);
    expect(await delta(page)).toEqual([{ insert: 'a ' }, { insert: 'world', attributes: { bold: true } }, { insert: ' b' }]);
    await undo(page);
    await expect.poll(() => texts(page)).toEqual(['a wrold b']);
  });

  test('insertReplacementText without target ranges replaces the selection', async ({ page }) => {
    await buildBlocks(page, [Para('teh cat')]);
    await selectRange(page, 'teh cat', 0, 'teh cat', 3);
    await fire(page, 'insertReplacementText', { text: 'the' });
    await expect.poll(() => texts(page)).toEqual(['the cat']);
  });

  // ── Line deletions ──────────────────────────────────────────────────────
  const LINES = 'one\ntwo three\nfour';
  for (const [type, at, expected, caretAt] of [
    ['deleteSoftLineBackward', 8, 'one\nthree\nfour', 'one\n|three\nfour'],
    ['deleteHardLineBackward', 8, 'one\nthree\nfour', 'one\n|three\nfour'],
    ['deleteSoftLineForward', 8, 'one\ntwo \nfour', 'one\ntwo |\nfour'],
    ['deleteHardLineForward', 8, 'one\ntwo \nfour', 'one\ntwo |\nfour'],
    ['deleteEntireSoftLine', 8, 'one\n\nfour', 'one\n|\nfour'],
  ] as const) {
    test(`${type} works from the model text, caret placed, Ctrl+Z restores`, async ({ page }) => {
      await buildBlocks(page, [Para(LINES)]);
      await focusAt(page, LINES, at);
      expect(await fire(page, type)).toBe(true);
      await expect.poll(() => texts(page)).toEqual([expected]);
      await expect.poll(async () => (await caret(page))?.replace(/\n/g, '\n')).toBe(caretAt);
      await undo(page);
      await expect.poll(() => texts(page)).toEqual([LINES]);
    });
  }

  test('deleteContent deletes the selection', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await selectRange(page, 'abcdef', 1, 'abcdef', 4);
    await fire(page, 'deleteContent');
    await expect.poll(() => texts(page)).toEqual(['aef']);
    await undo(page);
    await expect.poll(() => texts(page)).toEqual(['abcdef']);
  });

  test('line deletion over a MULTI-block selection deletes the range (deleteRange), one undo step', async ({ page }) => {
    await buildBlocks(page, [Para('alpha beta'), Para('gamma delta')]);
    await selectRange(page, 'alpha beta', 6, 'gamma delta', 5);
    await fire(page, 'deleteSoftLineForward');
    await expect.poll(() => flat(page)).toBe('p(alpha  delta)');
    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(alpha beta) ; p(gamma delta)');
  });

  // ── insertTranspose ─────────────────────────────────────────────────────
  test('insertTranspose swaps the two characters around the caret, caret after; at the end the last two', async ({ page }) => {
    await buildBlocks(page, [Para('abcd')]);
    await focusAt(page, 'abcd', 2);
    expect(await fire(page, 'insertTranspose')).toBe(true);
    await expect.poll(() => texts(page)).toEqual(['acbd']);
    await expect.poll(() => caret(page)).toBe('acb|d');
    await undo(page);
    await expect.poll(() => texts(page)).toEqual(['abcd']);
    await focusAt(page, 'abcd', 4);
    await fire(page, 'insertTranspose');
    await expect.poll(() => texts(page)).toEqual(['abdc']);
    await expect.poll(() => caret(page)).toBe('abdc|');
  });

  test('insertTranspose swaps whole graphemes (emoji, flag, accent)', async ({ page }) => {
    await buildBlocks(page, [Para('a👨‍👩‍👧🇫🇷é')]);
    await focusAt(page, 'a👨‍👩‍👧🇫🇷é', 9);
    await fire(page, 'insertTranspose');
    await expect.poll(() => texts(page)).toEqual(['a🇫🇷👨‍👩‍👧e\u0301']);
    expect((await texts(page))[0]).not.toMatch(LONE_SURROGATE);
  });

  test('insertTranspose at the start / on a single character does nothing', async ({ page }) => {
    await buildBlocks(page, [Para('ab')]);
    await focusAt(page, 'ab', 0);
    await fire(page, 'insertTranspose');
    await expect.poll(() => texts(page)).toEqual(['ab']);
    await buildBlocks(page, [Para('a')]);
    await focusAt(page, 'a', 1);
    await fire(page, 'insertTranspose');
    await expect.poll(() => texts(page)).toEqual(['a']);
    expect(await page.evaluate(() => (window as any).nabu.undoManager.canUndo())).toBe(false);
  });

  // ── insertFromYank ──────────────────────────────────────────────────────
  test('insertFromYank inserts the text at the caret like a plain paste; replaces a selection', async ({ page }) => {
    await buildBlocks(page, [Para('abcdef')]);
    await focusAt(page, 'abcdef', 3);
    expect(await fire(page, 'insertFromYank', { data: 'XY' })).toBe(true);
    await expect.poll(() => texts(page)).toEqual(['abcXYdef']);
    await expect.poll(() => caret(page)).toBe('abcXY|def');
    await undo(page);
    await expect.poll(() => texts(page)).toEqual(['abcdef']);
    await selectRange(page, 'abcdef', 1, 'abcdef', 3);
    await fire(page, 'insertFromYank', { text: 'Z' });
    await expect.poll(() => texts(page)).toEqual(['aZdef']);
  });

  // ── format* ─────────────────────────────────────────────────────────────
  for (const [type, mark] of [
    ['formatBold', 'bold'], ['formatItalic', 'italic'], ['formatUnderline', 'underline'], ['formatStrikeThrough', 'strikethrough'],
  ] as const) {
    test(`${type} toggles ${mark} on the selection (and off again); undo / redo`, async ({ page }) => {
      await buildBlocks(page, [Para('hello world')]);
      await selectRange(page, 'hello world', 0, 'hello world', 5);
      expect(await fire(page, type)).toBe(true);
      await expect.poll(() => delta(page)).toEqual([{ insert: 'hello', attributes: { [mark]: true } }, { insert: ' world' }]);
      await undo(page);
      await expect.poll(() => plain(page)).toEqual({ text: 'hello world', marked: false });
      await redo(page);
      await expect.poll(() => delta(page)).toEqual([{ insert: 'hello', attributes: { [mark]: true } }, { insert: ' world' }]);
      await fire(page, type); // toggle off
      await expect.poll(() => plain(page)).toEqual({ text: 'hello world', marked: false });
    });
  }

  test('formatRemove clears the formatting marks of the selection (links stay)', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const c = n.children[0].behaviors.get('text').container;
      c.mark({ start: 0, end: 5 }, 'bold', true);
      c.mark({ start: 0, end: 5 }, 'italic', true);
      c.mark({ start: 0, end: 5 }, 'link', 'https://example.com');
      await n.commit();
      n.undoManager.clear();
    });
    await selectRange(page, 'hello world', 0, 'hello world', 5);
    await fire(page, 'formatRemove');
    await expect.poll(() => delta(page)).toEqual([{ insert: 'hello', attributes: { link: 'https://example.com' } }, { insert: ' world' }]);
    await undo(page);
    expect((await delta(page))[0].attributes).toMatchObject({ bold: true, italic: true });
  });

  test('formatSubscript / formatSuperscript are swallowed (no such mark): nothing changes, nothing breaks', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await selectRange(page, 'hello world', 0, 'hello world', 5);
    expect(await fire(page, 'formatSubscript')).toBe(true);
    expect(await fire(page, 'formatSuperscript')).toBe(true);
    expect(await plain(page)).toEqual({ text: 'hello world', marked: false });
  });

  test('formatBold at a collapsed caret toggles the stored mark for the next typed text', async ({ page }) => {
    await buildBlocks(page, [Para('ab')]);
    await focusAt(page, 'ab', 2);
    await fire(page, 'formatBold');
    await page.keyboard.type('c');
    await expect.poll(() => delta(page)).toEqual([{ insert: 'ab' }, { insert: 'c', attributes: { bold: true } }]);
  });

  // ── Unknown types / drag move ───────────────────────────────────────────
  test('an unknown input type is cancelled (no native mutation) and changes nothing', async ({ page }) => {
    await buildBlocks(page, [Para('abc')]);
    await focusAt(page, 'abc', 1);
    expect(await fire(page, 'insertSomethingNew')).toBe(true);
    await expect.poll(() => texts(page)).toEqual(['abc']);
  });

  test('a real drag-MOVE of text fires no beforeinput at all (the drop handler does the move; no swallowed deleteByDrag)', async ({ page }) => {
    await buildBlocks(page, [Para('one two three')]);
    await page.evaluate(() => {
      (window as any).__bi = [];
      document.addEventListener('beforeinput', (e) => (window as any).__bi.push(e.inputType), true);
    });
    await selectRange(page, 'one two three', 0, 'one two three', 4);
    const pt = (off: number) => page.evaluate((o) => {
      const n = (window as any).nabu;
      const block = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === 'one two three' && b.element?.isConnected) as any;
      const a = block.getDOMPoint(o > 0 ? o - 1 : 0);
      const b = block.getDOMPoint(o > 0 ? o : 1);
      const r = document.createRange();
      r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
      const rect = r.getBoundingClientRect();
      return { x: o > 0 ? rect.right : rect.left, y: (rect.top + rect.bottom) / 2 };
    }, off);
    const s0 = await pt(1), s1 = await pt(4), end = await pt(13);
    const start = { x: (s0.x + s1.x) / 2, y: s1.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 6, start.y + 4, { steps: 3 });
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => texts(page)).toEqual(['two threeone ']);
    expect(await page.evaluate(() => (window as any).__bi)).toEqual([]);
    await undo(page);
    await expect.poll(() => texts(page)).toEqual(['one two three']);
  });
});
