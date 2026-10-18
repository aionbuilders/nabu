/**
 * E2E — what COPY and CUT put on the clipboard, and what CUT does to the document.
 *
 * The three payloads written by `Nabu.handleCopy` (`application/x-nabu+json`, `text/html`, `text/plain`) are read
 * from the ClipboardEvent itself (see helpers/clip-capture.ts) — the system clipboard is unreliable for custom MIME
 * types. Fixtures are built programmatically, the selection is placed through the API, and the copy / cut is a REAL
 * Ctrl+C / Ctrl+X key press. Document assertions run on the MODEL (outline / flat / tree), not the DOM.
 *
 * Convention (see lists-structure.spec.ts): "CURRENT:" documents a coherent, data-preserving behaviour that is not
 * specifically decided; "BROKEN:" tags a test left FAILING on purpose (lost / duplicated text, wrong props, invalid
 * tree after a cut, unescaped HTML, live `javascript:` link, page error, undo not restoring).
 *
 *  A. copy payloads (text, blocks, void blocks, toggle, lists, code)   B. security of the HTML payload
 *  C. cut (select-all, partial multi-block, nested lists)               D. collapsed caret
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoEditor, clearAndReset, press } from './helpers/editor.js';
import { undo, redo, selectAll } from './helpers/keyboard.js';
import {
  buildDoc, I, UL, TODO, outline, caret, violations, allText, focusAt, selectRange, collectErrors,
} from './helpers/model.js';
import { buildBlocks, buildTree, tree, flat, H, Q, C, D, Para, Code, Tog, Hr, Pp, type TreeSpec } from './helpers/blocks.js';
import { copy, cut, fragStr, fragTexts, type ClipEvent } from './helpers/clip-capture.js';

// ── local helpers ──────────────────────────────────────────────────────────

/** Apply an inline mark to `[start, end)` of the (unique, root) text block whose text is `blockText`. */
async function mark(page: Page, blockText: string, start: number, end: number, name: string, value: any = true) {
  await page.evaluate(async ([t, s, e, name, value]) => {
    const n = (window as any).nabu;
    const hit = [...n.blocks.values()].find((b: any) => b.behaviors?.get('text')?.text === t) as any;
    if (!hit) throw new Error('no block with text ' + t);
    hit.behaviors.get('text').container.mark({ start: s, end: e }, name, value);
    await n.commit();
  }, [blockText, start, end, name, value] as [string, number, number, string, any]);
}

/** Parse a copied HTML payload in an INERT document (DOMParser: no script runs, no image loads) and list what is live. */
async function inspectHtml(page: Page, html: string) {
  return page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    const live: string[] = [];
    d.querySelectorAll('*').forEach((el) => {
      if (/^(script|iframe|object|embed|style)$/i.test(el.tagName)) live.push(`<${el.tagName.toLowerCase()}>`);
      for (const a of Array.from(el.attributes)) {
        if (/^on/i.test(a.name)) live.push(`<${el.tagName.toLowerCase()} ${a.name}>`);
        if (/^\s*javascript:/i.test(a.value)) live.push(`<${el.tagName.toLowerCase()} ${a.name}="${a.value}">`);
      }
    });
    return { live, text: d.body.textContent ?? '', hrefs: Array.from(d.querySelectorAll('a')).map((a) => a.getAttribute('href')) };
  }, html);
}

/** Blocks of the captured fragment, as one compact string per block (for readable failure diffs). */
const frag = (ev: ClipEvent) => (ev.nabu?.blocks ?? []).map(fragStr);

/** Make a text/plain / html / fragment check that EVERY expected text is present in the three payloads. */
function expectTextInAllPayloads(ev: ClipEvent, texts: string[]) {
  const inFrag = fragTexts(ev.nabu?.blocks ?? []);
  for (const t of texts) {
    expect.soft(inFrag, `"${t}" in nabu fragment`).toContain(t);
    expect.soft(ev.html, `"${t}" in text/html`).toContain(t);
    expect.soft(ev.text, `"${t}" in text/plain`).toContain(t);
  }
}

