// @ts-nocheck
/**
 * Markdown, BLOCK level (P-59): the rules each block declares (`markdownRules` / `fromMarkdown`) driven by the interpreter
 * loop of the markdown paste extension. Each case: markdown -> an outline of the PasteBlocks, in paste mode (one non-blank
 * line = one block) and/or on import (`joinLines`: CommonMark paragraph joining).
 *
 * Outline: `h2(text)` `p(text)` `q(text)` `hr` `code[lang](body)` `callout[note](text)` `dialogue(text)` `img(ref)`
 *          `ul[li(a), li(b)[ol@3[li(c)]]]` `todo[li(a)+, li(b)-]`   (TAB shown as `⇥`, a line break as `⏎`)
 */

import { describe, it, expect } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { BlockquoteExtension } from '$lib/blocks/blockquote/index.js';
import { DividerExtension } from '$lib/blocks/divider/index.js';
import { CodeExtension } from '$lib/blocks/code/index.js';
import { CalloutExtension } from '$lib/blocks/callout/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { DialogueExtension } from '$lib/blocks/dialogue/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';

const engine = new Nabu({
    extensions: [ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ImageExtension, DialogueExtension, ListExtension, ListItemExtension, MarkdownPasteExtension],
});
const interpreter = MarkdownPasteExtension.pasteInterpreters[0];

const text = (pb) => (pb.delta ?? []).map((op) => {
    const marks = Object.keys(op.attributes ?? {}).map((k) => ({ bold: 'b', italic: 'i', code: 'c', strikethrough: 's', underline: 'u', link: 'a' }[k] ?? k)).join('');
    const s = op.insert.replace(/\n/g, '⏎').replace(/\t/g, '⇥');
    return marks ? `{${marks}:${s}}` : s;
}).join('');

function outline(pb) {
    switch (pb.type) {
        case 'heading': return `h${pb.props.level}(${text(pb)})`;
        case 'paragraph': return `p(${text(pb)})`;
        case 'blockquote': return `q(${text(pb)})`;
        case 'divider': return 'hr';
        case 'code': return `code[${pb.props.language ?? ''}](${text(pb).replace(/⏎/g, '|')})`;
        case 'callout': return `callout[${pb.props.variant}](${text(pb)})`;
        case 'dialogue': return `dialogue(${text(pb)})`;
        case 'image': return `img(${pb.props.ref})`;
        case 'list': {
            const t = pb.props.listType;
            const name = t === 'ordered' ? 'ol' : t === 'todo' ? 'todo' : 'ul';
            return `${name}${pb.props.start !== undefined ? '@' + pb.props.start : ''}[${pb.children.map(outline).join(', ')}]`;
        }
        case 'list-item': {
            const check = pb.props?.checked === undefined ? '' : pb.props.checked ? '+' : '-';
            return `li(${text(pb)})${check}${pb.children ? '[' + pb.children.map(outline).join(', ') + ']' : ''}`;
        }
        default: return `?${pb.type}`;
    }
}

const run = (md, joinLines) => (interpreter.interpret(md, engine, { joinLines })?.blocks ?? []).map(outline).join(' ; ');
/** paste mode */
const paste = (md) => run(md, false);
/** import mode */
const imp = (md) => run(md, true);

function table(title, cases, fn) {
    describe(title, () => {
        for (const [name, input, expected] of cases) {
            it(`${name}: ${JSON.stringify(input)}`, () => {
                expect(fn(input)).toBe(expected);
            });
        }
    });
}

// ── 1. Setext headings ───────────────────────────────────────────────────────

