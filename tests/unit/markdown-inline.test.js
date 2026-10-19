// @ts-nocheck
/**
 * Inline markdown (P-48): the parser behind markdown paste and `importMarkdown`, the block-level glue (reference
 * definitions, inline images) and the delta → markdown round trip.
 *
 * Each case: markdown → delta. `d('a', ['b', { bold: true }])` builds the expected delta: a string is plain text,
 * a pair is text + attributes.
 */

import { describe, it, expect } from 'vitest';
import { parseMarkdownInline, parseMarkdownSegments } from '$lib/paste/markdown.paste.js';
import { extractLinkDefinitions } from '$lib/paste/markdown-inline.js';
import { deltaToMarkdown } from '$lib/behaviors/text/text.behavior.svelte.js';
import { delimiterFlags } from '$lib/behaviors/text/markdown-syntax.js';

const d = (...parts) => parts.map((p) => (typeof p === 'string' ? { insert: p } : { insert: p[0], attributes: p[1] }));
const B = { bold: true };
const I = { italic: true };
const BI = { bold: true, italic: true };
const S = { strikethrough: true };
const C = { code: true };
const U = { underline: true };
const link = (href, extra = {}) => ({ link: href, ...extra });

/** Parse with the definitions found in `refs` (a markdown snippet of `[label]: url` lines). */
function withRefs(refs, text) {
    const { resolveRef } = extractLinkDefinitions(refs.split('\n'));
    return parseMarkdownInline(text, {}, { resolveRef });
}

function table(title, cases) {
    describe(title, () => {
        for (const [name, input, expected] of cases) {
            it(`${name}: ${JSON.stringify(input)}`, () => {
                expect(parseMarkdownInline(input)).toEqual(expected);
            });
        }
    });
}

table('plain text and marks (as before)', [
    ['plain', 'hello world', d('hello world')],
    ['empty', '', []],
    ['bold', 'a **b** c', d('a ', ['b', B], ' c')],
    ['italic *', 'a *b* c', d('a ', ['b', I], ' c')],
    ['italic _', 'a _b_ c', d('a ', ['b', I], ' c')],
    ['bold __', 'a __b__ c', d('a ', ['b', B], ' c')],
    ['bold italic ***', '***x***', d(['x', BI])],
    ['bold italic ___', '___x___', d(['x', BI])],
    ['strike', '~~gone~~', d(['gone', S])],
    ['underline tag', 'a <u>b</u> c', d('a ', ['b', U], ' c')],
    ['nested italic in bold', '**bold *it* still**', d(['bold ', B], ['it', { bold: true, italic: true }], [' still', B])],
    ['bold in italic', '*a **b** c*', d(['a ', I], ['b', BI], [' c', I])],
    ['adjacent marks', '**a***b*', d(['a', B], ['b', I])],
    ['strike with bold', '~~**x**~~', d(['x', { strikethrough: true, bold: true }])],
    ['code', 'use `x` here', d('use ', ['x', C], ' here')],
]);

table('emphasis flanking (same rules as the typing shortcuts)', [
    ['spaces inside stars stay literal', '2 * 3 * 4', d('2 * 3 * 4')],
    ['space after opener', '* not *', d('* not *')],
    ['space before closer', '*not *', d('*not *')],
    ['space inside bold', '** x **', d('** x **')],
    ['intraword underscores are literal', 'snake_case_name', d('snake_case_name')],
    ['intraword underscores around text', 'a_b_ c', d('a_b_ c')],
    ['__init__ after a word stays literal', 'foo__bar__baz', d('foo__bar__baz')],
    ['intraword stars emphasize', 'a*b*c', d('a', ['b', I], 'c')],
    ['unmatched opener is literal', '**oops', d('**oops')],
    ['unmatched closer is literal', 'oops**', d('oops**')],
    ['single tilde is literal', 'about ~5 and ~6', d('about ~5 and ~6')],
    ['triple tilde is literal', '~~~x~~~', d('~~~x~~~')],
    ['underscore italic at edges', '_a_', d(['a', I])],
    ['underscore after punctuation opens', '(_a_)', d('(', ['a', I], ')')],
    ['four stars nest bold in bold', '****x****', d(['x', B])],
    ['multiple of 3 rule', '*foo**bar*', d(['foo**bar', I])],
]);

