/**
 * Mark edges of typed text: the rule is Nabu's, not Loro's.
 *
 * Nabu's marks are exact (`expand: 'none'`): a character typed at the edge of a mark does not take it, and one typed inside a mark
 * (the same value on the character before and the one after) keeps it. That is what the user sees, whatever the history of the
 * document. Loro, however, decides from the anchors of the style operations that happened, so two texts that look identical can
 * differ: `[012]3456[789]` made by two `mark` calls takes nothing when "X" is typed at 3, the same text made by `mark [0,10)` then
 * `unmark [3,7)` makes "X" bold (and two `mark` calls that meet at the insertion point make it plain although both sides are bold).
 *
 * {@link markEdgeFixes} reads the typed run and its two neighbours and returns the marks to add or remove so that the typed run
 * follows the rule. A mark the user armed (a stored mark, Ctrl+B with a collapsed caret) is explicit and left alone, on or off.
 */

import { effective, sameValue } from '../../utils/delta.js';

/**
 * @typedef {{ start: number, end: number, name: string, value: any }} MarkFix  `value` null: remove the mark over the range
 */

/**
 * The value text typed between two characters takes for the mark `name`, or `undefined`: the mark must be on both neighbours with the
 * same value (typing inside a run). The one place that says it, for the correction of a typed run and for what Ctrl+B reads.
 * @param {Record<string, any> | undefined} left  effective attributes of the character before (undefined: none)
 * @param {Record<string, any> | undefined} right  effective attributes of the character after (undefined: none)
 * @param {string} name
 */
export function sharedMark(left, right, name) {
    return left && right && name in left && name in right && sameValue(left[name], right[name]) ? left[name] : undefined;
}

/**
 * What typing at the collapsed caret `pos` would produce for the mark `name`, read from a delta (the canonical one a behavior holds):
 * the value the typed text would carry, or `undefined`. This is what "the mark is active at the caret" means.
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @param {number} pos
 * @param {string} name
 */
export function markAtCaret(delta, pos, name) {
    /** @type {Record<string, any> | undefined} */
    let left;
    /** @type {Record<string, any> | undefined} */
    let right;
    let offset = 0;
    for (const op of delta) {
        const length = typeof op.insert === 'string' ? op.insert.length : 1;
        const end = offset + length;
        if (pos > 0 && offset <= pos - 1 && pos - 1 < end) left = effective(op.attributes) ?? {};
        if (offset <= pos && pos < end) { right = effective(op.attributes) ?? {}; break; }
        offset = end;
    }
    return sharedMark(left, right, name);
}

/**
 * The corrections for a run just inserted at `[from, end)`.
 * @param {import('loro-crdt').Delta<string>[]} ops  `sliceDelta(lo, hi)` of the text, where `lo <= from - 1` (when `from > 0`) and `hi >= end + 1` (when there is a character after)
 * @param {number} lo  where `ops` start in the text
 * @param {number} from  start of the typed run
 * @param {number} end  end of the typed run (exclusive)
 * @param {number} total  length of the text
 * @param {Record<string, boolean> | null | undefined} armed  the stored marks (explicit on / off), not touched
 * @returns {MarkFix[]}
 */
export function markEdgeFixes(ops, lo, from, end, total, armed) {
    // Fast path (almost every keystroke): no mark anywhere around the typed run.
    if (!ops.some((op) => op.attributes)) return [];
    /** @type {Record<string, any>} */
    let left = {};
    /** @type {Record<string, any>} */
    let right = {};
    /** @type {{ start: number, end: number, attrs: Record<string, any> }[]} */
    const typed = [];
    let pos = lo;
    for (const op of ops) {
        if (typeof op.insert !== 'string') { pos += 1; continue; }
        const stop = pos + op.insert.length;
        const attrs = effective(op.attributes) ?? {};
        if (from > 0 && pos <= from - 1 && from - 1 < stop) left = attrs;
        if (end < total && pos <= end && end < stop) right = attrs;
        const s = Math.max(pos, from), e = Math.min(stop, end);
        if (s < e) typed.push({ start: s, end: e, attrs });
        pos = stop;
    }
    /** @type {MarkFix[]} */
    const fixes = [];
    for (const { start, end: stop, attrs } of typed) {
        for (const name of new Set([...Object.keys(attrs), ...Object.keys(left)])) {
            if (armed && name in armed) continue;
            const want = sharedMark(left, right, name);
            if (want === undefined) {
                if (name in attrs) fixes.push({ start, end: stop, name, value: null });
            } else if (!(name in attrs) || !sameValue(attrs[name], want)) {
                fixes.push({ start, end: stop, name, value: want });
            }
        }
    }
    return fixes;
}