describe('setext headings', () => {
    const both = [
        ['h1 with =', 'Title\n===', 'h1(Title)'],
        ['h2 with -', 'Title\n---', 'h2(Title)'],
        ['long underline', 'Title\n==========', 'h1(Title)'],
        ['one dash underline', 'Title\n-', 'h2(Title)'],
        ['underline with trailing spaces', 'Title\n---  ', 'h2(Title)'],
        ['inline marks in the text', '**Bold** title\n===', 'h1({b:Bold} title)'],
        ['followed by a paragraph', 'Title\n===\n\ntext', 'h1(Title) ; p(text)'],
        ['a --- after a blank line stays a divider', 'Title\n\n---\n\ntext', 'p(Title) ; hr ; p(text)'],
        ['--- at the very start is a divider', '---\ntext', 'hr ; p(text)'],
        ['a list item is not a heading text', '- item\n---', 'ul[li(item)] ; hr'],
        ['a dialogue line is not a heading text', '-- hello\n---', 'dialogue(hello) ; hr'],
        ['an ATX heading is not a heading text', '# Title\n---', 'h1(Title) ; hr'],
        ['a quote is not a heading text', '> quote\n---', 'q(quote) ; hr'],
        ['=== alone is a paragraph', '===', 'p(===)'],
        ['=== after a blank line is a paragraph', 'text\n\n===', 'p(text) ; p(===)'],
    ];
    table('paste', both, paste);
    table('import', both, imp);

    it('paste: the heading text is ONE line, the lines above stay paragraphs', () => {
        expect(paste('one\ntwo\n===')).toBe('p(one) ; h1(two)');
    });
    it('import: the heading text is the whole paragraph above (CommonMark)', () => {
        expect(imp('one\ntwo\n===')).toBe('h1(one two)');
        expect(imp('one\ntwo\n---')).toBe('h2(one two)');
    });
    it('import: a block start ends the paragraph, the underline then belongs to nobody', () => {
        expect(imp('text\n> quote\n---')).toBe('p(text) ; q(quote) ; hr');
    });
});

// ── 2. Code fences ───────────────────────────────────────────────────────────

describe('code fences', () => {
    const cases = [
        ['backticks', '```\ncode\n```', 'code[](code)'],
        ['tildes', '~~~\ncode\n~~~', 'code[](code)'],
        ['language', '```js\nlet a = 1;\n```', 'code[js](let a = 1;)'],
        ['tilde language', '~~~python\nx = 1\n~~~', 'code[python](x = 1)'],
        ['info string: the first word is the language', '```js {highlight: 2} title="a"\nx\n```', 'code[js](x)'],
        ['a language with symbols', '```c++\nx\n```', 'code[c++](x)'],
        ['longer fence', '````\n```\ninner\n```\n````', 'code[](```|inner|```)'],
        ['a shorter closing fence does not close', '````js\na\n```\nb\n````', 'code[js](a|```|b)'],
        ['a longer closing fence closes', '```\na\n`````', 'code[](a)'],
        ['a tilde does not close a backtick fence', '```\na\n~~~\nb\n```', 'code[](a|~~~|b)'],
        ['a backtick does not close a tilde fence', '~~~\na\n```\nb\n~~~', 'code[](a|```|b)'],
        ['unclosed: runs to the end', '```js\na\nb', 'code[js](a|b)'],
        ['blank lines are kept', '```\na\n\n\nb\n```', 'code[](a|||b)'],
        ['no inline parsing', '```\n**not bold** `x` [a](b) # not a heading\n```', 'code[](**not bold** `x` [a](b) # not a heading)'],
        ['no block parsing', '```\n- a\n> b\n---\n```', 'code[](- a|> b|---)'],
        ['text after the block', '```\na\n```\nafter', 'code[](a) ; p(after)'],
        ['closing fence may have trailing spaces', '```\na\n```  \nafter', 'code[](a) ; p(after)'],
        ['empty code block', '```\n```', 'code[]()'],
        ['indented fence strips its indent from the content', '  ```\n  a\n    b\n  ```', 'code[](a|  b)'],
        ['inline code on one line is not a fence', '```code``` here', 'p({c:code} here)'],
        ['a definition-looking line inside a fence is code', '```\n[a]: http://x\n```', 'code[]([a]: http://x)'],
    ];
    table('paste', cases, paste);
    table('import', cases, imp);

    it('import: a fence interrupts a paragraph', () => {
        expect(imp('Install:\n```bash\nnpm i\n```\nthen run')).toBe('p(Install:) ; code[bash](npm i) ; p(then run)');
    });
});

// ── 3. Blockquotes ───────────────────────────────────────────────────────────