table('backslash escapes', [
    ['star', '\\*not italic\\*', d('*not italic*')],
    ['underscore', 'a \\_b\\_ c', d('a _b_ c')],
    ['brackets', '\\[x\\]\\(y\\)', d('[x](y)')],
    ['hash', '\\# not a heading', d('# not a heading')],
    ['backtick', '\\`x\\`', d('`x`')],
    ['backslash', 'a \\\\ b', d('a \\ b')],
    ['tilde and pipe', '\\~\\~x\\~\\~ \\|', d('~~x~~ |')],
    ['escaped delimiter does not pair', '\\**a*', d('*', ['a', I])],
    ['backslash before a letter is literal', 'C:\\dir', d('C:\\dir')],
    ['trailing backslash is literal', 'end\\', d('end\\')],
    ['escaped angle', '\\<u>x\\</u>', d('<u>x</u>')],
    ['escaped bang before link', '\\![a](https://x.y)', d('!', ['a', link('https://x.y')])],
    ['escaped bracket kills the link', '\\[a](https://x.y)', d('[a](', ['https://x.y', link('https://x.y')], ')')],
]);

table('code spans', [
    ['protects emphasis', '`**not bold**`', d(['**not bold**', C])],
    ['protects links', '`[a](b)`', d(['[a](b)', C])],
    ['double backticks', '`` a ` b ``', d(['a ` b', C])],
    ['double backticks, edge backtick', '`` `x` ``', d(['`x`', C])],
    ['spaces kept inside', '`a  b`', d(['a  b', C])],
    ['one space stripped each side', '`  a  `', d([' a ', C])],
    ['only spaces are kept', '`  `', d(['  ', C])],
    ['unmatched backtick is literal', 'a ` b', d('a ` b')],
    ['mismatched runs are literal', '``a`', d('``a`')],
    ['escapes are literal inside', '`\\*`', d(['\\*', C])],
    ['code beats emphasis opener', '*a `b*` c*', d(['a ', I], ['b*', { italic: true, code: true }], [' c', I])],
    ['code inside bold', '**x `y` z**', d(['x ', B], ['y', { bold: true, code: true }], [' z', B])],
]);

table('inline links', [
    ['simple', '[text](https://a.b)', d(['text', link('https://a.b')])],
    ['inside a sentence', 'see [this](https://a.b) now', d('see ', ['this', link('https://a.b')], ' now')],
    ['with title "', '[t](https://a.b "the title")', d(['t', link('https://a.b')])],
    ["with title '", "[t](https://a.b 'the title')", d(['t', link('https://a.b')])],
    ['with title ()', '[t](https://a.b (the title))', d(['t', link('https://a.b')])],
    ['relative', '[t](./docs/x.md)', d(['t', link('./docs/x.md')])],
    ['fragment', '[t](#section)', d(['t', link('#section')])],
    ['mailto', '[mail](mailto:me@x.y)', d(['mail', link('mailto:me@x.y')])],
    ['marks inside the text', '[**bold** link](https://a.b)', d(['bold', link('https://a.b', B)], [' link', link('https://a.b')])],
    ['italic inside', '[a *b* c](u)', d(['a ', link('u')], ['b', link('u', I)], [' c', link('u')])],
    ['marks around the link', '**[t](u)**', d(['t', link('u', B)])],
    ['code inside the text', '[`code`](u)', d(['code', link('u', C)])],
    ['nested brackets in text', '[a [b] c](u)', d(['a [b] c', link('u')])],
    ['parentheses in the url', '[w](https://en.wikipedia.org/wiki/Foo_(bar))', d(['w', link('https://en.wikipedia.org/wiki/Foo_(bar)')])],
    ['parentheses then text', '([w](https://x.y/a_(b)))', d('(', ['w', link('https://x.y/a_(b)')], ')')],
    ['angle destination with spaces', '[t](<https://a.b/my file>)', d(['t', link('https://a.b/my file')])],
    ['angle destination with parens', '[t](<https://a.b/a)b>)', d(['t', link('https://a.b/a)b')])],
    ['escaped paren in the url', '[t](https://a.b/a\\)b)', d(['t', link('https://a.b/a)b')])],
    ['empty text', '[](https://a.b)', []],
    ['spaces around the destination', '[t](  https://a.b  )', d(['t', link('https://a.b')])],
    ['unclosed paren is literal', '[t](https://a.b', d('[t](', ['https://a.b', link('https://a.b')])],
    ['no destination is literal', '[just brackets]', d('[just brackets]')],
    ['links do not nest', '[a [b](u1) c](u2)', d('[a ', ['b', link('u1')], ' c](u2)')],
    ['underscore inside the url is not emphasis', '[t](https://a.b/x_y_z)', d(['t', link('https://a.b/x_y_z')])],
    ['two links', '[a](u) and [b](v)', d(['a', link('u')], ' and ', ['b', link('v')])],
]);

