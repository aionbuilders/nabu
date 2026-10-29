// Workaround for a Loro quirk (the raw delta keeps a split after an exact unmark). https://github.com/loro-dev/loro/issues/1241
// Canary: tests/unit/loro-quirks.test.js.
/**
 * The canonical form of a rich-text delta.
 *
 * `LoroText.toDelta()` keeps a split where a mark was removed over exactly the range it was applied to: bolding `[18, 21)` then
 * un-bolding `[18, 21)` leaves `[{ insert: 'The ford is upstre' }, { insert: 'am.' }]` instead of one run (an unmark over a wider
 * range merges, which is why it looked random). The split lives in the document, snapshots included, and is not repaired there:
 * every read of a delta goes through {@link readDelta}, so that the engine only ever sees runs that differ.
 *
 * Canonical means: no empty insert, no attribute whose value is `null`, `undefined` or `false` (a mark that is off is an absent
 * mark, the way the renderers and `isMarkActive` read it), no `attributes` object when none is left, and no two adjacent text
 * runs with the same attributes. An embed (a non-string insert) is kept untouched and never merged.
 */

/** @typedef {import('loro-crdt').Delta<string>} DeltaOp */

/**
 * Whether a mark value counts as "off".
 * @param {unknown} value
 */
const isOff = (value) => value === null || value === undefined || value === false;

/**
 * Whether an op carries an attribute that is off, or an empty attribute object (it must be rewritten).
 * @param {Record<string, any> | undefined} attrs
 */
function isDirty(attrs) {
    if (!attrs) return false;
    let any = false;
    for (const key in attrs) {
        if (isOff(attrs[key])) return true;
        any = true;
    }
    return !any;
}

/**
 * The attributes of an op without the ones that are off, `undefined` when none is left.
 * @param {Record<string, any> | undefined} attrs
 * @returns {Record<string, any> | undefined}
 */
export function effective(attrs) {
    if (!attrs) return undefined;
    /** @type {Record<string, any> | undefined} */
    let out;
    for (const key in attrs) if (!isOff(attrs[key])) (out ??= {})[key] = attrs[key];
    return out;
}

/**
 * Whether two mark values are the same (links compare by href; an object value by its content).
 * @param {any} a @param {any} b
 */
export function sameValue(a, b) {
    if (a === b) return true;
    if (a && b && typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return false;
}

/**
 * Whether two EFFECTIVE attribute sets (no off value) are equal.
 * @param {Record<string, any> | undefined} a @param {Record<string, any> | undefined} b
 */
function sameAttributes(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    let count = 0;
    for (const key in a) {
        if (!(key in b) || !sameValue(a[key], b[key])) return false;
        count++;
    }
    for (const _ in b) count--;
    return count === 0;
}

/**
 * The canonical form of a delta (see the top of this file). One linear pass; when the delta already is canonical (the usual
 * case, this runs on every keystroke) the SAME array is returned, nothing is allocated.
 * @param {DeltaOp[]} delta
 * @returns {DeltaOp[]}
 */
export function normalizeDelta(delta) {
    const n = delta.length;
    // First pass: is there anything to do?
    let canonical = true;
    for (let i = 0; i < n && canonical; i++) {
        const op = delta[i];
        if (typeof op.insert !== 'string') continue;
        if (op.insert === '' || isDirty(op.attributes)) { canonical = false; break; }
        const next = delta[i + 1];
        if (next && typeof next.insert === 'string' && sameAttributes(op.attributes, next.attributes)) canonical = false;
    }
    if (canonical) return delta;

    /** @type {DeltaOp[]} */
    const out = [];
    /** @type {DeltaOp | null} */
    let last = null; // the run being built (a copy, never an op of the input)
    for (const op of delta) {
        if (typeof op.insert !== 'string') { out.push(op); last = null; continue; }
        if (op.insert === '') continue;
        const attrs = effective(op.attributes);
        if (last && sameAttributes(/** @type {any} */ (last.attributes), attrs)) {
            last.insert = /** @type {string} */ (last.insert) + op.insert;
            continue;
        }
        last = attrs ? { insert: op.insert, attributes: attrs } : { insert: op.insert };
        out.push(last);
    }
    return out;
}

/**
 * The canonical delta of a Loro text: the only way the engine reads `toDelta()`.
 * @param {{ toDelta: () => DeltaOp[] }} container
 * @returns {DeltaOp[]}
 */
export function readDelta(container) {
    return normalizeDelta(container.toDelta());
}
