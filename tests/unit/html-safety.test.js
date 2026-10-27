// @ts-nocheck
/**
 * P-42 — safety of the HTML we produce and of the URLs we accept.
 * Sanitizer vectors, copy HTML escaping per block type, link:set rejection, paste dropping unsafe URLs.
 */
import { describe, it, expect, vi } from 'vitest';
import { tick } from 'svelte';
import { escapeHtml, escapeAttr, sanitizeUrl, sanitizePasteBlocks } from '#lib/utils/html.js';
import { deltaToHtml } from '#lib/behaviors/text/text.behavior.svelte.js';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { FullPreset, TextPreset } from '#lib/presets.js';
import { Paragraph as ParagraphBlock } from '#lib/blocks/paragraph/paragraph.svelte.js';
import { Heading as HeadingBlock } from '#lib/blocks/heading/heading.svelte.js';
import { Dialogue } from '#lib/blocks/dialogue/dialogue.svelte.js';
import { CalloutBlock } from '#lib/blocks/callout/callout.svelte.js';
import { BlockquoteBlock } from '#lib/blocks/blockquote/blockquote.svelte.js';
import { CodeBlock } from '#lib/blocks/code/code.svelte.js';
import { ImageBlock } from '#lib/blocks/image/image.svelte.js';
import { VideoBlock } from '#lib/blocks/video/video.svelte.js';
import { FileBlock } from '#lib/blocks/file/file.svelte.js';

const NASTY = '<img src=x onerror=alert(1)>"\'&';
const d = (insert, attributes) => ({ insert, ...(attributes ? { attributes } : {}) });

/** Everything that would be LIVE if the string were parsed as HTML. */
function liveParts(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const live = [];
  doc.querySelectorAll('*').forEach((el) => {
    if (/^(script|iframe|object|embed|style|img)$/i.test(el.tagName)) live.push(el.tagName.toLowerCase());
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) live.push(`${el.tagName.toLowerCase()}[${a.name}]`);
      if (/^\s*javascript:/i.test(a.value)) live.push(`${el.tagName.toLowerCase()}[${a.name}=js]`);
    }
  });
  return live;
}

// ═══════════════════════════════════════════════════════════
// escape helpers
// ═══════════════════════════════════════════════════════════

describe('escapeHtml / escapeAttr', () => {
  it('escapes & < > " \'', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
    expect(escapeAttr('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
  });
  it('coerces null / undefined / numbers safely', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(12)).toBe('12');
  });
});

// ═══════════════════════════════════════════════════════════
// sanitizeUrl
// ═══════════════════════════════════════════════════════════

describe('sanitizeUrl — links', () => {
  const ok = [
    'http://example.com', 'https://example.com/a?b=c#d', 'HTTPS://EXAMPLE.COM', 'mailto:a@b.co', 'tel:+33123456789',
    '/relative/path', 'relative/path', './x', '../x', '?q=1', '#section', '//cdn.example.com/x',
    'https://x.com/" onmouseover="alert(1)', // scheme is fine: the caller escapes the quote
    'https://a.com/?next=javascript:alert(1)', 'foo/bar:baz',
  ];
  for (const url of ok) it(`allows ${JSON.stringify(url)}`, () => expect(sanitizeUrl(url)).toBe(url));

  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)',
    'javascript:alert(1) ', '\u0001javascript:alert(1)', '\u0000javascript:alert(1)', ' javascript:alert(1)',
    '﻿javascript:alert(1)', '​javascript:alert(1)',
    'java\nscript:alert(1)', 'java\tscript:alert(1)', 'java\r\nscript:alert(1)', 'jav&#x09;ascript:alert(1)',
    'jav&#x0A;ascript:alert(1)', 'java\u0000script:alert(1)',
    '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', '&#0000106avascript:alert(1)', '&#106&#97&#118&#97script:alert(1)',
    'javascript&colon;alert(1)', 'javascript&COLON;alert(1)', 'javascript&Tab;:alert(1)', 'java&NewLine;script:alert(1)',
    '&amp;#106;avascript:alert(1)', // double encoding
    'vbscript:msgbox(1)', 'VBScript:x', 'data:text/html,<script>alert(1)</script>', 'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,AAAA', // data: is media-only
    'file:///etc/passwd', 'ftp://x.com', 'blob:https://x.com/uuid', 'nabu-asset:abc', 'about:blank', 'chrome://settings',
    'livescript:x', 'mocha:x', 'jar:http://x/!/', 'x-schema:foo', '%6Aavascript:alert(1)'.replace('%6A', 'j'),
    '', '   ', '\n', null, undefined, 42, {}, ['javascript:alert(1)'], true,
  ];
  for (const url of bad) it(`refuses ${JSON.stringify(url)}`, () => expect(sanitizeUrl(url)).toBeNull());

  it('refuses a percent-encoded scheme separator hiding a scheme', () => {
    expect(sanitizeUrl('javascript%3Aalert(1)')).toBeNull();
    expect(sanitizeUrl('%6A%61vascript%3Aalert(1)')).toBeNull();
  });
  it('returns the url unchanged (no normalisation, the caller escapes it)', () => {
    expect(sanitizeUrl('https://a.com/?q=<b>&x=1')).toBe('https://a.com/?q=<b>&x=1');
  });
});

