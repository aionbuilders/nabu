/**
 * E2E — a mark taken off leaves ONE run, in the model and in the DOM.
 *
 * Loro keeps a split where a mark is removed over exactly the range it was applied to (`The ford is upstre` + `am.`); the engine
 * reads every delta through `readDelta` (src/lib/utils/delta.js), so the JSON export has a single segment and the block holds a
 * single text node (two would break the spellcheck squiggles, the double-click word selection and the word delete).
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, focusEditor, getBlock, typeText, press, getJson } from './helpers/editor.js';
import { bold, italic, undo, redo, selectForward } from './helpers/keyboard.js';

type Run = { text: string; [mark: string]: any };

const SENTENCE = 'The ford is upstream.';

async function runs(page: Page, index = 0): Promise<Run[]> {
  return (await getJson(page)).blocks[index].content ?? [];
}

/** The text nodes (with text) the first paragraph holds: what the browser sees, not the model. */
async function textNodes(page: Page): Promise<string[]> {
  return getBlock(page, 'paragraph').evaluate((el) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if ((n as Text).data) out.push((n as Text).data);
    return out;
  });
}

/** Adjacent runs never carry the same marks: the canonical form. */
async function expectCanonical(page: Page) {
  const list = await runs(page);
  const key = (r: Run) => JSON.stringify(Object.entries(r).filter(([k, v]) => k !== 'text' && v).sort());
  for (let i = 1; i < list.length; i++) expect(key(list[i]), `runs ${i - 1}/${i}: ${JSON.stringify(list)}`).not.toBe(key(list[i - 1]));
  // the DOM holds one text node per run, no more
  expect((await textNodes(page)).join('')).toBe(list.map((r) => r.text).join(''));
  expect((await textNodes(page)).length, `text nodes: ${JSON.stringify(await textNodes(page))}`).toBe(list.length);
}

/** One segment, one text node, the whole sentence. */
async function expectOneRun(page: Page, text = SENTENCE) {
  expect(await runs(page)).toEqual([{ text }]);
  expect(await textNodes(page)).toEqual([text]);
}

/** Selects `len` characters from `start` in the first text block (keyboard only). */
async function selectRange(page: Page, start: number, len: number) {
  await press(page, 'Home');
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowRight');
  await selectForward(page, len);
}

const toolbarButton = (page: Page, label: RegExp) => page.locator('.nabu-toolbar .nabu-toolbar-btn', { hasText: label });

test.describe('Canonical runs after a mark is removed', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
    await typeText(page, SENTENCE);
  });

  test('P0 · bold then bold again on exactly the same selection leaves one segment and one text node', async ({ page }) => {
    await selectRange(page, 18, 3); // the tail "am." of the reported case
    await bold(page);
    expect((await runs(page)).map((r) => r.text)).toEqual(['The ford is upstre', 'am.']);
    await expectCanonical(page);
    await bold(page);
    await expectOneRun(page);
  });

  test('P0 · same on a word in the middle', async ({ page }) => {
    await selectRange(page, 4, 4); // "ford"
    await bold(page);
    expect(await runs(page)).toEqual([{ text: 'The ' }, { text: 'ford', bold: true }, { text: ' is upstream.' }]);
    await bold(page);
    await expectOneRun(page);
  });

  test('P1 · same on the whole block and on the first word', async ({ page }) => {
    await selectRange(page, 0, SENTENCE.length);
    await bold(page);
    expect(await runs(page)).toEqual([{ text: SENTENCE, bold: true }]);
    await bold(page);
    await expectOneRun(page);

    await selectRange(page, 0, 3);
    await bold(page); await bold(page);
    await expectOneRun(page);
  });

  test('P1 · the toolbar button, twice, leaves one segment and one text node', async ({ page }) => {
    await selectRange(page, 4, 4);
    const boldBtn = toolbarButton(page, /^B$/);
    await boldBtn.click();
    expect((await runs(page)).length).toBe(3);
    await boldBtn.click();
    await expectOneRun(page);
  });

  test('P1 · partial overlap: bold, then the same words unbolded in two steps', async ({ page }) => {
    await selectRange(page, 4, 8); // "ford is "
    await bold(page);
    await selectRange(page, 4, 4); // "ford": inside the bold run, fully bold -> off
    await bold(page);
    expect(await runs(page)).toEqual([{ text: 'The ford' }, { text: ' is ', bold: true }, { text: 'upstream.' }]);
    await expectCanonical(page);
    await selectRange(page, 8, 4); // " is ": the rest of the bold run
    await bold(page);
    await expectOneRun(page);
  });

  test('P1 · partial overlap: a selection wider than the bold run applies, then removes, with one run left', async ({ page }) => {
    await selectRange(page, 6, 4);
    await bold(page);
    await selectRange(page, 2, 12); // partly bold: bold everywhere
    await bold(page);
    expect(await runs(page)).toEqual([{ text: 'Th' }, { text: 'e ford is up', bold: true }, { text: 'stream.' }]);
    await bold(page); // fully bold: off over the same range
    await expectOneRun(page);
  });

  test('P1 · italic + bold on the same word, then bold removed: the word stays ONE italic run', async ({ page }) => {
    await selectRange(page, 4, 4);
    await italic(page);
    await bold(page);
    expect(await runs(page)).toEqual([{ text: 'The ' }, { text: 'ford', italic: true, bold: true }, { text: ' is upstream.' }]);
    await bold(page);
    expect(await runs(page)).toEqual([{ text: 'The ' }, { text: 'ford', italic: true }, { text: ' is upstream.' }]);
    await expectCanonical(page);
    await italic(page);
    await expectOneRun(page);
  });

  test('P1 · bold on [4, 8) and italic on [4, 12), then bold off: the italic run is whole', async ({ page }) => {
    await selectRange(page, 4, 4);
    await bold(page);
    await selectRange(page, 4, 8);
    await italic(page);
    await selectRange(page, 4, 4);
    await bold(page);
    expect(await runs(page)).toEqual([{ text: 'The ' }, { text: 'ford is ', italic: true }, { text: 'upstream.' }]);
    await expectCanonical(page);
  });

  test('P1 · undo after the unbold restores the bold word, redo takes it off again; every state is canonical', async ({ page }) => {
    // The undo steps merge within 1 s: let each action be its own step.
    const ownStep = () => page.waitForTimeout(1100);
    await ownStep();
    await selectRange(page, 4, 4);
    await bold(page);
    await ownStep();
    await bold(page);
    await expectOneRun(page);

    await undo(page); // the unbold
    expect(await runs(page)).toEqual([{ text: 'The ' }, { text: 'ford', bold: true }, { text: ' is upstream.' }]);
    await expectCanonical(page);

    await redo(page);
    await expectOneRun(page);

    await undo(page);
    await undo(page); // the bold
    await expectOneRun(page);
  });

  test('P1 · collapsed caret: Ctrl+B twice then typing makes plain text in one run', async ({ page }) => {
    await press(page, 'End');
    await bold(page);
    await bold(page); // pending bold on, then off: nothing is stored
    await typeText(page, ' Yes.');
    await expectOneRun(page, `${SENTENCE} Yes.`);
  });

  test('P1 · collapsed caret: a bold word typed in the middle of a sentence, then unbolded by selection, is one run again', async ({ page }) => {
    await press(page, 'End');
    await typeText(page, ' ');
    await bold(page);
    await typeText(page, 'River');
    await bold(page);
    await typeText(page, ' end');
    expect(await runs(page)).toEqual([{ text: `${SENTENCE} ` }, { text: 'River', bold: true }, { text: ' end' }]);
    await selectRange(page, SENTENCE.length + 1, 5);
    await bold(page);
    await expectOneRun(page, `${SENTENCE} River end`);
  });

  test('P2 · a word that used to straddle the split is selected whole by a double-click, and typing after it stays one run', async ({ page }) => {
    await selectRange(page, 18, 3);
    await bold(page);
    await bold(page);
    const box = await getBlock(page, 'paragraph').evaluate((el) => {
      const node = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, (n) => ((n as Text).data ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)).nextNode() as Text; // the single text node: the whole sentence
      const at = node.data.indexOf('upstream');
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 8);
      const r = range.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.dblclick(box.x, box.y);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('upstream');
    await press(page, 'End');
    await typeText(page, ' Go');
    await expectOneRun(page, `${SENTENCE} Go`);
  });
});

