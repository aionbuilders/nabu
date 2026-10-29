/**
 * Pure text helpers of the code block (no DOM, no Loro): where a line starts, what indentation it has, which lines a Tab /
 * Shift+Tab touches and the edits that indent / outdent them. `CodeBlock` applies the edits to its Loro text.
 */

/** One level of indentation: two spaces (never a tab character: the code is not re-indented by the host's tab width). */
export const INDENT = '  ';

/**
 * The offset where the line holding `pos` starts.
 * @param {string} text @param {number} pos
 */
export function lineStart(text, pos) {
    return pos <= 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1;
}

/**
 * The whitespace (spaces and tabs) at the start of the line, up to the caret: what a new line typed with Enter starts with.
 * @param {string} text @param {number} pos
 */
export function leadingIndent(text, pos) {
    const start = lineStart(text, pos);
    return /^[ \t]*/.exec(text.slice(start, pos))?.[0] ?? '';
}

/**
 * The start offsets of the lines a selection touches. A selection that ends at the very start of a line does not touch that
 * line (as in every code editor); a collapsed caret touches its own line.
 * @param {string} text @param {number} from @param {number} to
 * @returns {number[]}
 */
export function touchedLines(text, from, to) {
    const end = to > from && text[to - 1] === '\n' ? to - 1 : to;
    /** @type {number[]} */
    const starts = [];
    let s = lineStart(text, from);
    for (;;) {
        starts.push(s);
        const next = text.indexOf('\n', s);
        if (next === -1 || next >= end) break;
        s = next + 1;
    }
    return starts;
}

/**
 * @typedef {Object} IndentPlan
 * @property {{ index: number, remove: number, insert: string }[]} edits  from the END of the text to its start (apply in order)
 * @property {number} from  the selection start after the edits
 * @property {number} to    the selection end after the edits
 */

/**
 * Tab over a selection that spans several lines: one indentation level is inserted at the start of every non-empty line.
 * `null` when the selection is within one line (Tab then replaces it by an indentation, like VS Code).
 * @param {string} text @param {number} from @param {number} to
 * @returns {IndentPlan | null}
 */
export function indentLines(text, from, to) {
    const lines = touchedLines(text, from, to);
    if (lines.length < 2) return null;
    const targets = lines.filter((s) => s < text.length && text[s] !== '\n');
    let nextFrom = from;
    let nextTo = to;
    for (const s of targets) {
        if (from > s) nextFrom += INDENT.length;
        if (to > s) nextTo += INDENT.length;
    }
    return { edits: targets.reverse().map((index) => ({ index, remove: 0, insert: INDENT })), from: nextFrom, to: nextTo };
}

/**
 * Shift+Tab: one indentation level (a tab character, or up to two spaces) is removed from the start of every line the
 * selection touches (the caret's own line when it is collapsed). `null` when no line has anything to remove.
 * @param {string} text @param {number} from @param {number} to
 * @returns {IndentPlan | null}
 */
export function outdentLines(text, from, to) {
    /** @type {{ index: number, remove: number }[]} */
    const cuts = [];
    for (const s of touchedLines(text, from, to)) {
        let n = 0;
        if (text[s] === '\t') n = 1;
        else while (n < INDENT.length && text[s + n] === ' ') n++;
        if (n) cuts.push({ index: s, remove: n });
    }
    if (!cuts.length) return null;
    /** @param {number} p */
    const map = (p) => cuts.reduce((q, c) => q - Math.min(Math.max(p - c.index, 0), c.remove), p);
    return { edits: [...cuts].reverse().map((c) => ({ ...c, insert: '' })), from: map(from), to: map(to) };
}