table('unsafe urls keep the text, drop the link', [
    ['javascript:', '[x](javascript:alert(1))', d('x')],
    ['javascript: with spaces', '[x](<javascript:alert(1)>)', d('x')],
    ['mixed case', '[x](JaVaScRiPt:alert(1))', d('x')],
    ['entity obfuscated', '[x](&#106;avascript:alert(1))', d('x')],
    ['data:text/html', '[x](data:text/html;base64,AAAA)', d('x')],
    ['vbscript', '[x](vbscript:msgbox)', d('x')],
    ['marks survive', '[**x**](javascript:alert(1))', d(['x', B])],
    ['autolink javascript', '<javascript:alert(1)>', d('<javascript:alert(1)>')],
    ['unsafe image keeps alt', '![alt text](javascript:alert(1))', d('alt text')],
    ['data:text image keeps alt', '![alt](data:text/html;base64,AAAA)', d('alt')],
]);

describe('reference links', () => {
    const refs = '[ref]: https://example.com "Title"\n[Other Ref]: <https://o.example/a b>\n[dup]: https://first.test\n[dup]: https://second.test\n[js]: javascript:alert(1)';

    it('full reference', () => {
        expect(withRefs(refs, 'a [text][ref] b')).toEqual(d('a ', ['text', link('https://example.com')], ' b'));
    });
    it('collapsed reference', () => {
        expect(withRefs(refs, '[ref][]')).toEqual(d(['ref', link('https://example.com')]));
    });
    it('shortcut reference', () => {
        expect(withRefs(refs, 'see [ref].')).toEqual(d('see ', ['ref', link('https://example.com')], '.'));
    });
    it('labels are case-insensitive and whitespace-normalized', () => {
        expect(withRefs(refs, '[x][REF] [y][other   ref]')).toEqual(d(['x', link('https://example.com')], ' ', ['y', link('https://o.example/a b')]));
    });
    it('the first definition of a label wins', () => {
        expect(withRefs(refs, '[dup]')).toEqual(d(['dup', link('https://first.test')]));
    });
    it('marks inside a reference link text', () => {
        expect(withRefs(refs, '[**b**][ref]')).toEqual(d(['b', link('https://example.com', B)]));
    });
    it('an undefined reference stays literal', () => {
        expect(withRefs(refs, '[nope][missing] and [nada]')).toEqual(d('[nope][missing] and [nada]'));
    });
    it('a full reference to an undefined label does not fall back to a shortcut', () => {
        expect(withRefs(refs, '[ref][missing]')).toEqual(d('[ref][missing]'));
    });
    it('an unsafe definition keeps the text only', () => {
        expect(withRefs(refs, '[click][js]')).toEqual(d('click'));
    });
    it('no definitions at all: brackets are literal', () => {
        expect(parseMarkdownInline('[a][b] [c]')).toEqual(d('[a][b] [c]'));
    });
    it('footnote definitions are not link definitions', () => {
        const { lines, resolveRef } = extractLinkDefinitions(['text[^1]', '', '[^1]: a note']);
        expect(lines).toHaveLength(3);
        expect(resolveRef).toBeUndefined();
    });
    it('definitions inside fenced code are left alone', () => {
        const { lines, resolveRef } = extractLinkDefinitions(['```', '[a]: https://x.y', '```', '[b]: https://z.y']);
        expect(lines).toEqual(['```', '[a]: https://x.y', '```']);
        expect(resolveRef('a')).toBeNull();
        expect(resolveRef('b')).toEqual({ href: 'https://z.y' });
    });
    it('a reference image', () => {
        const { resolveRef } = extractLinkDefinitions(['[logo]: https://x.y/l.png']);
        expect(parseMarkdownSegments('![the logo][logo]', { resolveRef })).toEqual([{ image: { alt: 'the logo', ref: 'https://x.y/l.png' } }]);
    });
});

