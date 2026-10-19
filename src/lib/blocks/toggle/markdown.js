/**
 * Markdown for the Toggle block: the `<details>` construct, and ONLY that one.
 *
 * Export (what Nabu emits):
 *
 *     <details>              (or `<details open>` when expanded)
 *     <summary>header, inline markdown</summary>
 *
 *     body, block markdown
 *
 *     </details>
 *
 * Import / paste recognises exactly this construct: an opening line that is `<details>` or `<details open>` (nothing else
 * on it, no attribute, lower case), a `<summary>…</summary>` that follows it (on the same line, as the first Nabu exports
 * wrote it, or on the next one; the summary text may span lines), the body as markdown, and a closing line that is
 * `</details>`; nesting is allowed (a `<details>` of the body is matched with its own closing line, fenced code is
 * skipped). Everything else stays literal text: any other tag, an attribute (`<details class=x>`, `<details open=…>`,
 * `<details onclick=…>`), no summary, no closing line. No attribute or tag is ever passed through to the document: the
 * result is a Toggle block (`collapsed` = not `open`) with a header and a body of Nabu blocks.
 *
 * Pure functions, no DOM, no runes.
 */

const OPEN_RE = /^<details( open)?>[ \t]*(.*)$/;
const CLOSE_RE = /^<\/details>[ \t]*$/;
const SUMMARY_OPEN = '<summary>';
/** A `</summary>` ending a line, unless it is escaped (an odd number of backslashes before the `<`: `\</summary>` is text). */
const SUMMARY_CLOSE_RE = /(^|[^\\])((?:\\\\)*)<\/summary>[ \t]*$/;
const FENCE_RE = /^ {0,3}(`{3,}[^`]*|~{3,}.*)$/;

/**
 * Index of the line that closes the fence opened on line `at`, or -1 (an unclosed fence runs to the end of the text: it is
 * not skipped, the `</details>` after it still closes the toggle).
 * @param {string[]} lines
 * @param {number} at
 * @returns {number}
 */
function fenceEnd(lines, at) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(lines[at]);
    if (!open) return -1;
    for (let k = at + 1; k < lines.length; k++) {
        const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines[k]);
        if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) return k;
    }
    return -1;
}

/**
 * Index of the `</details>` line that closes a body starting at line `from`, or -1.
 * @param {string[]} lines
 * @param {number} from
 * @returns {number}
 */
function findClose(lines, from) {
    for (let j = from; j < lines.length; j++) {
        const line = lines[j];
        if (CLOSE_RE.test(line)) return j;
        if (FENCE_RE.test(line)) {
            const end = fenceEnd(lines, j);
            if (end >= 0) { j = end; continue; }
        }
        if (OPEN_RE.test(line)) {
            const inner = parseDetails(lines, j);
            if (inner) j = inner.end;
        }
    }
    return -1;
}

/**
 * The `<details>` construct that starts at line `at`, if it is the exact one (see the header), else `null`.
 * @param {string[]} lines
 * @param {number} at
 * @returns {{ open: boolean, summary: string, bodyStart: number, end: number } | null}
 */
export function parseDetails(lines, at) {
    const head = OPEN_RE.exec(lines[at] ?? '');
    if (!head) return null;
    // The summary starts on the same line as the opener, or on the next one.
    let s = at;
    let first = head[2];
    if (!first) { s = at + 1; first = lines[s] ?? ''; }
    if (!first.startsWith(SUMMARY_OPEN)) return null;
    first = first.slice(SUMMARY_OPEN.length);

    const parts = [];
    let k = s;
    let current = first;
    for (;;) {
        const close = SUMMARY_CLOSE_RE.exec(current);
        if (close) { parts.push(current.slice(0, close.index + close[1].length + close[2].length)); break; }
        parts.push(current);
        if (++k >= lines.length || !lines[k].trim()) return null; // no `</summary>` before a blank line / the end
        current = lines[k];
    }
    const bodyStart = k + 1;
    const end = findClose(lines, bodyStart);
    if (end < 0) return null;
    return { open: !!head[1], summary: parts.join('\n'), bodyStart, end };
}

/**
 * The toggle as markdown. `head` is the inline markdown of the header, `body` the markdown of each body block.
 * @param {boolean} collapsed
 * @param {string} head
 * @param {string[]} body
 * @returns {string}
 */
export function toggleMarkdown(collapsed, head, body) {
    const content = body.filter(Boolean).join('\n\n');
    return `${collapsed ? '<details>' : '<details open>'}\n<summary>${head}</summary>\n\n${content ? content + '\n\n' : ''}</details>`;
}