let errors: ReturnType<typeof collectErrors>;

test.beforeEach(async ({ page }) => {
  errors = collectErrors(page);
  await gotoEditor(page);
  await clearAndReset(page);
});

test.afterEach(async () => {
  expect(errors.list(), 'console / page errors').toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════
// A. COPY payloads
// ═══════════════════════════════════════════════════════════════════════════

test.describe('A · copy payloads', () => {
  test('1 · partial selection in ONE paragraph, with bold + link', async ({ page }) => {
    await buildBlocks(page, [Para('hello world')]);
    await mark(page, 'hello world', 0, 5, 'bold');
    await mark(page, 'hello world', 6, 11, 'link', 'https://x.com/a?b=1&c=2');
    await selectRange(page, 'hello world', 2, 'hello world', 9); // "llo wor"
    const ev = await copy(page);

    expect(ev.defaultPrevented, 'Nabu takes over the clipboard').toBe(true);
    expect(ev.nabu!.blocks).toEqual([{
      type: 'paragraph',
      partial: 'both',
      props: {},
      delta: [
        { insert: 'llo', attributes: { bold: true } },
        { insert: ' ' },
        { insert: 'wor', attributes: { link: 'https://x.com/a?b=1&c=2' } },
      ],
    }]);
    // html: semantic marks, the href is attribute-escaped
    expect(ev.html).toBe('<p><strong>llo</strong> <a href="https://x.com/a?b=1&amp;c=2">wor</a></p>');
    // CURRENT: text/plain is MARKDOWN (not the visible text): **bold**, [label](href), blocks joined by a blank line
    expect(ev.text).toBe('**llo** [wor](https://x.com/a?b=1&c=2)');
    // copy never touches the document
    expect(await flat(page)).toBe('p(hello world)');
  });

  test('2 · from the middle of paragraph 1 to the middle of paragraph 3', async ({ page }) => {
    await buildBlocks(page, [Para('first one'), Para('second'), Para('third para')]);
    await selectRange(page, 'first one', 3, 'third para', 5);
    const ev = await copy(page);

    expect(ev.nabu!.blocks.map((b) => [b.type, b.partial])).toEqual([['paragraph', 'start'], ['paragraph', false], ['paragraph', 'end']]);
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['st one', 'second', 'third']);
    expect(ev.html).toBe('<p>st one</p>\n<p>second</p>\n<p>third</p>');
    expect(ev.text).toBe('st one\n\nsecond\n\nthird');
    expect(await flat(page)).toBe('p(first one) ; p(second) ; p(third para)');
  });

  test('3 · heading + quote + code + callout + dialogue: types and props are preserved', async ({ page }) => {
    await buildTree(page, [H('Title', 2), Q('quote'), Code('a\nb', 'js'), C('call', 'tip'), D('line one')] as TreeSpec[]);
    await selectRange(page, 'Title', 0, 'line one', -1);
    const ev = await copy(page);

    expect(ev.nabu!.blocks.map((b) => b.type)).toEqual(['heading', 'blockquote', 'code', 'callout', 'dialogue']);
    expect(ev.nabu!.blocks[0].props).toEqual({ level: 2 });
    expect(ev.nabu!.blocks[2].props).toEqual({ language: 'js' });
    expect(ev.nabu!.blocks[3].props).toEqual({ variant: 'tip' });
    // CURRENT: the first / last block of the selection carry partial 'start' / 'end' even when fully covered
    expect(ev.nabu!.blocks.map((b) => b.partial)).toEqual(['start', false, false, false, 'end']);
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['Title', 'quote', 'a\nb', 'call', 'line one']);
    expect(ev.html).toBe([
      '<h2>Title</h2>',
      '<blockquote>quote</blockquote>',
      '<pre><code>a\nb</code></pre>',
      '<aside class="callout callout-tip" data-callout="tip">call</aside>',
      '<p>line one</p>', // CURRENT: Dialogue has no toHtml(), it falls back to a plain <p>
    ].join('\n'));
    expect(ev.text).toBe([
      '## Title',
      '> quote',
      '```js\na\nb\n```',
      '> [!TIP]\n> call',
      '-- line one',
    ].join('\n\n'));
  });

  test('4 · selection inside a nested list, from item "alpha" (has a sublist) to nested "two": no item text is lost', async ({ page }) => {
    await buildDoc(page, [UL(I('top'), I('alpha', UL(I('one'), I('two'), I('three'))))]);
    await selectRange(page, 'alpha', 2, 'two', 1); // "pha", "one", "t"
    const ev = await copy(page);

    // BROKEN: only `list-item(start)"pha"` is emitted — the sublist items "one" and "t" are dropped, because the LCA of the
    // two boundary blocks is "alpha" itself, and MegaBlock.serializeForClipboard serializes a boundary hybrid block
    // as text only, ignoring the children that lie inside the selection (megablock.svelte.js:107-121).
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['pha', 'one', 't']);
    expectTextInAllPayloads(ev, ['pha', 'one', 't']);
    expect(ev.html).toContain('<ul>');
    expect(await outline(page)).toBe('ul[top, alpha > ul[one, two, three]]');
  });

  test('5 · P-29: from inside "x1" to inside nested "S3": item "a" keeps its text', async ({ page }) => {
    await buildDoc(page, [UL(I('x1'), I('a', UL(I('s1'), I('s2'), I('S3'))))]);
    await selectRange(page, 'x1', 1, 'S3', 1); // "1", whole a, s1, s2, "S"
    const ev = await copy(page);

    // BROKEN (P-29): the item "a" is emitted as `list-item{children:[list]}` with NO delta -> an EMPTY item ("- " in
    // markdown, `<li><ul>` in html). MegaBlock.serializeForClipboard "pure container" branch (megablock.svelte.js:123-159)
    // returns `{type, props, children}` for a hybrid block (list-item) that is neither a boundary nor fully selected.
    expect(frag(ev)).toHaveLength(1);
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['1', 'a', 's1', 's2', 'S']);
    expectTextInAllPayloads(ev, ['1', 'a', 's1', 's2', 'S']);
    expect(ev.text).toBe('- 1\n- a\n  - s1\n  - s2\n  - S');
  });

  test('6 · paragraph -> divider -> paragraph, and paragraph -> image -> paragraph: void blocks are copied', async ({ page }) => {
    const ref = 'data:image/png;base64,AAAA';
    await buildTree(page, [Pp('before'), Hr(), Pp('after'), { type: 'image', props: { ref, alt: 'pic' } }, Pp('end')] as TreeSpec[]);

    await selectRange(page, 'before', 2, 'after', 2);
    const a = await copy(page);
    expect(a.nabu!.blocks.map((b) => [b.type, b.partial])).toEqual([['paragraph', 'start'], ['divider', false], ['paragraph', 'end']]);
    expect(fragTexts(a.nabu!.blocks)).toEqual(['fore', 'af']);
    expect(a.html).toBe('<p>fore</p>\n<hr>\n<p>af</p>');
    expect(a.text).toBe('fore\n\n---\n\naf');

    await selectRange(page, 'after', 2, 'end', 2);
    const b = await copy(page);
    expect(b.nabu!.blocks.map((x) => x.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(b.nabu!.blocks[1].props).toEqual({ ref, alt: 'pic' });
    expect(b.html).toBe(`<p>ter</p>\n<img src="${ref}" alt="pic">\n<p>en</p>`);
    expect(b.text).toBe(`ter\n\n![pic](${ref})\n\nen`);
    expect(await tree(page)).toBe('p(before) ; hr ; p(after) ; image(∅) ; p(end)');
  });

  test('7a · selection from a paragraph INTO an expanded toggle header: header text kept, body not selected -> not copied', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body1'), Pp('body2')], false), Pp('after')]);
    await selectRange(page, 'before', 2, 'Head', 2);
    const ev = await copy(page);

    expect(ev.nabu!.blocks.map((b) => [b.type, b.partial])).toEqual([['paragraph', 'start'], ['toggle', 'end']]);
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['fore', 'He']);
    expect(ev.html).toContain('<summary>He</summary>');
    expect(ev.html).not.toContain('body1');
    expect(ev.text).toContain('<summary>He</summary>'); // CURRENT: a toggle is exported as <details><summary> in text/plain too
  });

  test('7b · selection from a toggle header into its expanded body', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body1'), Pp('body2')], false), Pp('after')]);
    await selectRange(page, 'Head', 2, 'body2', 2);
    const ev = await copy(page);

    // header tail + both body paragraphs (second one partial) must all be there
    expectTextInAllPayloads(ev, ['ad', 'body1', 'bo']);
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['ad', 'body1', 'bo']);
    expect(await tree(page)).toBe('p(before) ; toggle▾(Head){p(body1) p(body2)} ; p(after)');
  });

  test('7c · selection spanning a COLLAPSED toggle: the hidden body is copied along with the header', async ({ page }) => {
    await buildTree(page, [Pp('before'), Tog('Head', [Pp('body1'), Pp('body2')], true), Pp('after')]);
    await selectRange(page, 'before', 2, 'after', 2);
    const ev = await copy(page);

    // CURRENT: a toggle fully inside the selection is copied with its whole body, collapsed or not (nothing lost)
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['fore', 'Head', 'body1', 'body2', 'af']);
    expectTextInAllPayloads(ev, ['Head', 'body1', 'body2']);
    // CURRENT: the `collapsed` flag is not part of the fragment props, so the copy re-opens as an expanded <details open>
    expect(ev.nabu!.blocks[1].props).toEqual({});
    expect(ev.html).toContain('<details open><summary>Head</summary>');
    expect(await tree(page)).toBe('p(before) ; toggle▸(Head){p(body1) p(body2)} ; p(after)');
  });

  test('8 · todo list: `checked` is preserved in the fragment, `- [x]` in markdown', async ({ page }) => {
    await buildDoc(page, [TODO({ text: 't1', checked: true }, { text: 't2', checked: false }, { text: 't3', checked: true })]);
    expect(await outline(page)).toBe('todo[[x] t1, [ ] t2, [x] t3]'); // fixture sanity
    await selectRange(page, 't1', 0, 't3', -1);
    const ev = await copy(page);

    expect(ev.nabu!.blocks[0].type).toBe('list');
    expect(ev.nabu!.blocks[0].props).toEqual({ listType: 'todo' });
    // BROKEN: every item is emitted with `props: {}` -> all items come out UNCHECKED. ListItem does not override
    // `clipboardProps` (megablock.svelte.js:83 returns {}), so `checked` is never serialized; the markdown is
    // "- [ ] t1 / - [ ] t2 / - [ ] t3" and the html has no `checked` attribute.
    expect(ev.nabu!.blocks[0].children.map((c: any) => c.props?.checked)).toEqual([true, false, true]);
    expect(ev.text).toBe('- [x] t1\n- [ ] t2\n- [x] t3');
    expect(ev.html).toBe(
      '<ul class="contains-task-list"><li><input type="checkbox" disabled checked> t1</li>'
      + '<li><input type="checkbox" disabled> t2</li><li><input type="checkbox" disabled checked> t3</li></ul>',
    );
  });

  test('9 · ordered list starting at 3, copying items 2-3', async ({ page }) => {
    await page.evaluate(async () => {
      const n = (window as any).nabu;
      for (const c of [...n.children]) n.delete(c);
      const l = n.insert('list', { listType: 'ordered', start: 3 }, null, 0);
      ['i1', 'i2', 'i3', 'i4'].forEach((t, i) => n.insert('list-item', { text: t }, l.id, i));
      await n.commit();
      n.undoManager.clear();
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-block-type="list-item"]').length === 4);
    await selectRange(page, 'i2', 0, 'i3', -1);
    const ev = await copy(page);

    expect(ev.nabu!.blocks).toHaveLength(1);
    expect(ev.nabu!.blocks[0].type).toBe('list');
    expect(fragTexts(ev.nabu!.blocks)).toEqual(['i2', 'i3']);
    // CURRENT: the list's own `start` (3) is copied as is, NOT shifted by the dropped first item: the copied items are
    // numbered 3, 4 although they were items 4, 5 of the source. No text is lost; only the numbering restarts at 3.
    expect(ev.nabu!.blocks[0].props).toEqual({ listType: 'ordered', start: 3 });
    expect(ev.text).toBe('3. i2\n4. i3');
    expect(ev.html).toBe('<ol start="3"><li>i2</li><li>i3</li></ol>');
  });

  test('15 · partial lines inside a code block: text/plain is the code wrapped in a markdown fence', async ({ page }) => {
    const src = 'const a = 1;\nif (a < b && c > d) {\n  run();\n}';
    await buildTree(page, [Code(src, 'js')]);
    await selectRange(page, src, 6, src, src.indexOf('run') + 1); // "a = 1;\nif (...) {\n  r"
    const ev = await copy(page);

    const picked = src.slice(6, src.indexOf('run') + 1);
    expect(ev.nabu!.blocks).toEqual([{ type: 'code', partial: 'both', props: { language: 'js' }, delta: [{ insert: picked }] }]);
    // CURRENT: text/plain is MARKDOWN: the code is wrapped in a ```js fence (not the raw code). Pasting into a plain-text
    // field gives the fence lines too.
    expect(ev.text).toBe('```js\n' + picked + '\n```');
    // html: <pre><code>, and the code's `<`, `>`, `&` are escaped
    expect(ev.html).toBe('<pre><code>' + picked.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
    expect(await tree(page)).toBe(`code:js(${src.replace(/\n/g, '\\n')})`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. Security of the copied HTML
// ═══════════════════════════════════════════════════════════════════════════

test.describe('B · security of the text/html payload', () => {
  test('10a · paragraph TEXT that looks like HTML is escaped (no live tag / attribute)', async ({ page }) => {
    const t1 = '<img src=x onerror=alert(1)>';
    const t2 = '<script>x</script>';
    await buildBlocks(page, [Para(t1), Para(t2)]);
    await selectRange(page, t1, 0, t2, -1);
    const ev = await copy(page);

    expect(ev.html).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>\n<p>&lt;script&gt;x&lt;/script&gt;</p>');
    const insp = await inspectHtml(page, ev.html);
    expect(insp.live).toEqual([]);
    expect(insp.text).toBe(t1 + '\n' + t2); // the text survives literally (blocks are newline-joined)
    expect(ev.text).toBe(t1 + '\n\n' + t2); // text/plain keeps the literal characters (correct: it is not HTML)
    expect(fragTexts(ev.nabu!.blocks)).toEqual([t1, t2]);
  });

  test('10b · a link whose href is `javascript:` must not be a live link in the copied HTML', async ({ page }) => {
    await buildBlocks(page, [Para('click me')]);
    await mark(page, 'click me', 0, 8, 'link', 'javascript:alert(1)'); // model-level insert (the UI may refuse it)
    await selectRange(page, 'click me', 0, 'click me', -1);
    const ev = await copy(page);

    // BROKEN: deltaToHtml writes `<a href="javascript:alert(1)">click me</a>` verbatim (only &,<,> are escaped, the
    // URL scheme is not checked) — text-behavior deltaToHtml, text.behavior.svelte.js:36. Pasting that HTML into
    // any rich-text target yields a clickable javascript: link.
    const insp = await inspectHtml(page, ev.html);
    expect(insp.live, `html: ${ev.html}`).toEqual([]);
    expect(insp.text).toBe('click me'); // the label must survive, whatever happens to the href
  });

  test('10c · a link href containing a double quote cannot break out of the href attribute', async ({ page }) => {
    await buildBlocks(page, [Para('link')]);
    await mark(page, 'link', 0, 4, 'link', 'https://x.com/" onmouseover="alert(1)');
    await selectRange(page, 'link', 0, 'link', -1);
    const ev = await copy(page);

    // BROKEN: escapeHtml (text.behavior.svelte.js:13) escapes & < > but NOT the double quote, so the attribute value is
    // closed early and an `onmouseover` attribute is injected: <a href="https://x.com/" onmouseover="alert(1)">.
    const insp = await inspectHtml(page, ev.html);
    expect(insp.live, `html: ${ev.html}`).toEqual([]);
    expect(insp.hrefs).toEqual(['https://x.com/" onmouseover="alert(1)']);
  });

  test('10d · dialogue text that looks like HTML is escaped', async ({ page }) => {
    const t = '<b onclick=alert(1)>d</b>';
    await buildBlocks(page, [D(t)]);
    await selectRange(page, t, 0, t, -1);
    const ev = await copy(page);

    // BROKEN: Dialogue defines no toHtml(); handleCopy falls back to `<p>${text}</p>` with the RAW text
    // (nabu.svelte.js:1092-1094) -> a live <b onclick> element in the copied HTML.
    const insp = await inspectHtml(page, ev.html);
    expect(insp.live, `html: ${ev.html}`).toEqual([]);
    expect(insp.text).toBe(t);
  });

  test('10e · image alt / ref containing quotes and tags cannot inject markup', async ({ page }) => {
    const ref = 'x" onerror="alert(1)';
    const alt = '"><script>alert(1)</script>';
    await buildTree(page, [Pp('a'), { type: 'image', props: { ref, alt } }, Pp('b')] as TreeSpec[]);
    await selectRange(page, 'a', 0, 'b', 1);
    const ev = await copy(page);

    expect(ev.nabu!.blocks[1].props).toEqual({ ref, alt }); // the model payload is verbatim, as it should be
    // BROKEN: ImageBlock.toHtml concatenates ref / alt into the attributes unescaped (image.svelte.js:46):
    // <img src="x" onerror="alert(1)" alt=""><script>alert(1)</script>">
    const insp = await inspectHtml(page, ev.html);
    expect(insp.live, `html: ${ev.html}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. CUT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('C · cut', () => {
  test('11a · Ctrl+A, copy: the whole document; Ctrl+X: one empty paragraph, caret usable', async ({ page }) => {
    await buildBlocks(page, [Para('hello world'), H('T'), Q('q')]);
    await focusAt(page, 'hello world', 2);
    await selectAll(page);

    const c = await copy(page);
    expect(c.nabu!.blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'blockquote']);
    expect(fragTexts(c.nabu!.blocks)).toEqual(['hello world', 'T', 'q']);
    expect(c.text).toBe('hello world\n\n# T\n\n> q');
    expect(await flat(page)).toBe('p(hello world) ; h1(T) ; q(q)'); // copy leaves the document alone

    const x = await cut(page);
    expect(x.type).toBe('cut');
    expect(x.nabu).toEqual(c.nabu); // same payload as the copy
    expect(x.text).toBe(c.text);
    await expect.poll(() => flat(page)).toBe('p(∅)');
    expect(await caret(page)).toBe('|');
    await page.keyboard.type('Z');
    expect(await flat(page)).toBe('p(Z)');
    expect(await violations(page)).toEqual([]);
  });

  test('11b · Ctrl+A, Ctrl+X, then ONE Ctrl+Z restores the whole document', async ({ page }) => {
    await buildBlocks(page, [Para('hello world'), H('T'), Q('q')]);
    await focusAt(page, 'hello world', 2);
    await selectAll(page);
    await cut(page);
    await expect.poll(() => flat(page)).toBe('p(∅)');

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(hello world) ; h1(T) ; q(q)');
    expect(await violations(page)).toEqual([]);
    await redo(page);
    await expect.poll(() => flat(page)).toBe('p(∅)');
  });

  test('12 · cut mid p1 -> mid p3: head + tail merged, one undo restores, redo re-cuts', async ({ page }) => {
    await buildBlocks(page, [Para('hello world'), Para('second'), Para('third para')]);
    await selectRange(page, 'hello world', 3, 'third para', 5);
    const ev = await cut(page);

    expect(fragTexts(ev.nabu!.blocks)).toEqual(['lo world', 'second', 'third']);
    expect(ev.text).toBe('lo world\n\nsecond\n\nthird');
    await expect.poll(() => flat(page)).toBe('p(hel para)');
    // BROKEN: the caret lands at the START of the merged block ("|hel para") instead of at the cut junction ("hel| para",
    // where Backspace on the same selection puts it): the next keystroke is inserted at the wrong place. Suspected:
    // deleteSelectionContent computes `startOffset` for a multi-block selection (container.utils.js:259) as 0.
    expect.soft(await caret(page), 'caret at the cut junction').toBe('hel| para');
    expect(await violations(page)).toEqual([]);

    await undo(page);
    await expect.poll(() => flat(page)).toBe('p(hello world) ; p(second) ; p(third para)');
    expect(await violations(page)).toEqual([]);
    await redo(page);
    await expect.poll(() => flat(page)).toBe('p(hel para)');
  });

  test('13 · cut across nested-list levels: valid tree, no stray empty list, one undo restores', async ({ page }) => {
    const ORIGINAL = 'ul[x, a > ul[s1, s2, s3], z]';
    const cases: Array<[string, number, string, number, string[]]> = [
      // [from block, offset, to block, offset, texts that must survive (order-insensitive)]
      ['x', 1, 's2', 1, ['x', '2', 's3', 'z']],
      ['a', 0, 'z', 1, ['x']],
      ['s1', 1, 's3', 1, ['x', 'a', 's', '3', 'z']],
    ];
    for (const [fb, fo, tb, to, survive] of cases) {
      const label = `${fb}@${fo} -> ${tb}@${to}`;
      await buildDoc(page, [UL(I('x'), I('a', UL(I('s1'), I('s2'), I('s3'))), I('z'))]);
      expect(await outline(page)).toBe(ORIGINAL);
      await selectRange(page, fb, fo, tb, to);
      await cut(page);

      // BROKEN: the cut tears the tree down — `ul[]`, an empty list, Block instances / DOM out of sync with the tree and
      // "Text is deleted. You cannot apply the op on a deleted container" page errors — while Backspace on the SAME
      // selection is fine. Cause: deleteSelectionContent (container.utils.js:246) destroys `startOfEndSpine` unconditionally
      // (it is the root list shared by both boundaries), where handleContainerBeforeInput guards it with
      // `startOfEndSpine !== startOfStartSpine` (container.utils.js:218-226).
      expect.soft(await violations(page), `violations after cut ${label}`).toEqual([]);
      const left = (await allText(page)).filter(Boolean);
      for (const s of survive) expect.soft(left.join('|'), `text "${s}" kept after cut ${label}`).toContain(s);

      await undo(page);
      expect.soft(await outline(page), `undo restores after cut ${label}`).toBe(ORIGINAL);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. Collapsed caret
// ═══════════════════════════════════════════════════════════════════════════

test.describe('D · collapsed caret', () => {
  test('14 · copy writes nothing, cut is a no-op (no exception, one undo step untouched)', async ({ page }) => {
    await buildBlocks(page, [Para('abc'), Para('def')]);
    await focusAt(page, 'abc', 1);

    const c = await copy(page);
    // CURRENT: the handler returns early WITHOUT preventDefault and writes no payload (the browser then copies the empty selection)
    expect(c.nabu).toBeNull();
    expect([c.html, c.text]).toEqual(['', '']);
    expect(c.defaultPrevented).toBe(false);

    const x = await cut(page);
    expect(x.nabu).toBeNull();
    expect([x.html, x.text]).toEqual(['', '']);
    expect(x.defaultPrevented).toBe(false);

    expect(await flat(page)).toBe('p(abc) ; p(def)');
    expect(await caret(page)).toBe('a|bc');
    await page.keyboard.type('X'); // caret still usable
    expect(await flat(page)).toBe('p(aXbc) ; p(def)');
    await press(page, 'Control+z');
    await expect.poll(() => flat(page)).toBe('p(abc) ; p(def)'); // the no-op cut left no extra undo step
  });
});