table('autolinks and bare URLs', [
    ['angle autolink', '<https://example.com/a?b=1>', d(['https://example.com/a?b=1', link('https://example.com/a?b=1')])],
    ['angle mailto', '<mailto:me@x.y>', d(['mailto:me@x.y', link('mailto:me@x.y')])],
    ['angle email', '<me@x.y>', d(['me@x.y', link('mailto:me@x.y')])],
    ['not an autolink (space)', '<not a link>', d('<not a link>')],
    ['bare https', 'see https://example.com now', d('see ', ['https://example.com', link('https://example.com')], ' now')],
    ['bare http with path', 'http://a.b/c/d?e=f#g', d(['http://a.b/c/d?e=f#g', link('http://a.b/c/d?e=f#g')])],
    ['bare www', 'go www.example.com/x ok', d('go ', ['www.example.com/x', link('http://www.example.com/x')], ' ok')],
    ['trailing period', 'See https://example.com.', d('See ', ['https://example.com', link('https://example.com')], '.')],
    ['trailing comma', 'https://example.com, then', d(['https://example.com', link('https://example.com')], ', then')],
    ['trailing colon, semicolon, bang, question', 'https://a.b/x:;!?', d(['https://a.b/x', link('https://a.b/x')], ':;!?')],
    ['trailing paren (unbalanced)', '(see https://a.b/x)', d('(see ', ['https://a.b/x', link('https://a.b/x')], ')')],
    ['balanced parens kept', 'https://en.wikipedia.org/wiki/Foo_(bar)', d(['https://en.wikipedia.org/wiki/Foo_(bar)', link('https://en.wikipedia.org/wiki/Foo_(bar)')])],
    ['balanced parens then period', 'https://x.y/a_(b).', d(['https://x.y/a_(b)', link('https://x.y/a_(b)')], '.')],
    ['underscores inside a url are not emphasis', 'https://x.y/a_b_c', d(['https://x.y/a_b_c', link('https://x.y/a_b_c')])],
    ['url in bold', '**https://a.b**', d(['https://a.b', link('https://a.b', B)])],
    ['url in italic underscores', '_https://a.b_', d(['https://a.b', link('https://a.b', I)])],
    ['stops at an angle bracket', 'https://a.b<b>', d(['https://a.b', link('https://a.b')], '<b>')],
    ['not after a word character', 'xhttps://a.b', d('xhttps://a.b')],
    ['bare scheme alone is literal', 'https:// nothing', d('https:// nothing')],
    ['ftp is not autolinked', 'ftp://a.b', d('ftp://a.b')],
    ['no link nested in a link text', '[https://a.b](https://a.b)', d(['https://a.b', link('https://a.b')])],
    ['a bare url inside a link text does not nest', '[see https://a.b](https://c.d)', d(['see https://a.b', link('https://c.d')])],
    ['entity at the end', 'https://a.b/x&amp;', d(['https://a.b/x', link('https://a.b/x')], '&amp;')],
]);

describe('images', () => {
    it('an image is a segment of its own', () => {
        expect(parseMarkdownSegments('head ![alt](https://x.y/i.png) tail')).toEqual([
            { delta: d('head ') },
            { image: { alt: 'alt', ref: 'https://x.y/i.png' } },
            { delta: d(' tail') },
        ]);
    });
    it('title is ignored', () => {
        expect(parseMarkdownSegments('![a](https://x.y/i.png "T")')).toEqual([{ image: { alt: 'a', ref: 'https://x.y/i.png' } }]);
    });
    it('alt text is plain (marks stripped)', () => {
        expect(parseMarkdownSegments('![a **b** `c`](https://x.y/i.png)')).toEqual([{ image: { alt: 'a b c', ref: 'https://x.y/i.png' } }]);
    });
    it('two images and text between', () => {
        const segs = parseMarkdownSegments('![a](u1) mid ![b](u2)');
        expect(segs.map((s) => ('image' in s ? s.image.alt : s.delta[0].insert))).toEqual(['a', ' mid ', 'b']);
    });
    it('an unsafe image is its alt text, in the surrounding text', () => {
        expect(parseMarkdownSegments('a ![evil](javascript:x) b')).toEqual([{ delta: d('a evil b') }]);
    });
    it('parseMarkdownInline (no block to split) keeps the alt text', () => {
        expect(parseMarkdownInline('x ![the alt](https://x.y/i.png) y')).toEqual(d('x the alt y'));
    });
    it('an image in a link keeps the link on the alt text (inline mode)', () => {
        expect(parseMarkdownInline('[![badge](https://x.y/b.svg)](https://x.y)')).toEqual(d(['badge', link('https://x.y')]));
    });
    it('parentheses in the image url', () => {
        expect(parseMarkdownSegments('![a](https://x.y/i_(1).png)')).toEqual([{ image: { alt: 'a', ref: 'https://x.y/i_(1).png' } }]);
    });
});

