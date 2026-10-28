import { Extension } from '../../utils/extensions.js';
import { TextBehavior } from './text.behavior.svelte.js';
import { WORD } from './markdown-syntax.js';

// Flanking rules (CommonMark, simplified): an opening delimiter must be followed by a non-whitespace
// char and a closing one preceded by a non-whitespace char, so `2 * 3 * 4` and `* not *` stay literal.
// Only the whitespace half of CommonMark's flanking rules is implemented (no punctuation special case).
// `_` / `__` additionally never open or close INTRAWORD (`snake_case_name` stays literal); `*`, `~~`
// are allowed intraword (`a*b*c` → italic b, as in CommonMark / GFM). The paste / import parser applies the same
// rules (`markdown-syntax.js` `delimiterFlags`), so typing `*a*` and pasting `*a*` agree.

/**
 * Inner content of a delimited span: no `d`, non-whitespace first AND last char (a single char is fine).
 * @param {string} d  the delimiter character
 */
const inner = (d) => `[^${d}\\s](?:[^${d}]*[^${d}\\s])?`;

/**
 * Build an inputRule that, when `closeChar` is typed and `pattern` matches the
 * text before the cursor, strips the markdown delimiters and applies mark(s)
 * to the inner content. `pattern` MUST capture the bare content in group 1, and
 * match[0] MUST be exactly the delimiters+content to delete (no extra chars).
 * @param {RegExp} pattern
 * @param {string} closeChar  the closing delimiter character being typed
 * @param {string | string[]} marks  mark name(s) to apply
 * @param {{ noIntrawordClose?: boolean }} [opts]  `noIntrawordClose`: refuse to close when the char
 *   right after the cursor is a letter/digit (the closing `_` would be intraword)
 * @returns {import('../../utils/extensions.js').InputRule}
 */
function markRule(pattern, closeChar, marks, opts = {}) {
    const names = Array.isArray(marks) ? marks : [marks];
    return {
        pattern,
        handler(nabu, block, match, sel) {
            if (sel.data !== closeChar) return;
            const behavior = block.behaviors.get('text');
            if (!(behavior instanceof TextBehavior)) return;
            if (opts.noIntrawordClose && /[\p{L}\p{N}]/u.test(behavior.text.charAt(sel.from))) return;
            const full = match[0];   // delimiters + content present before the cursor
            const inner = match[1];  // bare content
            if (!inner) return;
            const start = sel.from - full.length;
            behavior.delete({ index: start, length: full.length });
            behavior.insert(start, inner);
            for (const name of names) {
                behavior.applyMark(name, true, { from: start, to: start + inner.length, isCollapsed: false });
            }
            return true;
        }
    };
}

/**
 * Inline markdown shortcuts while typing: `**bold**`, `_italic_`, `` `code` ``, `~~strike~~` turn into marks as the closing delimiter is typed.
 */
export const MarkdownShortcutsExtension = new Extension('markdown-shortcuts', {
    // ORDER MATTERS: most-specific (longest) delimiters first.
    // The `(?<!d)` lookbehinds make an opener the START of its delimiter run: `**…*` must not fire
    // inside `***x*` (typing `***x***`: the 2nd closing `*` used to bold `x*` and leave a stray `*`).
    inputRules: [
        // ***bold-italic***  (asterisks) — typed final '*' after '***x**'
        markRule(new RegExp(`(?<!\\*)\\*\\*\\*(${inner('*')})\\*\\*$`, 'u'), '*', ['bold', 'italic']),
        // **bold**           — typed final '*' after '**x*'
        markRule(new RegExp(`(?<!\\*)\\*\\*(${inner('*')})\\*$`, 'u'), '*', 'bold'),
        // *italic*           — typed final '*' after '*x' (not preceded by '*')
        markRule(new RegExp(`(?<!\\*)\\*(${inner('*')})$`, 'u'), '*', 'italic'),
        // ___bold-italic___  (underscores, not intraword) — typed final '_' after '___x__'
        markRule(new RegExp(`(?<![${WORD}])___(${inner('_')})__$`, 'u'), '_', ['bold', 'italic'], { noIntrawordClose: true }),
        // __bold__           — typed final '_' after '__x_'
        markRule(new RegExp(`(?<![${WORD}])__(${inner('_')})_$`, 'u'), '_', 'bold', { noIntrawordClose: true }),
        // _italic_           — typed final '_' after '_x' (opener preceded by a non-word char or the block start)
        markRule(new RegExp(`(?<![${WORD}])_(${inner('_')})$`, 'u'), '_', 'italic', { noIntrawordClose: true }),
        // `code`             — typed final '`' after '`x'. Code spans keep inner spaces (`a b`), but need
        //                       at least one non-space char and don't open inside a longer backtick run.
        markRule(/(?<!`)`([^`]*[^`\s][^`]*)$/, '`', 'code'),
        // ~~strike~~         — typed final '~' after '~~x~'
        markRule(new RegExp(`(?<!~)~~(${inner('~')})~$`, 'u'), '~', 'strikethrough'),
    ],
});
