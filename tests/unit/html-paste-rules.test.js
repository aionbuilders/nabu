// @ts-nocheck
/**
 * Targeted tests of the external-HTML paste rules (P-56, P-57, P-47): style overrides, known marks only, empty blocks,
 * whitespace / NBSP, Google redirects, scripts and Word junk.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { makeEditor, interpret, outline, fmtDelta } from './html-paste.helpers.js';
import { unwrapGoogleRedirect, resolveLinkHref, parseStyle } from '$lib/paste/html.paste.js';

let engine;
beforeAll(async () => { engine = await makeEditor(); });
const read = (html) => outline(interpret(engine, html));
/** Delta of the first block. */
const delta = (html) => interpret(engine, html)?.blocks[0].delta;
/** Raw text of the first block (marks ignored). */
const text = (html) => delta(html)?.map((op) => op.insert).join('');

describe('rule 1 — the inline style has the last word over the tag', () => {
  it.each([
    ['<b style="font-weight:normal">x</b>', 'x'],
    ['<b style="font-weight: 400">x</b>', 'x'],
    ['<strong style="font-weight:400;color:red">x</strong>', 'x'],
    ['<b style="FONT-WEIGHT : Normal !important">x</b>', 'x'],
    ['<i style="font-style:normal">x</i>', 'x'],
    ['<em style="font-style: normal">x</em>', 'x'],
    ['<u style="text-decoration:none">x</u>', 'x'],
    ['<s style="text-decoration: none">x</s>', 'x'],
    ['<del style="text-decoration-line:none">x</del>', 'x'],
    ['<b style="font-weight:300">x</b>', 'x'],
  ])('%s is plain', (inner, t) => {
    expect(read(`<p>${inner}</p>`)).toBe(`p(${t})`);
  });

  it.each([
    ['<span style="font-weight:700">x</span>', 'b'],
    ['<span style="font-weight:600">x</span>', 'b'],
    ['<span style="font-weight:900">x</span>', 'b'],
    ['<span style="font-weight:bold">x</span>', 'b'],
    ['<span style="font-style:italic">x</span>', 'i'],
    ['<span style="font-style:oblique">x</span>', 'i'],
    ['<span style="text-decoration:underline">x</span>', 'u'],
    ['<span style="text-decoration-line:underline">x</span>', 'u'],
    ['<span style="text-decoration:line-through">x</span>', 's'],
    ['<span style="text-decoration:underline line-through">x</span>', 's,u'],
  ])('%s is detected', (inner, marks) => {
    expect(read(`<p>${inner}</p>`)).toBe(`p([${marks}:x])`);
  });

  it('font-weight 500 / 400 on a span does not make bold', () => {
    expect(read('<p><span style="font-weight:500">x</span><span style="font-weight:400">y</span></p>')).toBe('p(xy)');
  });

  it('a nested font-weight:normal cancels the bold inherited from an ancestor tag', () => {
    expect(read('<p><b>a<span style="font-weight:normal">b</span>c</b></p>')).toBe('p([b:a]b[b:c])');
  });

  it('a nested text-decoration:none / font-style:normal cancels what an ancestor set', () => {
    expect(read('<p><i>a<span style="font-style:normal">b</span></i><u>c<span style="text-decoration:none">d</span></u></p>')).toBe('p([i:a]b[u:c]d)');
  });

  it('the Google Docs wrapper (font-weight:normal) around spans does not bold the line', () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><span style="font-weight:400">plain </span><span style="font-weight:700">strong</span></b>';
    expect(read(html)).toBe('p(plain [b:strong])');
  });

  it('mso-* properties never count as their standard namesake', () => {
    expect(read(`<p><b style='mso-bidi-font-weight:normal'>x</b><i style='mso-bidi-font-style:normal'>y</i></p>`)).toBe('p([b:x][i:y])');
    expect(read(`<p><span style='mso-bold:normal;mso-font-style:italic'>x</span></p>`)).toBe('p(x)');
  });

  it('the underline a link gets from its style is not a mark; <u> inside a link still is', () => {
    expect(read('<p><a href="https://e.org/"><span style="text-decoration:underline;color:#1155cc">go</span></a></p>')).toBe('p([a=https://e.org/:go])');
    expect(read('<p><a href="https://e.org/"><u>go</u></a></p>')).toBe('p([a=https://e.org/,u:go])');
  });

  it('parseStyle reads declarations with quotes / url(…;…) and keeps the last value', () => {
    expect(parseStyle({ getAttribute: () => `font-family:"A;B"; background:url(data:image/png;base64,AA) ; font-weight:700; font-weight:400 !important` }))
      .toEqual({ 'font-family': '"a;b"', background: 'url(data:image/png;base64,aa)', 'font-weight': '400' });
  });
});

