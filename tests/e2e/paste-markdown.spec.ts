/**
 * E2E — inline markdown (P-48) through the real paste pipeline and `importMarkdown`.
 *
 * Markdown text pasted from the clipboard (links, reference links, bare URLs, escapes, an inline image) and a README
 * handed to `importMarkdown` give the right MODEL (marks, hrefs, blocks) and the right DOM (`a[href]`), unsafe URLs
 * never become a link / image, a paste is ONE undo step, and nothing is logged as an error.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, focusEditor } from './helpers/editor.js';
import { pasteText } from './helpers/clipboard.js';
import { undo, redo } from './helpers/keyboard.js';
import { violations, collectErrors } from './helpers/model.js';

/** Model dump: `h1(text) ; p(plain [b:bold] [a=url:link]) ; img(ref|alt) ; ul[li(a), li(b)]`. */
function dump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const L: Record<string, string> = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', code: 'c' };
    const fmt = (node: any) => {
      const t = node.data.get('text');
      if (!t) return '';
      return t.toDelta().map((op: any) => {
        const marks = Object.entries(op.attributes ?? {}).map(([k, v]) => (k === 'link' ? `a=${v}` : L[k] ?? k)).sort();
        const s = String(op.insert).replace(/\n/g, '\\n');
        return marks.length ? `[${marks.join(',')}:${s}]` : s;
      }).join('');
    };
    const walk = (node: any): string => {
      const type = node.data.get('type');
      const kids: any[] = node.children() ?? [];
      if (type === 'list') return `${node.data.get('listType') === 'ordered' ? 'ol' : 'ul'}[${kids.map(walk).join(', ')}]`;
      if (type === 'list-item') return `li(${fmt(node)})`;
      if (type === 'image') return `img(${node.data.get('ref')}|${node.data.get('alt')})`;
      const short = type === 'paragraph' ? 'p' : type === 'heading' ? 'h' + node.data.get('level') : type;
      return `${short}(${fmt(node)})`;
    };
    return n.tree.roots().map(walk).join(' ; ');
  });
}

/** Every `a[href]` of the editor DOM, in order. */
const domHrefs = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('[contenteditable] a[href]')].map((a) => a.getAttribute('href')));