describe('blockquotes', () => {
    const cases = [
        ['simple', '> quote', 'q(quote)'],
        ['no space after >', '>quote', 'q(quote)'],
        ['marks', '> a **b**', 'q(a {b:b})'],
        ['empty marker lines split paragraphs', '> a\n>\n> b', 'q(a) ; q(b)'],
        ['text after', '> a\n\nb', 'q(a) ; p(b)'],
        ['a list inside degrades to a list', '> - a\n> - b', 'ul[li(a), li(b)]'],
        ['a heading inside degrades to a heading', '> # Title\n> text', 'h1(Title) ; q(text)'],
        ['a fenced code inside degrades to code (blank lines kept)', '> ```js\n> a\n>\n> b\n> ```', 'code[js](a||b)'],
        ['a divider inside', '> a\n> ---\n> b', 'h2(a) ; q(b)'],
        ['a callout is still a callout', '> [!NOTE]\n> body', 'callout[note](body)'],
    ];
    table('paste', cases, paste);
    table('import', cases, imp);

    it('nested quotes are flattened into one quote, the text is kept', () => {
        expect(paste('> a\n> > b\n> > > c')).toBe('q(a⏎b⏎c)');
        expect(imp('> a\n> > b\n> > > c')).toBe('q(a b c)');
        expect(paste('>> deep')).toBe('q(deep)');
        expect(paste('> > x')).toBe('q(x)');
    });
    it('paste: the lines of a quote keep their line break, import joins them (CommonMark)', () => {
        expect(paste('> a\n> b')).toBe('q(a⏎b)');
        expect(imp('> a\n> b')).toBe('q(a b)');
    });
    it('lazy continuation: import joins the unprefixed line, a paste does not (one line = one block)', () => {
        expect(imp('> a\nb\nc')).toBe('q(a b c)');
        expect(paste('> a\nb')).toBe('q(a) ; p(b)');
    });
    it('lazy continuation after a hard break, in a paste too (what serialize produces)', () => {
        expect(paste('> a\\\nb')).toBe('q(a⏎b)');
        expect(paste('> a  \nb')).toBe('q(a⏎b)');
    });
    it('a block start ends the quote even on import', () => {
        expect(imp('> a\n- item')).toBe('q(a) ; ul[li(item)]');
        expect(imp('> a\n# H')).toBe('q(a) ; h1(H)');
    });
    it('a lazy line does not continue a quote whose last line starts a block', () => {
        expect(imp('> - a\nb')).toBe('ul[li(a)] ; p(b)');
    });
    it('callout: body lines, variants, unknown variant', () => {
        expect(paste('> [!TIP]\n> one\n> two')).toBe('callout[tip](one⏎two)');
        expect(paste('> [!warning]\n> x')).toBe('callout[warning](x)');
        expect(paste('> [!CAUTION]')).toBe('callout[caution]()');
    });
});

// ── 4. Lists ─────────────────────────────────────────────────────────────────

