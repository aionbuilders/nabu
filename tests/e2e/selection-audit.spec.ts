/**
 * E2E AUDIT — theme 8d: MULTI-BLOCK SELECTION edge cases (+ finding T-11 of docs/audit/2026-10.md §3).
 *
 * Everything is driven by REAL keys and mouse; the assertions read the MODEL selection (`nabu.selection.anchorBlock / focusBlock`,
 * `isRange`, `blocks`) through `sel()` below — the offset is the MODEL offset (text offset in the block), not the raw DOM offset
 * that `nabu.selection.focusOffset` exposes (P-20) — and the result of the action on the model tree (`outline`).
 *
 * This file is an AUDIT: a scenario that fails is kept as `test.fixme('… — FINDING: …')` with the observed behaviour in its
 * comment; the product is not touched. Selection notation: `anchorText@offset -> focusText@offset` (a void block is `<divider>`).
 * Related, already covered elsewhere (not duplicated): multi-delete.spec.ts (deleteRange semantics through an API-set selection),
 * undo-selection.spec.ts (ADR 015), mark-selection.spec.ts (P-78), regions.spec.ts (extending across a title), drag-drop.spec.ts.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press, flushRender, getMarkdown, getEditor } from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';
import { outline, violations, focusAt, focusEnd, collectErrors, allText, caret } from './helpers/model.js';
import { buildTree, Pp, Hr, Code, Tog, type TreeSpec } from './helpers/blocks.js';
import { cut } from './helpers/clip-capture.js';
import { writeClipboardText, pasteText } from './helpers/clipboard.js';
import { pointOfText, dblclickWord, wheelScroll } from './helpers/ui.js';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
/** The "word" modifier of the platform (Alt on macOS, Ctrl elsewhere). */
const WORD = process.platform === 'darwin' ? 'Alt' : 'Control';

// ── Fixtures ───────────────────────────────────────────────────────────────

const SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#888"/></svg>');
const Img = (): TreeSpec => ({ type: 'image', props: { ref: SVG, alt: 'x' } });
const Hd = (text: string, level = 2): TreeSpec => ({ type: 'heading', text, props: { level } });
const Callout = (text: string): TreeSpec => ({ type: 'callout', text, props: { variant: 'note' } });
const Quote = (text: string): TreeSpec => ({ type: 'blockquote', text });
const ul = (...items: TreeSpec[]): TreeSpec => ({ type: 'list', props: { listType: 'bullet' }, children: items });
const li = (text: string, ...sub: TreeSpec[]): TreeSpec => ({ type: 'list-item', text, children: sub });
const S1 = (title: string, ...children: TreeSpec[]): TreeSpec => ({ type: 'region', props: { regionType: 'section-1', title }, children });

// ── Model selection helpers ────────────────────────────────────────────────

type Sel = { a: string; f: string; range: boolean; collapsed: boolean; covered: string[] };

/** The MODEL selection: anchor / focus as `text@modelOffset`, `isRange`, and the blocks the selection covers (`selection.blocks`). */
const sel = (page: Page): Promise<Sel> => page.evaluate(() => {
  const n = (window as any).nabu;
  const s = n.selection;
  const label = (b: any) => {
    if (!b) return '∅model';
    const tb = b.behaviors?.get('text');
    return tb ? (tb.text as string).replace(/\n/g, '⏎') : `<${b.type}>`;
  };
  const off = (b: any, node: Node | null, o: number) => {
    const tb = b?.behaviors?.get('text');
    return tb && node ? (tb.calculateOffset(node, o, b.element) as number) : 0;
  };
  return {
    a: `${label(s.anchorBlock)}@${off(s.anchorBlock, s.anchorNode, s.anchorOffset)}`,
    f: `${label(s.focusBlock)}@${off(s.focusBlock, s.focusNode, s.focusOffset)}`,
    range: !!s.isRange,
    collapsed: !!s.isCollapsed,
    // `selection.blocks` also holds the container blocks between the ends (a `list`): only the leaves are of interest here
    covered: [...s.blocks].map(label).filter((l: string) => l !== '<list>'),
  };
});

const arrow = `->`;
/** Poll until the model selection is `a -> f`. */
const expectSel = (page: Page, a: string, f: string) =>
  expect.poll(async () => { const s = await sel(page); return `${s.a} ${arrow} ${s.f}`; }, { timeout: 3000, message: 'model selection' }).toBe(`${a} ${arrow} ${f}`);
/** The block part (before `@`) of the model focus / anchor. */
const focusBlock = async (page: Page) => (await sel(page)).f.replace(/@\d+$/, '');
const offsetOf = (end: string) => Number(end.slice(end.lastIndexOf('@') + 1));
const expectFocusBlock = (page: Page, block: string) =>
  expect.poll(() => focusBlock(page), { timeout: 3000, message: 'model focus block' }).toBe(block);
const expectOutline = (page: Page, expected: string) => expect.poll(() => outline(page), { timeout: 3000, message: 'outline' }).toBe(expected);
async function expectValid(page: Page) { expect(await violations(page)).toEqual([]); }

/** Press `key` `n` times. */
async function keys(page: Page, key: string, n: number) { for (let i = 0; i < n; i++) await page.keyboard.press(key); }
const canUndo = (page: Page) => page.evaluate(() => (window as any).nabu.undoManager.canUndo());