describe('sanitizeUrl — media', () => {
  const opts = { kind: 'media' };
  const ok = [
    'http://x.com/a.png', 'https://x.com/a.png', '/img/a.png', 'a.png', 'blob:https://x.com/1234-uuid', 'nabu-asset:3f2a-uuid',
    'data:image/png;base64,iVBORw0KGgo=', 'data:image/jpeg;base64,AAAA', 'data:image/svg+xml;utf8,<svg/>', 'data:video/mp4;base64,AAAA', 'DATA:IMAGE/PNG;base64,AAAA',
    '#frag', '//cdn.x.com/a.png',
  ];
  for (const url of ok) it(`allows ${JSON.stringify(url)}`, () => expect(sanitizeUrl(url, opts)).toBe(url));

  const bad = [
    'javascript:alert(1)', ' JaVa\nScRiPt:alert(1)', '&#106;avascript:alert(1)', 'vbscript:x',
    'data:text/html,<script>alert(1)</script>', 'data:application/javascript,alert(1)', 'data:text/plain,hi', 'data:,hi', 'data:image', 'data:image/png',
    'mailto:a@b.co', 'tel:123', 'file:///x', 'ftp://x', '', null, undefined,
  ];
  for (const url of bad) it(`refuses ${JSON.stringify(url)}`, () => expect(sanitizeUrl(url, opts)).toBeNull());
});

// ═══════════════════════════════════════════════════════════
// deltaToHtml
// ═══════════════════════════════════════════════════════════

