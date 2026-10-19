// @ts-nocheck
/**
 * HTML paste, lot 2 — structures: Google Docs / Word lists rebuilt as real nested lists, tables as tab-separated rows,
 * web images (split of the paragraph, unsafe sources dropped), and the generic hooks they rely on.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeEditor, interpret, outline, allText, EXTENSIONS } from './html-paste.helpers.js';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { HtmlPasteExtension } from '$lib/paste/html.paste.js';
import { Block } from '$lib/blocks/block.svelte.js';
import { extension } from '$lib/utils/extensions.js';

let engine;
beforeAll(async () => { engine = await makeEditor(); });
const read = (html) => outline(interpret(engine, html));
/** List props of the first block (listType, start). */
const listProps = (html) => interpret(engine, html).blocks[0].props;

const docsLi = (level, kind, text) => `<li aria-level="${level}" style="list-style-type:${kind}"><p role="presentation"><span>${text}</span></p></li>`;

describe('Google Docs lists', () => {
  it('aria-level in a single <ul> nests the items', () => {
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}${docsLi(2, 'circle', 'b')}${docsLi(3, 'square', 'c')}${docsLi(2, 'circle', 'd')}${docsLi(1, 'disc', 'e')}</ul>`))
      .toBe('ul{li(a){ul{li(b){ul{li(c)}} li(d)}} li(e)}');
  });

  it('one list element per level (siblings) is ONE list; the kind comes from list-style-type', () => {
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}</ul><ol>${docsLi(2, 'decimal', 'b')}${docsLi(2, 'decimal', 'c')}</ol><ul>${docsLi(3, 'square', 'd')}</ul><ul>${docsLi(1, 'disc', 'e')}</ul>`))
      .toBe('ul{li(a){ol{li(b) li(c){ul{li(d)}}}} li(e)}');
  });

  it('a <ul> nested straight inside the <ul> (what Docs writes) is a sublist', () => {
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}<ul>${docsLi(2, 'circle', 'b')}</ul>${docsLi(1, 'disc', 'c')}</ul>`)).toBe('ul{li(a){ul{li(b)}} li(c)}');
    // without aria-level the nesting depth is the level
    expect(read('<ul><li>a</li><ul><li>b</li><ul><li>c</li></ul></ul><li>d</li></ul>')).toBe('ul{li(a){ul{li(b){ul{li(c)}}}} li(d)}');
  });

  it('a list element of another kind, or at the same level, is a NEW list', () => {
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}</ul><ol>${docsLi(1, 'decimal', 'b')}</ol>`)).toBe('ul{li(a)} ; ol{li(b)}');
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}</ul><ul>${docsLi(1, 'disc', 'b')}</ul>`)).toBe('ul{li(a)} ; ul{li(b)}');
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}</ul><p>between</p><ul>${docsLi(2, 'circle', 'b')}</ul>`)).toBe('ul{li(a)} ; p(between) ; ul{li(b)}');
  });

  it('a jump of several levels is clamped; an item shallower than the first stays at the top', () => {
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}${docsLi(4, 'disc', 'b')}</ul>`)).toBe('ul{li(a){ul{li(b)}}}');
    expect(read(`<ul>${docsLi(2, 'disc', 'a')}${docsLi(1, 'disc', 'b')}</ul>`)).toBe('ul{li(a) li(b)}');
  });

  it('list-style-type decides bullet / ordered per level, the <ol start> is kept', () => {
    expect(listProps(`<ol start="3">${docsLi(1, 'lower-roman', 'a')}</ol>`)).toEqual({ listType: 'ordered', start: 3 });
    expect(listProps(`<ul>${docsLi(1, 'upper-alpha', 'a')}</ul>`)).toEqual({ listType: 'ordered' });
    expect(listProps(`<ol>${docsLi(1, 'disc', 'a')}</ol>`)).toEqual({ listType: 'bullet' });
    const sub = interpret(engine, `<ul>${docsLi(1, 'disc', 'a')}<ol start="4">${docsLi(2, 'decimal', 'b')}</ol></ul>`).blocks[0].children[0].children[0];
    expect(sub.props).toEqual({ listType: 'ordered', start: 4 });
  });

  it('aria-checked items make a to-do list; the checked state is kept', () => {
    const f = interpret(engine, `<ul><li aria-level="1" role="checkbox" aria-checked="true"><p>done</p></li><li aria-level="1" role="checkbox" aria-checked="false"><p>todo</p></li></ul>`);
    expect(outline(f)).toBe('todo{li[x](done) li[ ](todo)}');
  });

  it('empty items vanish, text is not lost', () => {
    expect(read(`<ul>${docsLi(1, 'disc', 'a')}<li aria-level="1"><p><br></p></li>${docsLi(1, 'disc', 'b')}</ul>`)).toBe('ul{li(a) li(b)}');
  });

  it('a plain nested HTML list is untouched', () => {
    expect(read('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>')).toBe('ul{li(a){ul{li(b)}} li(c)}');
  });
});

const wordP = (key, marker, text) => `<p class=MsoListParagraph style='mso-list:${key}'><![if !supportLists]><span style='mso-list:Ignore'>${marker}<span style='font:7pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;</span></span><![endif]>${text}<o:p></o:p></p>`;

describe('Word lists', () => {
  it('levels from levelN, bullets from the marker glyph', () => {
    expect(read(wordP('l0 level1 lfo1', '·', 'a') + wordP('l0 level2 lfo1', 'o', 'b') + wordP('l0 level3 lfo1', '§', 'c') + wordP('l0 level1 lfo1', '-', 'd')))
      .toBe('ul{li(a){ul{li(b){ul{li(c)}}}} li(d)}');
  });

  it('numbers from the marker (1. a) i.), each level keeps its own kind; a numbered list keeps its first number', () => {
    expect(read(wordP('l1 level1 lfo2', '1.', 'a') + wordP('l1 level2 lfo2', 'a)', 'b') + wordP('l1 level3 lfo2', 'i.', 'c') + wordP('l1 level1 lfo2', '2.', 'd')))
      .toBe('ol{li(a){ol{li(b){ol{li(c)}}}} li(d)}');
    expect(listProps(wordP('l1 level1 lfo2', '4.', 'x') + wordP('l1 level1 lfo2', '5.', 'y'))).toEqual({ listType: 'ordered', start: 4 });
  });

  it('a bullet sublist under a numbered item', () => {
    expect(read(wordP('l1 level1 lfo2', '1.', 'a') + wordP('l1 level2 lfo2', 'o', 'b'))).toBe('ol{li(a){ul{li(b)}}}');
  });

  it('another list id, or a paragraph in between, starts another list', () => {
    expect(read(wordP('l0 level1 lfo1', '·', 'a') + wordP('l1 level1 lfo2', '1.', 'b'))).toBe('ul{li(a)} ; ol{li(b)}');
    expect(read(wordP('l0 level1 lfo1', '·', 'a') + '<p class=MsoNormal>between</p>' + wordP('l0 level1 lfo1', '·', 'b'))).toBe('ul{li(a)} ; p(between) ; ul{li(b)}');
    // same l-id, other override: another list
    expect(read(wordP('l0 level1 lfo1', '·', 'a') + wordP('l0 level1 lfo3', '·', 'b'))).toBe('ul{li(a)} ; ul{li(b)}');
  });

  it('a list paragraph with no marker is a bullet; marks and links of the text are kept; the marker is never text', () => {
    const f = interpret(engine, `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>plain <b>bold</b></p>` + wordP('l0 level1 lfo1', '·', 'x'));
    expect(outline(f)).toBe('ul{li(plain [b:bold]) li(x)}');
    expect(allText(f)).not.toMatch(/·/);
  });

  it('whitespace-only list paragraphs are dropped', () => {
    expect(read(wordP('l0 level1 lfo1', '·', 'a') + wordP('l0 level1 lfo1', '·', '&nbsp;') + wordP('l0 level1 lfo1', '·', 'b'))).toBe('ul{li(a) li(b)}');
  });
});

describe('tables become one paragraph per row (tab-separated cells)', () => {
  it('rows, with the marks of the cells', () => {
    expect(read('<table><tr><th>Name</th><th>Score</th></tr><tr><td><b>Alice</b></td><td>4<i>2</i></td></tr></table>'))
      .toBe('p(Name\tScore) ; p([b:Alice]\t4[i:2])');
  });

  it('a cell style (font-weight on the <td>) is a mark of its text', () => {
    expect(read('<table><tr><td style="font-weight:bold">a</td><td>b</td></tr></table>')).toBe('p([b:a]\tb)');
  });

  it('nested blocks, lists, <br> and a nested table are flattened with spaces', () => {
    expect(read('<table><tr><td><p>one</p><p>two</p></td><td>x<br>y</td><td><ul><li>l1</li><li>l2</li></ul></td><td><table><tr><td>n1</td><td>n2</td></tr><tr><td>n3</td><td>n4</td></tr></table></td></tr></table>'))
      .toBe('p(one two\tx y\tl1 l2\tn1 n2 n3 n4)');
  });

  it('colspan keeps the columns aligned; trailing empty cells are kept', () => {
    expect(read('<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td>a</td><td></td><td></td></tr></table>')).toBe('p(wide\t\tc) ; p(a\t\t)');
  });

  it('rows without text are dropped; thead / tbody / tfoot all count; a caption comes first', () => {
    expect(read('<table><caption>Cap</caption><thead><tr><th>h</th></tr></thead><tbody><tr><td> </td><td>&nbsp;</td></tr><tr><td>b</td></tr></tbody><tfoot><tr><td>f</td></tr></tfoot></table>'))
      .toBe('p(Cap) ; p(h) ; p(b) ; p(f)');
    expect(interpret(engine, '<table><tr><td></td></tr></table>')).toBeNull();
  });

  it('is a block among the others', () => {
    expect(read('<p>before</p><table><tr><td>a</td><td>b</td></tr></table><p>after</p>')).toBe('p(before) ; p(a\tb) ; p(after)');
  });

  it('the rule has the LOWEST priority: a block with its own rule for `table` takes over', async () => {
    class TableLike extends Block {
      static htmlRules = [{ selector: 'table', priority: 5 }];
      static fromHTML(el) { return { type: 'tablelike', props: { rows: el.querySelectorAll('tr').length }, partial: false }; }
      static create() { throw new Error('unused'); }
    }
    const withTable = await makeEditor([...EXTENSIONS, extension('tablelike', { block: TableLike })]);
    expect(outline(interpret(withTable, '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>'))).toBe('tablelike()');
    // …and without it, the paragraph rule is the fallback
    expect(outline(interpret(engine, '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>'))).toBe('p(a) ; p(b)');
  });

  it('a fromHTML may return several blocks (the generic hook the table rule uses)', async () => {
    class Two extends Block {
      static htmlRules = [{ selector: 'section.two', priority: 9 }];
      static fromHTML() { return [{ type: 'paragraph', delta: [{ insert: 'x' }], partial: false }, { type: 'paragraph', delta: [{ insert: 'y' }], partial: false }]; }
      static create() { throw new Error('unused'); }
    }
    const e = await makeEditor([...EXTENSIONS, extension('two', { block: Two })]);
    expect(outline(interpret(e, '<section class="two">ignored</section>'))).toBe('p(x) ; p(y)');
  });
});

describe('web images', () => {
  const imgs = (html) => interpret(engine, html).blocks.filter((b) => b.type === 'image');

  it('<img src> is an image block: ref = the original URL (no download), alt kept', () => {
    expect(imgs('<img src="https://example.org/a.png" alt="A cat">')[0]).toEqual({ type: 'image', props: { ref: 'https://example.org/a.png', alt: 'A cat' }, partial: false });
  });

  it('an image inside a paragraph splits it: text before, the image, text after', () => {
    expect(read('<p>Before <img src="https://example.org/a.png" alt="x"> after</p>')).toBe('p(Before) ; image() ; p(after)');
  });

  it('through inline wrappers (a link around the image), several images, and heading hosts', () => {
    expect(read('<p>a<a href="https://x.test"><img src="https://example.org/1.png"></a>b<span><b>c<img src="https://example.org/2.png">d</b></span></p>'))
      .toBe('p(a) ; image() ; p(b[b:c]) ; image() ; p([b:d])');
    expect(read('<h2>Title <img src="https://example.org/a.png"></h2>')).toBe('h2(Title) ; image()');
  });

  it('an image alone in a paragraph is just the image; none of the text is lost', () => {
    expect(read('<p><img src="https://example.org/a.png"></p>')).toBe('image()');
    const f = interpret(engine, '<p>One <img src="https://example.org/a.png"> two <img src="https://example.org/b.png"> three</p>');
    expect(allText(f)).toBe('One\ntwo\nthree');
  });

  it('unsafe sources are dropped (javascript:, data:text/html), the text around stays; no source = no block', () => {
    expect(read('<p>a <img src="javascript:alert(1)"> b</p>')).toBe('p(a b)');
    expect(read('<p>a <img src="data:text/html,<script>x</script>"> b</p>')).toBe('p(a b)');
    expect(read('<p>a <img> b</p>')).toBe('p(a b)');
    expect(read('<p>a <img data-src="https://example.org/lazy.png"> b</p>')).toBe('p(a b)');
  });

  it('data:image is a media-safe source and stays; the sanitized URL is what is kept', () => {
    expect(imgs('<img src=" https://example.org/a.png ">')[0].props.ref).toBe('https://example.org/a.png');
    expect(imgs('<img src="data:image/png;base64,AAAA">')).toHaveLength(1);
  });

  it('the image in a list item or a table cell does not split the list / the table (text kept)', () => {
    expect(read('<ul><li>a <img src="https://example.org/a.png"> b</li></ul>')).toBe('ul{li(a b)}');
    expect(read('<table><tr><td>a <img src="https://example.org/a.png"></td><td>b</td></tr></table>')).toBe('p(a\tb)');
  });

  it('an element declared `embed` by ANY block is lifted (video)', () => {
    expect(read('<p>x <video src="https://example.org/v.mp4"></video> y</p>')).toBe('p(x) ; video() ; p(y)');
  });

  it('a fragment from HTML is flagged `external` (remote media may be imported)', () => {
    expect(interpret(engine, '<p>a</p>').external).toBe(true);
  });
});