describe('rule 2 — only known marks survive; nothing is inferred from sizes', () => {
  it('colors, fonts, sizes and backgrounds are ignored', () => {
    expect(read('<p><span style="color:#ff0000;background-color:yellow;font-family:Courier;font-size:20pt;line-height:2">x</span></p>')).toBe('p(x)');
  });

  it('a big font-size never makes a heading; a small one never makes anything', () => {
    expect(read('<p><span style="font-size:32pt;font-weight:700">Big title</span></p>')).toBe('p([b:Big title])');
    expect(read('<div style="font-size:48px">Huge</div>')).toBe('p(Huge)');
    expect(read('<p style="font-size:8pt"><span style="font-size:8pt">Tiny</span></p>')).toBe('p(Tiny)');
  });

  it('keeps the five marks and the link, nothing else', () => {
    expect(read('<p><b>b</b><i>i</i><u>u</u><s>s</s><code>c</code><a href="https://e.org">l</a><mark>m</mark><sup>2</sup><kbd>k</kbd></p>'))
      .toBe('p([b:b][i:i][u:u][s:s][c:c][a=https://e.org:l]m2k)');
  });
});

describe('rule 3 — empty / whitespace-only text blocks are dropped', () => {
  it.each([
    ['<p></p><p>x</p>', 'p(x)'],
    ['<p><br></p><p>x</p><p><br/></p>', 'p(x)'],
    ['<p>&nbsp;</p><p>x</p>', 'p(x)'],
    ['<p> \n\t </p><p>x</p>', 'p(x)'],
    ['<p>&nbsp;&nbsp;</p><p>x</p>', 'p(x)'],
    ['<p><span></span></p><p>x</p>', 'p(x)'],
    ['<p>a</p><div><br></div><p>b</p>', 'p(a) ; p(b)'],
    ['<h2></h2><h2>&nbsp;</h2><p>x</p>', 'p(x)'],
    ['<blockquote>&nbsp;</blockquote><p>x</p>', 'p(x)'],
    ['<ul><li></li><li>a</li><li>&nbsp;</li><li><br></li></ul>', 'ul{li(a)}'],
    ['<ul><li></li></ul><p>x</p>', 'p(x)'],
  ])('%s', (html, expected) => {
    expect(read(html)).toBe(expected);
  });

  it('keeps an empty list item that holds a sub-list', () => {
    expect(read('<ul><li><ul><li>a</li></ul></li></ul>')).toBe('ul{li(){ul{li(a)}}}');
  });

  it('a paste made only of empties inserts nothing (no fragment)', () => {
    expect(interpret(engine, '<p></p><p><br></p><p>&nbsp;</p><div> </div><br>')).toBeNull();
    expect(interpret(engine, '<ul><li></li></ul>')).toBeNull();
    expect(interpret(engine, '<span>&nbsp;</span>')).toBeNull();
  });

  it('never touches <pre> / code: whitespace-only code stays', () => {
    expect(read('<pre>  \n</pre>')).toBe('code(  \\n)');
    expect(read('<pre><code class="language-js">\n</code></pre>')).toBe('code:js(\\n)');
  });
});