describe('deltaToHtml safety', () => {
  it('escapes text content', () => {
    expect(deltaToHtml([d(NASTY)])).toBe('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
  });
  it('escapes text inside every mark', () => {
    const html = deltaToHtml([d(NASTY, { bold: true, italic: true, code: true, underline: true, strikethrough: true })]);
    expect(liveParts(html)).toEqual([]);
  });
  it('a javascript: link renders as its label only', () => {
    expect(deltaToHtml([d('click', { link: 'javascript:alert(1)' })])).toBe('click');
  });
  it('an unsafe link keeps the other marks of the label', () => {
    expect(deltaToHtml([d('click', { link: ' JaVa\nScript:alert(1)', bold: true })])).toBe('<strong>click</strong>');
  });
  it('a quote in the href cannot close the attribute', () => {
    const html = deltaToHtml([d('link', { link: 'https://x.com/" onmouseover="alert(1)' })]);
    expect(html).toBe('<a href="https://x.com/&quot; onmouseover=&quot;alert(1)">link</a>');
    expect(liveParts(html)).toEqual([]);
  });
  it('a single quote in the href is escaped too', () => {
    expect(deltaToHtml([d('l', { link: "https://x.com/' onclick='x" })])).toBe('<a href="https://x.com/&#39; onclick=&#39;x">l</a>');
  });
  it('safe links are kept (http, https, mailto, tel, relative)', () => {
    for (const href of ['http://a.com', 'https://a.com', 'mailto:a@b.co', 'tel:123', '/x', '#y']) {
      expect(deltaToHtml([d('t', { link: href })])).toBe(`<a href="${href}">t</a>`);
    }
  });
  it('a non-string link value is not a live link', () => {
    expect(deltaToHtml([d('t', { link: { toString: () => 'javascript:1' } })])).toBe('t');
    expect(deltaToHtml([d('t', { link: true })])).toBe('t');
  });
});

// ═══════════════════════════════════════════════════════════
// every block's toHtml
// ═══════════════════════════════════════════════════════════

describe('block toHtml — nothing live from hostile content', () => {
  const evil = [d(NASTY), d('x', { link: 'javascript:alert(1)' }), d(NASTY, { link: 'https://a.com/"onmouseover="x', bold: true })];
  const textBlocks = [
    ['paragraph', ParagraphBlock, {}],
    ['heading', HeadingBlock, { level: 2 }],
    ['dialogue', Dialogue, {}],
    ['blockquote', BlockquoteBlock, {}],
    ['callout', CalloutBlock, { variant: 'note' }],
    ['code', CodeBlock, {}],
  ];
  for (const [name, Cls, props] of textBlocks) {
    it(`${name}: text and links are escaped / sanitized`, () => {
      const html = Cls.toHtml({ type: name, props, delta: evil });
      expect(liveParts(html)).toEqual([]);
      expect(html).not.toContain('<img');
      expect(html).not.toMatch(/javascript:/i);
    });
  }

  it('dialogue has a real toHtml (no raw fallback)', () => {
    expect(typeof Dialogue.toHtml).toBe('function');
    expect(Dialogue.toHtml({ type: 'dialogue', delta: [d('<b>x</b>')] })).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });

  it('heading: an arbitrary level never reaches the tag name', () => {
    expect(HeadingBlock.toHtml({ props: { level: '1><script>alert(1)</script><h1' }, delta: [d('t')] })).toBe('<h1>t</h1>');
    expect(HeadingBlock.toHtml({ props: { level: 9 }, delta: [d('t')] })).toBe('<h1>t</h1>');
    expect(HeadingBlock.toHtml({ props: { level: 3 }, delta: [d('t')] })).toBe('<h3>t</h3>');
  });

  it('callout: a hostile variant cannot break out of the attributes', () => {
    const html = CalloutBlock.toHtml({ props: { variant: '"><script>alert(1)</script>' }, delta: [d('t')] });
    expect(liveParts(html)).toEqual([]);
  });

  it('image: ref and alt are escaped; an unsafe ref gives no <img>', () => {
    const html = ImageBlock.toHtml({ props: { ref: 'x" onerror="alert(1)', alt: '"><script>alert(1)</script>' } });
    expect(liveParts(html.replace(/<img/, '<span'))).toEqual([]);
    expect(html).toBe('<img src="x&quot; onerror=&quot;alert(1)" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">');
    expect(ImageBlock.toHtml({ props: { ref: 'javascript:alert(1)', alt: 'a<b' } })).toBe('<p>a&lt;b</p>');
    expect(ImageBlock.toHtml({ props: { ref: 'data:text/html,<script>x</script>', alt: '' } })).toBe('');
    expect(ImageBlock.toHtml({ props: { ref: 'nabu-asset:abc', alt: 'a' } })).toBe('<img src="nabu-asset:abc" alt="a">');
  });

  it('video: src escaped, unsafe src dropped', () => {
    expect(VideoBlock.toHtml({ props: { ref: 'v.mp4"onerror="x' } })).toBe('<video src="v.mp4&quot;onerror=&quot;x" controls></video>');
    expect(VideoBlock.toHtml({ props: { ref: 'javascript:alert(1)' } })).toBe('');
  });

  it('file: href / name escaped, unsafe href gives plain text', () => {
    const html = FileBlock.toHtml({ props: { ref: 'https://x.com/f.pdf', name: '"><script>alert(1)</script>' } });
    expect(liveParts(html)).toEqual([]);
    expect(FileBlock.toHtml({ props: { ref: 'javascript:alert(1)', name: 'a<b>' } })).toBe('<p>a&lt;b&gt;</p>');
    expect(FileBlock.toHtml({ props: { ref: 'data:text/html,x', name: '' } })).toBe('<p>file</p>');
  });
});

// ═══════════════════════════════════════════════════════════
// model guard: link:set / link:toggle / mark:apply
// ═══════════════════════════════════════════════════════════

async function editorWithSelectedText(text = 'click me') {
  const engine = new Nabu({ extensions: TextPreset });
  await engine.commit();
  const block = engine.children[0];
  const tb = block.behaviors.get('text');
  tb.container.insert(0, text);
  await engine.commit();
  block.selected = true;
  Object.defineProperty(tb, 'selection', { value: { from: 0, to: text.length, isCollapsed: false }, configurable: true });
  const linkOf = () => tb.container.toDelta().map((op) => op.attributes?.link).filter(Boolean);
  return { engine, tb, linkOf };
}

describe('link actions reject unsafe hrefs', () => {
  it('link:set stores a safe href', async () => {
    const { engine, linkOf } = await editorWithSelectedText();
    await engine.exec('link:set', { href: 'https://example.com' });
    expect(linkOf()).toEqual(['https://example.com']);
  });

  for (const href of ['javascript:alert(1)', ' JaVa\nScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '&#106;avascript:alert(1)']) {
    it(`link:set refuses ${JSON.stringify(href)}`, async () => {
      const { engine, linkOf } = await editorWithSelectedText();
      const warn = vi.spyOn(engine, 'warn');
      await engine.exec('link:set', { href });
      expect(linkOf()).toEqual([]);
      expect(warn).toHaveBeenCalled();
    });

    it(`link:toggle refuses ${JSON.stringify(href)}`, async () => {
      const { engine, linkOf } = await editorWithSelectedText();
      await engine.exec('link:toggle', { href });
      expect(linkOf()).toEqual([]);
    });

    it(`mark:apply link refuses ${JSON.stringify(href)}`, async () => {
      const { engine, linkOf } = await editorWithSelectedText();
      await engine.exec('mark:apply', { mark: 'link', value: href });
      expect(linkOf()).toEqual([]);
    });
  }

  it('mark:apply link with a non-URL value (true) is refused', async () => {
    const { engine, linkOf } = await editorWithSelectedText();
    await engine.exec('mark:apply', { mark: 'link', value: true });
    expect(linkOf()).toEqual([]);
  });

  it('other marks are unaffected', async () => {
    const { engine, tb } = await editorWithSelectedText();
    await engine.exec('mark:apply', { mark: 'bold' });
    expect(tb.container.toDelta()[0].attributes.bold).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// paste / import
// ═══════════════════════════════════════════════════════════

async function pasteEditor() {
  const engine = new Nabu({ extensions: FullPreset });
  await engine.commit();
  const block = engine.children[0];
  engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
  return { engine, block };
}

async function pasteHtml(engine, html) {
  engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (f) => (f === 'text/html' ? html : '') } });
  await tick();
  await engine.commit();
}

const allDeltas = (engine) => [...engine.blocks.values()].flatMap((b) => b.behaviors?.get('text')?.container?.toDelta() ?? []);
const allLinks = (engine) => allDeltas(engine).map((op) => op.attributes?.link).filter(Boolean);
const allText = (engine) => allDeltas(engine).map((op) => op.insert).join('');
const typesOf = (engine) => [...engine.blocks.values()].map((b) => b.type);

describe('HTML paste drops unsafe URLs and active content', () => {
  it('<a href="javascript:…"> keeps the text, no link', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p>go <a href="javascript:alert(1)">here</a> now</p>');
    expect(allText(engine)).toContain('go here now');
    expect(allLinks(engine)).toEqual([]);
  });

  for (const href of [' JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', '&#106;avascript:alert(1)', 'vbscript:x']) {
    it(`obfuscated href ${JSON.stringify(href)} is dropped`, async () => {
      const { engine } = await pasteEditor();
      await pasteHtml(engine, `<p><a href="${href.replace(/"/g, '&quot;')}">x</a></p>`);
      expect(allLinks(engine)).toEqual([]);
      expect(allText(engine)).toContain('x');
    });
  }

  it('a safe link survives', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p><a href="https://example.com/a">ok</a></p>');
    expect(allLinks(engine)).toEqual(['https://example.com/a']);
  });

  it('<script>, <style>, <iframe>, <object>, <embed>, <svg> contribute no text and no block', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p>a<script>window.pwn=1</script><style>p{x:y}</style><iframe src="javascript:1">frame</iframe><object data="x">obj</object><embed src="x"><svg><text>svg</text></svg>b</p>');
    expect(allText(engine)).toBe('ab');
    expect(typesOf(engine).filter((t) => !['paragraph'].includes(t))).toEqual([]);
  });

  it('on* attributes and tags are text only: <p onclick> / <img onerror> produce no live attribute', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p onclick="alert(1)" style="x">hi <b onmouseover="alert(1)">there</b></p><img src="x" onerror="alert(1)">');
    expect(allText(engine)).toContain('hi there');
    for (const b of engine.blocks.values()) {
      const json = JSON.stringify(b.node.data.toJSON?.() ?? {});
      expect(json).not.toMatch(/onclick|onerror|onmouseover/i);
    }
  });

  it('<img src="javascript:…"> and <video src="javascript:…"> produce no media block', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p>a</p><img src="javascript:alert(1)" alt="x"><video src="javascript:alert(1)"></video><img src="data:text/html,x">');
    expect(typesOf(engine)).not.toContain('image');
    expect(typesOf(engine)).not.toContain('video');
  });

  it('<a download href="javascript:…"> becomes plain text, not a file block', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p>a</p><a href="javascript:alert(1)" download="doc.pdf">doc</a>');
    expect(typesOf(engine)).not.toContain('file');
  });

  it('a safe <img> still pastes as an image block', async () => {
    const { engine } = await pasteEditor();
    await pasteHtml(engine, '<p>a</p><img src="https://example.com/a.png" alt="pic">');
    expect(typesOf(engine)).toContain('image');
  });
});

