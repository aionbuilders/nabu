// @ts-nocheck
/**
 * The HTML paste corpus (tests/fixtures/html): hand-written reconstructions of what each source puts on the clipboard,
 * parsed through the HTML interpreter. Asserts the block outline, the marks and the texts.
 * Lists / tables: lot 2 owns their exact structure; here we only pin what the engine does today and that no text is lost.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeEditor, interpret, outline, allText } from './html-paste.helpers.js';

const fixture = (name) => readFileSync(resolve(__dirname, '../fixtures/html', name), 'utf8');

let engine;
beforeAll(async () => { engine = await makeEditor(); });
const read = (name) => interpret(engine, fixture(name));

describe('corpus — Google Docs', () => {
  it('the font-weight:normal <b> wrapper does not make anything bold; marks come from the spans', () => {
    const f = read('google-docs.html');
    expect(outline(f)).toBe([
      'h1(Project notes)',
      'p(This is a [b:bold] word, an [i:italic] one and a [a=https://example.org/docs?page=2&lang=en:link].)',
      'p(Distance:⍽10⍽km)',
      'ul{li(First item) li(Second item) li(Nested item)}',
    ].join(' ; '));
    // No bold anywhere but the one word.
    const bold = f.blocks.flatMap((b) => (b.delta ?? []).filter((op) => op.attributes?.bold).map((op) => op.insert));
    expect(bold).toEqual(['bold']);
  });

  it('unwraps the google.com/url redirect, no underline mark on the link text, no empty paragraph', () => {
    const f = read('google-docs.html');
    const links = f.blocks.flatMap((b) => b.delta ?? []).filter((op) => op.attributes?.link);
    expect(links).toEqual([{ insert: 'link', attributes: { link: 'https://example.org/docs?page=2&lang=en' } }]);
    expect(f.blocks.every((b) => b.type === 'list' || b.delta.some((op) => /\S/.test(op.insert)))).toBe(true);
  });

  it('keeps the NBSP between "Distance:" / "10" / "km" (isolated between visible characters)', () => {
    const f = read('google-docs.html');
    expect(f.blocks[2].delta).toEqual([{ insert: 'Distance: 10 km' }]);
  });

  it('a part of a line (inline-only wrapper) is ONE inline fragment with its marks', () => {
    const f = read('google-docs-inline.html');
    expect(f.blocks).toHaveLength(1);
    expect(f.blocks[0].partial).toBe('both');
    expect(outline(f)).toBe('p(Just a partial line, with a [b:bold] tail.)');
  });
});

describe('corpus — Microsoft Word', () => {
  it('drops <o:p>, conditional comments, mso styles and the list markers; keeps b / i / link', () => {
    const f = read('word.html');
    expect(outline(f)).toBe([
      'p([b:Quarterly summary])',
      'p(Results were [i:better] than expected, see [a=https://example.org/report:the report].)',
      'p(Revenue up)', // lot 2 turns MsoListParagraph + mso-list into a list
      'p(Costs stable)',
    ].join(' ; '));
    const text = allText(f);
    expect(text).not.toMatch(/[· ]|mso|supportLists|StartFragment/);
  });
});

describe('corpus — Notion', () => {
  it('maps headings, marks, nested list, quote, to-do, divider and code', () => {
    expect(outline(read('notion.html'))).toBe([
      'h1(Meeting agenda)',
      'p(Welcome to the [b:weekly] sync. Please read the [i:notes] and [c:config.json] before [a=https://example.org/notes:joining].)',
      'h2(Topics)',
      'ul{li(Roadmap review){ul{li(Q1 goals)}} li(Open questions)}',
      'quote(Ship small, ship often.)',
      'todo{li[x](Send the recap) li[ ](Book the room)}',
      'hr',
      'code:js(const total = items.length;)',
    ].join(' ; '));
  });
});

describe('corpus — Wikipedia', () => {
  it('reads headings and paragraphs, keeps the citation text, trims the source newline, keeps table text', () => {
    expect(outline(read('wikipedia.html'))).toBe([
      'h2(History)',
      // Loose inline sibling of the heading. Browsers exclude it from a real copy (user-select:none); see the fixture README.
      'p([[a=/w/index.php?title=Example&action=edit&section=1:edit]])',
      'p(The [b:Example] language was designed in 1990[a=#cite_note-1:[1]] by a small team.⍽It is [i:widely] used.)',
      // lot 2: <table> becomes a table block; until then every cell is kept as a paragraph.
      'p(Releases) ; p(Version) ; p(Year) ; p(1.0) ; p(1992) ; p(2.0) ; p(1999)',
      'h3(Legacy)',
      'p(See [a=/wiki/Other_article:Other article] for more.)',
    ].join(' ; '));
  });

  it('never reads the inline <style> between blocks as text', () => {
    expect(allText(read('wikipedia.html'))).not.toMatch(/hatnote|font-style/);
  });

  it('keeps the NBSP between "team." and "It" (isolated between two visible characters)', () => {
    expect(allText(read('wikipedia.html'))).toContain('small team.\u00a0It is');
  });
});

describe('corpus — GitHub README', () => {
  it('drops the anchor svg, keeps inline code, both code shapes and the task list', () => {
    expect(outline(read('github-readme.html'))).toBe([
      'h1(demo)',
      'p(A tiny library. Install it with [c:npm install demo].)',
      "code(import { run } from 'demo';\\nrun({ verbose: true });)",
      'code:js(const x = 1;\\nconst y = 2;\\n)',
      'todo{li[ ](write docs) li[x](write tests)}',
    ].join(' ; '));
  });
});

describe('corpus — Google Sheets', () => {
  it('keeps every cell value (table structure is lot 2); the TSV fixture matches', () => {
    const f = read('sheets.html');
    const cells = f.blocks.map((b) => b.delta.map((op) => op.insert).join(''));
    expect(cells).toEqual(['Name', 'Score', 'Alice', '42', 'Bob', '37']);
    // text/plain companion: same values, row by row.
    const tsv = fixture('sheets.txt').trim().split('\n').map((l) => l.split('\t'));
    expect(tsv.flat()).toEqual(cells);
    // the <style> / <colgroup> of the clipboard never leak as text
    expect(allText(f)).not.toMatch(/border|cccccc|colgroup/);
  });
});

describe('corpus — generic web page', () => {
  it('reads loose text next to <script>/<style> (P-47), applies style overrides, drops empties and the unsafe link', () => {
    const f = read('web-page.html');
    expect(outline(f)).toBe([
      'p(Intro text before any block,\\ncontinued after a line break.)',
      'p([b:Posted] by [b:staff] on May 3)',
      'p([i,u:nested ][b,i,u:inline][i,u: styles])',
      'p(Paragraph with cancelled strong and cancelled em.)',
      'p(unsafe link then [a=https://example.org/a:redirected link])',
    ].join(' ; '));
    expect(allText(f)).not.toMatch(/dataLayer|color: ?red|Enable JavaScript|javascript:/);
  });
});
