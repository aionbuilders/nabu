import { Extension } from '../../utils/extensions.js';
import { TextBehavior } from './text.behavior.svelte.js';

/**
 * Build an inputRule that, when `closeChar` is typed and `pattern` matches the
 * text before the cursor, strips the markdown delimiters and applies mark(s)
 * to the inner content. `pattern` MUST capture the bare content in group 1, and
 * match[0] MUST be exactly the delimiters+content to delete (no extra chars).
 * @param {RegExp} pattern
 * @param {string} closeChar  the closing delimiter character being typed
 * @param {string | string[]} marks  mark name(s) to apply
 * @returns {import('../../utils/extensions.js').InputRule}
 */
function markRule(pattern, closeChar, marks) {
    const names = Array.isArray(marks) ? marks : [marks];
    return {
        pattern,
        handler(nabu, block, match, sel) {
            if (sel.data !== closeChar) return;
            const behavior = block.behaviors.get('text');
            if (!(behavior instanceof TextBehavior)) return;
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

export const MarkdownShortcutsExtension = new Extension('markdown-shortcuts', {
    // ORDER MATTERS: most-specific (longest) delimiters first.
    inputRules: [
        // ***bold-italic***  (asterisks) — typed final '*' after '***x**'
        markRule(/\*\*\*([^*]+)\*\*$/, '*', ['bold', 'italic']),
        // **bold**           — typed final '*' after '**x*'
        markRule(/\*\*([^*]+)\*$/, '*', 'bold'),
        // *italic*           — typed final '*' after '*x' (not preceded by '*')
        markRule(/(?<!\*)\*([^*]+)$/, '*', 'italic'),
        // __bold__           — typed final '_' after '__x_'
        markRule(/__([^_]+)_$/, '_', 'bold'),
        // _italic_           — typed final '_' after '_x' (not preceded by '_')
        markRule(/(?<!_)_([^_]+)$/, '_', 'italic'),
        // `code`             — typed final '`' after '`x'
        markRule(/`([^`]+)$/, '`', 'code'),
        // ~~strike~~         — typed final '~' after '~~x~'
        markRule(/~~([^~]+)~$/, '~', 'strikethrough'),
    ],
});