describe('line breaks', () => {
    it('a newline in the text is kept as a line break', () => {
        expect(parseMarkdownInline('a\nb')).toEqual(d('a\nb'));
    });
    it('two trailing spaces: hard break, spaces dropped', () => {
        expect(parseMarkdownInline('a  \nb')).toEqual(d('a\nb'));
    });
    it('a trailing backslash: hard break, backslash dropped', () => {
        expect(parseMarkdownInline('a\\\nb')).toEqual(d('a\nb'));
    });
    it('leading spaces of the next line are dropped', () => {
        expect(parseMarkdownInline('a\\\n   b')).toEqual(d('a\nb'));
    });
    it('marks continue across a hard break', () => {
        expect(parseMarkdownInline('**a\\\nb**')).toEqual(d(['a\nb', B]));
    });
});

describe('inherited marks (second argument)', () => {
    it('applies to every run', () => {
        expect(parseMarkdownInline('a *b*', { bold: true })).toEqual(d(['a ', B], ['b', BI]));
    });
});

describe('shared flanking rules', () => {
    it('delimiterFlags: spaces and edges', () => {
        expect(delimiterFlags('*', ' ', 'a')).toEqual({ canOpen: true, canClose: false });
        expect(delimiterFlags('*', 'a', ' ')).toEqual({ canOpen: false, canClose: true });
        expect(delimiterFlags('*', ' ', ' ')).toEqual({ canOpen: false, canClose: false });
        expect(delimiterFlags('*', '', 'a')).toEqual({ canOpen: true, canClose: false });
    });
    it('delimiterFlags: underscore is never intraword', () => {
        expect(delimiterFlags('_', 'a', 'b')).toEqual({ canOpen: false, canClose: false });
        expect(delimiterFlags('*', 'a', 'b')).toEqual({ canOpen: true, canClose: true });
    });
});

describe('robustness', () => {
    it('pathological input terminates quickly', () => {
        const start = Date.now();
        parseMarkdownInline('*a '.repeat(4000));
        parseMarkdownInline('['.repeat(3000) + ']'.repeat(3000));
        parseMarkdownInline('`'.repeat(3000));
        expect(Date.now() - start).toBeLessThan(3000);
    });
});

// ── delta → markdown → delta ────────────────────────────────────────────────

