/**
 * Markdown lists (paste AND `importMarkdown`), CommonMark / GFM level, as a nested List / ListItem PasteBlock tree.
 *
 *  - markers `-` `*` `+` `1.` `1)` (up to 9 digits); a task item is `[ ]` / `[x]` / `[X]` (`[]` is an unchecked one);
 *  - nesting is by indentation, relative: an item indented MORE than the previous item is its child (2 spaces, 4 spaces
 *    or a TAB (= 4 columns) each give one level, mixed indentation is tolerated);
 *  - CommonMark list boundaries: a list ends at a change of marker at the same level, and the next items start a NEW list.
 *    The marker is the bullet character (`-` / `*` / `+`) or the ordered delimiter (`.` / `)`), so `- a` then `* b`, `1. a`
 *    then `1) b`, bulleted then numbered (P-30) are all separate lists. Adjacent lists of the SAME type are merged back by
 *    the List normalizer (nothing changes for them in the model), but a to-do list next to a bullet list stay two lists.
 *    The exporter relies on it: it alternates `-` / `*` (and `.` / `)`) between adjacent lists. An ordered list starts at
 *    its first number;
 *  - a loose list (blank lines between items) is still ONE list;
 *  - an indented line under an item (a continuation paragraph, also after a blank line) is APPENDED to the item text with
 *    a line break; so is an unindented line after a hard break, and, on import (`joinLines`), a lazy continuation line.
 *    A fenced code in an item is kept verbatim (fences included) as text of the item: an item holds text, not blocks.
 *    The exporter writes such text back as an indented fence (see {@link itemMarkdown}), which this parser reads as the
 *    same text.
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
 * Index of the line that closes the fence opened on line `at` (a fence of the same character, at least as long), or -1.
 * @param {string[]} lines
 * @param {number} at
 * @param {string} fence  the opening fence (its backticks / tildes)
 * @returns {number}
 */
function fenceEnd(lines, at, fence) {
    for (let k = at + 1; k < lines.length; k++) {
        const close = /^[ \t]*(`+|~+)[ \t]*$/.exec(lines[k]);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) return k;
    }
    return -1;
}

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
        // A closed fence under an item is skipped as a whole: what it holds (a `---`, a `- x`, a blank line…) is code.
        const fence = j > i ? FENCE_RE.exec(line) : null;
        if (fence && (afterBlank || indentOf(line) > lastIndent)) {
            const end = fenceEnd(lines, j, fence[2]);
            if (end >= 0) { afterBlank = false; j = end + 1; continue; }
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
                key: m[3] === undefined ? m[2] : m[4], // the marker that tells lists apart: `-` `*` `+` / `.` `)`
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
            // verbatim, up to the closing fence (or the end): blank lines, markdown and indentation inside are kept; only the
            // indentation of the opening fence is removed from every line (the rest, TABs included, is untouched)
            const strip = indentOf(fence[1]);
            const dedent = (/** @type {string} */ l) => {
                let col = 0;
                let k = 0;
                while (k < l.length && col < strip) {
                    if (l[k] === ' ') col++;
                    else if (l[k] === '\t' && col + (4 - (col % 4)) <= strip) col += 4 - (col % 4);
                    else break;
                    k++;
                }
                return l.slice(k);
            };
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

// ── Export ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Bullet characters, alternated between ADJACENT lists of the same family (P-30). */
const BULLETS = ['-', '*'];
/** Ordered delimiters, alternated likewise. */
const DELIMITERS = ['.', ')'];

/** Bulleted (bullet, to-do) lists tell their neighbours apart by the bullet character, numbered ones by the delimiter. */
const familyOf = (/** @type {string | undefined} */ listType) => (listType === 'ordered' ? 'ordered' : 'bullet');

/**
 * Number of lists of the same family directly before a list: the position of the list in a run of ADJACENT lists, which
 * picks its marker (`-` then `*` then `-`…, `.` then `)`). CommonMark ends a list at a change of marker, so this is what
 * keeps two neighbours (a to-do list then a bullet list, two numbered lists…) from reading back as ONE list. A block
 * that is not a list, or a list of the other family, ends the run (the marker type already differs).
 * @param {string | undefined} listType
 * @param {Array<{ type: string, props?: { listType?: string } }>} before  the siblings before the list, in order
 * @returns {number}
 */
export function adjacentRun(listType, before) {
    const family = familyOf(listType);
    let run = 0;
    for (let k = before.length - 1; k >= 0; k--) {
        const b = before[k];
        if (b?.type !== 'list' || familyOf(b.props?.listType) !== family) break;
        run++;
    }
    return run;
}

/**
 * Columns taken by the marker of an item plus its space: the indentation of what belongs to the item (continuation
 * lines, sublists) so that any CommonMark reader nests them under it. A to-do item counts the bullet only.
 * @param {string | undefined} listType
 * @param {number} number  the number of the item (ordered lists)
 * @returns {number}
 */
export function markerWidth(listType, number) {
    return listType === 'ordered' ? String(number).length + 2 : 2;
}

/**
 * Plain text of a delta (embeds ignored).
 * @param {Array<{ insert?: unknown }>} delta
 */
const deltaText = (delta) => delta.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');

/**
 * Part of a delta between two character offsets (marks kept).
 * @template {{ insert?: unknown }} Op
 * @param {Op[]} delta
 * @param {number} from
 * @param {number} to
 * @returns {Op[]}
 */
function sliceDelta(delta, from, to) {
    /** @type {Op[]} */
    const out = [];
    let pos = 0;
    for (const op of delta) {
        if (typeof op.insert !== 'string') continue;
        const a = Math.max(from, pos);
        const b = Math.min(to, pos + op.insert.length);
        if (a < b) out.push({ ...op, insert: op.insert.slice(a - pos, b - pos) });
        pos += op.insert.length;
    }
    return out;
}

/**
 * The text of an item as markdown. An item holds text, not blocks, so a fenced code written in it (typed, or imported from a
 * list) is TEXT with line breaks. Escaped like any text it would be unreadable (`\`\`\`js\`), so a well-formed fence (an
 * opener at the start of a line of the text, not the first, and its closer) is written back as an indented fence under the
 * item, which the list parser reads as the same text, verbatim (marks inside the fence are not exported). Any other
 * text is the inline markdown of its delta.
 * @param {Array<{ insert?: unknown, attributes?: Record<string, any> }>} delta
 * @param {string} pad  indentation of what belongs to the item
 * @param {(delta: any[]) => string} toMarkdown  inline serializer
 * @returns {string}  the first line (after the marker) and the following ones, already indented
 */
export function itemMarkdown(delta, pad, toMarkdown) {
    const text = deltaText(delta);
    if (!text.includes('```') && !text.includes('~~~')) return toMarkdown(delta);
    const lines = text.split('\n');
    /** @type {number[]} */
    const starts = [];
    let at = 0;
    for (const line of lines) { starts.push(at); at += line.length + 1; }

    /** @type {Array<{ from: number, to: number }>} */
    const regions = [];
    for (let k = 1; k < lines.length; k++) {
        const open = /^(?:(`{3,})[^`]*|(~{3,}).*)$/.exec(lines[k]); // an opener at the very start of the line
        if (!open) continue;
        const end = fenceEnd(lines, k, open[1] ?? open[2]);
        if (end < 0) continue;
        regions.push({ from: k, to: end });
        k = end;
    }
    // An empty line next to a fence cannot be told apart from a paragraph break on the way back: keep the escaped text.
    if (!regions.length || regions.some((r) => lines[r.from - 1] === '' || lines[r.to + 1] === '')) return toMarkdown(delta);

    /** @type {string[]} */
    const out = [];
    /** @param {number} from first line @param {number} to last line (inclusive) @param {boolean} first */
    const textLines = (from, to, first) => {
        const md = toMarkdown(sliceDelta(delta, starts[from], starts[to] + lines[to].length));
        out.push(first ? md : md.split('\n').map((l) => pad + l).join('\n'));
    };
    let cursor = 0;
    for (const region of regions) {
        if (region.from > cursor) textLines(cursor, region.from - 1, cursor === 0);
        for (let k = region.from; k <= region.to; k++) out.push(lines[k] ? pad + lines[k] : '');
        cursor = region.to + 1;
    }
    if (cursor < lines.length) textLines(cursor, lines.length - 1, false);
    return out.join('\n');
}

