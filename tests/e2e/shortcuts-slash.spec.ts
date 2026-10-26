/**
 * E2E — Markdown shortcuts & slash menu, driven by REAL keyboard / mouse input.
 *
 *  A.  block shortcuts typed at the start of an empty paragraph (+ A-neg: they do not fire elsewhere)
 *  B.  inline shortcuts (**bold**, *italic*, `code`, ~~strike~~ …) (+ negative cases)
 *  C.  undo right after a shortcut / slash command (documents current behaviour)
 *  D.  slash menu: open / filter / keyboard / mouse / commands / file pickers / position
 *
 * Assertions are on the MODEL (serialize('json'), getSelection) unless the DOM is the point
 * (menu visibility, items, highlighted item).
 *
 * No settle waits: since P-08 is fixed the model selection is re-synced synchronously at every input
 * entry point, so keystrokes are typed back to back (see fast-input.spec.ts). The only waits left assert
 * an OUTCOME on the model/DOM. The one `waitForTimeout` (C4) is the UndoManager merge window.
 */

import { test, expect, type Page, type FileChooser } from './helpers/test.js';
import {
  gotoEditor, clearAndReset, focusEditor, press, flushRender, getJson, getBlocks, getRootBlockCount,
} from './helpers/editor.js';
import { undo, redo } from './helpers/keyboard.js';

// ── Local helpers ────────────────────────────────────────────────────────────

type Summary = { type: string; props?: any; text: string; checked?: boolean; children?: Summary[] };

/** Condensed view of the document tree: type, props, plain text (code content is a string), checked, children. */
function summarize(b: any): Summary {
  const content = b.content;
  const text = typeof content === 'string' ? content : (content ?? []).map((r: any) => r.text).join('');
  const s: Summary = { type: b.type, text };
  // the `checked` of a to-do item is a prop of the JSON export (it used to sit next to `type`): shown apart here
  const { checked, ...props } = b.props ?? {};
  if (Object.keys(props).length) s.props = props;
  if (checked !== undefined) s.checked = checked;
  if (b.children) s.children = b.children.map(summarize);
  return s;
}

async function tree(page: Page): Promise<Summary[]> {
  return (await getJson(page)).blocks.map(summarize);
}

/** Delta runs of the root block at `index`. */
async function runs(page: Page, index = 0): Promise<any[]> {
  return (await getJson(page)).blocks[index].content ?? [];
}

async function textWith(page: Page, mark: string, index = 0): Promise<string> {
  return (await runs(page, index)).filter(r => r[mark]).map(r => r.text).join('');
}
async function textWithout(page: Page, mark: string, index = 0): Promise<string> {
  return (await runs(page, index)).filter(r => !r[mark]).map(r => r.text).join('');
}
async function fullText(page: Page, index = 0): Promise<string> {
  return (await runs(page, index)).map(r => r.text).join('');
}

/**
 * Block-relative caret offset as seen by the MODEL: the text behavior's reactive selection (what the
 * input rules read). NOT `nabu.selection.focusOffset`, which is the raw DOM offset (relative to the
 * current text node, so it is wrong as soon as a block has several runs, e.g. after a mark).
 */
async function caretOffset(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const b = n.selection?.focusBlock;
    const beh = b?.behaviors?.get('text');
    return beh?.selection?.from ?? undefined;
  });
}

/** The block (flat walk of nabu.children) that currently holds the model caret. */
async function focusedBlock(page: Page): Promise<{ type: string; text: string } | null> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const b = n.selection?.focusBlock;
    if (!b) return null;
    return { type: b.type, text: b.behavior?.text ?? b.text ?? '' };
  });
}

// ── Fixture ──────────────────────────────────────────────────────────────────