describe('deltaToMarkdown: output', () => {
    const md = (delta) => deltaToMarkdown(delta);
    it('escapes markdown-significant characters', () => {
        expect(md(d('2 * 3 [x] `y` \\ z'))).toBe('2 \\* 3 \\[x\\] \\`y\\` \\\\ z');
    });
    it('keeps intraword underscores, escapes the others', () => {
        expect(md(d('snake_case and _x_'))).toBe('snake_case and \\_x\\_');
    });
    it('keeps whitespace outside the delimiters', () => {
        expect(md(d(['bold ', B], 'x'))).toBe('**bold** x');
        expect(md(d([' it', I]))).toBe(' *it*');
    });
    it('does not escape inside code, lengthens the fence', () => {
        expect(md(d(['a*b', C]))).toBe('`a*b`');
        expect(md(d(['a`b', C]))).toBe('``a`b``');
        expect(md(d(['`x`', C]))).toBe('`` `x` ``');
    });
    it('a link wraps its marks; adjacent runs share one link', () => {
        expect(md(d(['a', link('u', B)], [' b', link('u')]))).toBe('[**a** b](u)');
    });
    it('destinations with spaces or unbalanced parens use angle brackets', () => {
        expect(md(d(['t', link('https://a.b/x y')]))).toBe('[t](<https://a.b/x y>)');
        expect(md(d(['t', link('https://a.b/x)')]))).toBe('[t](<https://a.b/x)>)');
        expect(md(d(['t', link('https://a.b/x_(y)')]))).toBe('[t](https://a.b/x_(y))');
    });
    it('only markup-looking angle brackets are escaped', () => {
        expect(md(d('<img src=x onerror=1> a < b <script>'))).toBe('<img src=x onerror=1> a < b <script>');
        expect(md(d('<u>x</u> <https://a.b> <a@b.c>'))).toBe('\\<u>x\\</u> \\<https://a.b> \\<a@b.c>');
    });
    it('a line break is a hard break (or a raw newline on request)', () => {
        expect(deltaToMarkdown(d('a\nb'), { rawBreaks: true })).toBe('a\nb');
        expect(md(d('a\nb'))).toBe('a\\\nb');
    });
    it('strikethrough and underline nest around bold / italic', () => {
        expect(md(d(['x', { strikethrough: true, bold: true }]))).toBe('~~**x**~~');
        expect(md(d(['x', { underline: true, italic: true }]))).toBe('<u>*x*</u>');
    });
    it('a mark spanning several runs is one delimiter pair', () => {
        expect(md(d(['a ', B], ['b', BI], [' c', B]))).toBe('**a *b* c**');
        expect(md(d(['a ', B], ['b', BI], [' c', B]))).not.toContain('****');
        expect(md(d(['  ', B]))).toBe('  ');
    });
    it('escapes a start that would become another block', () => {
        expect(md(d('# not a heading'))).toBe('\\# not a heading');
        expect(md(d('> not a quote'))).toBe('\\> not a quote');
        expect(md(d('- not a list'))).toBe('\\- not a list');
        expect(md(d('1. not a list'))).toBe('1\\. not a list');
        expect(md(d('-- not a dialogue'))).toBe('\\-- not a dialogue');
        expect(md(d('---'))).toBe('\\---');
        expect(md(d('fine # here'))).toBe('fine # here');
    });
});

const roundTrips = [
    ['plain', d('hello world')],
    ['bold / italic / both', d('a ', ['b', B], ' ', ['i', I], ' ', ['bi', BI], ' z')],
    ['strike + underline', d(['s', S], ' ', ['u', U])],
    ['code', d('x ', ['y', C], ' z')],
    ['code with backticks', d(['a`b', C])],
    ['literal stars', d('2 * 3 * 4 and **nope**')],
    ['literal brackets and parens', d('[a](b) and ![c](d)')],
    ['literal underscores', d('_x_ and snake_case and __init__')],
    ['literal backticks', d('use `ls` here')],
    ['literal backslashes', d('C:\\dir\\file \\* \\n')],
    ['literal tildes', d('~~x~~ and ~y')],
    ['literal html', d('<u>x</u> and <b> and <https://x.y>')],
    ['literal hash lines', d('# title')],
    ['link', d('go ', ['here', link('https://example.com/a?b=1&c=2')], ' now')],
    ['link with marks', d(['bold', link('https://a.b', B)], [' and ', link('https://a.b')], ['it', link('https://a.b', I)])],
    ['two adjacent different links', d(['a', link('https://a.b')], ['b', link('https://c.d')])],
    ['link, relative and fragment', d(['a', link('./x/y.md')], ' ', ['b', link('#sec')])],
    ['link with spaces in the url', d(['a', link('https://a.b/x y')])],
    ['link with parens in the url', d(['a', link('https://en.wikipedia.org/wiki/Foo_(bar)')])],
    ['link text with brackets', d(['a [b] c', link('https://a.b')])],
    ['bold with trailing space outside', d(['bold', B], ' next')],
    ['hard break', d('a\nb')],
    ['nested marks across runs', d(['a ', B], ['b', BI], [' c', B])],
    ['unicode', d('café ', ['naïve', I], ' — 日本語 ', ['強', B])],
];

describe('round trip: delta → markdown → delta', () => {
    for (const [name, delta] of roundTrips) {
        it(name, () => {
            const md = deltaToMarkdown(delta);
            expect(parseMarkdownInline(md)).toEqual(delta);
        });
    }
});

