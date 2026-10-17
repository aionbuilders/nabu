/**
 * E2E — Fast input (P-08): the model selection must never lag the DOM selection.
 *
 * `nabu.selection` is fed by the asynchronous `selectionchange` event; input handlers used to read it
 * as-is, so a keystroke arriving right after a caret move (click, arrows, Home…) acted on a STALE caret.
 * Nabu now re-syncs the model selection from the DOM at the start of every input entry point.
 *
 * Every test here deliberately has NO settle wait: no expect.poll on the selection, no waitForTimeout and
 * no `press()` helper (which has a 50ms delay) between a caret move and the next keystroke — raw
 * `page.keyboard.*` calls back to back. Only the final assertions poll/read the model.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, focusEditor, getEditor, getBlock, getJson, getMarkdown } from './helpers/editor.js';

type Summary = { type: string; props?: any; text: string; children?: Summary[] };

function summarize(b: any): Summary {
  const content = b.content;
  const text = typeof content === 'string' ? content : (content ?? []).map((r: any) => r.text).join('');
  const s: Summary = { type: b.type, text };
  if (b.props) s.props = b.props;
  if (b.children) s.children = b.children.map(summarize);
  return s;
}

async function tree(page: Page): Promise<Summary[]> {
  return (await getJson(page)).blocks.map(summarize);
}

async function runs(page: Page, index = 0): Promise<any[]> {
  return (await getJson(page)).blocks[index].content ?? [];
}

/** Types `text` into the (empty) editor right after the focusing click, with no wait in between. */
async function seedParagraph(page: Page, text: string) {
  await page.keyboard.type(text);
  await expect.poll(async () => (await tree(page))[0]?.text).toBe(text);
}

test.describe('Fast input — model selection is synced before every input', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
  });

  // ── click / focus, then type immediately ───────────────────────────────────

  test('P0 · P-08 · focus then type immediately: no character lost', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('hello');
    await expect.poll(async () => (await tree(page))[0].text).toBe('hello');
    expect(await tree(page)).toEqual([{ type: 'paragraph', text: 'hello' }]);
  });

  test('P0 · P-08 · click into existing text then type immediately: inserted at the click position', async ({ page }) => {
    await focusEditor(page);
    await seedParagraph(page, 'abcdef');
    const box = (await getBlock(page, 'paragraph').boundingBox())!;
    // click at the far left of the paragraph (caret goes to offset 0) and type with no wait
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.keyboard.type('X');
    await expect.poll(async () => (await tree(page))[0].text).toBe('Xabcdef');
  });

  test('P0 · P-08 · "1. hello" typed right after focusing becomes an ordered list item', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('1. hello');
    await expect.poll(async () => (await tree(page))[0]?.type).toBe('list');
    await expect.poll(async () => JSON.stringify(await tree(page))).toBe(JSON.stringify([
      { type: 'list', text: '', props: { listType: 'ordered' }, children: [{ type: 'list-item', text: 'hello' }] },
    ]));
  });

  test('P0 · P-08 · "-- hi" typed right after focusing is a dialogue (not a bullet list: the first "-" must not vanish)', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('-- hi');
    await expect.poll(async () => (await tree(page))[0]?.type).toBe('dialogue');
    await expect.poll(async () => JSON.stringify(await tree(page))).toBe(JSON.stringify([{ type: 'dialogue', text: 'hi' }]));
  });

  test('P0 · P-08 · "###### x" typed right after focusing is a level-6 heading', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('###### x');
    await expect.poll(async () => (await tree(page))[0]?.type).toBe('heading');
    await expect.poll(async () => JSON.stringify(await tree(page))).toBe(JSON.stringify([
      { type: 'heading', text: 'x', props: { level: 6 } },
    ]));
  });

  test('P0 · P-08 · "! note" typed right after focusing is a callout', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('! note');
    await expect.poll(async () => (await tree(page))[0]?.type).toBe('callout');
    await expect.poll(async () => (await tree(page))[0]?.text).toBe('note');
    expect((await tree(page))[0].props).toEqual({ variant: 'note' });
  });

  // ── keyboard caret moves, then act immediately ─────────────────────────────

  test('P0 · P-08 · ArrowRight x5 then Enter immediately splits "hello world" at 5', async ({ page }) => {
    await focusEditor(page);
    await seedParagraph(page, 'hello world');
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await tree(page)).length).toBe(2);
    expect((await tree(page)).map(b => b.text)).toEqual(['hello', ' world']);
  });

  test('P0 · P-08 · Home then type immediately inserts at the start', async ({ page }) => {
    await focusEditor(page);
    await seedParagraph(page, 'world');
    await page.keyboard.press('Home');
    await page.keyboard.type('hello ');
    await expect.poll(async () => (await tree(page))[0].text).toBe('hello world');
  });

  test('P0 · P-08 · Shift+ArrowLeft x3 then Ctrl+B immediately bolds exactly the last 3 chars', async ({ page }) => {
    await focusEditor(page);
    await seedParagraph(page, 'abcdef');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Control+b');
    await expect.poll(async () =>
      (await runs(page)).filter(r => r.bold).map(r => r.text).join('')).toBe('def');
    expect((await runs(page)).filter(r => !r.bold).map(r => r.text).join('')).toBe('abc');
  });

  test('P0 · P-08 · Ctrl+B (stored mark) right after a caret move is kept for the next typed char', async ({ page }) => {
    await focusEditor(page);
    await seedParagraph(page, 'ab');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('X');
    await expect.poll(async () =>
      (await runs(page)).filter(r => r.bold).map(r => r.text).join('')).toBe('X');
    expect((await runs(page)).map(r => r.text).join('')).toBe('aXb');
  });

  // ── click in another block, then act immediately ───────────────────────────

  test('P0 · P-08 · click in another block then Backspace immediately acts in the clicked block', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await expect.poll(async () => (await tree(page)).map(b => b.text)).toEqual(['first', 'second']);

    // click at the end of "first" (line 1), then Backspace with no wait
    const box = (await getBlock(page, 'paragraph', 0).boundingBox())!;
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await page.keyboard.press('Backspace');
    await expect.poll(async () => (await tree(page)).map(b => b.text)).toEqual(['firs', 'second']);
  });

  test('P0 · P-08 · click in another block then type immediately inserts in the clicked block', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await expect.poll(async () => (await tree(page)).map(b => b.text)).toEqual(['first', 'second']);

    const box = (await getBlock(page, 'paragraph', 0).boundingBox())!;
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await page.keyboard.type('!');
    await expect.poll(async () => (await tree(page)).map(b => b.text)).toEqual(['first!', 'second']);
  });

  // ── programmatic exec right after a keyboard-only selection change (P-22) ──

  test('P0 · P-22 · Shift+ArrowLeft x3 then immediate exec(mark:toggle) bolds exactly the last 3 chars', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('example');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.evaluate(() => (window as any).nabu.exec('mark:toggle', { mark: 'bold' }));
    await expect.poll(async () => (await getMarkdown(page)).trim()).toBe('exam**ple**');
  });

  test('P0 · P-22 · Ctrl+A then immediate exec(mark:toggle) bolds everything', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.type('hello world');
    await page.keyboard.press('Control+a');
    await page.evaluate(() => (window as any).nabu.exec('mark:toggle', { mark: 'bold' }));
    await expect.poll(async () => (await getMarkdown(page)).trim()).toBe('**hello world**');
  });
});