/** Paste an internal nabu fragment (as written by cut / copy) at the current selection. */
async function pasteFragment(page: Page, raw: string) {
  await page.evaluate((r) => {
    const dt = new DataTransfer();
    dt.setData('application/x-nabu+json', r);
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, raw);
}

/** Three plain paragraphs and the forward / backward REAL-key selection `alpha@2 .. gamma@3` (12 Shift+Arrow presses). */
const ABG = [Pp('alpha'), Pp('beta'), Pp('gamma')];
async function selectAbg(page: Page, dir: 'forward' | 'backward') {
  await buildTree(page, ABG);
  if (dir === 'forward') { await focusAt(page, 'alpha', 2); await keys(page, 'Shift+ArrowRight', 12); await expectSel(page, 'alpha@2', 'gamma@3'); }
  else { await focusAt(page, 'gamma', 3); await keys(page, 'Shift+ArrowLeft', 12); await expectSel(page, 'gamma@3', 'alpha@2'); }
  expect((await sel(page)).range).toBe(true);
}

let errors: ReturnType<typeof collectErrors>;
test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});
test.afterEach(async () => { expect(errors.list(), 'console / page errors').toEqual([]); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. Extending a selection with the keyboard
// ═══════════════════════════════════════════════════════════════════════════

test.describe('1 · Shift+Arrow & co across block types', () => {
  test('1.1 · Shift+Right / Shift+Left cross a paragraph boundary in ONE press (heading in between), forward and backward', async ({ page }) => {
    await buildTree(page, [Pp('alpha'), Hd('Beta head'), Pp('gamma')]);
    await focusEnd(page, 'alpha');
    await press(page, 'Shift+ArrowRight');
    await expectSel(page, 'alpha@5', 'Beta head@0');
    expect((await sel(page)).range).toBe(true);
    await keys(page, 'Shift+ArrowRight', 9);
    await expectSel(page, 'alpha@5', 'Beta head@9');
    await press(page, 'Shift+ArrowRight');
    await expectSel(page, 'alpha@5', 'gamma@0');
    expect((await sel(page)).covered).toEqual(['alpha', 'Beta head', 'gamma']);
    await press(page, 'Shift+ArrowLeft'); // retract: back on the heading, still a range
    await expectSel(page, 'alpha@5', 'Beta head@9');
    // backward: anchor after, focus before
    await focusAt(page, 'gamma', 0);
    await press(page, 'Shift+ArrowLeft');
    await expectSel(page, 'gamma@0', 'Beta head@9');
    expect((await sel(page)).range).toBe(true);
    await keys(page, 'Shift+ArrowLeft', 10);
    await expectSel(page, 'gamma@0', 'alpha@5');
  });

  test('1.2 · Shift+Down / Shift+Up walk block by block (heading, paragraphs); Shift+Home / Shift+End bound the focus; retracting to the anchor block ends the range', async ({ page }) => {
    await buildTree(page, [Pp('alpha one'), Hd('Beta head'), Pp('gamma three'), Pp('delta four')]);
    await focusAt(page, 'alpha one', 3);
    for (const next of ['Beta head', 'gamma three', 'delta four']) {
      await press(page, 'Shift+ArrowDown');
      await expectFocusBlock(page, next);
      expect((await sel(page)).range).toBe(true);
    }
    expect((await sel(page)).covered).toEqual(['alpha one', 'Beta head', 'gamma three', 'delta four']);
    await press(page, 'Shift+End');
    await expectSel(page, 'alpha one@3', 'delta four@10');
    await keys(page, 'Shift+ArrowUp', 3);
    await expectFocusBlock(page, 'alpha one');
    expect((await sel(page)).range).toBe(false); // focus back in the anchor block: a text selection of one block, not a range
    // Shift+Home / Shift+End inside a range: a backward range goes to the line start of the block above and its end
    await focusAt(page, 'gamma three', 4);
    await press(page, 'Shift+Home');
    await expectSel(page, 'gamma three@4', 'gamma three@0');
    await press(page, 'Shift+ArrowUp');
    await expectFocusBlock(page, 'Beta head');
    await press(page, 'Shift+Home');
    await expectSel(page, 'gamma three@4', 'Beta head@0');
    expect((await sel(page)).covered).toEqual(['Beta head', 'gamma three']);
    await press(page, 'Shift+End');
    await expectSel(page, 'gamma three@4', 'Beta head@9');
    // forward, focus in the middle of the block below: Shift+End is fine (Shift+Home: see 1.2c)
    await focusAt(page, 'alpha one', 3);
    await press(page, 'Shift+ArrowDown');
    await press(page, 'Shift+End');
    await expectSel(page, 'alpha one@3', 'Beta head@9');
  });

  // P-110 (fixed): Chrome expresses the "start of line" of a block's first line as an empty text node at the END of the block above, so the
  // model focus was "gamma three@11" instead of "delta four@0" (the range stopped one block short, a following Backspace left "delta four"
  // unmerged); `NabuSelection#canonicalHome` puts the focus back at the start of the block the key was pressed in.
  test('1.2c · Shift+Home from the END of the last block of a range puts the focus at the start of THAT block (P-110)', async ({ page }) => {
    await buildTree(page, [Pp('alpha one'), Pp('Beta head'), Pp('gamma three'), Pp('delta four')]);
    await focusAt(page, 'alpha one', 3);
    await keys(page, 'Shift+ArrowDown', 3);
    await expectFocusBlock(page, 'delta four');
    await press(page, 'Shift+Home');
    await expectSel(page, 'alpha one@3', 'delta four@0');
    await press(page, 'Backspace');
    await expectOutline(page, 'p(alpdelta four)');
  });

  test('1.2d · Shift+Home on a 2-block range puts the focus at the start of the second block; the range then extends and retracts as usual (P-110)', async ({ page }) => {
    await buildTree(page, [Pp('alpha one'), Pp('beta head')]);
    await focusAt(page, 'alpha one', 3);
    await press(page, 'Shift+ArrowDown');
    await expectFocusBlock(page, 'beta head');
    await press(page, 'Shift+Home');
    await expectSel(page, 'alpha one@3', 'beta head@0');
    await press(page, 'Shift+ArrowUp'); // still extends / retracts normally afterwards
    await expectFocusBlock(page, 'alpha one');
    await press(page, 'Shift+ArrowDown');
    await expectFocusBlock(page, 'beta head');
    await press(page, 'Shift+End');
    await expectSel(page, 'alpha one@3', 'beta head@9');
  });

  test('1.3 · Ctrl+Shift+Arrow (word): extends by words inside a block, then crosses into the next block; backward too', async ({ page }) => {
    await buildTree(page, [Pp('alpha one'), Pp('beta two')]);
    await focusAt(page, 'alpha one', 0);
    await press(page, `${WORD}+Shift+ArrowRight`);
    expect([5, 6]).toContain(offsetOf((await sel(page)).f)); // end of the word (Linux / mac) or start of the next (Windows)
    await press(page, `${WORD}+Shift+ArrowRight`);
    await expectSel(page, 'alpha one@0', 'alpha one@9');
    await press(page, `${WORD}+Shift+ArrowRight`);
    await expect.poll(() => focusBlock(page)).toBe('beta two');
    expect((await sel(page)).range).toBe(true);
    // backward from the start of the 2nd block
    await focusAt(page, 'beta two', 0);
    await press(page, `${WORD}+Shift+ArrowLeft`); // the block boundary is a word stop: end of the previous block
    await expectSel(page, 'beta two@0', 'alpha one@9');
    await press(page, `${WORD}+Shift+ArrowLeft`);
    await expectSel(page, 'beta two@0', 'alpha one@6');
    await press(page, `${WORD}+Shift+ArrowLeft`);
    await expectSel(page, 'beta two@0', 'alpha one@0');
    expect((await sel(page)).covered).toEqual(['alpha one', 'beta two']);
  });

  test('1.4 · nested lists: Shift+Down goes INTO the sublevel and back OUT of it; deleting the range keeps the document order', async ({ page }) => {
    await buildTree(page, [ul(li('a'), li('b', ul(li('b1'), li('b2'))), li('c'))]);
    await focusAt(page, 'a', 0);
    // (the goal column of the deeper levels is past the end of the one-letter text "c": the focus lands at its end)
    for (const next of ['b', 'b1', 'b2', 'c']) {
      await press(page, 'Shift+ArrowDown');
      await expectFocusBlock(page, next);
    }
    expect((await sel(page)).covered).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    const cOffset = offsetOf((await sel(page)).f);
    await press(page, 'Backspace');
    await expectOutline(page, `ul[${'c'.slice(cOffset) || '∅'}]`);
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'ul[a, b > ul[b1, b2], c]');
    // backward, out of the sublevel: from c up to b1
    await focusAt(page, 'c', 1);
    await keys(page, 'Shift+ArrowUp', 2);
    await expect.poll(() => focusBlock(page)).toBe('b1');
    expect((await sel(page)).covered).toEqual(['b1', 'b2', 'c']);
    const head = 'b1'.slice(0, offsetOf((await sel(page)).f));
    await press(page, 'Delete');
    await expectOutline(page, `ul[a, b > ul[${head || '∅'}]]`); // head of b1 + "" (tail of c, selected to its end): b2 gone, c merged into b1
    await expectValid(page);
  });

  test('1.5 · toggles: the OPEN body is walked, the COLLAPSED (hidden) body is never selected nor left behind by a deletion', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('inner')]), Pp('after')]);
    await focusAt(page, 'before', 3);
    await press(page, 'Shift+ArrowDown'); await expectFocusBlock(page, 'Head');
    await press(page, 'Shift+ArrowDown'); await expectFocusBlock(page, 'inner');
    await press(page, 'Shift+ArrowDown'); await expectFocusBlock(page, 'after');
    expect((await sel(page)).covered).toEqual(['before', 'Head', 'inner', 'after']);

    // collapsed
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('inner')], true), Pp('after')]);
    await focusAt(page, 'before', 3);
    await keys(page, 'Shift+ArrowRight', 3); // end of "before"
    await press(page, 'Shift+ArrowRight'); await expectSel(page, 'before@3', 'Head@0');
    await keys(page, 'Shift+ArrowRight', 4); await expectSel(page, 'before@3', 'Head@4');
    await press(page, 'Shift+ArrowRight'); // the hidden body is skipped: straight to "after"
    await expectSel(page, 'before@3', 'after@0');
    await keys(page, 'Shift+ArrowRight', 2);
    await press(page, 'Delete');
    await expectOutline(page, 'p(befter)'); // the toggle goes with its (hidden) body: no orphan "inner" left in the document
    expect(await allText(page)).not.toContain('inner');
    await expectValid(page);
  });

  // P-112 (fixed): `selection.blocks` (and so `block.selected`, the target of marks / the highlight) of a range that spans a COLLAPSED toggle
  // held the hidden body block too: ['before', 'Head', 'inner', 'after'] — formatting would reach invisible text.
  test('1.5b · the HIDDEN body of a collapsed toggle is not part of the covered blocks (P-112)', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('inner')], true), Pp('after')]);
    await focusAt(page, 'before', 3);
    await keys(page, 'Shift+ArrowDown', 2);
    await expectFocusBlock(page, 'after');
    expect((await sel(page)).covered).not.toContain('inner');
  });

  test('1.5c · bold over a range that spans a collapsed toggle marks the visible text only, never the hidden body (P-112)', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('inner')], true), Pp('after')]);
    await focusAt(page, 'before', 3);
    await keys(page, 'Shift+ArrowDown', 2);
    await expectFocusBlock(page, 'after');
    await page.keyboard.press(`${MOD}+b`);
    await expect.poll(() => getMarkdown(page)).toContain('**Head**');
    const md = await getMarkdown(page);
    expect(md).toContain('inner');
    expect(md).not.toContain('**inner**');
    expect(md.split('\n').filter((line) => line.includes('inner')).every((line) => !line.includes('**'))).toBe(true); // no mark on the hidden line
  });

  test('1.6 · a code block: Shift+Down moves line by line INSIDE it (multi-line), then leaves it; backward too', async ({ page }) => {
    await buildTree(page, [Pp('intro'), Code('line1\nline2\nline3'), Pp('outro')]);
    await focusAt(page, 'intro', 2);
    const lines = [[0, 5], [6, 11], [12, 17]];
    for (const [lo, hi] of lines) {
      await press(page, 'Shift+ArrowDown');
      await expectFocusBlock(page, 'line1⏎line2⏎line3');
      const off = offsetOf((await sel(page)).f);
      expect(off, 'a line below the previous one').toBeGreaterThanOrEqual(lo);
      expect(off).toBeLessThanOrEqual(hi);
    }
    await press(page, 'Shift+ArrowDown');
    await expectFocusBlock(page, 'outro');
    expect((await sel(page)).covered).toEqual(['intro', 'line1⏎line2⏎line3', 'outro']);
    // backward
    await focusAt(page, 'outro', 2);
    for (const [lo, hi] of [...lines].reverse()) {
      await press(page, 'Shift+ArrowUp');
      await expectFocusBlock(page, 'line1⏎line2⏎line3');
      const off = offsetOf((await sel(page)).f);
      expect(off).toBeGreaterThanOrEqual(lo);
      expect(off).toBeLessThanOrEqual(hi);
    }
    await press(page, 'Shift+ArrowUp');
    await expectFocusBlock(page, 'intro');
  });

  test('1.7 · void blocks (divider, image) are INCLUDED as whole blocks: covered by the range and removed by a deletion', async ({ page }) => {
    await buildTree(page, [Pp('top'), Hr(), Pp('mid'), Img(), Pp('end')]);
    await focusAt(page, 'top', 1);
    for (let i = 0; i < 30 && (await focusBlock(page)) !== 'end'; i++) await press(page, 'Shift+ArrowRight');
    await expectFocusBlock(page, 'end');
    const s = await sel(page);
    expect(s.range).toBe(true);
    expect(s.covered).toEqual(['top', '<divider>', 'mid', '<image>', 'end']);
    const tail = 'end'.slice(offsetOf(s.f));
    await press(page, 'Backspace');
    await expectOutline(page, `p(t${tail})`);
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'p(top) ; divider(∅) ; p(mid) ; image(∅) ; p(end)');
  });

  test('1.8 · a sweep through paragraph, heading, list item, quote, callout: every Shift+Down lands in the NEXT block, none skipped', async ({ page }) => {
    await buildTree(page, [Pp('one'), Hd('two', 1), ul(li('three')), Quote('four'), Callout('five'), Pp('six')]);
    await focusAt(page, 'one', 1);
    for (const next of ['two', 'three', 'four', 'five', 'six']) {
      await press(page, 'Shift+ArrowDown');
      await expectFocusBlock(page, next);
    }
    expect((await sel(page)).covered).toEqual(['one', 'two', 'three', 'four', 'five', 'six']);
    const tail = 'six'.slice(offsetOf((await sel(page)).f));
    await press(page, 'Backspace');
    await expect.poll(() => allText(page)).toEqual(['o' + tail]);
  });

  test('1.9 · a region seam: a backward selection from one body to the previous one skips both titles; Delete clears the text, keeps the skeleton (ADR 018 §3.9)', async ({ page }) => {
    await buildTree(page, [Pp('pre'), S1('One', Pp('aaa')), S1('Two', Pp('bbb'))]);
    await focusAt(page, 'bbb', 2);
    await keys(page, 'Shift+ArrowLeft', 2);
    await press(page, 'Shift+ArrowLeft'); // leaves "bbb" past the title of Two
    await expectSel(page, 'bbb@2', 'aaa@3');
    await keys(page, 'Shift+ArrowLeft', 2);
    await expectSel(page, 'bbb@2', 'aaa@1');
    const s = await sel(page);
    expect(s.covered).toEqual(['aaa', 'bbb']); // no title in the covered set
    await press(page, 'Delete');
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(a) } ; R:section-1(Two){ p(b) }');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'p(pre) ; R:section-1(One){ p(aaa) } ; R:section-1(Two){ p(bbb) }');
    await expectSel(page, 'bbb@2', 'aaa@1'); // ADR 015: the backward selection comes back backward
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Actions on a multi-block range (forward AND backward)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('2 · actions on a multi-block range, forward and backward', () => {
  // [key, expected outline, expected caret]
  const ACTIONS: Array<[string, string, string]> = [
    ['Backspace', 'p(alma)', 'al|ma'],
    ['Delete', 'p(alma)', 'al|ma'],
    ['X', 'p(alXma)', 'alX|ma'],
    ['Enter', 'p(al) ; p(ma)', '|ma'],
  ];

  test('2.1 · Backspace / Delete / typing / Enter: forward and backward ranges give the SAME result, caret at the junction', async ({ page }) => {
    for (const dir of ['forward', 'backward'] as const) {
      for (const [key, outcome, where] of ACTIONS) {
        await selectAbg(page, dir);
        await page.keyboard.press(key);
        await expectOutline(page, outcome);
        expect(await caret(page), `${dir} + ${key}`).toBe(where);
        await expectValid(page);
      }
    }
  });

  test('2.2 · undo / redo after each action: ONE step, the selection comes back with its direction (ADR 015); redo gives the junction', async ({ page }) => {
    const problems: string[] = [];
    const check = async (label: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { problems.push(`${label}: ${String((e as Error).message).split('\n').slice(0, 4).join(' | ')}`); } };
    for (const dir of ['forward', 'backward'] as const) {
      for (const [key, outcome, where] of [...ACTIONS, [`${MOD}+b`, 'p(alpha) ; p(beta) ; p(gamma)', 'bold'] as [string, string, string]]) {
        const label = `${dir} + ${key}`;
        await selectAbg(page, dir);
        await page.keyboard.press(key);
        if (key === `${MOD}+b`) await expect.poll(() => getMarkdown(page)).toContain('**beta**');
        else await expectOutline(page, outcome);
        await undo(page);
        await expectOutline(page, 'p(alpha) ; p(beta) ; p(gamma)');
        await check(`${label}: undone in ONE step`, async () => { expect(await canUndo(page)).toBe(false); });
        await check(`${label}: undo restores the selection`, async () => {
          await expect.poll(async () => { const s = await sel(page); return `${s.a} ${arrow} ${s.f}`; }, { timeout: 1500 })
            .toBe(dir === 'forward' ? 'alpha@2 -> gamma@3' : 'gamma@3 -> alpha@2');
        });
        await redo(page);
        if (key === `${MOD}+b`) await expect.poll(() => getMarkdown(page)).toContain('**beta**');
        else {
          await expectOutline(page, outcome);
          await check(`${label}: redo puts the caret at the junction`, async () => { await expect.poll(() => caret(page), { timeout: 1500 }).toBe(where); });
        }
      }
    }
    expect(problems).toEqual([]);
  });

  // P-111 (fixed): redo re-applied the typing but put the caret at the END of the block ("alXma|") instead of right after the typed
  // character ("alX|ma"), where the action ended (ADR 015): both Loro cursors of the stored endpoint were dead (the typed character and the
  // merged tail are re-created by the redo), see `resolveOffset` in undo-selection.js.
  test('2.2b · redo of typing over a range puts the caret right AFTER the typed character (P-111)', async ({ page }) => {
    await selectAbg(page, 'backward');
    await page.keyboard.press('X');
    await expectOutline(page, 'p(alXma)');
    await undo(page);
    await expectOutline(page, 'p(alpha) ; p(beta) ; p(gamma)');
    await redo(page);
    await expectOutline(page, 'p(alXma)');
    await expect.poll(() => caret(page)).toBe('alX|ma');
  });

  test('2.3 · paste over a backward range: plain single line, plain multi-line (1 line = 1 block), and an undo of each', async ({ page }) => {
    await selectAbg(page, 'backward');
    await pasteText(page, 'Z');
    await expectOutline(page, 'p(alZma)');
    await undo(page);
    await expectOutline(page, 'p(alpha) ; p(beta) ; p(gamma)');
    await selectAbg(page, 'backward');
    await pasteText(page, 'P1\nP2');
    await expectOutline(page, 'p(alP1) ; p(P2ma)');
    expect(await caret(page)).toBe('P2|ma');
    await undo(page);
    await expectOutline(page, 'p(alpha) ; p(beta) ; p(gamma)');
    await expectValid(page);
  });

  test('2.4 · Cut (Ctrl+X) a backward multi-block range, then paste it elsewhere with Ctrl+V: structure and text travel, one undo each', async ({ page }) => {
    await buildTree(page, [Pp('alpha'), Pp('beta'), Pp('gamma'), Pp('omega')]);
    await focusAt(page, 'gamma', 3);
    await keys(page, 'Shift+ArrowLeft', 12);
    await expectSel(page, 'gamma@3', 'alpha@2');
    const ev = await cut(page);
    expect(ev.text.replace(/\r/g, '')).toBe('pha\n\nbeta\n\ngam'); // paragraphs are separated by a blank line
    await expectOutline(page, 'p(alma) ; p(omega)');
    await focusEnd(page, 'omega');
    await press(page, `${MOD}+v`);
    await expectOutline(page, 'p(alma) ; p(omegapha) ; p(beta) ; p(gam)');
    await expectValid(page);
    await undo(page);
    await expectOutline(page, 'p(alma) ; p(omega)');
    await undo(page);
    await expectOutline(page, 'p(alpha) ; p(beta) ; p(gamma) ; p(omega)');
  });

  test('2.5 · bold then italic on a backward range: every block marked, toggling again unmarks, the selection never moves', async ({ page }) => {
    await selectAbg(page, 'backward');
    for (const [key, mark] of [[`${MOD}+b`, '**'], [`${MOD}+i`, '*']] as const) {
      await press(page, key);
      await expect.poll(() => getMarkdown(page)).toMatch(new RegExp(`al${mark === '**' ? '\\*\\*' : '\\*'}pha`));
      const md = await getMarkdown(page);
      expect(md).toContain(`${mark}beta${mark}`);
      expect(md).toContain(`${mark}gam${mark}ma`);
      await expectSel(page, 'gamma@3', 'alpha@2');
      await press(page, key);
      await expect.poll(() => getMarkdown(page)).not.toContain(mark);
      await expectSel(page, 'gamma@3', 'alpha@2');
    }
  });

  test('2.6 · Tab / Shift+Tab on a range across list items indent / outdent ALL of them, keep the range, one undo step each', async ({ page }) => {
    await buildTree(page, [ul(li('a'), li('b'), li('c'), li('d'))]);
    await focusAt(page, 'c', 0);
    await press(page, 'Shift+ArrowUp'); // backward range c -> b
    await expectSel(page, 'c@0', 'b@0');
    await press(page, 'Tab');
    await expectOutline(page, 'ul[a > ul[b, c], d]');
    await expectSel(page, 'c@0', 'b@0');
    await press(page, 'Shift+Tab');
    await expectOutline(page, 'ul[a, b, c, d]');
    await expectSel(page, 'c@0', 'b@0');
    await undo(page);
    await expectOutline(page, 'ul[a > ul[b, c], d]'); // the Shift+Tab alone is undone
    await undo(page);
    await expectOutline(page, 'ul[a, b, c, d]');
    await expectValid(page);
  });

  test('2.7 · dragging a BACKWARD two-block selection moves it whole, same result as the forward one', async ({ page }) => {
    await buildTree(page, [Pp('alpha beta'), Pp('gamma delta'), Pp('omega')]);
    await focusAt(page, 'gamma delta', 5);
    await keys(page, 'Shift+ArrowLeft', 10);
    await expectSel(page, 'gamma delta@5', 'alpha beta@6');
    const from = await pointOfText(page, 'gamma delta', { word: 'amm' });
    const end = await pointOfText(page, 'omega');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 4, { steps: 3 });
    await page.mouse.move(end.box.right - 1, end.y, { steps: 8 });
    await page.mouse.up();
    await expectOutline(page, 'p(alpha  delta) ; p(omegabeta) ; p(gamma)');
    await undo(page);
    await expectOutline(page, 'p(alpha beta) ; p(gamma delta) ; p(omega)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Mouse
// ═══════════════════════════════════════════════════════════════════════════

test.describe('3 · mouse selections', () => {
  test('3.1 · drag from the middle of a paragraph, across a list, into the middle of a code block: model range + a clean deletion', async ({ page }) => {
    await buildTree(page, [Pp('start text here'), ul(li('item one'), li('item two')), Code('let x = 1;\nlet y = 2;'), Pp('end')]);
    const from = await pointOfText(page, 'start text here', { word: 'text' });
    const to = await pointOfText(page, 'let x = 1;', { word: 'x =' });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 10, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await sel(page)).range).toBe(true);
    const s = await sel(page);
    expect(s.a.startsWith('start text here@')).toBe(true);
    expect(s.f.startsWith('let x = 1;⏎let y = 2;@')).toBe(true);
    expect(s.covered).toEqual(['start text here', 'item one', 'item two', 'let x = 1;⏎let y = 2;']);
    const head = 'start text here'.slice(0, offsetOf(s.a));
    const tail = 'let x = 1;\nlet y = 2;'.slice(offsetOf(s.f));
    await press(page, 'Backspace');
    await expect.poll(() => allText(page)).toEqual([head + tail, 'end']);
    await expectValid(page);
  });

  test('3.2 · Shift+Click extends from the SAME anchor, shrinks, and flips to a backward range; the anchor offset never changes', async ({ page }) => {
    // filler blocks above: the floating toolbar (shown over a range) must not cover the block we flip onto
    await buildTree(page, [Pp('far'), Pp('away'), Pp('zero'), Pp('alpha word'), Pp('beta'), Pp('gamma')]);
    const click = async (text: string, word: string) => {
      const p = await pointOfText(page, text, { word });
      await page.mouse.click(p.x, p.y);
    };
    // Playwright's `mouse.click` takes no modifiers: hold the key instead
    const shiftClick = async (text: string, word: string) => {
      await page.keyboard.down('Shift');
      const p = await pointOfText(page, text, { word });
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
    };
    await click('alpha word', 'wor');
    const anchor = (await sel(page)).a;
    expect(anchor.startsWith('alpha word@')).toBe(true);
    await shiftClick('gamma', 'amm');
    await expect.poll(() => focusBlock(page)).toBe('gamma');
    expect((await sel(page)).a).toBe(anchor);
    expect((await sel(page)).covered).toEqual(['alpha word', 'beta', 'gamma']);
    await shiftClick('beta', 'et'); // shrink
    await expect.poll(() => focusBlock(page)).toBe('beta');
    expect((await sel(page)).a).toBe(anchor);
    expect((await sel(page)).covered).toEqual(['alpha word', 'beta']);
    await shiftClick('far', 'ar'); // flip above the anchor
    await expect.poll(() => focusBlock(page)).toBe('far');
    expect((await sel(page)).a).toBe(anchor);
    expect((await sel(page)).covered).toEqual(['far', 'away', 'zero', 'alpha word']);
    await press(page, 'Backspace');
    await expect.poll(() => allText(page)).toHaveLength(3); // far + alpha word merged, beta + gamma intact
    await expectValid(page);
  });

  test('3.3 · double-click selects the word (nothing more); on the LAST word of a block it does not spill into the next block', async ({ page }) => {
    // filler above: the floating toolbar shows over a selection and must not cover the next block
    await buildTree(page, [Pp('f1'), Pp('f2'), Pp('f3'), Pp('alpha one two'), Pp('alpha end'), Pp('next')]);
    await dblclickWord(page, 'alpha one two', 'one');
    await expect.poll(async () => (await sel(page)).collapsed).toBe(false);
    let s = await sel(page);
    expect(s.range).toBe(false);
    expect(s.a).toBe('alpha one two@6');
    expect([9, 10]).toContain(offsetOf(s.f));
    await dblclickWord(page, 'alpha end', 'end');
    s = await sel(page);
    expect(s.range, 'a word selection stays inside its block').toBe(false);
    expect(s.f).toBe('alpha end@9');
    await press(page, 'Delete');
    await expectOutline(page, 'p(f1) ; p(f2) ; p(f3) ; p(alpha one two) ; p(alpha ) ; p(next)');
  });

  test('3.4 · triple-click selects ONE paragraph; Delete empties its text and does not eat into / merge with the next block', async ({ page }) => {
    await buildTree(page, [Pp('first para'), Pp('second para'), Pp('third')]);
    const p = await pointOfText(page, 'second para', { word: 'cond' });
    await page.mouse.click(p.x, p.y, { clickCount: 3 });
    await expect.poll(async () => (await sel(page)).collapsed).toBe(false);
    const s = await sel(page);
    expect(s.range, 'triple-click is a text selection of one block: ' + s.a + ' -> ' + s.f).toBe(false);
    expect(s.covered).toEqual(['second para']);
    await press(page, 'Delete');
    await expectOutline(page, 'p(first para) ; p(∅) ; p(third)');
    await expectValid(page);
  });

  test('3.5 · clicking into an EMPTY paragraph after a range collapses it there, and typing goes in that block', async ({ page }) => {
    await buildTree(page, [Pp('aaa'), Pp(''), Pp('ccc')]);
    await focusAt(page, 'aaa', 1);
    await keys(page, 'Shift+ArrowDown', 2);
    await expect.poll(async () => (await sel(page)).range).toBe(true);
    await page.locator('[data-block-type="paragraph"]').nth(1).click();
    await expect.poll(async () => (await sel(page)).collapsed).toBe(true);
    await expectSel(page, '@0', '@0');
    await page.keyboard.type('x');
    await expectOutline(page, 'p(aaa) ; p(x) ; p(ccc)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Stability
// ═══════════════════════════════════════════════════════════════════════════

test.describe('4 · selection stability', () => {
  const DOC4 = [Pp('alpha'), Pp('beta'), Pp('gamma'), Pp('delta')];

  test('4.1 · a range survives programmatic changes elsewhere (outside, inside the middle, a new root block) and a blur / refocus', async ({ page }) => {
    await buildTree(page, DOC4);
    await focusAt(page, 'alpha', 2);
    await keys(page, 'Shift+ArrowDown', 2);
    await expectFocusBlock(page, 'gamma');
    const before = await sel(page);
    const same = async (why: string) => { await flushRender(page); const s = await sel(page); expect({ a: s.a, f: s.f, range: s.range }, why).toEqual({ a: before.a, f: before.f, range: true }); return s; };
    // 1. a change OUTSIDE the range (the last block)
    await page.evaluate(async () => { const n = (window as any).nabu; n.children[3].behaviors.get('text').insert(0, 'REMOTE '); await n.commit(); });
    await same('after a change outside the range');
    // 2. a change in the MIDDLE block
    await page.evaluate(async () => { const n = (window as any).nabu; n.children[1].behaviors.get('text').insert(4, '!'); await n.commit(); });
    await same('after a change in the middle block');
    // 3. a new block at the end of the document
    await page.evaluate(async () => { const n = (window as any).nabu; n.insert('paragraph', { text: 'new' }); await n.commit(); });
    await same('after a new root block');
    // 4. blur the editor (and the window), then refocus: the range is still there and still the target of an action
    await page.evaluate(() => { (document.activeElement as HTMLElement).blur(); window.dispatchEvent(new Event('blur')); });
    await flushRender(page);
    await same('after a blur');
    await page.evaluate(() => { (document.querySelector('[contenteditable="true"]') as HTMLElement).focus(); window.dispatchEvent(new Event('focus')); });
    await same('after a refocus');
    await press(page, 'Backspace');
    await expect.poll(() => allText(page)).toEqual(['al' + 'gamma'.slice(offsetOf(before.f)), 'REMOTE delta', 'new']);
    await expectValid(page);
  });

  // P-109 (fixed): the anchor (alpha@2) became 'REMOTE alpha@0': Svelte rewrites the text node's data, the DOM range end falls back to offset 0
  // of the text node, nothing restored it. `Nabu#noteTextChange` now puts the selection back on its characters (Loro cursors) after the render.
  // 4.2b / 4.2c / 4.2d: a collapsed caret, a range inside one block, and a real `importRemote` of a forked document.
  test('4.2 · a programmatic insertion BEFORE the anchor in the anchor block keeps the range on the same characters (P-109)', async ({ page }) => {
    await buildTree(page, DOC4);
    await focusAt(page, 'alpha', 2);
    await keys(page, 'Shift+ArrowDown', 2);
    await expectFocusBlock(page, 'gamma');
    await page.evaluate(async () => { const n = (window as any).nabu; n.children[0].behaviors.get('text').insert(0, 'REMOTE '); await n.commit(); });
    await flushRender(page);
    const s = await sel(page);
    expect(s.a).toBe('REMOTE alpha@9'); // anchored between "al" and "pha", as before the remote edit
    expect(s.range).toBe(true);
  });

  test('4.2b · a COLLAPSED caret follows a programmatic insertion before it (same block), and one after it stays put (P-109)', async ({ page }) => {
    await buildTree(page, DOC4);
    await focusAt(page, 'beta', 2);
    await page.evaluate(async () => { const n = (window as any).nabu; n.children[1].behaviors.get('text').insert(0, 'REMOTE '); await n.commit(); });
    await flushRender(page);
    await expectSel(page, 'REMOTE beta@9', 'REMOTE beta@9');
    expect(await caret(page)).toBe('REMOTE be|ta');
    await page.evaluate(async () => { const n = (window as any).nabu; n.children[1].behaviors.get('text').insert(11, '!'); await n.commit(); }); // after the caret
    await flushRender(page);
    expect(await caret(page)).toBe('REMOTE be|ta!');
    // the user types at the followed caret: the text lands where the caret really is
    await page.keyboard.type('X');
    await expectOutline(page, 'p(alpha) ; p(REMOTE beXta!) ; p(gamma) ; p(delta)');
  });

  test('4.2c · a RANGE inside one block follows a programmatic insertion before it; a following Backspace deletes exactly the selected characters (P-109)', async ({ page }) => {
    await buildTree(page, DOC4);
    await focusAt(page, 'gamma', 1);
    await keys(page, 'Shift+ArrowRight', 3); // "amm"
    await expectSel(page, 'gamma@1', 'gamma@4');
    await page.evaluate(async () => { const n = (window as any).nabu; n.children[2].behaviors.get('text').insert(0, 'REMOTE '); await n.commit(); });
    await flushRender(page);
    await expectSel(page, 'REMOTE gamma@8', 'REMOTE gamma@11');
    await press(page, 'Backspace');
    await expectOutline(page, 'p(alpha) ; p(beta) ; p(REMOTE ga) ; p(delta)');
  });

  test('4.2d · an IMPORT from another replica (importRemote of a forked document) before the caret / the range keeps them on the same characters (P-109)', async ({ page }) => {
    await buildTree(page, DOC4);
    const peerInsert = (index: number, at: number, what: string) => page.evaluate(([i, a, w]) => {
      const n = (window as any).nabu;
      const fork = n.doc.fork();
      const container = fork.getContainerById(n.children[i as number].behaviors.get('text').container.id);
      const before = n.doc.version();
      container.insert(a as number, w as string);
      fork.commit();
      n.importRemote(fork.export({ mode: 'update', from: before }));
    }, [index, at, what] as [number, number, string]);
    // collapsed
    await focusAt(page, 'alpha', 3);
    await peerInsert(0, 0, 'PEER ');
    await flushRender(page);
    expect(await caret(page)).toBe('PEER alp|ha');
    // range from alpha into gamma
    await focusAt(page, 'beta', 1);
    await keys(page, 'Shift+ArrowDown', 1);
    await expectFocusBlock(page, 'gamma');
    const before = await sel(page);
    await peerInsert(1, 0, 'PEER ');
    await flushRender(page);
    const after = await sel(page);
    expect(after.a).toBe('PEER beta@' + (offsetOf(before.a) + 5));
    expect(after.f).toBe(before.f);
    expect(after.range).toBe(true);
  });

  test('4.3 · SCROLLING (scroll container): Shift+PageDown extends a page at a time, the range survives wheel scrolling, then deletes cleanly in one undo step', async ({ page }) => {
    await gotoEditor(page, { seed: 'long', layout: 'scroll' });
    await page.locator('[data-block-type="paragraph"]').first().click();
    const first = 'Long line 00 with some words to select';
    await expect.poll(async () => (await sel(page)).a.startsWith(first)).toBe(true);
    await press(page, 'Shift+PageDown');
    await expect.poll(async () => (await sel(page)).range).toBe(true);
    const s = await sel(page);
    const k = (await sel(page)).covered.length;
    expect(k, 'a page down covers more than a few lines').toBeGreaterThan(4);
    expect(s.covered[0]).toBe(first);
    // contiguous: line 00 .. line k-1
    expect(s.covered.map((t) => Number(t.slice(10, 12)))).toEqual(Array.from({ length: k }, (_, i) => i));
    const box = (await page.locator('.e2e-scroll-host').boundingBox())!;
    await wheelScroll(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 600, '.e2e-scroll-host');
    await wheelScroll(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, -300, '.e2e-scroll-host');
    const after = await sel(page);
    expect({ a: after.a, f: after.f, range: after.range }).toEqual({ a: s.a, f: s.f, range: true });
    await press(page, 'Backspace');
    await expect.poll(() => page.evaluate(() => (window as any).nabu.children.length)).toBe(80 - k + 1);
    await undo(page);
    await expect.poll(() => page.evaluate(() => (window as any).nabu.children.length)).toBe(80);
    expect(await canUndo(page)).toBe(false);
  });

  test('4.4 · LARGE selection: 300 blocks, click + Shift+Click, Backspace (timings are only reported)', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      for (let i = 0; i < 300; i++) n.insert('paragraph', { text: `block ${String(i).padStart(3, '0')} text` }, null, i);
      await n.commit();
      n.undoManager.clear();
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-block-id]').length === 300);
    const paras = page.locator('[data-block-type="paragraph"]');
    await paras.first().click();
    const t0 = Date.now();
    await paras.last().click({ modifiers: ['Shift'] });
    await expect.poll(async () => (await sel(page)).covered.length, { timeout: 15000 }).toBe(300);
    const tSelect = Date.now() - t0;
    expect((await sel(page)).range).toBe(true);
    const t1 = Date.now();
    await press(page, 'Backspace');
    await expect.poll(() => page.evaluate(() => (window as any).nabu.children.length), { timeout: 30000 }).toBe(1);
    const tDelete = Date.now() - t1;
    console.log(`[selection-audit] 300-block selection: Shift+Click -> model range ${tSelect} ms, Backspace -> 1 block ${tDelete} ms`);
    test.info().annotations.push({ type: 'timing', description: `select ${tSelect} ms, delete ${tDelete} ms` });
    expect(await allText(page)).toHaveLength(1);
    await undo(page);
    await expect.poll(() => page.evaluate(() => (window as any).nabu.children.length), { timeout: 30000 }).toBe(300);
    await expectValid(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. T-11 — "after a repeated clearAndReset a click does not place a model caret"
// ═══════════════════════════════════════════════════════════════════════════

test.describe('5 · T-11 · click after the block holding the caret was deleted and replaced', () => {
  /** Type in the editor, then replace the whole document the way `clearAndReset` does (delete every root block, insert an empty paragraph). */
  async function typeThenReset(page: Page) {
    await getEditor(page).click();
    await page.keyboard.type('ab');
    await expect.poll(() => allText(page)).toEqual(['ab']);
    await clearAndReset(page);
  }

  test('5.1 · controls: resetting repeatedly with NO caret in the document is harmless; after a reset that removed the caret\'s block, nabu.focus() gives a usable caret', async ({ page }) => {
    for (let i = 0; i < 5; i++) await clearAndReset(page);
    await getEditor(page).click();
    await pasteText(page, 'hello');
    await expect.poll(() => allText(page)).toEqual(['hello']);
    await gotoEditor(page); // a fresh editor: the reset of a document whose caret block was deleted is the very scenario of 5.2
    await clearAndReset(page);
    await typeThenReset(page);
    await page.evaluate(async () => { await (window as any).nabu.focus({ offset: 0 }); });
    await pasteText(page, 'again');
    await expect.poll(() => allText(page)).toEqual(['again']);
  });

  // T-11 = P-108 (fixed): the empty paragraph that replaces the one holding the caret is clicked, but the click was a no-op (Chrome
  // re-selects the very position the DOM selection already has: the editor root, offset 5, left there by the removal of the old block -> no
  // `selectionchange`, no normalisation). The model selection still pointed at the DELETED block. The next keystroke / paste ran
  // `normalize()`, which landed BACKWARD on Svelte's empty text node AFTER the lone "\n" placeholder, i.e. MODEL offset 1 in a text of
  // length 0: the insertion went to Loro at index 1 of an empty text, threw (loro-internal handler.rs:2229) and the input was lost.
  // Fixed three ways: the landing on an empty block is its placeholder start (`#landingPoint`), the model offset is bounded by the text
  // (`TextBehavior#modelOffset`, `insert`), and a selection left dead by a removal is re-resolved at once (`NabuSelection#repairAfterRemoval`).
  test('5.2 · click on the replaced empty paragraph places a model caret: paste / typing works (T-11 / P-108)', async ({ page }) => {
    await typeThenReset(page);
    await getEditor(page).click();
    await pasteText(page, 'hello');
    await expect.poll(() => allText(page)).toEqual(['hello']);
    await page.keyboard.type('!');
    await expect.poll(() => allText(page)).toEqual(['hello!']);
  });

  test('5.3 · a landing on an EMPTY paragraph is model offset 0 (never 1): the normalisation of a dead caret just before it is safe to type from', async ({ page }) => {
    await buildTree(page, [Pp('x'), Pp(''), Pp('y')]);
    // The caret sits on a dead position (an element, right before the block "y"): normalize() lands BACKWARD on the empty paragraph.
    const landed = await page.evaluate(() => {
      const n = (window as any).nabu;
      const y = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === 'y') as any;
      const el = document.querySelector(`[data-block-id="${y.id}"]`)!;
      window.getSelection()!.setBaseAndExtent(el.parentNode!, [...el.parentNode!.childNodes].indexOf(el as ChildNode), el.parentNode!, [...el.parentNode!.childNodes].indexOf(el as ChildNode));
      n.selection.sync();
      n.selection.normalize();
      n.selection.sync();
      const b = n.selection.anchorBlock;
      const g = window.getSelection()!;
      return { text: b?.behaviors?.get('text')?.text, from: b?.behaviors?.get('text')?.calculateOffset(g.anchorNode, g.anchorOffset, b.element) };
    });
    expect(landed).toEqual({ text: '', from: 0 });
    await pasteText(page, 'hello');
    await expect.poll(() => allText(page)).toEqual(['x', 'hello', 'y']);
  });

  test('5.4 · the block holding the caret is deleted programmatically: the selection is re-resolved to a real position at once (no click needed)', async ({ page }) => {
    await buildTree(page, [Pp('keep'), Pp('doomed'), Pp('tail')]);
    await focusAt(page, 'doomed', 3);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[1]);
      await n.commit();
    });
    await expect.poll(() => caret(page), { timeout: 3000 }).toMatch(/^(keep\||\|tail)$/);
    await page.keyboard.type('Z');
    await expect.poll(() => allText(page)).toHaveLength(2);
    expect((await allText(page)).join('|')).toMatch(/keepZ\|tail|keep\|Ztail/);
  });
});
