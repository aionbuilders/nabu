/**
 * E2E — pasting external HTML (P-56 / P-57 / P-47), lot 1 = the engine.
 *
 * The corpus in tests/fixtures/html reproduces the structure each source puts on the clipboard. Each fixture goes through a
 * REAL paste (async clipboard write + Ctrl+V) into an empty paragraph, and the MODEL is checked:
 *  - no stray bold (the Google Docs `font-weight:normal` wrapper), no empty paragraph, no junk (Word markers, scripts, styles);
 *  - Google redirect links are unwrapped; unsafe links keep their text only;
 *  - NBSP kept between two visible characters ("10 km"), regular spaces collapsed;
 *  - Docs / Word lists come out as real nested lists (levels, bullet vs numbered, `start`); a table is one paragraph per row,
 *    cells separated by a TAB (the same rows as the text/plain TSV); web images become image blocks that split the paragraph;
 *  - one undo restores the empty document; no console error.
 */

import { test, expect, type Page } from './helpers/test.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gotoEditor, clearAndReset, focusEditor } from './helpers/editor.js';
import { pasteHtml, pasteText } from './helpers/clipboard.js';
import { undo, redo } from './helpers/keyboard.js';
import { violations, collectErrors, allText } from './helpers/model.js';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../fixtures/html/${name}`, import.meta.url)), 'utf8');

/** Model dump: `h1(text) ; p(plain [b:bold] [a=url:link]) ; ul[li(a), li(b)]`; NBSP shown as ⍽. */
function dump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const L: Record<string, string> = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', code: 'c' };
    const fmt = (node: any) => {
      const t = node.data.get('text');
      if (!t) return '';
      return t.toDelta().map((op: any) => {
        const marks = Object.entries(op.attributes ?? {}).map(([k, v]) => (k === 'link' ? `a=${v}` : L[k] ?? k)).sort();
        const s = String(op.insert).replace(/\n/g, '\\n').replace(/ /g, '⍽');
        return marks.length ? `[${marks.join(',')}:${s}]` : s;
      }).join('');
    };
    const walk = (node: any): string => {
      const type = node.data.get('type');
      const kids: any[] = node.children() ?? [];
      const sub = kids.map(walk).join(' ');
      if (type === 'list') return `${node.data.get('listType') === 'todo' ? 'todo' : node.data.get('listType') === 'ordered' ? 'ol' : 'ul'}[${kids.map(walk).join(', ')}]`;
      if (type === 'list-item') return `li${node.data.get('checked') === undefined ? '' : node.data.get('checked') ? '[x]' : '[ ]'}(${fmt(node)})${kids.length ? ' > ' + sub : ''}`;
      const short = type === 'paragraph' ? 'p' : type === 'heading' ? 'h' + node.data.get('level') : type === 'divider' ? 'hr' : type === 'blockquote' ? 'quote' : type;
      return type === 'divider' ? 'hr' : `${short}(${fmt(node)})${kids.length ? '{' + sub + '}' : ''}`;
    };
    return n.tree.roots().map(walk).join(' ; ');
  });
}

/** Every mark applied in the document: `bold:Text` pairs, to spot a stray mark at a glance. */
const markedRuns = (page: Page, mark: string) => page.evaluate((m) => {
  const n = (window as any).nabu;
  const out: string[] = [];
  const walk = (node: any) => {
    const t = node.data.get('text');
    if (t) for (const op of t.toDelta()) if (op.attributes?.[m]) out.push(String(op.insert));
    (node.children() ?? []).forEach(walk);
  };
  n.tree.roots().forEach(walk);
  return out;
}, mark);

/** `start` of every list that has one (numbering that does not begin at 1). */
const listStarts = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const out: number[] = [];
  const walk = (node: any) => {
    if (node.data.get('type') === 'list' && node.data.get('start') !== undefined) out.push(node.data.get('start'));
    (node.children() ?? []).forEach(walk);
  };
  n.tree.roots().forEach(walk);
  return out;
});

/** The `ref` of every image block, in document order. */
const imageRefs = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const out: string[] = [];
  const walk = (node: any) => {
    if (node.data.get('type') === 'image') out.push(node.data.get('ref'));
    (node.children() ?? []).forEach(walk);
  };
  n.tree.roots().forEach(walk);
  return out;
});

const links = (page: Page) => page.evaluate(() => {
  const n = (window as any).nabu;
  const out: string[] = [];
  const walk = (node: any) => {
    const t = node.data.get('text');
    if (t) for (const op of t.toDelta()) if (op.attributes?.link) out.push(op.attributes.link);
    (node.children() ?? []).forEach(walk);
  };
  n.tree.roots().forEach(walk);
  return out;
});

/** True when some text block is empty or whitespace-only (the document must not contain one after the paste). */
const hasEmptyTextBlock = async (page: Page) => (await allText(page)).some((t) => !t.trim());

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
  await focusEditor(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

/** Paste a fixture through the real clipboard, then wait for the model to settle. */
async function pasteFixture(page: Page, name: string, plain = '') {
  await pasteHtml(page, fixture(name), plain);
  await expect.poll(async () => (await dump(page)) !== 'p()', { timeout: 3000, message: 'something was pasted' }).toBe(true);
}

/** One undo restores the empty paragraph; redo brings the paste back; the tree is valid throughout. */
async function expectOneUndo(page: Page, pasted: string) {
  expect(await violations(page)).toEqual([]);
  await undo(page);
  await expect.poll(() => dump(page), { timeout: 3000, message: 'one undo' }).toBe('p()');
  await redo(page);
  await expect.poll(() => dump(page), { timeout: 3000, message: 'redo' }).toBe(pasted);
  expect(await violations(page)).toEqual([]);
}

test('Google Docs: the font-weight:normal wrapper does not bold the document, the redirect link is unwrapped', async ({ page }) => {
  await pasteFixture(page, 'google-docs.html');
  const model = await dump(page);
  expect(model).toBe([
    'h1(Project notes)',
    'p(This is a [b:bold] word, an [i:italic] one and a [a=https://example.org/docs?page=2&lang=en:link].)',
    'p(Distance:⍽10⍽km)',
    'ul[li(First item), li(Second item) > ul[li(Nested item)]]',
    'p(Plan with levels:)',
    'ul[li(Plan) > ol[li(Draft), li(Review) > ul[li(Typos)]], li(Ship)]',
    'p(Numbered from 3:)',
    'ol[li(Third) > ul[li(Detail)], li(Fourth)]',
  ].join(' ; '));
  expect(await listStarts(page)).toEqual([3]);
  expect(await markedRuns(page, 'bold')).toEqual(['bold']);
  expect(await markedRuns(page, 'underline')).toEqual([]);
  expect(await links(page)).toEqual(['https://example.org/docs?page=2&lang=en']);
  expect(await hasEmptyTextBlock(page)).toBe(false);
  await expectOneUndo(page, model);
});

test('Google Docs: part of a line (inline wrapper) keeps its mark and merges at the caret', async ({ page }) => {
  await page.evaluate(async () => {
    const n = (window as any).nabu;
    n.children[0].insert(0, 'Hello world');
    await n.commit();
  });
  await expect.poll(() => dump(page)).toBe('p(Hello world)');
  await page.evaluate(async () => {
    const n = (window as any).nabu;
    await n.focus({ from: { block: n.children[0], offset: 6 }, to: { block: n.children[0], offset: 6 } });
  });
  await pasteHtml(page, fixture('google-docs-inline.html'), '');
  await expect.poll(() => dump(page)).toBe('p(Hello Just a partial line, with a [b:bold] tail.world)');
  expect(await markedRuns(page, 'bold')).toEqual(['bold']);
  expect(await violations(page)).toEqual([]);
  await undo(page);
  await expect.poll(() => dump(page)).toBe('p(Hello world)');
});

test('Word: <o:p>, conditional comments, mso styles and list markers leave no trace', async ({ page }) => {
  await pasteFixture(page, 'word.html');
  const model = await dump(page);
  expect(model).toBe([
    'p([b:Quarterly summary])',
    'p(Results were [i:better] than expected, see [a=https://example.org/report:the report].)',
    'ul[li(Revenue up) > ul[li(Cloud) > ul[li(Storage)]], li(Costs stable)]',
    'p(Next steps)',
    'ol[li(Plan) > ol[li(Draft)], li(Ship)]',
  ].join(' ; '));
  expect(model).not.toMatch(/·|⍽|mso|supportLists|StartFragment|Fragment/);
  expect(await markedRuns(page, 'bold')).toEqual(['Quarterly summary']);
  expect(await links(page)).toEqual(['https://example.org/report']);
  expect(await hasEmptyTextBlock(page)).toBe(false);
  expect((await allText(page)).join('|')).not.toMatch(/[·§]/);
  await expectOneUndo(page, model);
});

test('Wikipedia: headings, citation, no style leak, the table is one paragraph per row', async ({ page }) => {
  await pasteFixture(page, 'wikipedia.html');
  const model = await dump(page);
  // Chrome resolves relative hrefs against the page when it hands the clipboard HTML over.
  const origin = new URL(page.url()).origin;
  expect(model.replaceAll(origin, '')).toBe([
    'h2(History)',
    'p([[a=/w/index.php?title=Example&action=edit&section=1:edit]])',
    'p(The [b:Example] language was designed in 1990[a=/e2e#cite_note-1:[1]] by a small team.⍽It is [i:widely] used.)',
    'p(Releases) ; p(Version\tYear) ; p(1.0\t1992) ; p(2.0\t1999)',
    'h3(Legacy)',
    'p(See [a=/wiki/Other_article:Other article] for more.)',
  ].join(' ; '));
  const text = (await allText(page)).join('|');
  for (const cell of ['Releases', 'Version', 'Year', '1.0', '1992', '2.0', '1999']) expect(text).toContain(cell);
  expect(text).not.toMatch(/hatnote|font-style/);
  expect(await markedRuns(page, 'bold')).toEqual(['Example']);
  expect(await markedRuns(page, 'italic')).toEqual(['widely']);
  expect(text).toContain('small team. It is');
  expect(await hasEmptyTextBlock(page)).toBe(false);
  await expectOneUndo(page, model);
});

test('GitHub README: code blocks, inline code and the task list', async ({ page }) => {
  await pasteFixture(page, 'github-readme.html');
  const model = await dump(page);
  expect(model).toBe([
    'h1(demo)',
    'p(A tiny library. Install it with [c:npm install demo].)',
    "code(import { run } from 'demo';\\nrun({ verbose: true });)",
    'code(const x = 1;\\nconst y = 2;\\n)',
    'todo[li[ ](write docs), li[x](write tests)]',
  ].join(' ; '));
  expect(await page.evaluate(() => [...(window as any).nabu.tree.roots()].filter((r: any) => r.data.get('type') === 'code').map((r: any) => r.data.get('language') ?? null))).toEqual([null, 'js']);
  expect(await hasEmptyTextBlock(page)).toBe(false);
  await expectOneUndo(page, model);
});

test('generic web page: loose text next to script/style, style overrides, empties and unsafe link', async ({ page }) => {
  await pasteFixture(page, 'web-page.html');
  const model = await dump(page);
  expect(model).toBe([
    'p(Intro text before any block,\\ncontinued after a line break.)',
    'p([b:Posted] by [b:staff] on May 3)',
    'p([i,u:nested ][b,i,u:inline][i,u: styles])',
    'p(Paragraph with cancelled strong and cancelled em.)',
    'p(unsafe link then [a=https://example.org/a:redirected link])',
  ].join(' ; '));
  expect(await markedRuns(page, 'bold')).toEqual(['Posted', 'staff', 'inline']);
  expect(await links(page)).toEqual(['https://example.org/a']);
  expect((await allText(page)).join('|')).not.toMatch(/dataLayer|Enable JavaScript|javascript:/);
  expect(await hasEmptyTextBlock(page)).toBe(false);
  await expectOneUndo(page, model);
});

test('Notion: headings, marks, nested list, quote, to-do, divider and code', async ({ page }) => {
  await pasteFixture(page, 'notion.html');
  const model = await dump(page);
  expect(model).toBe([
    'h1(Meeting agenda)',
    'p(Welcome to the [b:weekly] sync. Please read the [i:notes] and [c:config.json] before [a=https://example.org/notes:joining].)',
    'h2(Topics)',
    'ul[li(Roadmap review) > ul[li(Q1 goals)], li(Open questions)]',
    'quote(Ship small, ship often.)',
    'todo[li[x](Send the recap), li[ ](Book the room)]',
    'hr',
    'code(const total = items.length;)',
  ].join(' ; '));
  expect(await hasEmptyTextBlock(page)).toBe(false);
  await expectOneUndo(page, model);
});

test('Google Sheets: the table pastes as tab-separated rows, the same as the text/plain TSV; no <style> / colgroup leak', async ({ page }) => {
  await pasteFixture(page, 'sheets.html', fixture('sheets.txt'));
  const model = await dump(page);
  expect(model).toBe('p([b:Name]\t[b:Score]) ; p(Alice\t42) ; p(Bob\t37)');
  expect(await allText(page)).toEqual(fixture('sheets.txt').trim().split('\n'));
  await expectOneUndo(page, model);
});

test('Google Sheets: with only the TSV on the clipboard the rows are the same', async ({ page }) => {
  await pasteText(page, fixture('sheets.txt'));
  await expect.poll(() => allText(page)).toEqual(fixture('sheets.txt').trim().split('\n'));
});

test('web page with inline images: the paragraph is split around the image block, text before and after is kept', async ({ page }) => {
  await pasteFixture(page, 'web-images.html');
  const model = await dump(page);
  expect(model).toBe([
    'p(Before the picture)',
    'image()',
    'p(and after it.)',
    'h2(Gallery)',
    'image()',
    'image()',
    'p(An unsafe one and a caption.)',
  ].join(' ; '));
  expect(await imageRefs(page)).toEqual(['https://example.org/img/cat.png', 'https://example.org/img/dog.jpg', 'https://example.org/img/bird.gif']);
  expect(await hasEmptyTextBlock(page)).toBe(false);
  await expectOneUndo(page, model);
});

test('image sources that are unsafe (javascript:, data:text/html) or missing are dropped; the text stays', async ({ page }) => {
  await pasteHtml(page, '<p>A <img src="javascript:alert(1)"> B <img src="data:text/html,<script>alert(1)</script>"> C <img alt="no source"> D</p>');
  await expect.poll(() => dump(page)).toBe('p(A B C D)');
  expect(await imageRefs(page)).toEqual([]);
  expect(await violations(page)).toEqual([]);
});