describe('lists', () => {
    const cases = [
        ['- marker', '- a\n- b', 'ul[li(a), li(b)]'],
        ['* marker', '* a\n* b', 'ul[li(a), li(b)]'],
        ['+ marker', '+ a\n+ b', 'ul[li(a), li(b)]'],
        ['mixed bullet characters stay one list', '- a\n* b\n+ c', 'ul[li(a), li(b), li(c)]'],
        ['1. marker', '1. a\n2. b', 'ol[li(a), li(b)]'],
        ['1) marker', '1) a\n2) b', 'ol[li(a), li(b)]'],
        ['start from the first number', '3. a\n4. b', 'ol@3[li(a), li(b)]'],
        ['start 0', '0. a\n1. b', 'ol@0[li(a), li(b)]'],
        ['start with a paren', '5) a\n6) b', 'ol@5[li(a), li(b)]'],
        ['2 spaces nesting', '- a\n  - b\n    - c', 'ul[li(a)[ul[li(b)[ul[li(c)]]]]]'],
        ['4 spaces nesting', '- a\n    - b\n        - c', 'ul[li(a)[ul[li(b)[ul[li(c)]]]]]'],
        ['TAB nesting', '- a\n\t- b\n\t\t- c', 'ul[li(a)[ul[li(b)[ul[li(c)]]]]]'],
        ['mixed indentation is tolerated', '- a\n\t- b\n    - c\n- d', 'ul[li(a)[ul[li(b), li(c)]], li(d)]'],
        ['back to a shallower level', '- a\n  - b\n    - c\n  - d\n- e', 'ul[li(a)[ul[li(b)[ul[li(c)]], li(d)]], li(e)]'],
        ['ordered in bullet', '- a\n  1. x\n  2. y', 'ul[li(a)[ol[li(x), li(y)]]]'],
        ['bullet then ordered at the same level are two lists', '- a\n1. b', 'ul[li(a)] ; ol[li(b)]'],
        ['ordered then bullet at the same level are two lists', '1. a\n- b', 'ol[li(a)] ; ul[li(b)]'],
        ['sublists of different types stay separate, in order', '- a\n  - s1\n  1. s2\n  - s3', 'ul[li(a)[ul[li(s1)], ol[li(s2)], ul[li(s3)]]]'],
        ['task items', '- [ ] a\n- [x] b\n- [X] c', 'todo[li(a)-, li(b)+, li(c)+]'],
        ['task with a * marker', '* [ ] a\n* [X] b', 'todo[li(a)-, li(b)+]'],
        ['task with a + marker and an ordered marker', '+ [x] a\n1. [ ] b', 'todo[li(a)+] ; todo[li(b)-]'],
        ['[] is an unchecked task', '- [] a', 'todo[li(a)-]'],
        ['[x]text is no task', '- [x]text', 'ul[li([x]text)]'],
        ['a task needs a bracket pair with a space or x', '- [y] a', 'ul[li([y] a)]'],
        ['nested tasks', '- [ ] a\n  - [x] b', 'todo[li(a)-[todo[li(b)+]]]'],
        ['inline marks', '- **a** and `b`', 'ul[li({b:a} and {c:b})]'],
        ['a bullet and its sublists then another list', '- a\n  - b\n\n1. c', 'ul[li(a)[ul[li(b)]]] ; ol[li(c)]'],
        ['loose list is one list', '- a\n\n- b\n\n\n- c', 'ul[li(a), li(b), li(c)]'],
        ['loose ordered list', '1. a\n\n2. b', 'ol[li(a), li(b)]'],
        ['empty item', '- \n- b', 'ul[li(), li(b)]'],
        ['a list item and a paragraph after a blank line', '- a\n\ntext', 'ul[li(a)] ; p(text)'],
        ['*emphasis* is not a bullet', '*em* text', 'p({i:em} text)'],
        ['a dash with no space is not a bullet', '-a', 'p(-a)'],
        ['1.5 is not an ordered marker', '1.5 apples', 'p(1.5 apples)'],
        ['a dialogue is not a bullet', '-- hello', 'dialogue(hello)'],
        ['a thematic break of spaced stars is a divider', '* * *', 'hr'],
        ['a thematic break of spaced dashes is a divider', '- - -', 'hr'],
        ['a divider ends a list', '- a\n---\n- b', 'ul[li(a)] ; hr ; ul[li(b)]'],
    ];
    table('paste', cases, paste);
    table('import', cases, imp);

    it('continuation paragraph under an item is appended with a line break (indented, also after a blank line)', () => {
        expect(paste('- a\n  more\n- b')).toBe('ul[li(a⏎more), li(b)]');
        expect(paste('- a\n\n  second paragraph\n- b')).toBe('ul[li(a⏎second paragraph), li(b)]');
        expect(paste('1. a\n   more\n   and more')).toBe('ol[li(a⏎more⏎and more)]');
        expect(imp('- a\n  more')).toBe('ul[li(a more)]');
        expect(imp('- a\n\n  second paragraph\n- b')).toBe('ul[li(a⏎second paragraph), li(b)]');
    });
    it('continuation under a nested item belongs to the right item', () => {
        expect(paste('- a\n  - b\n    cont of b\n\n  cont of a')).toBe('ul[li(a⏎cont of a)[ul[li(b⏎cont of b)]]]');
    });
    it('a fenced code in an item is kept verbatim as text of the item', () => {
        expect(paste('1. Install:\n   ```bash\n   npm i\n   ```\n2. Run')).toBe('ol[li(Install:⏎```bash⏎npm i⏎```), li(Run)]');
    });
    it('an unindented line after an item is a paragraph in a paste, a lazy continuation on import', () => {
        expect(paste('- a\nb')).toBe('ul[li(a)] ; p(b)');
        expect(imp('- a\nb')).toBe('ul[li(a b)]');
    });
    it('an unindented line after a hard break continues the item (what serialize produces)', () => {
        expect(paste('- a\\\nb\n- c')).toBe('ul[li(a⏎b), li(c)]');
    });
    it('import: a list interrupts a paragraph, an ordered one only when it starts at 1', () => {
        expect(imp('text\n- a')).toBe('p(text) ; ul[li(a)]');
        expect(imp('text\n1. a')).toBe('p(text) ; ol[li(a)]');
        expect(imp('text\n2. a')).toBe('p(text 2. a)');
    });
    it('a long document order is kept', () => {
        expect(paste('- a\n- b\n\n# T\n\n1. x')).toBe('ul[li(a), li(b)] ; h1(T) ; ol[li(x)]');
    });
});