describe('rule 4 — whitespace and NBSP (P-57)', () => {
  const NB = ' ';

  it('an NBSP between two visible characters is kept ("10 km", "Bonjour :", « guillemets »)', () => {
    expect(text(`<p>10${NB}km</p>`)).toBe(`10${NB}km`);
    expect(text(`<p>Bonjour${NB}: monde</p>`)).toBe(`Bonjour${NB}: monde`);
    expect(text(`<p>«${NB}Salut${NB}»</p>`)).toBe(`«${NB}Salut${NB}»`);
    expect(text('<p>10&nbsp;km</p>')).toBe(`10${NB}km`);
  });

  it('is kept across marks and elements', () => {
    expect(delta(`<p><b>10</b>${NB}km</p>`)).toEqual([{ insert: '10', attributes: { bold: true } }, { insert: `${NB}km` }]);
    expect(text(`<p><span>10</span>${NB}<span>km</span></p>`)).toBe(`10${NB}km`);
  });

  it('NBSP next to a space becomes a regular space, then collapses', () => {
    expect(text(`<p>a${NB} b</p>`)).toBe('a b');
    expect(text(`<p>a ${NB}b</p>`)).toBe('a b');
    expect(text(`<p>a${NB}${NB}b</p>`)).toBe('a b');
    expect(text(`<p>a${NB}${NB}${NB}${NB}b</p>`)).toBe('a b');
    expect(text(`<p>a${NB}\n b</p>`)).toBe('a b');
  });

  it('leading / trailing NBSP of a block is a regular space, then trimmed', () => {
    expect(text(`<p>${NB}hello${NB}</p>`)).toBe('hello');
    expect(text(`<p>${NB}${NB}hello${NB}${NB}</p>`)).toBe('hello');
    expect(text(`<h1>${NB}Title</h1>`)).toBe('Title');
    expect(read(`<ul><li>${NB}item${NB}</li></ul>`)).toBe('ul{li(item)}');
  });

  it('NBSP next to a <br> (a line edge) is a regular space, then trimmed', () => {
    expect(text(`<p>a${NB}<br>${NB}b</p>`)).toBe('a\nb');
  });

  it('HTML whitespace collapses; a double space is one space', () => {
    expect(text('<p>a  b</p>')).toBe('a b');
    expect(text('<p>a \t\n   b</p>')).toBe('a b');
    expect(text('<p>  lead and trail  </p>')).toBe('lead and trail');
    expect(text('<p><b>a </b> <i> b</i></p>')).toBe('a b');
    expect(delta('<p><b>a </b> <i> b</i></p>')).toEqual([{ insert: 'a ', attributes: { bold: true } }, { insert: 'b', attributes: { italic: true } }]);
    expect(text('<p>\n   indented\n   source\n</p>')).toBe('indented source');
  });

  it('<br> is a line break; spaces around it are dropped', () => {
    expect(text('<p>a<br>b</p>')).toBe('a\nb');
    expect(text('<p>a <br> b</p>')).toBe('a\nb');
    expect(text('<p>a<br><br>b</p>')).toBe('a\n\nb');
    expect(text('<p>a<br></p>')).toBe('a'); // a trailing <br> is not a line
  });

  it('U+202F, U+2007, U+2060, U+00AD are never touched', () => {
    for (const ch of [' ', ' ', '⁠', '­']) {
      expect(text(`<p>10${ch}km</p>`)).toBe(`10${ch}km`);
      expect(text(`<p>${ch}x${ch}</p>`)).toBe(`${ch}x${ch}`);
      expect(text(`<p>a ${ch} b</p>`)).toBe(`a ${ch} b`);
    }
  });

  it('ZWJ emoji sequences and ZWNJ words are untouched', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(text(`<p>Family ${family} here</p>`)).toBe(`Family ${family} here`);
    expect(text(`<p>${family}</p>`)).toBe(family);
    const persian = 'می‌خواهم'; // می‌خواهم (ZWNJ inside)
    expect(text(`<p>${persian}</p>`)).toBe(persian);
    expect(text(`<p>a${'‌'}b</p>`)).toBe('a‌b');
    expect(text(`<p>a${'‍'}b</p>`)).toBe('a‍b');
  });

  it('white-space:pre-wrap spans (Google Docs) keep their spaces; plain spans collapse', () => {
    expect(text('<p><span style="white-space:pre-wrap">a  b</span></p>')).toBe('a  b');
    expect(text('<p><span style="white-space:pre-wrap">a  b</span> c  d</p>')).toBe('a  b c d');
    expect(text('<p><span style="white-space:normal">a  b</span></p>')).toBe('a b');
  });

  it('an NBSP inside pre-wrap text still follows the NBSP rule', () => {
    expect(text(`<p><span style="white-space:pre-wrap">a${NB}${NB}b${NB}c</span></p>`)).toBe(`a  b${NB}c`);
  });

  it('<pre> is verbatim (spaces, newlines, NBSP)', () => {
    expect(read(`<pre>a  b${NB}${NB}\n  c</pre>`)).toBe('code(a  b⍽⍽\\n  c)');
  });

  it('a fragment of a line (inline-only HTML) keeps one edge space: it is merged into running text', () => {
    const f = interpret(engine, '<meta charset="utf-8"><span style="color:red">hello </span>\n');
    expect(f.blocks[0].partial).toBe('both');
    expect(fmtDelta(f.blocks[0].delta)).toBe('hello ');
    const g = interpret(engine, '<span> and </span>');
    expect(fmtDelta(g.blocks[0].delta)).toBe(' and ');
  });
});

