/**
 * Markdown lists (paste AND `importMarkdown`), CommonMark / GFM level, as a nested List / ListItem PasteBlock tree.
 *
 *  - markers `-` `*` `+` `1.` `1)` (up to 9 digits); a task item is `[ ]` / `[x]` / `[X]` (`[]` is an unchecked one);
 *  - nesting is by indentation, relative: an item indented MORE than the previous item is its child (2 spaces, 4 spaces
 *    or a TAB (= 4 columns) each give one level, mixed indentation is tolerated);
 *  - a list ends at a change of marker type at the same level (bulleted then numbered, or the other way round): the next
 *    items start a NEW list. The bullet character (`-` / `*` / `+`) and the ordered delimiter (`.` / `)`) are NOT told
 *    apart (CommonMark would start a new list; the List normalizer merges adjacent lists of the same type back anyway);
 *    an ordered list starts at its first number;
 *  - a loose list (blank lines between items) is still ONE list;
 *  - an indented line under an item (a continuation paragraph, also after a blank line) is APPENDED to the item text with
 *    a line break; so is an unindented line after a hard break, and, on import (`joinLines`), a lazy continuation line.
 *    A fenced code in an item is kept verbatim (fences included) as text of the item: an item holds text, not blocks.
 *
 * Pure functions, no DOM, no runes.
 *
 * @import { PasteBlock } from "../../utils/extensions.js";
 */

const ITEM_RE = /^([ \t]*)([-*+]|(\d{1,9})([.)]))[ \t]+(.*)$/;
const THEMATIC_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TASK_RE = /^\[([ xX]?)\](?:[ \t]+(.*)|$)/;
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})/;
const HARD_BREAK_RE = /(?: {2,}|\\)$/;

/**
 * Width of the leading whitespace of a line, in columns (a TAB goes to the next multiple of 4).
 * @param {string} line
 * @returns {number}
 */
function indentOf(line) {
    let col = 0;
    for (const ch of line) {
        if (ch === ' ') col++;
        else if (ch === '\t') col += 4 - (col % 4);
        else break;
    }
    return col;
}

/** @param {string} line */
export function isListItem(line) {
    return ITEM_RE.test(line) && !THEMATIC_RE.test(line);
}

/**
 * Whether a list may start in the middle of a paragraph (CommonMark): a bullet with text, or an ordered list that starts at 1.
 * @param {string} line
 */
export function interruptsParagraph(line) {
    return /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/.test(line) && !THEMATIC_RE.test(line);
}

/**
 * Number of lines of the list that starts at line `i`.
 * @param {string[]} lines
 * @param {number} i
 * @param {{ joinLines?: boolean, interrupts?: (lines: string[], k: number) => boolean }} [helpers]
 * @returns {number}
 */
export function listLength(lines, i, helpers) {
    const n = lines.length;
    let j = i;
    let rootIndent = 0;
    let lastIndent = 0;
    let afterBlank = false; // the line was already accepted as a continuation, past a blank line
    while (j < n) {
        const line = lines[j];
        if (!line.trim()) {
            let k = j + 1;
            while (k < n && !lines[k].trim()) k++;
            if (k >= n) break;
            const next = lines[k];
            if (isListItem(next)) { j = k; continue; } // loose list
            // an indented paragraph (or fence) under the items belongs to the last one
            if (THEMATIC_RE.test(next) || indentOf(next) < rootIndent + 2) break;
            afterBlank = true;
            j = k;
            continue;
        }
        if (isListItem(line)) {
            afterBlank = false;
            lastIndent = indentOf(line);
            if (j === i) rootIndent = lastIndent;
            j++;
            continue;
        }
        if (THEMATIC_RE.test(line)) break;
        if (afterBlank) { afterBlank = false; j++; continue; }
        if (j > i && indentOf(line) > lastIndent) { j++; continue; } // indented continuation
        // an unindented line: continues the item after a hard break, or lazily on import
        const previous = lines[j - 1];
        if (j > i && previous.trim() && (HARD_BREAK_RE.test(previous) || (helpers?.joinLines && !helpers.interrupts?.(lines, j)))) { j++; continue; }
        break;
    }
    return Math.max(1, j - i);
}

/**
 * @typedef {{ raw: boolean, s: string }} Chunk
 * @typedef {{ indent: number, key: string, ordered: boolean, num: number, task: boolean, checked: boolean, chunks: Chunk[], previous: string, children: Item[] }} Item
 */

/**
 * Parse the lines of a list (see {@link listLength}) into List PasteBlocks: one, or several when the marker type changes at
 * the root.
 * @param {string[]} lines
 * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[], joinLines?: boolean, softBreak?: string }} helpers
 * @param {(listType: string, start: unknown) => number | null} listStart  normalises the `start` of an ordered list
 * @returns {PasteBlock | PasteBlock[] | null}
 */