describe('round trip: markdown → delta → markdown', () => {
    const stable = [
        'plain text',
        '**bold** and *italic* and ***both***',
        '[link](https://example.com)',
        '[**bold** link](https://example.com)',
        '`code` and ~~strike~~',
        '\\*escaped\\* \\[brackets\\]',
        '[t](<https://a.b/x y>)',
    ];
    for (const src of stable) {
        it(src, () => {
            expect(deltaToMarkdown(parseMarkdownInline(src))).toBe(src);
        });
    }
});

// ── Block level: definitions, images, hard breaks (paste + importMarkdown) ───

import { vi } from 'vitest';
import { tick } from 'svelte';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { HeadingExtension } from '$lib/blocks/heading/index.js';
import { ListExtension, ListItemExtension } from '$lib/blocks/list/index.js';
import { ImageExtension } from '$lib/blocks/image/index.js';
import { MarkdownPasteExtension } from '$lib/paste/markdown.paste.js';
import { PlainTextPasteExtension } from '$lib/paste/plain-text.paste.js';

const EXTENSIONS = [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, ImageExtension, MarkdownPasteExtension, PlainTextPasteExtension];

async function makeEditor() {
    const engine = new Nabu({ extensions: EXTENSIONS });
    await engine.commit();
    const block = engine.children[0];
    engine.selection = { anchorBlock: block, focusBlock: block, isCollapsed: true, sync: vi.fn(), setCursor: vi.fn() };
    return { engine, block };
}

async function paste(engine, text) {
    engine.handlePaste({ preventDefault: vi.fn(), clipboardData: { getData: (f) => (f === 'text/plain' ? text : '') } });
    await tick();
    await engine.commit();
}

/** `type:text` per root, `type:ref` for an image. */
function shape(engine) {
    return engine.tree.roots().map((r) => {
        const type = r.data.get('type');
        return type === 'image' ? `image:${r.data.get('ref')}|${r.data.get('alt')}` : `${type}:${r.data.get('text')?.toString()}`;
    });
}
const deltas = (engine) => engine.tree.roots().map((r) => r.data.get('text')?.toDelta());

describe('block level: reference definitions', () => {
    const MD = 'Read the [docs][d] and [home].\n\n[d]: https://docs.example.com "Docs"\n[Home]: https://example.com\n';

    it('importMarkdown resolves them and produces no block for the definition lines', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown(MD);
        expect(shape(engine)).toEqual(['paragraph:Read the docs and home.']);
        expect(deltas(engine)[0]).toEqual(d('Read the ', ['docs', link('https://docs.example.com')], ' and ', ['home', link('https://example.com')], '.'));
    });

    it('paste resolves them too, even when the definition comes first', async () => {
        const { engine } = await makeEditor();
        await paste(engine, '[a]: https://a.example\nsee [a]\n\n[b]: https://b.example');
        expect(shape(engine)).toEqual(['paragraph:see a']);
        expect(deltas(engine)[0]).toEqual(d('see ', ['a', link('https://a.example')]));
    });

    it('a document made of definitions only pastes nothing special (no block)', async () => {
        const { engine } = await makeEditor();
        await paste(engine, '[a]: https://a.example');
        expect(shape(engine)).toEqual(['paragraph:[a]: https://a.example']); // falls back to the plain text interpreter
    });

    it('works in list items and headings', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('# About [x]\n\n- see [x]\n\n[x]: https://x.example');
        const heading = engine.tree.roots()[0];
        expect(heading.data.get('text').toDelta()).toEqual(d('About ', ['x', link('https://x.example')]));
        const item = engine.tree.roots()[1].children()[0];
        expect(item.data.get('text').toDelta()).toEqual(d('see ', ['x', link('https://x.example')]));
    });

    it('definitions inside a code fence stay code', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('before\n\n```\n[a]: https://a.example\n```\n\nafter [a]');
        expect(engine.tree.roots().map((r) => r.data.get('type'))).toContain('paragraph');
        expect(shape(engine).join('|')).toContain('[a]: https://a.example');
        expect(shape(engine).pop()).toBe('paragraph:after [a]');
    });
});