describe('fragment sanitization (insertFragment / importFragment / nabu JSON)', () => {
  it('sanitizePasteBlocks drops unsafe link marks and keeps the text and the other marks', () => {
    const out = sanitizePasteBlocks([{ type: 'paragraph', delta: [d('a', { link: 'javascript:1', bold: true }), d('b', { link: 'https://ok.com' })] }]);
    expect(out[0].delta).toEqual([d('a', { bold: true }), d('b', { link: 'https://ok.com' })]);
  });
  it('drops an attributes object left empty', () => {
    const out = sanitizePasteBlocks([{ type: 'paragraph', delta: [d('a', { link: 'javascript:1' })] }]);
    expect(out[0].delta).toEqual([{ insert: 'a' }]);
  });
  it('empties an unsafe media ref, recursing into children, without mutating the input', () => {
    const input = [{ type: 'toggle', delta: [], children: [{ type: 'image', props: { ref: 'javascript:1', alt: 'x' } }] }];
    const snapshot = JSON.stringify(input);
    const out = sanitizePasteBlocks(input);
    expect(out[0].children[0].props).toEqual({ ref: '', alt: 'x' });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it('returns unchanged objects when nothing is unsafe', () => {
    const b = [{ type: 'paragraph', delta: [d('a', { link: 'https://a.com' })] }];
    expect(sanitizePasteBlocks(b)[0]).toBe(b[0]);
  });

  it('application/x-nabu+json carrying a javascript: link is sanitized on paste', async () => {
    const { engine } = await pasteEditor();
    const frag = { blocks: [{ type: 'paragraph', delta: [d('evil', { link: 'javascript:alert(1)' })], partial: false }] };
    engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (f) => (f === 'application/x-nabu+json' ? JSON.stringify(frag) : '') } });
    await tick();
    await engine.commit();
    expect(allText(engine)).toContain('evil');
    expect(allLinks(engine)).toEqual([]);
  });

  it('importJSON with an unsafe link / image ref is sanitized', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.commit();
    await engine.importJSON({ blocks: [
      { type: 'paragraph', content: [{ text: 'x', link: 'javascript:alert(1)' }] },
      { type: 'image', props: { ref: 'javascript:alert(1)', alt: 'a' } },
    ] });
    expect(allLinks(engine)).toEqual([]);
    const img = [...engine.blocks.values()].find((b) => b.type === 'image');
    if (img) expect(img.ref).toBe('');
  });
});