/** Every link href of the model. */
const modelLinks = (page: Page) => page.evaluate(() => {
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

async function expectOneUndo(page: Page, pasted: string, before = 'p()') {
  expect(await violations(page)).toEqual([]);
  await undo(page);
  await expect.poll(() => dump(page), { timeout: 3000, message: 'one undo' }).toBe(before);
  await redo(page);
  await expect.poll(() => dump(page), { timeout: 3000, message: 'redo' }).toBe(pasted);
  expect(await violations(page)).toEqual([]);
}

test('paste: links, reference links, bare URLs, autolinks and escapes', async ({ page }) => {
  await pasteText(page, [
    '# Docs',
    'See [the docs][d] and [**bold** link](https://a.example/x_(y)) or https://b.example/path.',
    'Visit www.c.example, <https://d.example> and \\*literal\\* here.',
    '',
    '[d]: https://docs.example/guide "Guide"',
  ].join('\n'));
  await expect.poll(() => dump(page)).toBe([
    'h1(Docs)',
    'p(See [a=https://docs.example/guide:the docs] and [a=https://a.example/x_(y),b:bold][a=https://a.example/x_(y): link] or [a=https://b.example/path:https://b.example/path].)',
    'p(Visit [a=http://www.c.example:www.c.example], [a=https://d.example:https://d.example] and *literal* here.)',
  ].join(' ; '));
  expect(await domHrefs(page)).toEqual([
    'https://docs.example/guide', 'https://a.example/x_(y)', 'https://a.example/x_(y)', 'https://b.example/path', 'http://www.c.example', 'https://d.example',
  ]);
  await expectOneUndo(page, await dump(page));
});

test('paste: unsafe URLs keep the text, never a link or an image', async ({ page }) => {
  await pasteText(page, [
    '[click](javascript:alert(1)) and [also][evil] and ![pic](javascript:alert(2)) and <javascript:alert(3)>',
    '',
    '[evil]: javascript:alert(4)',
  ].join('\n'));
  await expect.poll(() => dump(page)).toBe('p(click and also and pic and <javascript:alert(3)>)');
  expect(await modelLinks(page)).toEqual([]);
  expect(await domHrefs(page)).toEqual([]);
  expect(await page.evaluate(() => document.querySelectorAll('[contenteditable] img').length)).toBe(0);
});

test('paste: marks and code spans inside text, code protects its content', async ({ page }) => {
  await pasteText(page, 'a **bold *nested*** `**not bold**` ~~gone~~ snake_case_name 2 * 3 * 4');
  await expect.poll(() => dump(page)).toBe(
    'p(a [b:bold ][b,i:nested] [c:**not bold**] [s:gone] snake_case_name 2 * 3 * 4)',
  );
});

test('paste: an image in the middle of the text splits the caret block, one undo', async ({ page }) => {
  await page.evaluate(async () => {
    const n = (window as any).nabu;
    n.children[0].insert(0, 'Hello world');
    await n.commit();
  });
  await page.evaluate(async () => {
    const n = (window as any).nabu;
    await n.focus({ from: { block: n.children[0], offset: 5 }, to: { block: n.children[0], offset: 5 } });
  });
  await pasteText(page, 'before ![the alt](https://i.example/p.png "T") after');
  await expect.poll(() => dump(page)).toBe('p(Hellobefore) ; img(https://i.example/p.png|the alt) ; p(after world)');
  expect(await page.evaluate(() => document.querySelectorAll('[contenteditable] img').length)).toBe(1);
  await expectOneUndo(page, await dump(page), 'p(Hello world)');
});

test('importMarkdown: a README round-trips (links, references, escapes, hard breaks, image)', async ({ page }) => {
  const readme = [
    '# Project',
    '',
    'A **fast** library, see [the docs][docs], [Home] or <https://example.com>.  ',
    'Second line after a hard break\\',
    'and a third.',
    '',
    '![screenshot](https://x.example/shot.png)',
    '',
    '- run `npm i project` (needs *node*)',
    '- visit www.project.dev.',
    '',
    'Escapes: \\*not italic\\* and snake_case_name.',
    '',
    '[docs]: https://docs.example.com/guide_(v2) "Guide"',
    '[home]: https://example.com/home',
  ].join('\n');
  await page.evaluate(async (md) => { await (window as any).nabu.importMarkdown(md); }, readme);
  const model = await dump(page);
  expect(model).toBe([
    'h1(Project)',
    'p(A [b:fast] library, see [a=https://docs.example.com/guide_(v2):the docs], [a=https://example.com/home:Home] or [a=https://example.com:https://example.com].\\nSecond line after a hard break\\nand a third.)',
    'img(https://x.example/shot.png|screenshot)',
    'ul[li(run [c:npm i project] (needs [i:node])), li(visit [a=http://www.project.dev:www.project.dev].)]',
    'p(Escapes: *not italic* and snake_case_name.)',
  ].join(' ; '));
  expect(await domHrefs(page)).toEqual([
    'https://docs.example.com/guide_(v2)', 'https://example.com/home', 'https://example.com', 'http://www.project.dev',
  ]);
  expect(await violations(page)).toEqual([]);

  // serialize → import is stable
  const md = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
  await page.evaluate(async (m) => { await (window as any).nabu.importMarkdown(m); }, md);
  expect(await dump(page)).toBe(model);
});

// ── P-59: markdown at the BLOCK level ────────────────────────────────────────

/** Model outline with the block props: `h2(t) ; code[bash](a\nb) ; ol@3[li(a)[ul[li(b)]]] ; todo[li(a)+, li(b)-] ; q(t) ; hr`. */
function outline(page: Page): Promise<string> {
  return page.evaluate(() => {
    const n = (window as any).nabu;
    const fmt = (node: any) => {
      const t = node.data.get('text');
      if (!t) return '';
      return t.toDelta().map((op: any) => {
        const marks = Object.keys(op.attributes ?? {}).map((k) => ({ bold: 'b', italic: 'i', code: 'c' } as Record<string, string>)[k] ?? k).sort();
        const s = String(op.insert).replace(/\n/g, '\\n').replace(/\t/g, '⇥');
        return marks.length ? `[${marks.join(',')}:${s}]` : s;
      }).join('');
    };
    const walk = (node: any): string => {
      const type = node.data.get('type');
      const kids: any[] = node.children() ?? [];
      if (type === 'list') {
        const lt = node.data.get('listType');
        const start = node.data.get('start');
        return `${lt === 'ordered' ? 'ol' : lt === 'todo' ? 'todo' : 'ul'}${start ? '@' + start : ''}[${kids.map(walk).join(', ')}]`;
      }
      if (type === 'list-item') {
        const check = node.data.get('checked') === undefined ? '' : node.data.get('checked') ? '+' : '-';
        const sub = kids.length ? `[${kids.map(walk).join(', ')}]` : '';
        return `li(${fmt(node)})${check}${sub}`;
      }
      if (type === 'divider') return 'hr';
      if (type === 'heading') return `h${node.data.get('level')}(${fmt(node)})`;
      if (type === 'code') return `code[${node.data.get('language') ?? ''}](${fmt(node)})`;
      const short = type === 'paragraph' ? 'p' : type === 'blockquote' ? 'q' : type;
      return `${short}(${fmt(node)})`;
    };
    return n.tree.roots().map(walk).join(' ; ');
  });
}

const README = [
  'Project',
  '=======',
  'Intro with **bold**[^1] and <b>html</b>.',
  '',
  'Install',
  '-------',
  '~~~bash',
  'npm i project',
  '',
  'npm test',
  '~~~',
  '1. Add it',
  '\t- with npm',
  '\t- with bun',
  '2. Use it',
  '- [x] done',
  '- [ ] todo',
  '',
  '| name | type |',
  '|:-----|-----:|',
  '| `a`  | text |',
  '',
  '> quote',
  '> > nested',
  '',
  '* * *',
  '[^1]: The note.',
].join('\n');

const README_MODEL = [
  'h1(Project)',
  'p(Intro with [b:bold][^1] and <b>html</b>.)',
  'h2(Install)',
  'code[bash](npm i project\\n\\nnpm test)',
  'ol[li(Add it)[ul[li(with npm), li(with bun)]], li(Use it)]',
  'todo[li(done)+, li(todo)-]',
  'p(name⇥type)',
  'p([c:a]⇥text)',
  'q(quote\\nnested)',
  'hr',
  'p([^1]: The note.)',
].join(' ; ');

test('paste: a README with setext headings, a ~~~ fence, tab-nested lists, tasks, a table, a footnote and inline HTML', async ({ page }) => {
  await pasteText(page, README);
  await expect.poll(() => outline(page)).toBe(README_MODEL);
  expect(await violations(page)).toEqual([]);
  // HTML stays text: nothing was rendered as markup
  expect(await page.evaluate(() => document.querySelectorAll('[contenteditable] b, [contenteditable] div[align]').length)).toBe(0);
  // ONE undo step
  await undo(page);
  await expect.poll(() => outline(page), { timeout: 3000, message: 'one undo' }).toBe('p()');
  await redo(page);
  await expect.poll(() => outline(page), { timeout: 3000, message: 'redo' }).toBe(README_MODEL);
  expect(await violations(page)).toEqual([]);
});

test('importMarkdown: the README is stable (serialize -> import -> serialize), CRLF and BOM included', async ({ page }) => {
  const crlf = '﻿' + README.replace(/\n/g, '\r\n');
  await page.evaluate(async (md) => { await (window as any).nabu.importMarkdown(md); }, crlf);
  const first = await outline(page);
  // CommonMark joining: the quote's lines are one paragraph; the tab-indented sublist and the table are the same
  expect(first).toBe(README_MODEL.replace('q(quote\\nnested)', 'q(quote nested)'));
  expect(await violations(page)).toEqual([]);

  const md1 = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
  await page.evaluate(async (m) => { await (window as any).nabu.importMarkdown(m); }, md1);
  expect(await outline(page)).toBe(first);
  const md2 = await page.evaluate(() => (window as any).nabu.serialize('markdown'));
  expect(md2).toBe(md1);
  expect(await violations(page)).toEqual([]);
});