describe('rule 5 — Google redirect links', () => {
  const wrap = (u) => `<p><a href="${u}">go</a></p>`;

  it('unwraps https and http redirects to their target', () => {
    expect(read(wrap('https://www.google.com/url?q=https://example.org/page&sa=D&source=editors&ust=1&usg=x'))).toBe('p([a=https://example.org/page:go])');
    expect(read(wrap('http://www.google.com/url?q=https://example.org/page&sa=D'))).toBe('p([a=https://example.org/page:go])');
    expect(read(wrap('https://google.com/url?q=https://example.org/page'))).toBe('p([a=https://example.org/page:go])');
  });

  it('decodes a percent-encoded target', () => {
    expect(read(wrap('https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fa%3Fx%3D1%26y%3D2&sa=D'))).toBe('p([a=https://example.org/a?x=1&y=2:go])');
    expect(read(wrap('https://www.google.com/url?q=mailto:me@example.org&sa=D'))).toBe('p([a=mailto:me@example.org:go])');
  });

  it('the target goes through sanitizeUrl: an unsafe target keeps the (safe) original link', () => {
    const original = 'https://www.google.com/url?q=javascript:alert(1)&sa=D';
    expect(unwrapGoogleRedirect(original)).toBeNull();
    expect(read(wrap(original))).toBe(`p([a=${original}:go])`);
  });

  it('malformed redirects keep the original link when it is safe', () => {
    for (const u of [
      'https://www.google.com/url?sa=D',
      'https://www.google.com/url?q=',
      'https://www.google.com/url?q=not-a-url',
      'https://www.google.com/url?q=/relative',
      'https://www.google.com/search?q=https://example.org',
      'https://www.google.com.evil.example/url?q=https://example.org',
      'https://example.org/url?q=https://other.example',
    ]) {
      expect(unwrapGoogleRedirect(u)).toBeNull();
      expect(read(wrap(u))).toBe(`p([a=${u}:go])`);
    }
  });

  it('a redirect never smuggles a script: the link is dropped when nothing safe remains', () => {
    expect(resolveLinkHref('javascript:alert(1)')).toBeNull();
    expect(resolveLinkHref('java\nscript:alert(1)')).toBeNull();
    expect(read(wrap('javascript:alert(1)'))).toBe('p(go)');
    expect(read(wrap('data:text/html,<script>x</script>'))).toBe('p(go)');
  });

  it('plain links are untouched', () => {
    expect(read(wrap('https://example.org/a?b=c#d'))).toBe('p([a=https://example.org/a?b=c#d:go])');
    expect(read(wrap('#top'))).toBe('p([a=#top:go])');
  });
});