test.describe('Mark edges do not depend on how the text got its marks', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
    await typeText(page, SENTENCE);
  });

  test('P0 · a sentence in bold, a middle word unbolded: typing at the start of that word is not bold, and one undo removes it', async ({ page }) => {
    await selectRange(page, 0, SENTENCE.length);
    await bold(page); // the whole sentence
    await selectRange(page, 4, 4); // "ford"
    await bold(page); // unbolded: Loro keeps the outer bold with a hole in it
    expect(await runs(page)).toEqual([{ text: 'The ', bold: true }, { text: 'ford' }, { text: ' is upstream.', bold: true }]);

    await press(page, 'Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // right before "ford"
    await page.waitForTimeout(1100); // past the undo merge window (1 s): the typing is a step of its own
    await page.keyboard.type('X');
    expect(await runs(page)).toEqual([{ text: 'The ', bold: true }, { text: 'Xford' }, { text: ' is upstream.', bold: true }]);
    await expectCanonical(page);

    await undo(page);
    expect(await runs(page)).toEqual([{ text: 'The ', bold: true }, { text: 'ford' }, { text: ' is upstream.', bold: true }]);
  });

  test('P1 · typing inside the bold part stays bold; a mark armed with Ctrl+B still wins', async ({ page }) => {
    await selectRange(page, 0, SENTENCE.length);
    await bold(page);
    await selectRange(page, 4, 4);
    await bold(page);
    await press(page, 'Home');
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowRight'); // inside "The "
    await page.keyboard.type('Y');
    expect((await runs(page))[0]).toEqual({ text: 'ThYe ', bold: true });

    // armed on: inside the plain word, Ctrl+B then a letter is bold
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight'); // "fo|rd"
    await bold(page);
    await page.keyboard.type('Z');
    expect(await runs(page)).toEqual([{ text: 'ThYe ', bold: true }, { text: 'fo' }, { text: 'Z', bold: true }, { text: 'rd' }, { text: ' is upstream.', bold: true }]);
    // armed off: inside the bold tail, Ctrl+B then a letter is plain
    await press(page, 'End');
    await page.keyboard.press('ArrowLeft');
    await bold(page);
    await page.keyboard.type('W');
    expect(await runs(page)).toEqual([{ text: 'ThYe ', bold: true }, { text: 'fo' }, { text: 'Z', bold: true }, { text: 'rd' }, { text: ' is upstream', bold: true }, { text: 'W' }, { text: '.', bold: true }]);
  });
});