test.describe('Markdown shortcuts & slash menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEditor(page);
    await clearAndReset(page);
    await focusEditor(page);
  });

  // ══ A. Block shortcuts ═════════════════════════════════════════════════════

  test.describe('A · block shortcuts at the start of an empty paragraph', () => {
    for (let level = 1; level <= 6; level++) {
      test(`P0 · A1 · "${'#'.repeat(level)} " becomes a level-${level} heading, caret inside`, async ({ page }) => {
        await page.keyboard.type('#'.repeat(level) + ' ');
        await page.keyboard.type('hello');

        expect(await tree(page)).toEqual([{ type: 'heading', props: { level }, text: 'hello' }]);
      });
    }

    test('P0 · A2 · "- " becomes a bullet list, trigger removed, caret in the item', async ({ page }) => {
      await page.keyboard.type('- ');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([
        { type: 'list', props: { listType: 'bullet' }, text: '', children: [{ type: 'list-item', text: 'hello' }] },
      ]);
    });

    test('P0 · A3 · "1. " becomes an ordered list', async ({ page }) => {
      await page.keyboard.type('1. ');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([
        { type: 'list', props: { listType: 'ordered' }, text: '', children: [{ type: 'list-item', text: 'hello' }] },
      ]);
    });

    test('P2 · A3b · "3. " makes an ordered list that starts at 3 (P-14: the start number is kept)', async ({ page }) => {
      await page.keyboard.type('3. ');
      await page.keyboard.type('hello');

      const [list] = await tree(page);
      expect(list.type).toBe('list');
      expect(list.props).toEqual({ listType: 'ordered', start: 3 });
      expect(list.children).toEqual([{ type: 'list-item', text: 'hello' }]);
      // rendered as <ol start="3">, numbered 3, 4… in markdown
      await expect(page.locator('ol[data-block-type="list"]')).toHaveAttribute('start', '3');
      await press(page, 'Enter');
      await page.keyboard.type('next');
      await expect.poll(() => page.evaluate(() => (window as any).nabu.serialize('markdown'))).toBe('3. hello\n4. next');
    });

    test('P2 · A3c · "1. " has no start prop (1 is the default) and renders a plain <ol>', async ({ page }) => {
      await page.keyboard.type('1. ');
      await page.keyboard.type('hello');
      expect((await tree(page))[0].props).toEqual({ listType: 'ordered' });
      await expect(page.locator('ol[data-block-type="list"]')).not.toHaveAttribute('start', /.*/);
    });

    for (const [trigger, checked] of [['[] ', false], ['[ ] ', false], ['[x] ', true], ['[X] ', true]] as const) {
      test(`P0 · A4 · "${trigger}" becomes a ${checked ? 'checked' : 'unchecked'} to-do item`, async ({ page }) => {
        await page.keyboard.type(trigger);
        await page.keyboard.type('hello');

        expect(await tree(page)).toEqual([
          {
            type: 'list', props: { listType: 'todo' }, text: '',
            children: [{ type: 'list-item', text: 'hello', checked }],
          },
        ]);
      });
    }

    test('P0 · A5 · "> " becomes a blockquote', async ({ page }) => {
      await page.keyboard.type('> ');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([{ type: 'blockquote', text: 'hello' }]);
    });

    test('P0 · A6 · "--- " becomes a divider followed by an empty paragraph holding the caret', async ({ page }) => {
      await page.keyboard.type('--- ');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([{ type: 'divider', text: '' }, { type: 'paragraph', text: 'hello' }]);
    });

    test('P0 · A7 · "```" + Enter becomes a code block (no language)', async ({ page }) => {
      await page.keyboard.type('```\n');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([{ type: 'code', props: { language: null }, text: 'hello' }]);
    });

    test('P0 · A7b · "```js" + Enter becomes a code block with language js', async ({ page }) => {
      await page.keyboard.type('```js\n');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([{ type: 'code', props: { language: 'js' }, text: 'hello' }]);
    });

    test('P1 · A7c · "``` " (space instead of Enter) does not transform: the fence needs Enter', async ({ page }) => {
      await page.keyboard.type('``` ');
      await page.keyboard.type('x');

      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '``` x' }]);
    });

    test('P0 · A8 · "! " becomes a callout (variant note)', async ({ page }) => {
      await page.keyboard.type('! ');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([{ type: 'callout', props: { variant: 'note' }, text: 'hello' }]);
    });

    test('P0 · A9 · "-- " becomes a dialogue block', async ({ page }) => {
      await page.keyboard.type('-- ');
      await page.keyboard.type('hello');

      expect(await tree(page)).toEqual([{ type: 'dialogue', text: 'hello' }]);
    });

    test('P2 · A10 · toggle has no markdown shortcut (e.g. "> " is a quote, "▸ " / ">> " are literal)', async ({ page }) => {
      await page.keyboard.type('>> ');
      await page.keyboard.type('x');

      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '>> x' }]);
    });

    test('P1 · A11 · a trigger typed at the start of a NON-empty paragraph still transforms it and keeps the text', async ({ page }) => {
      await page.keyboard.type('abc');
      await press(page, 'Home');
      await page.keyboard.type('#');
      expect(await caretOffset(page)).toBe(1);
      await page.keyboard.type(' ');

      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');
      expect(await tree(page)).toEqual([{ type: 'heading', props: { level: 1 }, text: 'abc' }]);
    });
  });

  // ── A-neg ──────────────────────────────────────────────────────────────────

  test.describe('A-neg · triggers that must NOT transform', () => {
    for (const trigger of ['# ', '- ', '1. ', '> ', '! ', '[] ', '[x] ']) {
      test(`P0 · A-neg1 · "abc ${trigger}" typed mid-text stays a plain paragraph`, async ({ page }) => {
        await page.keyboard.type('abc ');
        await page.keyboard.type(trigger);
        await page.keyboard.type('z');

        expect(await tree(page)).toEqual([{ type: 'paragraph', text: `abc ${trigger}z` }]);
      });
    }

    test('P0 · A-neg2 · "abc ---" + space mid-text does not make a divider (stays a paragraph)', async ({ page }) => {
      await page.keyboard.type('abc ---');
      await page.keyboard.type(' ');
      await page.keyboard.type('z');

      const t = await tree(page);
      expect(t.map(b => b.type)).toEqual(['paragraph']);
      // P-17: the typography rule no longer turns the "--" of "---" into an em dash
      expect(t[0].text).toBe('abc --- z');
    });

    test('P0 · A-neg3 · "```" + Enter after other text does not make a code block (just splits)', async ({ page }) => {
      await page.keyboard.type('abc ```');
      await press(page, 'Enter');

      await expect.poll(() => getRootBlockCount(page)).toBe(2);
      expect((await tree(page)).map(b => b.type)).toEqual(['paragraph', 'paragraph']);
    });

    test('P0 · A-neg4 · "#hello" (no space) stays literal', async ({ page }) => {
      await page.keyboard.type('#hello');

      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '#hello' }]);
    });

    test('P0 · A-neg5 · "####### " (7 hashes) does not make a heading', async ({ page }) => {
      await page.keyboard.type('####### ');
      await page.keyboard.type('x');

      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '####### x' }]);
    });

    test('P1 · A-neg6 · "#" + Enter (no space) just splits, no heading', async ({ page }) => {
      await page.keyboard.type('#');
      await press(page, 'Enter');

      await expect.poll(() => getRootBlockCount(page)).toBe(2);
      expect((await getBlocks(page)).map(b => [b.type, b.text ?? ''])).toEqual([['paragraph', '#'], ['paragraph', '']]);
    });
  });

  // ══ B. Inline shortcuts ════════════════════════════════════════════════════

  test.describe('B · inline shortcuts typed for real', () => {
    /**
     * Types `lead` + `typed` (all but the closing delimiter), then the closing delimiter, then
     * waits for the caret to land after the converted text and types " after".
     */
    async function typeInline(page: Page, body: string, close: string, innerLen: number) {
      await page.keyboard.type('x ' + body);
      await page.keyboard.type(close);
      // delimiters are removed: the model caret must end right after the inner text
      expect(await caretOffset(page)).toBe(2 + innerLen);
      await page.keyboard.type(' after');
    }

    const cases: Array<[string, string, string, string[], string]> = [
      // title, body typed before the closing char, closing char, marks, inner text
      ['**bold**', '**bold*', '*', ['bold'], 'bold'],
      ['__bold__', '__bold_', '_', ['bold'], 'bold'],
      ['*italic*', '*ital', '*', ['italic'], 'ital'],
      ['_italic_', '_ital', '_', ['italic'], 'ital'],
      ['`code`', '`code', '`', ['code'], 'code'],
      ['~~strike~~', '~~strike~', '~', ['strikethrough'], 'strike'],
      ['***both***', '***both**', '*', ['bold', 'italic'], 'both'],
    ];

    for (const [title, body, close, marks, inner] of cases) {
      test(`P0 · B1 · ${title} applies ${marks.join('+')} on exactly the inner text, delimiters gone, typing continues unmarked`, async ({ page }) => {
        await typeInline(page, body, close, inner.length);

        expect(await fullText(page)).toBe(`x ${inner} after`);
        for (const m of marks) {
          expect(await textWith(page, m), `mark ${m}`).toBe(inner);
        }
        // nothing outside the inner text carries any of the marks
        for (const m of marks) expect(await textWithout(page, m), `outside ${m}`).toBe('x  after');
        // one block, still a paragraph
        expect((await tree(page)).map(b => b.type)).toEqual(['paragraph']);
      });
    }

    test('P1 · B2 · inline shortcut at the very start of a block works too', async ({ page }) => {
      await page.keyboard.type('**hi*');
      await page.keyboard.type('*');
      expect(await caretOffset(page)).toBe(2);

      expect(await fullText(page)).toBe('hi');
      expect(await textWith(page, 'bold')).toBe('hi');
    });

    test('P0 · B3 · NEG "2 * 3 * 4" stays literal (a lone spaced asterisk pair is not italic)', async ({ page }) => {
      await page.keyboard.type('2 * 3 ');
      await page.keyboard.type('*');
      await page.keyboard.type(' 4');

      expect(await fullText(page)).toBe('2 * 3 * 4');
      expect(await textWith(page, 'italic')).toBe('');
    });

    test('P0 · B4 · NEG "snake_case_name" stays literal (intra-word underscores are not italic)', async ({ page }) => {
      await page.keyboard.type('snake_case');
      await page.keyboard.type('_');
      await page.keyboard.type('name');

      expect(await fullText(page)).toBe('snake_case_name');
      expect(await textWith(page, 'italic')).toBe('');
    });

    test('P1 · B5 · NEG an unclosed "**bold" stays literal', async ({ page }) => {
      await page.keyboard.type('**bold');

      expect(await fullText(page)).toBe('**bold');
      expect(await textWith(page, 'bold')).toBe('');
    });

    test('P1 · B6 · NEG "a * b" with a single asterisk never closes, stays literal', async ({ page }) => {
      await page.keyboard.type('a * b');

      expect(await fullText(page)).toBe('a * b');
      expect(await textWith(page, 'italic')).toBe('');
    });
  });

  test.describe('B2 · inline shortcut flanking rules (P-09 / P-10)', () => {
    test('P0 · B7 · "***both***" typed char by char: bold+italic, all delimiters gone', async ({ page }) => {
      await page.keyboard.type('***both**');
      await page.keyboard.type('*');
      expect(await caretOffset(page)).toBe(4);

      expect(await fullText(page)).toBe('both');
      expect(await textWith(page, 'bold')).toBe('both');
      expect(await textWith(page, 'italic')).toBe('both');
    });

    test('P0 · B8 · NEG "* not *" stays literal (opener followed by a space)', async ({ page }) => {
      await page.keyboard.type('* not ');
      await page.keyboard.type('*');
      await page.keyboard.type(' x');

      expect(await fullText(page)).toBe('* not * x');
      expect(await textWith(page, 'italic')).toBe('');
    });

    test('P0 · B9 · "x _it_ y" still makes an italic "it" (underscore opener after a space)', async ({ page }) => {
      await page.keyboard.type('x _it');
      await page.keyboard.type('_');
      expect(await caretOffset(page)).toBe(4);
      await page.keyboard.type(' y');

      expect(await fullText(page)).toBe('x it y');
      expect(await textWith(page, 'italic')).toBe('it');
    });

    test('P1 · B10 · "a*b*c": asterisks may be intraword (CommonMark), "b" becomes italic', async ({ page }) => {
      await page.keyboard.type('a*b');
      await page.keyboard.type('*');
      expect(await caretOffset(page)).toBe(2);
      await page.keyboard.type('c');

      expect(await fullText(page)).toBe('abc');
      expect(await textWith(page, 'italic')).toBe('b');
    });

    test('P1 · B11 · "`a b`" keeps the inner space inside the code span', async ({ page }) => {
      await page.keyboard.type('`a b');
      await page.keyboard.type('`');
      expect(await caretOffset(page)).toBe(3);

      expect(await fullText(page)).toBe('a b');
      expect(await textWith(page, 'code')).toBe('a b');
    });
  });

  // ══ C. Undo after a shortcut ═══════════════════════════════════════════════

  test.describe('C · undo right after a shortcut', () => {
    /**
     * Each structural op is its own undo step: ONE Ctrl+Z turns the new block back into a paragraph that
     * holds EXACTLY what was typed, trigger space included ("# " -> "# ", P-13); a second Ctrl+Z removes the rest.
     * (Used to be the trigger WITHOUT its space: "# " -> "#".)
     */
    const undoCases: Array<[string, string, string]> = [
      // trigger, text left after 1st undo, type of the block created by the trigger
      ['# ', '# ', 'heading'],
      ['## ', '## ', 'heading'],
      ['> ', '> ', 'blockquote'],
      ['! ', '! ', 'callout'],
      ['-- ', '-- ', 'dialogue'],
      ['--- ', '--- ', 'divider'],
      ['- ', '- ', 'list'],
      ['1. ', '1. ', 'list'],
      ['3. ', '3. ', 'list'],
      ['[] ', '[] ', 'list'],
      ['[x] ', '[x] ', 'list'],
    ];

    for (const [trigger, left, created] of undoCases) {
      test(`P0 · C1 · "${trigger}" then Ctrl+Z -> a single paragraph "${left}" (no ${created} left)`, async ({ page }) => {
        await page.keyboard.type(trigger);
        await expect.poll(async () => (await tree(page)).some(b => b.type === created)).toBe(true);

        await undo(page);
        await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['paragraph']);
        expect(await tree(page)).toEqual([{ type: 'paragraph', text: left }]);
      });

      test(`P0 · C2 · "${trigger}" then Ctrl+Z -> caret is back at the end of "${left}" and typing lands there`, async ({ page }) => {
        await page.keyboard.type(trigger);
        await expect.poll(async () => (await tree(page)).some(b => b.type === created)).toBe(true);

        await undo(page);
        await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['paragraph']);
        await expect.poll(() => caretOffset(page)).toBe(left.length);

        await page.keyboard.type('Z');
        await expect.poll(async () => (await tree(page))[0]?.text).toBe(left + 'Z');
      });
    }

    test('P1 · C3 · "# " then Ctrl+Z twice -> an empty paragraph, caret at 0', async ({ page }) => {
      await page.keyboard.type('# ');
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');

      await undo(page);
      await expect.poll(async () => (await tree(page))[0].text).toBe('# ');
      await undo(page);
      await expect.poll(async () => (await tree(page))[0].text).toBe('');

      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '' }]);
      await expect.poll(() => caretOffset(page)).toBe(0);
    });

    test('P0 · C5 · "# " Ctrl+Z (-> "# ") Ctrl+Y: the heading is back, caret inside, typing lands there (P-13 redo)', async ({ page }) => {
      await page.keyboard.type('# ');
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');

      await undo(page);
      await expect.poll(async () => (await tree(page))[0].text).toBe('# ');
      await redo(page);
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');
      expect(await tree(page)).toEqual([{ type: 'heading', props: { level: 1 }, text: '' }]);
      await page.keyboard.type('hello');
      expect(await tree(page)).toEqual([{ type: 'heading', props: { level: 1 }, text: 'hello' }]);
    });

    for (const [trigger, created] of [['- ', 'list'], ['--- ', 'divider']] as const) {
      test(`P0 · C5b · "${trigger}" Ctrl+Z Ctrl+Y: the ${created} is back and the caret is usable`, async ({ page }) => {
        await page.keyboard.type(trigger);
        await expect.poll(async () => (await tree(page)).some(b => b.type === created)).toBe(true);
        const before = await tree(page);

        await undo(page);
        await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['paragraph']);
        await redo(page);
        await expect.poll(async () => (await tree(page)).some(b => b.type === created)).toBe(true);
        expect(await tree(page)).toEqual(before);

        await page.keyboard.type('hello');
        const last = (await tree(page)).at(-1)!;
        expect(created === 'list' ? last.children![0].text : last.text).toBe('hello');
      });
    }

    test('P0 · C6 · "- " Ctrl+Z, then typing continues the paragraph; a second Ctrl+Z removes what was typed', async ({ page }) => {
      await page.keyboard.type('- ');
      await expect.poll(async () => (await tree(page))[0].type).toBe('list');
      await undo(page);
      await expect.poll(async () => (await tree(page))[0].text).toBe('- ');
      await expect.poll(() => caretOffset(page)).toBe(2);

      await page.keyboard.type('foo');
      await expect.poll(async () => (await tree(page))[0].text).toBe('- foo');
      expect((await tree(page)).map(b => b.type)).toEqual(['paragraph']);
    });

    test('P0 · C7 · "```js" + Enter then Ctrl+Z -> a paragraph "```js" (what was typed before the Enter), caret at its end', async ({ page }) => {
      await page.keyboard.type('```js\n');
      await expect.poll(async () => (await tree(page))[0].type).toBe('code');

      await undo(page);
      await expect.poll(async () => (await tree(page))[0].type).toBe('paragraph');
      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '```js' }]);
      await expect.poll(() => caretOffset(page)).toBe(5);
      await page.keyboard.type('Z');
      await expect.poll(async () => (await tree(page))[0].text).toBe('```jsZ');
    });

    test('P1 · C8 · the trigger is never visible as text: no "# " flash while the heading is created', async ({ page }) => {
      // Record every text the editor DOM ever shows for the block while we type the trigger.
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as any).__seen = seen;
        const root = document.querySelector('[data-block-id]')!.parentElement!;
        new MutationObserver(() => seen.push(root.textContent ?? '')).observe(root, { subtree: true, childList: true, characterData: true });
      });
      await page.keyboard.type('# ');
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');
      const seen: string[] = await page.evaluate(() => (window as any).__seen);
      expect(seen).not.toContain('# ');
    });

    test('P1 · C4 · inline "**bold**" then Ctrl+Z (conversion in its own undo step) -> what remains', async ({ page }) => {
      await page.keyboard.type('**bold*');
      // KEEP: a real sleep, the feature under test is time-based — it must outlive the UndoManager 1 s merge window
      // so that the conversion is recorded as its own undo step.
      await page.waitForTimeout(1200);
      await page.keyboard.type('*');
      expect(await caretOffset(page)).toBe(4);
      expect(await textWith(page, 'bold')).toBe('bold');

      await undo(page);
      await expect.poll(async () => await textWith(page, 'bold')).toBe('');
      // Current behaviour is recorded by the assertion below.
      expect(await fullText(page)).toBe('**bold*');
    });
  });

  // ══ D. Slash menu ══════════════════════════════════════════════════════════

  test.describe('D · slash menu', () => {
    const menu = (page: Page) => page.locator('.nabu-slash');
    const items = (page: Page) => page.locator('.nabu-slash .nabu-slash-item');
    const titles = (page: Page) => page.locator('.nabu-slash .nabu-slash-title').allTextContents();
    const activeTitle = (page: Page) => page.locator('.nabu-slash .nabu-slash-item.active .nabu-slash-title').textContent();

    const ALL_TITLES = [
      'Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'To-do list',
      'Code', 'Callout', 'Quote', 'Toggle', 'Divider', 'Image', 'Video', 'File',
      // contributed by the Regions extension (the default types), offered at the root
      'Section', 'Subsection', 'Sub-subsection',
    ];

    /** Types "/" + query one char at a time so the menu is live while filtering. */
    async function slash(page: Page, query = '') {
      await page.keyboard.type('/');
      if (query) await page.keyboard.type(query);
    }

    // ── open / close triggers ────────────────────────────────────────────────

    test('P0 · D1 · "/" in an empty paragraph opens the menu with all default items, first one highlighted', async ({ page }) => {
      await expect(menu(page)).toHaveCount(0);
      await slash(page);

      await expect(menu(page)).toBeVisible();
      await expect.poll(() => titles(page)).toEqual(ALL_TITLES);
      expect(await activeTitle(page)).toBe('Text');
    });

    test('P0 · D2 · "/" after a space mid-text opens the menu', async ({ page }) => {
      await page.keyboard.type('hello ');
      await slash(page);

      await expect(menu(page)).toBeVisible();
      await expect.poll(() => items(page).count()).toBe(ALL_TITLES.length);
    });

    test('P0 · D3 · "a/" (no space before the slash) does not open the menu', async ({ page }) => {
      await page.keyboard.type('a/');
      await flushRender(page); // negative check: let any (wrongly) pending menu render before asserting its absence

      await expect(menu(page)).toHaveCount(0);
      expect(await fullText(page)).toBe('a/');
    });

    // ── filtering ────────────────────────────────────────────────────────────

    test('P0 · D4 · "/hea" shows only the three heading items', async ({ page }) => {
      await slash(page, 'hea');

      await expect.poll(() => titles(page)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    });

    test('P0 · D5 · aliases work: "/ul" -> Bulleted list only, "/hr" -> Divider', async ({ page }) => {
      await slash(page, 'ul');
      // P-16: aliases match by PREFIX, so "ul" no longer hits Divider through its "r-ul-e" alias
      await expect.poll(async () => (await titles(page))[0]).toBe('Bulleted list');
      expect(await activeTitle(page)).toBe('Bulleted list');
      expect(await titles(page)).toEqual(['Bulleted list']);

      // replace the query: erase "ul", type "hr"
      await press(page, 'Backspace');
      await press(page, 'Backspace');
      await page.keyboard.type('hr');
      await expect.poll(() => titles(page)).toEqual(['Divider']);
    });

    test('P1 · D5b · filtering is case-insensitive ("/TODO" -> To-do list)', async ({ page }) => {
      await slash(page, 'TODO');

      await expect.poll(() => titles(page)).toEqual(['To-do list']);
    });

    test('P0 · D6 · a query with no match closes the menu, and a Backspace reopens it', async ({ page }) => {
      await slash(page, 'zzz');
      await expect(menu(page)).toHaveCount(0);
      expect(await fullText(page)).toBe('/zzz');

      await press(page, 'Backspace');
      await press(page, 'Backspace');
      await press(page, 'Backspace');
      await expect(menu(page)).toBeVisible();
      await expect.poll(() => items(page).count()).toBe(ALL_TITLES.length);
    });

    test('P0 · D7 · typing a space closes the menu and leaves the text untouched', async ({ page }) => {
      await slash(page, 'he');
      await expect(menu(page)).toBeVisible();

      await page.keyboard.type(' ');
      await expect(menu(page)).toHaveCount(0);
      expect(await fullText(page)).toBe('/he ');
      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '/he ' }]);
    });

    // ── keyboard ─────────────────────────────────────────────────────────────

    test('P0 · D8 · ArrowDown / ArrowUp move the highlight and wrap around; the caret does not move', async ({ page }) => {
      await slash(page);
      expect(await activeTitle(page)).toBe('Text');

      await press(page, 'ArrowDown');
      expect(await activeTitle(page)).toBe('Heading 1');
      await press(page, 'ArrowDown');
      expect(await activeTitle(page)).toBe('Heading 2');
      await press(page, 'ArrowUp');
      expect(await activeTitle(page)).toBe('Heading 1');
      await press(page, 'ArrowUp');
      expect(await activeTitle(page)).toBe('Text');

      // wrap: up from the first -> last
      await press(page, 'ArrowUp');
      expect(await activeTitle(page)).toBe('Sub-subsection');
      // wrap: down from the last -> first
      await press(page, 'ArrowDown');
      expect(await activeTitle(page)).toBe('Text');

      expect(await caretOffset(page)).toBe(1);
      expect(await fullText(page)).toBe('/');
    });

    test('P0 · D9 · Enter runs the highlighted item (ArrowDown then Enter -> Heading 1)', async ({ page }) => {
      await slash(page);
      await press(page, 'ArrowDown');
      await press(page, 'Enter');

      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');
      expect(await tree(page)).toEqual([{ type: 'heading', props: { level: 1 }, text: '' }]);
      await expect(menu(page)).toHaveCount(0);
    });

    test('P1 · D9b · Tab also runs the highlighted item', async ({ page }) => {
      await slash(page, 'quote');
      await press(page, 'Tab');

      await expect.poll(async () => (await tree(page))[0].type).toBe('blockquote');
      await expect(menu(page)).toHaveCount(0);
    });

    test('P1 · D9c · the highlight resets to the first item when the query changes', async ({ page }) => {
      await slash(page, 'h');
      await press(page, 'ArrowDown');
      await press(page, 'ArrowDown');
      const moved = await activeTitle(page);
      expect(moved).not.toBe((await titles(page))[0]);

      await page.keyboard.type('e');
      expect(await activeTitle(page)).toBe((await titles(page))[0]);
    });

    test('P0 · D10 · Escape closes the menu and the "/query" text stays', async ({ page }) => {
      await slash(page, 'he');
      await expect(menu(page)).toBeVisible();

      await press(page, 'Escape');
      await expect(menu(page)).toHaveCount(0);
      expect(await fullText(page)).toBe('/he');
      expect((await tree(page))[0].type).toBe('paragraph');
    });

    test('P0 · D11 · after Escape, typing more does not reopen the menu for that same slash', async ({ page }) => {
      await slash(page, 'he');
      await press(page, 'Escape');
      await expect(menu(page)).toHaveCount(0);

      await page.keyboard.type('a');
      await flushRender(page); // negative check: let any (wrongly) pending menu render before asserting its absence
      await expect(menu(page)).toHaveCount(0);
      expect(await fullText(page)).toBe('/hea');

      // …but a NEW slash later in the same block does open it again
      await page.keyboard.type(' ');
      await slash(page);
      await expect(menu(page)).toBeVisible();
    });

    test('P1 · D11b · Enter with the menu closed (after Escape) is a normal Enter: it splits the block', async ({ page }) => {
      await slash(page, 'he');
      await press(page, 'Escape');
      await press(page, 'Enter');

      await expect.poll(() => getRootBlockCount(page)).toBe(2);
      expect((await getBlocks(page)).map(b => b.text ?? '')).toEqual(['/he', '']);
    });

    // ── mouse ────────────────────────────────────────────────────────────────

    test('P0 · D12 · hovering an item highlights it, clicking it runs it', async ({ page }) => {
      await slash(page);
      const quote = items(page).filter({ hasText: 'Quote' });
      await quote.hover();
      expect(await activeTitle(page)).toBe('Quote');

      await quote.click();

      await expect.poll(async () => (await tree(page))[0].type).toBe('blockquote');
      expect(await tree(page)).toEqual([{ type: 'blockquote', text: '' }]);
      await expect(menu(page)).toHaveCount(0);
      // clicking the menu must not have stolen the caret: typing lands in the quote
      await page.keyboard.type('typed');
      expect(await tree(page)).toEqual([{ type: 'blockquote', text: 'typed' }]);
    });

    test('P1 · D12b · clicking a filtered item runs that item, not the first of the full list', async ({ page }) => {
      await slash(page, 'hea');
      await items(page).filter({ hasText: 'Heading 3' }).click();

      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');
      expect(await tree(page)).toEqual([{ type: 'heading', props: { level: 3 }, text: '' }]);
    });

    // ── running commands ─────────────────────────────────────────────────────

    const cmdCases: Array<{ query: string; expected: Summary[]; caretType: string }> = [
      { query: 'h1', caretType: 'heading', expected: [{ type: 'heading', props: { level: 1 }, text: 'hello' }] },
      { query: 'h2', caretType: 'heading', expected: [{ type: 'heading', props: { level: 2 }, text: 'hello' }] },
      { query: 'h3', caretType: 'heading', expected: [{ type: 'heading', props: { level: 3 }, text: 'hello' }] },
      {
        query: 'ul', caretType: 'list-item',
        expected: [{ type: 'list', props: { listType: 'bullet' }, text: '', children: [{ type: 'list-item', text: 'hello' }] }],
      },
      {
        query: 'numbered', caretType: 'list-item',
        expected: [{ type: 'list', props: { listType: 'ordered' }, text: '', children: [{ type: 'list-item', text: 'hello' }] }],
      },
      {
        query: 'todo', caretType: 'list-item',
        expected: [{
          type: 'list', props: { listType: 'todo' }, text: '',
          children: [{ type: 'list-item', text: 'hello', checked: false }],
        }],
      },
      { query: 'quote', caretType: 'blockquote', expected: [{ type: 'blockquote', text: 'hello' }] },
      { query: 'code', caretType: 'code', expected: [{ type: 'code', props: { language: null }, text: 'hello' }] },
      { query: 'callout', caretType: 'callout', expected: [{ type: 'callout', props: { variant: 'note' }, text: 'hello' }] },
      { query: 'toggle', caretType: 'toggle', expected: [{ type: 'toggle', props: { collapsed: false }, text: 'hello', children: [] }] },
      { query: 'text', caretType: 'paragraph', expected: [{ type: 'paragraph', text: 'hello' }] },
    ];

    for (const { query, expected, caretType } of cmdCases) {
      test(`P0 · D13 · "/${query}" + Enter -> ${expected[0].type}${expected[0].props ? ' ' + JSON.stringify(expected[0].props) : ''}, query text removed, caret usable`, async ({ page }) => {
        await slash(page, query);
        await expect(menu(page)).toBeVisible();
        await press(page, 'Enter');

        await page.keyboard.type('hello');
        await expect(menu(page)).toHaveCount(0);
        expect(await tree(page)).toEqual(expected);
      });
    }

    test('P0 · D14 · "/divider" in an EMPTY paragraph turns it into the divider; a new paragraph below holds the caret (P-15, like "--- ")', async ({ page }) => {
      await slash(page, 'divider');
      await press(page, 'Enter');

      await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['divider', 'paragraph']);
      expect(await tree(page)).toEqual([{ type: 'divider', text: '' }, { type: 'paragraph', text: '' }]);

      // the caret is in the paragraph below the divider and typing works
      await page.keyboard.type('hello');
      expect(await tree(page)).toEqual([{ type: 'divider', text: '' }, { type: 'paragraph', text: 'hello' }]);
    });

    test('P1 · D14b · "/divider" typed after text keeps the text, adds the divider below it and a caret paragraph under the divider', async ({ page }) => {
      await page.keyboard.type('above ');
      await slash(page, 'hr');
      await press(page, 'Enter');

      await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['paragraph', 'divider', 'paragraph']);
      expect((await tree(page))[0].text).toBe('above ');
      await page.keyboard.type('hello');
      expect((await tree(page)).map(b => b.text)).toEqual(['above ', '', 'hello']);
    });

    test('P1 · D14c · "/divider" then Ctrl+Z restores the empty paragraph and a usable caret', async ({ page }) => {
      await slash(page, 'divider');
      await press(page, 'Enter');
      await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['divider', 'paragraph']);

      await undo(page);
      await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['paragraph']);
      await expect.poll(async () => (await focusedBlock(page))?.type).toBe('paragraph');
      await page.keyboard.type('x');
      await expect.poll(async () => (await tree(page))[0]?.text).toBe('x');
    });

    test('P1 · D15 · a command run mid-text only removes "/query": the text before it is kept', async ({ page }) => {
      await page.keyboard.type('keep me ');
      await slash(page, 'quote');
      await press(page, 'Enter');

      await expect.poll(async () => (await tree(page))[0].type).toBe('blockquote');
      expect(await tree(page)).toEqual([{ type: 'blockquote', text: 'keep me ' }]);
      await expect.poll(() => caretOffset(page)).toBe('keep me '.length);
    });

    test('P1 · D16 · running a command leaves no stray "/" in the markdown', async ({ page }) => {
      await slash(page, 'h1');
      await press(page, 'Enter');
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');

      const md = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
      expect(md).not.toContain('/');
    });

    test('P1 · D17 · /Text on a heading turns it back into a paragraph', async ({ page }) => {
      await page.keyboard.type('# ');
      await page.keyboard.type('title');
      await page.keyboard.type(' ');
      await slash(page, 'text');
      await press(page, 'Enter');

      await expect.poll(async () => (await tree(page))[0].type).toBe('paragraph');
      expect((await tree(page))[0].text.startsWith('title')).toBe(true);
    });

    // ── undo after a slash command ───────────────────────────────────────────

    test('P0 · D18 · "/h1" Enter then Ctrl+Z -> back to a paragraph; the "/h1" text is not restored', async ({ page }) => {
      await slash(page, 'h1');
      await press(page, 'Enter');
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');

      await undo(page);
      await expect.poll(async () => (await tree(page))[0].type).toBe('paragraph');
      // Current behaviour: the transform is its own undo step; "/h1" typing + deletion are one earlier
      // step, so a single Ctrl+Z leaves an EMPTY paragraph.
      expect(await tree(page)).toEqual([{ type: 'paragraph', text: '' }]);
    });

    test('P0 · D18b · after that undo the caret is usable: typing lands in the paragraph', async ({ page }) => {
      await slash(page, 'h1');
      await press(page, 'Enter');
      await expect.poll(async () => (await tree(page))[0].type).toBe('heading');

      await undo(page);
      await expect.poll(async () => (await tree(page))[0].type).toBe('paragraph');
      await expect.poll(async () => (await focusedBlock(page))?.type).toBe('paragraph');
      await page.keyboard.type('after');

      await expect.poll(async () => (await tree(page))[0].text).toBe('after');
    });

    // ── file pickers ─────────────────────────────────────────────────────────

    // NB: the 'filechooser' listener must be registered well BEFORE the key press: Playwright enables chooser
    // interception asynchronously, and a listener added right before Enter misses the event ~1 run in 3.
    const chooserPromise = (page: Page) => new Promise<FileChooser>(res => page.once('filechooser', res));

    for (const [query, title] of [['image', 'Image'], ['video', 'Video'], ['file', 'File']] as const) {
      test(`P1 · D19 · "/${query}" + Enter opens a native file chooser`, async ({ page }) => {
        const chooserP = chooserPromise(page);
        await slash(page, query);
        await expect.poll(() => titles(page)).toEqual([title]);

        await press(page, 'Enter');
        const chooser = await chooserP;
        expect(chooser.isMultiple()).toBe(false);
        // the "/query" text is already gone and no block was created before a file is chosen
        expect(await tree(page)).toEqual([{ type: 'paragraph', text: '' }]);
      });
    }

    test('P1 · D20 · choosing a PNG in the Image chooser inserts an image block after the paragraph', async ({ page }) => {
      const chooserP = chooserPromise(page);
      await slash(page, 'image');
      await press(page, 'Enter');
      const chooser = await chooserP;

      // 1x1 transparent PNG
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );
      await chooser.setFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: png });

      await expect.poll(async () => (await tree(page)).map(b => b.type)).toEqual(['paragraph', 'image']);
      // the file is persisted into the asset store and referenced by an opaque ref (the file name is not kept on the block)
      await expect.poll(async () => ((await getJson(page)).blocks[1].props?.ref ?? '')).toMatch(/^nabu-asset:sha256-/);
      await expect(page.locator('[data-block-type="image"]')).toHaveCount(1);
    });

    // ── position ─────────────────────────────────────────────────────────────

    test('P1 · D21 · the menu is positioned just below the caret line and fully inside the viewport', async ({ page }) => {
      await slash(page);
      await expect(menu(page)).toBeVisible();

      const para = (await page.locator('[data-block-type="paragraph"]').boundingBox())!;
      const box = (await menu(page).boundingBox())!;
      const vp = page.viewportSize()!;

      // vertically: starts at/after the top of the caret line, at most ~80px under the paragraph
      expect(box.y).toBeGreaterThanOrEqual(para.y);
      expect(box.y).toBeLessThanOrEqual(para.y + para.height + 80);
      // horizontally: aligned with the caret (near the paragraph's left edge)
      expect(Math.abs(box.x - para.x)).toBeLessThan(80);
      // inside the viewport
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    });

    /** Fills the page with 60 paragraphs so that the document scrolls. */
    async function fillPage(page: Page) {
      await page.evaluate(async () => {
        const n = (window as any).nabu;
        for (let i = 0; i < 60; i++) n.insert('paragraph', { text: 'line ' + i });
        await n.commit();
      });
    }

    /** Viewport rect of the block holding the caret. */
    const caretLineRect = (page: Page) => page.evaluate(() => {
      const n = (window as any).nabu;
      const b = n.selection.focusBlock;
      const r = document.querySelector(`[data-block-id="${b.id}"]`)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });

    test('P1 · D22 · when the page is scrolled, the menu is still placed next to the caret line (position: fixed, viewport coordinates)', async ({ page }) => {
      await fillPage(page);
      // scroll so that "line 30" sits at the TOP of the viewport (lots of room below), then put the caret at its end
      await page.evaluate(() => { document.querySelectorAll('[data-block-type="paragraph"]')[30].scrollIntoView({ block: 'start' }); });
      await page.locator('[data-block-type="paragraph"]').nth(30).click();
      await press(page, 'End');
      await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      expect(await caretOffset(page)).toBe('line 30'.length);

      await page.keyboard.type(' ');
      expect(await caretOffset(page)).toBe('line 30 '.length);
      await page.keyboard.type('/');

      await expect(menu(page)).toBeVisible();
      const caretLine = await caretLineRect(page);
      const box = (await menu(page).boundingBox())!;
      const vp = page.viewportSize()!;

      // regression (P-12): document coordinates (scrollY added) put the menu far below the viewport
      expect(Math.abs(box.y - caretLine.bottom), `menu.y=${box.y} caretLine=${JSON.stringify(caretLine)} scrollY=${await page.evaluate(() => window.scrollY)}`).toBeLessThan(20);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    });

    test('P1 · D23 · caret near the bottom of the viewport: the menu flips ABOVE the caret line and stays inside the viewport', async ({ page }) => {
      await fillPage(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.locator('[data-block-type="paragraph"]').last().click();
      await press(page, 'End');
      expect(await caretOffset(page)).toBe('line 59'.length);
      await page.keyboard.type(' ');
      expect(await caretOffset(page)).toBe('line 59 '.length);
      await page.keyboard.type('/');

      await expect(menu(page)).toBeVisible();
      const caretLine = await caretLineRect(page);
      const box = (await menu(page).boundingBox())!;
      const vp = page.viewportSize()!;

      expect(caretLine.bottom, 'the caret line is near the bottom edge').toBeGreaterThan(vp.height - 120);
      expect(box.y + box.height, 'menu ends above the caret line').toBeLessThanOrEqual(caretLine.top);
      expect(caretLine.top - (box.y + box.height), 'and right above it').toBeLessThan(20);
      expect(box.y).toBeGreaterThanOrEqual(0);
    });

    test('P1 · D24 · the menu follows the caret when the page scrolls while it is open', async ({ page }) => {
      await fillPage(page);
      await page.evaluate(() => { document.querySelectorAll('[data-block-type="paragraph"]')[30].scrollIntoView({ block: 'center' }); });
      await page.locator('[data-block-type="paragraph"]').nth(30).click();
      await press(page, 'End');
      expect(await caretOffset(page)).toBe('line 30'.length);
      await page.keyboard.type(' ');
      expect(await caretOffset(page)).toBe('line 30 '.length);
      await page.keyboard.type('/');
      await expect(menu(page)).toBeVisible();
      const y0 = (await menu(page).boundingBox())!.y;

      await page.evaluate(() => window.scrollBy(0, 50));
      await expect.poll(async () => (await menu(page).boundingBox())!.y).toBeLessThan(y0 - 30);
    });
  });
});
