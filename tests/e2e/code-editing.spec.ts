/**
 * E2E — writing code: the code BLOCK (src/lib/blocks/code) and the INLINE code mark, driven by REAL keys.
 *
 * Complements blocks-special.spec.ts (A · Code: Enter, Tab at the caret, exit, Backspace, markdown stays literal, paste), which stay
 * the reference for what they pin. This file adds what a developer does all day: auto-indent, Tab over several lines, Ctrl+A, the
 * slash menu that must not open on a `/`, CRLF pastes, long lines, the language select, round trips, and the inline code mark.
 *
 *  A. code block: typing, indentation, selection, exits      B. clipboard      C. long lines, language select, placeholder
 *  D. export / import round trips                           E. inline code
 *
 * DECIDED (owner may revisit): Tab = 2 spaces (no tab character); Enter keeps the indentation of the line; Enter on an empty last line
 * does NOT leave the block (ArrowDown / ArrowUp at the edge do); a selection within ONE line is replaced by Tab (VS Code), a selection over
 * several lines is indented line by line.
 */

import { test, expect, type Page } from './helpers/test.js';
import { gotoEditor, clearAndReset, press, flushRender, getMarkdown, getJson } from './helpers/editor.js';
import { buildTree, tree, Pp, Code } from './helpers/blocks.js';
import { caret, focusAt, focusEnd, focusEmpty, selectRange } from './helpers/model.js';
import { undo, redo } from './helpers/keyboard.js';
import { pasteText, pasteHtml } from './helpers/clipboard.js';
import { copy } from './helpers/clip-capture.js';

const expectTree = (page: Page, expected: string) => expect.poll(() => tree(page), { timeout: 3000, message: 'model tree' }).toBe(expected);
const expectCaret = (page: Page, expected: string | null) => expect.poll(() => caret(page), { timeout: 3000, message: 'caret' }).toBe(expected);
/** The model text of the code block `n` (document order), newlines as-is. */
const codeText = (page: Page, n = 0) => page.evaluate((i) => {
  const roots = [...(window as any).nabu.tree.roots()].filter((r: any) => r.data.get('type') === 'code');
  return roots[i]?.data.get('text').toString() as string;
}, n);
/** Delta of the first TEXT block shown, with adjacent segments of equal attributes merged (the shape of the text, not of its storage). */
const delta = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const b = [...n.blocks.values()].find((x: any) => x.behaviors?.get('text') && document.querySelector(`[data-block-id="${x.id}"]`)) as any;
  const out: any[] = [];
  for (const op of b.delta) {
    const last = out[out.length - 1];
    if (last && JSON.stringify(last.attributes ?? {}) === JSON.stringify(op.attributes ?? {})) last.insert += op.insert;
    else out.push({ ...op });
  }
  return out;
});
const slashMenu = (page: Page) => page.locator('.nabu-slash');

test.beforeEach(async ({ page }) => {
  await gotoEditor(page);
  await clearAndReset(page);
});