// ── 5. GFM tables ────────────────────────────────────────────────────────────

describe('tables', () => {
    const cases = [
        ['header + body, delimiter row dropped', '| a | b |\n|---|---|\n| 1 | 2 |', 'p(a⇥b) ; p(1⇥2)'],
        ['alignment markers', '| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |', 'p(a⇥b⇥c) ; p(1⇥2⇥3)'],
        ['no edge pipes', 'a | b\n--|--\n1 | 2', 'p(a⇥b) ; p(1⇥2)'],
        ['inline marks in the cells', '| **a** | `b` |\n|---|---|\n| [l](https://x.example) | *i* |', 'p({b:a}⇥{c:b}) ; p({a:l}⇥{i:i})'],
        ['a short row is padded', '| a | b | c |\n|---|---|---|\n| 1 |', 'p(a⇥b⇥c) ; p(1⇥⇥)'],
        ['a long row is cut', '| a |\n|---|\n| 1 | 2 |', 'p(a) ; p(1)'],
        ['an escaped pipe stays in the cell', '| a | b |\n|---|---|\n| x \\| y | z |', 'p(a⇥b) ; p(x | y⇥z)'],
        ['the table ends at a blank line', '| a | b |\n|---|---|\n| 1 | 2 |\n\ntext', 'p(a⇥b) ; p(1⇥2) ; p(text)'],
        ['the table ends at a line without pipe', '| a | b |\n|---|---|\n| 1 | 2 |\ntext', 'p(a⇥b) ; p(1⇥2) ; p(text)'],
        ['a header only table', '| a | b |\n|---|---|', 'p(a⇥b)'],
        ['text before and after', 'intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\noutro', 'p(intro) ; p(a⇥b) ; p(1⇥2) ; p(outro)'],
        ['no delimiter row: plain text', '| a | b |\n| 1 | 2 |', 'p(| a | b |) ; p(| 1 | 2 |)'],
        ['a delimiter row with another width: plain text', '| a | b |\n|---|', 'p(| a | b |) ; p(|---|)'],
        ['a delimiter row without dashes: plain text', '| a | b |\n| x | y |\n', 'p(| a | b |) ; p(| x | y |)'],
        ['a single pipe line is text', 'a | b', 'p(a | b)'],
    ];
    table('paste', cases, paste);
    table('import', cases.filter(([name]) => !/no delimiter|another width|without dashes|single pipe/.test(name)), imp);

    it('import: a table interrupts a paragraph', () => {
        expect(imp('intro\n| a | b |\n|---|---|\n| 1 | 2 |')).toBe('p(intro) ; p(a⇥b) ; p(1⇥2)');
    });
    it('import: rows without a delimiter row are plain text, joined as a paragraph', () => {
        expect(imp('| a | b |\n| 1 | 2 |')).toBe('p(| a | b | | 1 | 2 |)');
    });
});

// ── 6. Footnotes, 7. HTML, 8. indented code ──────────────────────────────────

describe('footnotes stay literal text', () => {
    const cases = [
        ['reference', 'Text with a note[^1].', 'p(Text with a note[^1].)'],
        ['definition', '[^1]: The note.', 'p([^1]: The note.)'],
        ['reference + definition', 'See[^note].\n\n[^note]: Details here.', 'p(See[^note].) ; p([^note]: Details here.)'],
        ['a footnote definition is not a link definition', '[^1]: the note\n\n[^1]', 'p([^1]: the note) ; p([^1])'],
    ];
    table('paste', cases, paste);
    table('import', cases, imp);
});