export function parseListLines(lines, { parseInline, joinLines, softBreak }, listStart) {
    /** @type {Item[]} */
    const roots = [];
    /** @type {Item[]} */
    const stack = [];
    let blankBefore = false;

    /**
     * @param {Item} item
     * @param {string} text
     */
    const appendText = (item, text) => {
        const last = item.chunks[item.chunks.length - 1];
        if (last.raw) item.chunks.push({ raw: false, s: text });
        else if (!last.s) last.s = text;
        else {
            const hard = HARD_BREAK_RE.test(item.previous);
            // paragraphs of an item are separated by a line break, the lines of one by a space (import) or a line break
            last.s += (hard ? '\n' : blankBefore ? '\\\n' : (softBreak ?? (joinLines ? ' ' : '\n'))) + text;
        }
        item.previous = text;
    };

    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (!line.trim()) { blankBefore = true; continue; }

        const m = isListItem(line) ? ITEM_RE.exec(line) : null;
        if (m) {
            const indent = indentOf(m[1]);
            while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
            let text = m[5];
            const task = TASK_RE.exec(text);
            if (task) text = task[2] ?? '';
            /** @type {Item} */
            const item = {
                indent,
                key: m[3] === undefined ? 'bullet' : 'ordered',
                ordered: m[3] !== undefined,
                num: m[3] === undefined ? NaN : parseInt(m[3], 10),
                task: !!task,
                checked: !!task && /[xX]/.test(task[1]),
                chunks: [{ raw: false, s: text.trimEnd() ? text : '' }],
                previous: text,
                children: [],
            };
            (stack.length ? stack[stack.length - 1].children : roots).push(item);
            stack.push(item);
            blankBefore = false;
            continue;
        }

        // A continuation line: it belongs to the deepest open item that is indented less than the line (else the last one).
        const ind = indentOf(line);
        let target = stack[stack.length - 1];
        for (let k = stack.length - 1; k >= 0; k--) if (stack[k].indent < ind) { target = stack[k]; break; }
        if (!target) { blankBefore = false; continue; }

        const fence = FENCE_RE.exec(line);
        if (fence) {
            // verbatim, up to the closing fence (or the end): blank lines, markdown and indentation inside are kept
            const strip = indentOf(fence[1]);
            const dedent = (/** @type {string} */ l) => (' '.repeat(Math.max(0, indentOf(l) - strip)) + l.replace(/^[ \t]*/, ''));
            const body = [dedent(line)];
            const char = fence[2][0];
            while (li + 1 < lines.length) {
                const next = lines[++li];
                body.push(dedent(next));
                const close = /^[ \t]*(`+|~+)[ \t]*$/.exec(next);
                if (close && close[1][0] === char && close[1].length >= fence[2].length) break;
            }
            while (body.length > 1 && !body[body.length - 1].trim()) body.pop();
            const last = target.chunks[target.chunks.length - 1];
            if (!last.raw) last.s = last.s.replace(/\\$/, '');
            target.chunks.push({ raw: true, s: body.join('\n') });
            target.previous = '';
        } else {
            appendText(target, line.replace(/^[ \t]+/, ''));
        }
        blankBefore = false;
    }

    if (!roots.length) return null;

    /**
     * @param {Item[]} siblings
     * @returns {PasteBlock[]}
     */
    const toLists = (siblings) => {
        /** @type {Item[][]} */
        const groups = [];
        for (const item of siblings) {
            const group = groups[groups.length - 1];
            if (group && group[0].key === item.key) group.push(item);
            else groups.push([item]);
        }
        return groups.map((group) => {
            const listType = group.some((it) => it.task) ? 'todo' : group[0].ordered ? 'ordered' : 'bullet';
            const start = listStart(listType, group[0].num);
            /** @type {PasteBlock[]} */
            const children = group.map((it) => {
                /** @type {PasteBlock} */
                const pb = { type: 'list-item', delta: itemDelta(it), partial: false };
                if (it.task) pb.props = { checked: it.checked };
                if (it.children.length) pb.children = toLists(it.children);
                return pb;
            });
            return { type: 'list', props: start === null ? { listType } : { listType, start }, children, partial: false };
        });
    };

    /**
     * @param {Item} item
     * @returns {import('loro-crdt').Delta<string>[]}
     */
    const itemDelta = (item) => {
        /** @type {import('loro-crdt').Delta<string>[]} */
        const delta = [];
        item.chunks.forEach((chunk, k) => {
            if (k) delta.push({ insert: '\n' });
            if (chunk.raw) delta.push({ insert: chunk.s });
            else delta.push(...parseInline(chunk.s));
        });
        return delta.filter((op) => op.insert !== '' || op.attributes);
    };

    const lists = toLists(roots);
    return lists.length === 1 ? lists[0] : lists;
}