describe('block level: images', () => {
    it('a line that is only an image is an image block (title ignored)', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('![alt](https://x.example/i.png "T")');
        expect(shape(engine)).toEqual(['image:https://x.example/i.png|alt']);
    });

    it('an image in the middle of text splits the paragraph (import)', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('head ![alt](https://x.example/i.png) tail');
        expect(shape(engine)).toEqual(['paragraph:head', 'image:https://x.example/i.png|alt', 'paragraph:tail']);
    });

    it('an image in the middle of pasted text splits the caret block (paste)', async () => {
        const { engine, block } = await makeEditor();
        await paste(engine, 'head ![alt](https://x.example/i.png) tail');
        expect(shape(engine)).toEqual(['paragraph:head', 'image:https://x.example/i.png|alt', 'paragraph:tail']);
    });

    it('text after an image on the same line is kept', async () => {
        const { engine } = await makeEditor();
        await paste(engine, '![alt](https://x.example/i.png) caption');
        expect(shape(engine)).toEqual(['image:https://x.example/i.png|alt', 'paragraph:caption']);
    });

    it('an unsafe image is only its alt text', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('![evil](javascript:alert(1))');
        expect(shape(engine)).toEqual(['paragraph:evil']);
    });

    it('a reference image becomes an image block', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('![logo][l]\n\n[l]: https://x.example/l.png');
        expect(shape(engine)).toEqual(['image:https://x.example/l.png|logo']);
    });

    it('an image inside a list item keeps its alt text', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('- ![alt](https://x.example/i.png)');
        expect(engine.tree.roots()[0].children()[0].data.get('text').toString()).toBe('alt');
    });
});

describe('block level: line breaks', () => {
    it('import: two trailing spaces and a backslash are hard breaks, a plain newline is a space', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown('one  \ntwo\\\nthree\nfour');
        expect(shape(engine)).toEqual(['paragraph:one\ntwo\nthree four']);
    });

    it('paste: one line = one block, trailing marker or not', async () => {
        const { engine } = await makeEditor();
        await paste(engine, 'one  \ntwo\\\nthree');
        expect(shape(engine)).toEqual(['paragraph:one  ', 'paragraph:two\\', 'paragraph:three']);
    });
});

describe('block level: importMarkdown of a README sample', () => {
    const README = [
        '# Project',
        '',
        '[![Build](https://ci.example/badge.svg)](https://ci.example) A **fast** library, see [the docs][docs] or <https://example.com>.',
        '',
        '![screenshot](https://x.example/shot.png)',
        '',
        '## Install',
        '',
        '- run `npm i project` (needs *node* >= 20)',
        '- visit www.project.dev.',
        '',
        'Escapes: \\*not italic\\* and snake_case_name.',
        '',
        '[docs]: https://docs.example.com/guide_(v2) "Guide"',
    ].join('\n');

    it('imports and keeps the structure', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown(README);
        const s = shape(engine);
        expect(s[0]).toBe('heading:Project');
        expect(s).toContain('image:https://x.example/shot.png|screenshot');
        expect(s[1]).toBe('image:https://ci.example/badge.svg|Build'); // a linked badge: the image block (the link is lost)
        expect(s.at(-1)).toBe('paragraph:Escapes: *not italic* and snake_case_name.');
        const para = engine.tree.roots().find((r) => r.data.get('type') === 'paragraph' && r.data.get('text').toString().includes('fast'));
        const hrefs = para.data.get('text').toDelta().filter((op) => op.attributes?.link).map((op) => [op.insert, op.attributes.link]);
        expect(hrefs).toEqual([
            ['the docs', 'https://docs.example.com/guide_(v2)'],
            ['https://example.com', 'https://example.com'],
        ]);
        const list = engine.tree.roots().find((r) => r.data.get('type') === 'list');
        const second = list.children()[1].data.get('text').toDelta();
        expect(second).toEqual(d('visit ', ['www.project.dev', link('http://www.project.dev')], '.'));
    });

    it('serialize → import is stable for text, links and escapes', async () => {
        const { engine } = await makeEditor();
        await engine.importMarkdown(README);
        const md1 = engine.serialize('markdown');
        const second = (await makeEditor()).engine;
        await second.importMarkdown(md1);
        expect(shape(second)).toEqual(shape(engine));
        expect(deltas(second)).toEqual(deltas(engine));
    });
});
