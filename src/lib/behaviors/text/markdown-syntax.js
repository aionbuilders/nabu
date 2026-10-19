/**
 * Markdown inline syntax rules shared by everything that reads or writes inline markdown: the typing shortcuts
 * (`markdown-shortcuts.extension.js`), the markdown paste / import parser (`paste/markdown-inline.js`) and the
 * exporter (`deltaToMarkdown`). One place, so typing `*a*`, pasting `*a*` and exporting italic `a` agree.
 *
 * Pure functions, no DOM, no runes.
 */

/** Regex class body of a "word" character (letter, digit, underscore): an `_` touching one is intraword. */
export const WORD = '\\p{L}\\p{N}_';

const WORD_RE = new RegExp(`[${WORD}]`, 'u');
const SPACE_RE = /\s/u;

/** ASCII punctuation: the characters a backslash can escape (CommonMark). */
export const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/** @param {string | undefined} c */
export const isWordChar = (c) => !!c && WORD_RE.test(c);

/** Whitespace, or the edge of the text (nothing there): CommonMark treats the line edges as whitespace. */
export const isSpaceOrEdge = (/** @type {string | undefined} */ c) => !c || SPACE_RE.test(c);

/**
 * Can a delimiter run of `ch` (`*`, `_`, `~`) OPEN / CLOSE emphasis, given the character right before and right after
 * the whole run ('' at the text edges)? CommonMark flanking, whitespace half only (the same as the typing shortcuts):
 * an opener is followed by a non-whitespace char, a closer preceded by one. `_` additionally never opens or closes
 * INTRAWORD (`snake_case_name` stays literal); `*` and `~` may (`a*b*c`).
 * @param {string} ch
 * @param {string} prev  char before the run ('' at the start)
 * @param {string} next  char after the run ('' at the end)
 * @returns {{ canOpen: boolean, canClose: boolean }}
 */
export function delimiterFlags(ch, prev, next) {
    const left = !isSpaceOrEdge(next);
    const right = !isSpaceOrEdge(prev);
    if (ch === '_') return { canOpen: left && !isWordChar(prev), canClose: right && !isWordChar(next) };
    return { canOpen: left, canClose: right };
}

/** A `<` that the inline parser would read as markup: `<u>`, `</u>`, an autolink `<scheme:…>` or `<a@b.c>`. */
const MARKUP_START = /^<(?:\/?u>|[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>|[^\s<>@]+@[^\s<>]+>)/;

/**
 * Escape the markdown-significant characters of a plain text run so that parsing it back gives the same text.
 * Only what can start something is escaped: `\ * ` [ ]`, a `_` that could be a delimiter (not intraword), a `~`
 * next to another `~`, a `<` that would open an autolink / `<u>` tag.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdownText(text) {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '\\' || c === '*' || c === '`' || c === '[' || c === ']') out += '\\' + c;
        else if (c === '_') out += isWordChar(text[i - 1]) && isWordChar(text[i + 1]) ? c : '\\_';
        else if (c === '~') out += text[i - 1] === '~' || text[i + 1] === '~' ? '\\~' : c;
        else if (c === '<') out += MARKUP_START.test(text.slice(i)) ? '\\<' : c;
        else out += c;
    }
    return out;
}

/**
 * Escape what would turn a block's first line into another block when read back (`# `, `> `, `- `, `1. `, `-- `,
 * `---`). Applied to the start of the exported text of a block.
 * @param {string} md  already inline-escaped markdown
 * @returns {string}
 */
export function escapeBlockStart(md) {
    const indent = /^[ \t]*/.exec(md)?.[0] ?? '';
    const body = md.slice(indent.length);
    if (/^#{1,6}(?:\s|$)/.test(body) || body.startsWith('>')) return indent + '\\' + body;
    if (/^(?:[-+](?=\s)|-{2,}(?=\s|$))/.test(body)) return indent + '\\' + body;
    const ordered = /^(\d+)([.)])(?=\s)/.exec(body);
    if (ordered) return indent + ordered[1] + '\\' + body.slice(ordered[1].length);
    return md;
}