/**
 * Environment of the renderers below: the inline serializer and the normalizer of the `start` of an ordered list (both
 * live outside this pure module).
 * @typedef {{ toMarkdown: (delta: any[]) => string, listStart: (listType: string, start: unknown) => number | null }} RenderEnv
 */

/**
 * One list item (with its sublists) as markdown.
 *  - marker: `-` / `*` (alternated, see {@link adjacentRun}), `- [ ]` / `- [x]` for a to-do item, `1.` / `1)` (the number
 *    is `start + index`);
 *  - everything that belongs to the item (continuation lines, sublists) is indented by the width of the marker;
 *  - its sublists follow, in order (an item may hold several, of different types: P-28).
 * @param {{ type?: string, delta?: any[], props?: { checked?: boolean }, children?: any[] }} pb
 * @param {RenderEnv} env
 * @param {{ listType?: string, index?: number, start?: number, run?: number, indent?: string }} [ctx]
 * @returns {string}
 */
export function renderItem(pb, env, { listType = 'bullet', index = 0, start = 1, run = 0, indent = '' } = {}) {
    const number = start + index;
    const bullet = BULLETS[run % 2];
    const prefix = listType === 'ordered' ? `${number}${DELIMITERS[run % 2]}`
        : listType === 'todo' ? `${bullet} [${pb.props?.checked ? 'x' : ' '}]` : bullet;
    const pad = indent + ' '.repeat(markerWidth(listType, number));
    const lines = [`${indent}${prefix} ${itemMarkdown(pb.delta || [], pad, env.toMarkdown)}`];
    const subs = (pb.children || []).filter((child) => child?.type === 'list');
    subs.forEach((sub, k) => {
        const md = renderList(sub, env, { indent: pad, before: subs.slice(0, k) });
        if (md) lines.push(md);
    });
    return lines.join('\n');
}

/**
 * A list (its items and, recursively, their sublists) as markdown.
 * @param {{ props?: { listType?: string, start?: unknown }, children?: any[] }} pb
 * @param {RenderEnv} env
 * @param {{ indent?: string, before?: Array<{ type: string, props?: { listType?: string } }> }} [ctx]  `before`: the siblings before the list
 * @returns {string}
 */
export function renderList(pb, env, { indent = '', before = [] } = {}) {
    const listType = pb.props?.listType ?? 'bullet';
    const start = env.listStart(listType, pb.props?.start) ?? 1;
    const run = adjacentRun(listType, before);
    return (pb.children || []).map((child, index) => renderItem(child, env, { listType, index, start, run, indent })).join('\n');
}