describe('markdown paste / import drops unsafe URLs', () => {
  it('![alt](javascript:…) is not an image block (text kept)', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.commit();
    await engine.importMarkdown('![x](javascript:alert(1))');
    expect(typesOf(engine)).not.toContain('image');
    expect(allLinks(engine)).toEqual([]);
  });
  it('![alt](data:text/html,…) is not an image block', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.commit();
    await engine.importMarkdown('![x](data:text/html,<script>alert(1)</script>)');
    expect(typesOf(engine)).not.toContain('image');
  });
  it('![alt](https://…) is still an image', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.commit();
    await engine.importMarkdown('![x](https://example.com/a.png)');
    expect(typesOf(engine)).toContain('image');
  });
  it('[t](javascript:…) never becomes a link mark', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.commit();
    await engine.importMarkdown('[t](javascript:alert(1))');
    expect(allLinks(engine)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════
// render guard
// ═══════════════════════════════════════════════════════════

describe('render guard', () => {
  it('MediaBlock.displaySrc never returns an unsafe URL', async () => {
    const engine = new Nabu({ extensions: FullPreset });
    await engine.commit();
    const img = ImageBlock.create(engine, 'image', { ref: 'javascript:alert(1)', alt: 'x' });
    expect(img.displaySrc).toBe('');
    const ok = ImageBlock.create(engine, 'image', { ref: 'https://example.com/a.png' });
    expect(ok.displaySrc).toBe('https://example.com/a.png');
    const data = VideoBlock.create(engine, 'video', { ref: 'data:text/html,<script>1</script>' });
    expect(data.displaySrc).toBe('');
  });
});