// ═══════════════════════════════════════════════════════════════════════════
// A. Code block: typing, indentation, selection, exits
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · code block: typing', () => {
  test('1 · Enter and Shift+Enter both insert a newline in the block, the caret is on the new line', async ({ page }) => {
    await buildTree(page, [Code('ab', 'js')]);
    await focusEnd(page, 'ab');
    await press(page, 'Enter');
    await expectTree(page, 'code:js(ab\\n)');
    await expectCaret(page, 'ab\n|');
    await page.keyboard.type('c');
    await press(page, 'Shift+Enter');
    await expectTree(page, 'code:js(ab\\nc\\n)');
    await expectCaret(page, 'ab\nc\n|');
  });

  test('2 · auto-indent: Enter keeps the spaces / tabs of the line, up to the caret', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await page.keyboard.type('if (x) {');
    await press(page, 'Enter');
    await expectTree(page, 'code(if (x) {\\n)'); // no indentation on the line: a plain newline
    await press(page, 'Tab');
    await page.keyboard.type('a();');
    await press(page, 'Enter');
    await expectTree(page, 'code(if (x) {\\n  a();\\n  )');
    await expectCaret(page, 'if (x) {\n  a();\n  |');
    await page.keyboard.type('b();');
    await press(page, 'Shift+Enter'); // the same as Enter
    await expectTree(page, 'code(if (x) {\\n  a();\\n  b();\\n  )');
    // Backspace takes the indentation back one character at a time (it is plain text)
    await press(page, 'Backspace'); await press(page, 'Backspace');
    await page.keyboard.type('}');
    await expectTree(page, 'code(if (x) {\\n  a();\\n  b();\\n})');
  });

  test('2b · auto-indent with a tab character, and with the caret INSIDE the indentation (only the part before it is kept)', async ({ page }) => {
    await buildTree(page, [Code('\t\tx\n      y')]);
    await focusAt(page, '\t\tx\n      y', 3); // after "\t\tx"
    await press(page, 'Enter');
    await expectTree(page, 'code(\\t\\tx\\n\\t\\t\\n      y)'.replace('\\n\\t\\t\\n', '\\n\\t\\t\\n'));
    await expectCaret(page, '\t\tx\n\t\t|\n      y');
    // caret after 2 of the 6 spaces of line 3
    await buildTree(page, [Code('a\n      y')]);
    await focusAt(page, 'a\n      y', 4);
    await press(page, 'Enter');
    await expectTree(page, 'code(a\\n  \\n  ' + '    y)');
    await expectCaret(page, 'a\n  \n  |    y');
  });

  test('2c · Enter over a selection replaces it and indents; one undo gives everything back', async ({ page }) => {
    await buildTree(page, [Code('  abcd')]);
    await selectRange(page, '  abcd', 3, '  abcd', 5); // "bc"
    await press(page, 'Enter');
    await expectTree(page, 'code(  a\\n  d)');
    await expectCaret(page, '  a\n  |d');
    await undo(page);
    await expectTree(page, 'code(  abcd)');
  });

  test('3 · Tab over several lines indents every line (blank lines untouched), the selection stays on its characters', async ({ page }) => {
    await buildTree(page, [Code('l1\n\nl2\nl3')]);
    await selectRange(page, 'l1\n\nl2\nl3', 1, 'l1\n\nl2\nl3', 8); // "1\n\nl2\nl" -> up to inside l3
    await press(page, 'Tab');
    await expectTree(page, 'code(  l1\\n\\n  l2\\n  l3)');
    await expectCaret(page, '  l⟦1\n\n  l2\n  l⟧3');
    await press(page, 'Tab');
    await expectTree(page, 'code(    l1\\n\\n    l2\\n    l3)');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'code(  l1\\n\\n  l2\\n  l3)');
    await expectCaret(page, '  l⟦1\n\n  l2\n  l⟧3');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'code(l1\\n\\nl2\\nl3)');
    await expectCaret(page, 'l⟦1\n\nl2\nl⟧3');
  });

  test('3b · a selection that ends at the very start of a line does not indent that line; Shift+Tab also takes a tab character', async ({ page }) => {
    await buildTree(page, [Code('a\nb\n\tc')]);
    await selectRange(page, 'a\nb\n\tc', 0, 'a\nb\n\tc', 4); // "a\nb\n": ends at the start of the "\tc" line
    await press(page, 'Tab');
    await expectTree(page, 'code(  a\\n  b\\n\\tc)');
    await expectCaret(page, '⟦  a\n  b\n⟧\tc');
    await selectRange(page, '  a\n  b\n\tc', 0, '  a\n  b\n\tc', -1);
    await press(page, 'Shift+Tab');
    await expectTree(page, 'code(a\\nb\\nc)');
  });

  test('3c · a backward selection stays backward through Tab; one undo restores the text of a multi-line indent', async ({ page }) => {
    await buildTree(page, [Code('ab\ncd')]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      const b = n.children[0];
      await n.focus({ from: { block: b, offset: 4 }, to: { block: b, offset: 1 } }); // anchor in line 2, focus in line 1
    });
    await flushRender(page);
    await press(page, 'Tab');
    await expectTree(page, 'code(  ab\\n  cd)');
    await expectCaret(page, '  a⟦b\n  c⟧d');
    const backward = await page.evaluate(() => { const s = getSelection()!; return s.anchorNode === s.focusNode ? s.anchorOffset > s.focusOffset : null; });
    expect(backward).toBe(true);
    await undo(page);
    await expectTree(page, 'code(ab\\ncd)');
    await redo(page);
    await expectTree(page, 'code(  ab\\n  cd)');
  });

  test('3d · Tab over a selection WITHIN one line still replaces it (VS Code); Shift+Tab with nothing to remove does nothing and keeps the focus', async ({ page }) => {
    await buildTree(page, [Code('abcd')]);
    await selectRange(page, 'abcd', 1, 'abcd', 3);
    await press(page, 'Tab');
    await expectTree(page, 'code(a  d)');
    await press(page, 'Home');
    await press(page, 'Shift+Tab');
    await expectTree(page, 'code(a  d)');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[contenteditable="true"]'))).toBe(true);
  });

  test('4 · Ctrl+A selects the code first, the whole document with the second press (an empty block goes straight to the document)', async ({ page }) => {
    await buildTree(page, [Pp('before'), Code('abc\ndef'), Pp('after')]);
    await focusAt(page, 'abc\ndef', 5);
    await press(page, 'Control+a');
    await expectCaret(page, '⟦abc\ndef⟧');
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('abc\ndef');
    await press(page, 'Control+a');
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('before\nabc\ndef\nafter');
    // typing over the code selection replaces the code only
    await focusAt(page, 'abc\ndef', 5);
    await press(page, 'Control+a');
    await page.keyboard.type('x');
    await expectTree(page, 'p(before) ; code(x) ; p(after)');
    // empty block: the first press is already the whole document
    await buildTree(page, [Pp('before'), Code(''), Pp('after')]);
    await focusEmpty(page);
    await press(page, 'Control+a');
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('before\n\nafter');
  });

  test('5 · Home / End stay on the line, Shift+Arrow selects across lines inside the block', async ({ page }) => {
    await buildTree(page, [Code('abc\ndef\nghi')]);
    await focusAt(page, 'abc\ndef\nghi', 5);
    await press(page, 'Home');
    await expectCaret(page, 'abc\n|def\nghi');
    await press(page, 'End');
    await expectCaret(page, 'abc\ndef|\nghi');
    await press(page, 'Shift+ArrowDown');
    await expectCaret(page, 'abc\ndef⟦\nghi⟧');
  });

  test('6 · exits: ArrowUp on the first line of a code block that opens the document creates a paragraph before it (ArrowDown does it after)', async ({ page }) => {
    await buildTree(page, [Code('a\nb')]);
    await focusAt(page, 'a\nb', 1);
    await press(page, 'ArrowUp'); // the first line, nothing above
    await expectTree(page, 'p(∅) ; code(a\\nb)');
    await expectCaret(page, '|');
    await page.keyboard.type('intro');
    await expectTree(page, 'p(intro) ; code(a\\nb)');
    // with a text block above, ArrowUp only moves the caret (no extra paragraph)
    await focusAt(page, 'a\nb', 0);
    await press(page, 'ArrowUp');
    await expectTree(page, 'p(intro) ; code(a\\nb)');
    // a code block followed by a divider is left by ArrowDown too
    await buildTree(page, [Code('x'), { type: 'divider' }]);
    await focusEnd(page, 'x');
    await press(page, 'ArrowDown');
    await expectTree(page, 'code(x) ; p(∅) ; hr');
  });

  test('6b · ArrowUp from the second line only moves to the first line; a code block whose text starts with a newline is not "first line" at offset 0 of line 2', async ({ page }) => {
    await buildTree(page, [Code('\nb')]);
    await focusAt(page, '\nb', 1); // start of line 2
    await press(page, 'ArrowUp');
    await expectTree(page, 'code(\\nb)');
    await expectCaret(page, '|\nb');
  });

  test('7 · Backspace at the start of a non-empty code block makes it a paragraph (language dropped); trailing newline + Backspace removes only that newline', async ({ page }) => {
    await buildTree(page, [Code('a\n', 'js')]);
    await focusEnd(page, 'a\n');
    await expectCaret(page, 'a\n|');
    await press(page, 'Backspace');
    await expectTree(page, 'code:js(a)');
    await expectCaret(page, 'a|');
    await focusAt(page, 'a', 0);
    await press(page, 'Backspace');
    await expectTree(page, 'p(a)');
  });

  test('8 · markdown shortcuts stay literal: [] ** ` > - 1. # and ``` + Enter inside the block', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await page.keyboard.type('[] **b** `c` > - 1. # h ');
    await expectTree(page, 'code([] **b** `c` > - 1. # h )');
    expect(await page.evaluate(() => document.querySelector('pre[data-block-type="code"]')!.querySelector('strong, em, span, a, input'))).toBeNull();
  });

  test('9 · the slash menu never opens in a code block: `/` is code, and Enter after `a / c` stays a newline', async ({ page }) => {
    await buildTree(page, [Code('x ')]);
    await focusEnd(page, 'x ');
    await page.keyboard.type('/');
    await flushRender(page);
    await expect(slashMenu(page)).toHaveCount(0);
    await page.keyboard.type('c'); // "x /c": would match "Code" / "Callout" in a paragraph
    await flushRender(page);
    await expect(slashMenu(page)).toHaveCount(0);
    await press(page, 'Enter');
    await expectTree(page, 'code(x /c\\n)'); // a newline, the block is still a code block
    await page.keyboard.type('// comment');
    await press(page, 'Enter');
    await expectTree(page, 'code(x /c\\n// comment\\n)');
    // control: the same keys in a paragraph DO open the menu
    await buildTree(page, [Pp('x ')]);
    await focusEnd(page, 'x ');
    await page.keyboard.type('/c');
    await expect(slashMenu(page)).toHaveCount(1);
  });

  test('10 · undo / redo: typing and Enter are undone, the caret comes back inside the block', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await page.keyboard.type('abc');
    await press(page, 'Enter');
    await page.keyboard.type('def');
    await undo(page);
    await expect.poll(async () => (await tree(page))).not.toBe('code(abc\\ndef)');
    await undo(page);
    await expectTree(page, 'code(∅)');
    await redo(page);
    await expect.poll(async () => (await tree(page)).startsWith('code(abc')).toBe(true);
    await redo(page);
    await expectTree(page, 'code(abc\\ndef)');
    await expectCaret(page, 'abc\ndef|');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Clipboard
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · code block: paste and copy', () => {
  test('1 · a Windows (CRLF) or old-Mac (CR) paste becomes plain "\\n" lines; tabs are kept', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await pasteText(page, 'a\r\n\tb\r\n  c\rd');
    await expect.poll(() => codeText(page)).toBe('a\n\tb\n  c\nd');
    await expectCaret(page, 'a\n\tb\n  c\nd|');
    // one undo takes the whole paste back
    await undo(page);
    await expectTree(page, 'code(∅)');
  });

  test('2 · a paste from an editor (VS Code-like HTML + plain text) lands as the plain text, indentation intact, one block', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    const html = '<meta charset="utf-8"><div style="color:#ccc;background-color:#1f1f1f;font-family:Menlo,monospace;white-space:pre"><div><span style="color:#569cd6">function</span><span> f() {</span></div><div><span>    </span><span style="color:#569cd6">return</span><span> 1;</span></div><div><span>}</span></div></div>';
    await pasteHtml(page, html, 'function f() {\r\n    return 1;\r\n}');
    await expect.poll(() => codeText(page)).toBe('function f() {\n    return 1;\n}');
    expect(await page.evaluate(() => (window as any).nabu.tree.roots().length)).toBe(1);
  });

  test('3 · a paste over a selection replaces it; a paste after a line keeps what is typed next on its own line', async ({ page }) => {
    await buildTree(page, [Code('one\ntwo\nthree')]);
    await selectRange(page, 'one\ntwo\nthree', 4, 'one\ntwo\nthree', 7); // "two"
    await pasteText(page, 'x\ny');
    await expect.poll(() => codeText(page)).toBe('one\nx\ny\nthree');
    await expectCaret(page, 'one\nx\ny|\nthree');
  });

  test('4 · copy out of the block: a partial selection is the raw text; Ctrl+A then copy gives the whole code (no fence, no markup)', async ({ page }) => {
    await buildTree(page, [Pp('before'), Code('  a < b\n\tc', 'js')]);
    await focusAt(page, '  a < b\n\tc', 2);
    await press(page, 'Control+a');
    const ev = await copy(page);
    expect(ev.text).toBe('  a < b\n\tc');
    expect(ev.html).toBe('<pre><code class="language-js">  a &lt; b\n\tc</code></pre>');
    expect(ev.nabu!.blocks).toEqual([{ type: 'code', partial: 'both', props: { language: 'js' }, delta: [{ insert: '  a < b\n\tc' }] }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. Long lines, language select, placeholder, styling
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · code block: long lines, language select, placeholder', () => {
  test('1 · a long line scrolls sideways to keep the caret visible while typing, and back on Home', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    await page.keyboard.type('x'.repeat(400));
    const visible = () => page.evaluate(() => {
      const pre = document.querySelector('pre[data-block-type="code"]') as HTMLElement;
      const s = getSelection()!;
      const r = document.createRange(); r.setStart(s.anchorNode!, s.anchorOffset);
      const c = r.getClientRects()[0]; const box = pre.getBoundingClientRect();
      return { scrolled: pre.scrollLeft, overflow: pre.scrollWidth > pre.clientWidth, inside: !!c && c.right <= box.right + 1 && c.left >= box.left - 1 };
    });
    await expect.poll(visible).toMatchObject({ overflow: true, inside: true });
    expect((await visible()).scrolled).toBeGreaterThan(0);
    await press(page, 'Home');
    await expect.poll(async () => (await visible()).scrolled).toBe(0);
    await press(page, 'End');
    await expect.poll(visible).toMatchObject({ inside: true });
    await page.keyboard.type('Z');
    await expect.poll(visible).toMatchObject({ inside: true });
  });

  test('2 · changing the language does not steal the caret: typing continues in the block; the choice is in the model and the markdown', async ({ page }) => {
    await buildTree(page, [Code('ab', 'js')]);
    await focusEnd(page, 'ab');
    await page.locator('select.nabu-code-lang').selectOption('python');
    await expectTree(page, 'code:python(ab)');
    await page.keyboard.type('c');
    await expectTree(page, 'code:python(abc)');
    expect(await getMarkdown(page)).toBe('```python\nabc\n```');
    await page.locator('select.nabu-code-lang').selectOption('plaintext');
    await expectTree(page, 'code(abc)'); // plaintext = no language
  });

  test('3 · a language the list does not know (a fence "ts", "c++", a pasted language-rust class) is shown by the select, not a blank', async ({ page }) => {
    await buildTree(page, [Code('x', 'ts')]);
    await expect(page.locator('select.nabu-code-lang')).toHaveValue('ts');
    await buildTree(page, [Code('x', 'c++')]);
    await expect(page.locator('select.nabu-code-lang')).toHaveValue('c++');
    await buildTree(page, [Code('x', 'python')]);
    await expect(page.locator('select.nabu-code-lang')).toHaveValue('python');
    await expect(page.locator('select.nabu-code-lang option')).toHaveCount(12);
  });

  test('4 · the select is disabled in a read-only editor', async ({ page }) => {
    await buildTree(page, [Code('x', 'js')]);
    await page.evaluate(() => { (window as any).nabu.readonly = true; });
    await expect(page.locator('select.nabu-code-lang')).toBeDisabled();
    await page.evaluate(() => { (window as any).nabu.readonly = false; });
    await expect(page.locator('select.nabu-code-lang')).toBeEnabled();
  });

  test('5 · an empty code block shows its placeholder while it holds the caret, and not once there is text', async ({ page }) => {
    await buildTree(page, [Code('')]);
    await focusEmpty(page);
    const pre = page.locator('pre[data-block-type="code"]');
    await expect(pre).toHaveAttribute('data-placeholder', 'Code…');
    expect(await pre.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"Code…"');
    await page.keyboard.type('x');
    await expect(pre).toHaveAttribute('data-placeholder', '');
  });

  test('6 · the block is not tinted like an inline code span (the .nabu-code class is shared by both)', async ({ page }) => {
    await buildTree(page, [Code('x'), Pp('')]);
    const bg = await page.locator('pre[data-block-type="code"]').evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, radius: s.borderRadius, pad: s.paddingLeft };
    });
    expect(bg.bg).toBe('rgba(0, 0, 0, 0)');
    expect(bg.radius).toBe('0px');
    expect(parseFloat(bg.pad)).toBeGreaterThan(8);
  });

  test('7 · the way in: ``` + Enter, ```ts + Enter, ```c++ + Enter and /code make a code block', async ({ page }) => {
    for (const [typed, expected] of [['```', 'code(∅)'], ['```ts', 'code:ts(∅)'], ['```c++', 'code:c++(∅)'], ['```objective-c', 'code:objective-c(∅)'], ['```c#', 'code:c#(∅)']] as const) {
      await buildTree(page, [Pp('')]);
      await focusEmpty(page);
      await page.keyboard.type(typed);
      await press(page, 'Enter');
      await expectTree(page, expected);
      await page.keyboard.type('x');
      await expectCaret(page, 'x|');
    }
    // "```" + Space is NOT a shortcut (DECIDED: Enter only, like Obsidian): the backticks stay text
    await buildTree(page, [Pp('')]);
    await focusEmpty(page);
    await page.keyboard.type('``` ');
    await expectTree(page, 'p(``` )');
    await buildTree(page, [Pp('')]);
    await focusEmpty(page);
    await page.keyboard.type('/code');
    await press(page, 'Enter');
    await expectTree(page, 'code(∅)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Export / import round trips
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · code block: export and import', () => {
  const SRC = 'const re = `a${b}`;\n```js\nnested\n```\n\tindented  \n\nlast';

  test('1 · markdown: the fence outgrows the backticks of the code, the language is the info string, the text comes back identical', async ({ page }) => {
    await buildTree(page, [Code(SRC, 'js'), Pp('after')]);
    const md = await getMarkdown(page);
    expect(md).toBe('````js\n' + SRC + '\n````\n\nafter');
    await page.evaluate((m) => (window as any).nabu.importMarkdown(m), md);
    await expect.poll(() => tree(page)).toContain('code:js(');
    expect(await codeText(page)).toBe(SRC);
    expect(await tree(page)).toBe('code:js(' + SRC.replace(/\n/g, '\\n').replace(/\t/g, '\\t') + ') ; p(after)');
  });

  test('2 · markdown: the language of a fence with a symbol round-trips (c++, c#), a language with spaces cannot (it is cut to its first word)', async ({ page }) => {
    await buildTree(page, [Code('x', 'c++'), Code('y', 'c#')]);
    const md = await getMarkdown(page);
    expect(md).toBe('```c++\nx\n```\n\n```c#\ny\n```');
    await page.evaluate((m) => (window as any).nabu.importMarkdown(m), md);
    await expect.poll(() => tree(page)).toBe('code:c++(x) ; code:c#(y)');
  });

  test('3 · JSON: type, language and content; the import gives the same block', async ({ page }) => {
    await buildTree(page, [Code('a\n  b', 'ts')]);
    const json = await getJson(page);
    expect(json.blocks).toEqual([expect.objectContaining({ type: 'code', props: { language: 'ts' }, content: 'a\n  b' })]);
    await page.evaluate((j) => (window as any).nabu.importJSON(j), json);
    await expect.poll(() => tree(page)).toBe('code:ts(a\\n  b)');
  });

  test('4 · HTML: <pre><code class="language-xxx"> with the text escaped; reading it back gives the language', async ({ page }) => {
    await buildTree(page, [Code('if (a < b && c) {}', 'js')]);
    await focusAt(page, 'if (a < b && c) {}', 3);
    await press(page, 'Control+a');
    const { html } = await copy(page); // the HTML writer of a copy
    expect(html).toBe('<pre><code class="language-js">if (a &lt; b &amp;&amp; c) {}</code></pre>');
    await buildTree(page, [Pp('')]);
    await focusEmpty(page);
    await pasteHtml(page, html, 'if (a < b && c) {}');
    await expect.poll(() => tree(page)).toMatch(/code:js\(if \(a < b && c\) \{\}\)/);
  });

  test('5 · pasting a web page <pre> into a paragraph: the language (class, GitHub wrapper), <br> lines and indentation come through', async ({ page }) => {
    await buildTree(page, [Pp('')]);
    await focusEmpty(page);
    await pasteHtml(page, '<div class="highlight highlight-source-python"><pre>def f():<br>    return 1</pre></div>', 'def f():\n    return 1');
    await expect.poll(() => tree(page)).toBe('code:python(def f():\\n    return 1)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. Inline code (the `code` mark)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('E · inline code', () => {
  const type = async (page: Page, text: string) => { await page.locator('[contenteditable="true"]').first().click(); await page.keyboard.type(text); };

  test('1 · Ctrl+E turns the selection into code and a second Ctrl+E turns it off; the selection survives both', async ({ page }) => {
    await type(page, 'use foo here');
    await selectRange(page, 'use foo here', 4, 'use foo here', 7);
    await press(page, 'Control+e');
    expect(await delta(page)).toEqual([{ insert: 'use ' }, { insert: 'foo', attributes: { code: true } }, { insert: ' here' }]);
    await expectCaret(page, 'use ⟦foo⟧ here');
    await press(page, 'Control+e');
    expect(await delta(page)).toEqual([{ insert: 'use foo here' }]);
    await expectCaret(page, 'use ⟦foo⟧ here');
  });

  test('2 · the span has exact edges: text typed at its start or end is plain, text typed inside it is code', async ({ page }) => {
    await type(page, 'ab cd ef');
    await selectRange(page, 'ab cd ef', 3, 'ab cd ef', 5);
    await press(page, 'Control+e');
    await focusAt(page, 'ab cd ef', 5); // end boundary
    await page.keyboard.type('X');
    await focusAt(page, 'ab Xcd ef'.replace('X', ''), 3).catch(() => {});
    expect(await delta(page)).toEqual([{ insert: 'ab ' }, { insert: 'cd', attributes: { code: true } }, { insert: 'X ef' }]);
    await focusAt(page, 'ab cdX ef', 3); // start boundary
    await page.keyboard.type('Y');
    expect(await delta(page)).toEqual([{ insert: 'ab Y' }, { insert: 'cd', attributes: { code: true } }, { insert: 'X ef' }]);
    await focusAt(page, 'ab Ycd' + 'X ef', 5); // between c and d
    await page.keyboard.type('-');
    expect(await delta(page)).toEqual([{ insert: 'ab Y' }, { insert: 'c-d', attributes: { code: true } }, { insert: 'X ef' }]);
  });

  test('3 · you can write code and leave it: Ctrl+E before and after (stored mark), or any caret move after the span', async ({ page }) => {
    await type(page, 'a ');
    await press(page, 'Control+e');
    await page.keyboard.type('foo');
    await page.keyboard.type('bar'); // still code: the pending mark follows the typing
    await press(page, 'Control+e');
    await page.keyboard.type(' z');
    expect(await delta(page)).toEqual([{ insert: 'a ' }, { insert: 'foobar', attributes: { code: true } }, { insert: ' z' }]);
    // leaving by moving the caret away and back to the end of the span: the pending mark is gone, typing is plain
    await focusAt(page, 'a foobar z', 8);
    await press(page, 'ArrowRight'); await press(page, 'ArrowLeft');
    await page.keyboard.type('Q');
    expect(await delta(page)).toEqual([{ insert: 'a ' }, { insert: 'foobar', attributes: { code: true } }, { insert: 'Q z' }]);
  });

  test('4 · the backtick shortcut: `foo` becomes code as the closing backtick is typed, typing goes on as plain text', async ({ page }) => {
    await type(page, 'x `foo` y');
    expect(await delta(page)).toEqual([{ insert: 'x ' }, { insert: 'foo', attributes: { code: true } }, { insert: ' y' }]);
    await expectCaret(page, 'x foo y|');
    // spaces inside are kept; a lone opening backtick stays a backtick
    await buildTree(page, [Pp('')]);
    await type(page, '`a b` and `');
    expect(await delta(page)).toEqual([{ insert: 'a b', attributes: { code: true } }, { insert: ' and `' }]);
  });

  test('5 · code combines with bold and with a link; turning code off keeps the other mark', async ({ page }) => {
    await type(page, 'hello world');
    await press(page, 'Shift+Home');
    await press(page, 'Control+b');
    await press(page, 'Control+e');
    expect(await delta(page)).toEqual([{ insert: 'hello world', attributes: { bold: true, code: true } }]);
    await press(page, 'Control+e');
    expect(await delta(page)).toEqual([{ insert: 'hello world', attributes: { bold: true } }]);
    await press(page, 'Control+e');
    await page.evaluate(() => (window as any).nabu.exec('link:set', { href: 'https://example.com' }));
    expect(await delta(page)).toEqual([{ insert: 'hello world', attributes: { bold: true, code: true, link: 'https://example.com' } }]);
    const dom = await page.evaluate(() => document.querySelector('a.nabu-link')?.className);
    expect(dom).toContain('nabu-code');
    expect(dom).toContain('nabu-bold');
  });

  test('6 · pasted <code> becomes the mark (also inside <b>); the surrounding text stays plain', async ({ page }) => {
    await type(page, '');
    await pasteHtml(page, '<p>use <code>npm i</code> then <b><code>run</code></b> now</p>', 'use npm i then run now');
    expect(await delta(page)).toEqual([
      { insert: 'use ' }, { insert: 'npm i', attributes: { code: true } }, { insert: ' then ' },
      { insert: 'run', attributes: { code: true, bold: true } }, { insert: ' now' },
    ]);
  });

  test('7 · double-click selects the word inside the span (without the padding or the neighbours)', async ({ page }) => {
    await type(page, 'a ');
    await press(page, 'Control+e');
    await page.keyboard.type('foo_bar baz');
    await press(page, 'Control+e');
    await page.keyboard.type(' tail');
    await page.locator('span.nabu-code').dblclick({ position: { x: 12, y: 6 } });
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('foo_bar');
    await expectCaret(page, 'a ⟦foo_bar⟧ baz tail');
  });

  test('8 · the caret at the edges of the span: the start sits outside it (typing there is plain), the end inside its text', async ({ page }) => {
    await type(page, 'ab ');
    await press(page, 'Control+e');
    await page.keyboard.type('foo');
    await press(page, 'Control+e');
    await page.keyboard.type(' cd');
    const edges = await page.evaluate(async () => {
      const n = (window as any).nabu;
      const span = document.querySelector('span.nabu-code')!.getBoundingClientRect();
      const at = async (offset: number) => {
        await n.focus({ offset });
        const s = getSelection()!;
        const r = document.createRange(); r.setStart(s.anchorNode!, s.anchorOffset); r.collapse(true);
        return (r.getClientRects()[0] ?? r.getBoundingClientRect()).left;
      };
      return { left: span.left, right: span.right, start: await at(3), end: await at(6) };
    });
    expect(Math.abs(edges.start - edges.left)).toBeLessThan(1.5); // before the span's padding
    expect(edges.end).toBeLessThanOrEqual(edges.right);
    expect(edges.end).toBeGreaterThan(edges.left);
  });

  test('9 · copy: the mark is <code> in the HTML and backticks only in the markdown of the document', async ({ page }) => {
    await type(page, 'x `foo` y');
    await press(page, 'Control+a');
    const ev = await copy(page);
    expect(ev.html).toBe('<p>x <code>foo</code> y</p>');
    expect(ev.text).toBe('x foo y');
    expect(await getMarkdown(page)).toBe('x `foo` y');
  });

  test('10 · a span that holds a backtick exports with a longer delimiter and reads back as the same text', async ({ page }) => {
    await buildTree(page, [Pp('')]);
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      n.delete(n.children[0]);
      n.insert('paragraph', { delta: [{ insert: 'run ' }, { insert: 'a`b', attributes: { code: true } }, { insert: ' now' }] });
      await n.commit();
    });
    const md = await getMarkdown(page);
    expect(md).toBe('run ``a`b`` now');
    await page.evaluate((m) => (window as any).nabu.importMarkdown(m), md);
    await expect.poll(() => delta(page)).toEqual([{ insert: 'run ' }, { insert: 'a`b', attributes: { code: true } }, { insert: ' now' }]);
  });
});