describe('rule 6 — P-47: a container with a <script>/<style> child keeps its sibling text', () => {
  it.each([
    ['<div><script>x</script>text</div>', 'p(text)'],
    ['<div>text<script>x</script></div>', 'p(text)'],
    ['<div><style>.a{color:red}</style>text</div>', 'p(text)'],
    ['<div>one<script>alert(1)</script>two</div>', 'p(onetwo)'],
    ['<div><script>x</script><p>para</p>tail</div>', 'p(para) ; p(tail)'],
    ['<section>head<script>x</script><h2>T</h2><style>y</style>tail</section>', 'p(head) ; h2(T) ; p(tail)'],
    ['<div><noscript>enable js</noscript>shown</div>', 'p(shown)'],
    ['<div><div><script>x</script>deep</div></div>', 'p(deep)'],
    ['<p>a<script>x</script>b<style>y</style>c</p>', 'p(abc)'],
  ])('%s', (html, expected) => {
    expect(read(html)).toBe(expected);
  });

  it('scripts and styles never contribute text, anywhere', () => {
    const f = interpret(engine, '<div><script>SECRET1</script><b>x<script>SECRET2</script></b><style>SECRET3</style><ul><li>a<script>SECRET4</script></li></ul><pre>c</pre></div>');
    expect(JSON.stringify(f)).not.toContain('SECRET');
  });

  it('loose text between blocks becomes paragraphs, loose inline runs keep their marks', () => {
    expect(read('<div>a <b>b</b><p>p</p>c<br>d</div>')).toBe('p(a [b:b]) ; p(p) ; p(c\\nd)');
  });

  it('block children inside an inline wrapper (<b>, <font>, <span>) are read, the wrapper adds nothing', () => {
    expect(read('<b><p>a</p><p>b</p></b>')).toBe('p(a) ; p(b)');
    expect(read('<font><div>a</div></font>')).toBe('p(a)');
  });

  it('a container that matches a block rule is that block (toggle, callout)', () => {
    expect(read('<details open><summary>Head</summary><p>Body</p></details>')).toBe('toggle(Head){p(Body)}');
  });
});

describe('rule 7 — Word junk produces nothing', () => {
  it('<o:p>, StartFragment / EndFragment, conditional comments, mso styles', () => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!-- p.MsoNormal {mso-style-unhide:no;} --></style></head><body><!--StartFragment--><p class=MsoNormal style='margin:0cm;mso-layout-grid-align:none'>Hello<o:p></o:p></p><!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]--><p class=MsoNormal><o:p>&nbsp;</o:p></p><![if !supportLists]><![endif]><p class=MsoNormal><span style='mso-spacerun:yes'>  </span>World <o:p></o:p></p><!--EndFragment--></body></html>`;
    expect(read(html)).toBe('p(Hello) ; p(World)');
  });

  it('the marker of a Word list paragraph (mso-list:Ignore) is not text: it only tells bullet from numbered', () => {
    const html = `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span><![endif]>First<o:p></o:p></p>`;
    expect(read(html)).toBe('ol{li(First)}');
  });

  it('namespaced Office elements are dropped, other prefixed elements keep their text', () => {
    expect(read('<p>a<v:shape>junk</v:shape><w:sdt>junk</w:sdt>b<st1:place>Paris</st1:place></p>')).toBe('p(abParis)');
  });

  it('hidden elements (display:none, hidden, mso-hide) are dropped', () => {
    expect(read('<p>a<span style="display:none">x</span><span hidden>y</span><span style="mso-hide:all">z</span><span style="visibility:hidden">w</span>b</p>')).toBe('p(ab)');
  });
});

describe('internal Nabu path is untouched by the empty-block rule', () => {
  it('the HTML interpreter is the only place empties are dropped (the nabu+json interpreter keeps an empty paragraph)', async () => {
    const { NabuPasteExtension } = await import('$lib/paste/nabu.paste.js');
    const nabu = await makeEditor();
    const fragment = NabuPasteExtension.pasteInterpreters[0].interpret(JSON.stringify({ version: 1, blocks: [{ type: 'paragraph', partial: false, delta: [] }] }), nabu);
    expect(fragment?.blocks).toHaveLength(1);
  });
});