describe('HTML is literal text', () => {
    const cases = [
        ['a div line', '<div>hello</div>', 'p(<div>hello</div>)'],
        ['opening and closing lines', '<div class="a">\n</div>', 'p(<div class="a">) ; p(</div>)'],
        ['a comment', '<!-- note -->', 'p(<!-- note -->)'],
        ['script is text', '<script>alert(1)</script>', 'p(<script>alert(1)</script>)'],
        ['an image tag is text, not an image', '<img src="x.png" onerror="alert(1)">', 'p(<img src="x.png" onerror="alert(1)">)'],
        ['inline html inside a sentence', 'a <b>bold</b> and <br> text', 'p(a <b>bold</b> and <br> text)'],
        ['details/summary', '<details><summary>Sum</summary>', 'p(<details><summary>Sum</summary>)'],
    ];
    table('paste', cases, paste);
    table('import', cases.filter(([name]) => !/opening and closing/.test(name)), imp);
    it('import: a multi-line html block is one literal paragraph, nothing dropped', () => {
        expect(imp('<div class="a">\n  <p>x</p>\n</div>')).toBe('p(<div class="a"> <p>x</p> </div>)');
    });
});

describe('indented text is not code', () => {
    const cases = [
        ['4 spaces', '    indented', 'p(indented)'],
        ['a tab', '\tindented', 'p(indented)'],
        ['looks like a heading', '    # not a heading', 'p(# not a heading)'],
        ['looks like a fence', '    ```\n    code\n    ```', 'p(```) ; p(code) ; p(```)'],
        ['looks like a quote', '    > not a quote', 'p(> not a quote)'],
        ['3 spaces still lead a heading', '   # Title', 'h1(Title)'],
        ['a short indent of plain text is kept in a paste (it is a fragment)', '  two', 'p(  two)'],
    ];
    table('paste', cases, paste);
    it('import: the indent of a paragraph is trimmed', () => {
        expect(imp('  two')).toBe('p(two)');
    });
    it('import: an indented continuation line joins its paragraph, trimmed', () => {
        expect(imp('a\n    b')).toBe('p(a b)');
    });
});

// ── 9. Line endings, BOM ─────────────────────────────────────────────────────

describe('line endings and BOM', () => {
    it('CRLF', () => {
        expect(paste('# T\r\n\r\ntext\r\n- a\r\n- b\r\n')).toBe('h1(T) ; p(text) ; ul[li(a), li(b)]');
    });
    it('CR only', () => {
        expect(paste('# T\r\rtext\r- a')).toBe('h1(T) ; p(text) ; ul[li(a)]');
    });
    it('BOM', () => {
        expect(paste('﻿# T\n\ntext')).toBe('h1(T) ; p(text)');
    });
    it('a fenced block with CRLF keeps its lines', () => {
        expect(paste('```js\r\na\r\n\r\nb\r\n```')).toBe('code[js](a||b)');
    });
    it('setext with CRLF', () => {
        expect(paste('Title\r\n=====\r\n')).toBe('h1(Title)');
    });
    it('tab-indented list from a CRLF document', () => {
        expect(paste('- a\r\n\t- b\r\n')).toBe('ul[li(a)[ul[li(b)]]]');
    });
});

// ── Mixed documents ──────────────────────────────────────────────────────────

describe('a README-like document', () => {
    const README = [
        'Project',
        '=======',
        '',
        'A **tiny** library.',
        '',
        'Install',
        '-------',
        '',
        '~~~bash',
        'npm i project',
        '~~~',
        '',
        '1. Add it',
        '\t- with npm',
        '\t- with bun',
        '2. Use it[^1]',
        '',
        '- [x] done',
        '- [ ] todo',
        '',
        '| name | type |',
        '|:-----|-----:|',
        '| `a`  | text |',
        '',
        '<div align="center">',
        '',
        '[^1]: The note.',
    ].join('\n');

    it('import', () => {
        expect(imp(README)).toBe([
            'h1(Project)', 'p(A {b:tiny} library.)', 'h2(Install)', 'code[bash](npm i project)',
            'ol[li(Add it)[ul[li(with npm), li(with bun)]], li(Use it[^1])]',
            'todo[li(done)+, li(todo)-]', 'p(name⇥type)', 'p({c:a}⇥text)', 'p(<div align="center">)', 'p([^1]: The note.)',
        ].join(' ; '));
    });
});
