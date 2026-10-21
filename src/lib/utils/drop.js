/**
 * Drag & drop toolbox (ADR 014, lot 4): everything the editor needs to turn a pointer over the document into a MODEL
 * position, and to classify what is being dragged. Agnostic: it knows blocks only through their `text` behavior and
 * their `children`, never through a concrete type.
 *
 * Vocabulary
 *  - A {@link DropPosition} is where a drop lands: a caret position in the text of a block (`side: 'inside'`), or
 *    "beside" a block that holds no text and no children (a divider, an image… `side: 'before' | 'after'`).
 *  - A {@link DropTarget} is a position + what the drop will do (`kind`). It is what `nabu.dropTarget` exposes.
 */

/**
 * @import { Nabu } from '../blocks/nabu.svelte.js';
 * @import { Block } from '../blocks/block.svelte.js';
 */

/**
 * @typedef {'inside' | 'before' | 'after'} DropSide
 *   `inside`: a caret position in the text of `block`; `before` / `after`: beside a block without text (image, divider…).
 */

/**
 * @typedef {Object} DropPosition
 * @property {Block} block
 * @property {number} offset  Text offset in `block` (0 when `side` is not `inside`).
 * @property {DropSide} side
 */

/**
 * @typedef {'files' | 'content' | 'move'} DropKind
 *   `files`: OS files (become media blocks); `content`: text / HTML / markdown / Nabu fragment from outside (or a copy);
 *   `move`: the editor's own text selection being moved.
 */

/** @typedef {DropPosition & { kind: DropKind }} DropTarget */

/** MIME type that marks a drag started inside an editor (its value is a per-drag token). */
export const DRAG_MARKER = 'application/x-nabu-drag';
/** The Nabu clipboard / drag fragment format (see `Nabu#handleCopy`). */
export const NABU_FORMAT = 'application/x-nabu+json';

/**
 * What a drag carries, from its `types` alone (the data itself is not readable before the drop).
 *  - an internal fragment is `content` even when files come along (the fragment already holds the bytes);
 *  - `Files` is `files` when some extension takes files, else it counts as nothing;
 *  - any format an interpreter reads is `content`.
 * @param {ArrayLike<string> | null | undefined} types  `DataTransfer#types`
 * @param {{ formats: string[], files: boolean }} ctx  `formats`: the formats the paste interpreters read; `files`: whether a file handler exists
 * @returns {'files' | 'content' | null}
 */
export function transferKind(types, ctx) {
    const list = Array.from(types ?? []);
    if (!list.length) return null;
    if (list.includes(NABU_FORMAT) && ctx.formats.includes(NABU_FORMAT)) return 'content';
    if (ctx.files && list.includes('Files')) return 'files';
    return ctx.formats.some((format) => list.includes(format)) ? 'content' : null;
}

/**
 * Whether the pointer's modifiers ask for a COPY instead of a move. Platform conventions: Ctrl on Windows / Linux,
 * Option (Alt) on macOS — both are accepted everywhere (Ctrl+drag is a secondary click on macOS and never reaches us).
 * @param {{ ctrlKey?: boolean, altKey?: boolean }} e
 */
export const wantsCopy = (e) => !!(e.ctrlKey || e.altKey);

/**
 * The `dropEffect` to announce: `wanted` when the drag source's `effectAllowed` permits it, else the first effect it
 * does allow (announcing a forbidden effect makes the browser refuse the drop).
 * @param {string | undefined} effectAllowed
 * @param {'copy' | 'move'} wanted
 * @returns {'copy' | 'move' | 'link'}
 */
export function pickDropEffect(effectAllowed, wanted) {
    const allowed = effectAllowed || 'uninitialized';
    if (allowed === 'uninitialized' || allowed === 'all') return wanted;
    const has = (/** @type {string} */ effect) => allowed.toLowerCase().includes(effect);
    if (has(wanted)) return wanted;
    if (has('copy')) return 'copy';
    if (has('move')) return 'move';
    return 'link';
}

/**
 * Which half of a box the pointer is in.
 * @param {number} y
 * @param {{ top: number, bottom: number }} rect
 * @returns {'before' | 'after'}
 */
export const pointerHalf = (y, rect) => (y > (rect.top + rect.bottom) / 2 ? 'after' : 'before');

/**
 * Index of the box the pointer at `y` belongs to: the SMALLEST box containing `y` (the deepest block), else the box
 * with the nearest edge (ties: the smallest). -1 for no box.
 * @param {Array<{ top: number, bottom: number }>} rects
 * @param {number} y
 * @returns {number}
 */
export function nearestRect(rects, y) {
    let best = -1;
    let bestDistance = Infinity;
    let bestHeight = Infinity;
    rects.forEach((rect, i) => {
        const distance = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
        const height = rect.bottom - rect.top;
        if (distance < bestDistance || (distance === bestDistance && height < bestHeight)) {
            best = i; bestDistance = distance; bestHeight = height;
        }
    });
    return best;
}

/**
 * Whether two targets are the same drop (to avoid re-publishing reactive state on every `dragover`).
 * @param {DropTarget | null} a
 * @param {DropTarget | null} b
 */
export const sameTarget = (a, b) => a === b || (!!a && !!b && a.block === b.block && a.offset === b.offset && a.side === b.side && a.kind === b.kind);

/**
 * Document order of two block elements, a block's own text coming before its children (pre-order): -1 when `a` is
 * before `b`, 1 when after, 0 for the same block.
 * @param {Element} a
 * @param {Element} b
 * @returns {-1 | 0 | 1}
 */
export function compareBlocks(a, b) {
    if (a === b) return 0;
    if (a.contains(b)) return -1;
    if (b.contains(a)) return 1;
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * Whether a drop position lies in a model range, its two ends included (dropping a selection on itself, or right at its
 * edge, changes nothing). A position beside a block (before / after) is in the range when that block is.
 * @param {{ startBlock: Block, startOffset: number, endBlock: Block, endOffset: number }} range
 * @param {DropPosition} at
 * @returns {boolean}
 */
export function positionInRange(range, at) {
    const { startBlock, startOffset, endBlock, endOffset } = range;
    const { block } = at;
    if (at.side === 'inside') {
        if (block === startBlock && block === endBlock) return at.offset >= startOffset && at.offset <= endOffset;
        if (block === startBlock) return at.offset >= startOffset;
        if (block === endBlock) return at.offset <= endOffset;
    } else if (block === startBlock || block === endBlock) {
        return false;
    }
    const x = /** @type {Element | null | undefined} */ (block.element);
    const s = /** @type {Element | null | undefined} */ (startBlock.element);
    const e = /** @type {Element | null | undefined} */ (endBlock.element);
    if (!x || !s || !e) return false;
    return compareBlocks(s, x) < 0 && compareBlocks(x, e) < 0;
}

/**
 * Where a drop position goes once `range` has been removed from the document (`deleteRange`): a position after the range
 * in the same block shifts back by the removed length; one in the range's end block, when that block was merged into the
 * start block, follows its text there. `endMerged`: the end block no longer exists.
 * @param {{ startBlock: Block, startOffset: number, endBlock: Block, endOffset: number }} range
 * @param {DropPosition} at  a position outside the range
 * @param {boolean} endMerged
 * @returns {DropPosition}
 */
export function positionAfterRemoval(range, at, endMerged) {
    if (at.side !== 'inside') return at;
    const { startBlock, startOffset, endBlock, endOffset } = range;
    if (startBlock === endBlock) {
        return at.block === startBlock && at.offset >= endOffset ? { ...at, offset: at.offset - (endOffset - startOffset) } : at;
    }
    if (at.block !== endBlock) return at;
    return endMerged
        ? { ...at, block: startBlock, offset: startOffset + at.offset - endOffset }
        : { ...at, offset: at.offset - endOffset };
}

/**
 * The DOM point under a viewport coordinate (`caretPositionFromPoint` — standard, Firefox / Chromium ≥ 128 — or the
 * older `caretRangeFromPoint` — WebKit / Blink).
 * @param {number} x
 * @param {number} y
 * @returns {{ node: Node, offset: number } | null}
 */
export function caretPointFromPoint(x, y) {
    if (typeof document === 'undefined') return null;
    const doc = /** @type {any} */ (document);
    try {
        if (typeof doc.caretPositionFromPoint === 'function') {
            const pos = doc.caretPositionFromPoint(x, y);
            if (pos?.offsetNode) return { node: pos.offsetNode, offset: pos.offset };
        }
        if (typeof doc.caretRangeFromPoint === 'function') {
            const range = doc.caretRangeFromPoint(x, y);
            if (range) return { node: range.startContainer, offset: range.startOffset };
        }
    } catch { /* outside the viewport, detached… */ }
    return null;
}

/** A block that holds no text and no children: it can only be dropped before / after, never into. @param {Block} block */
const isVoid = (block) => !block.behaviors?.has('text') && !/** @type {any} */ (block).children?.length;

/** @param {Block} block @returns {number} */
const textLength = (block) => block.behaviors?.get('text')?.text?.length ?? 0;

/**
 * The innermost block whose element is at a viewport point, inside `root` (UI islands are not blocks).
 * @param {Nabu} nabu
 * @param {HTMLElement} root
 * @param {number} x
 * @param {number} y
 * @returns {Block | null}
 */
function blockAtPoint(nabu, root, x, y) {
    const el = /** @type {Element | null} */ (document.elementFromPoint(x, y));
    if (!el || !root.contains(el) || el.closest('[data-nabu-ui]')) return null;
    const id = el.closest('[data-block-id]')?.getAttribute('data-block-id');
    return (id && nabu.blocks.get(id)) || null;
}

/**
 * The position of a DOM point in the text of `block`, or null when it is not on the block's own text (a nested child
 * block's text, an inert part, a UI island, an element-level caret).
 * @param {Block} block
 * @param {Node} node
 * @param {number} offset
 * @returns {number | null}
 */
function textOffsetOf(block, node, offset) {
    const text = block.behaviors?.get('text');
    const el = /** @type {HTMLElement | null | undefined} */ (block.element);
    if (!text || !el || node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return null;
    const host = node.parentElement;
    if (host?.closest('[data-nabu-inert], [data-nabu-ui]')) return null;
    if (host?.closest('[data-block-id]') !== el) return null; // the text of a child block, not of this one
    return Math.min(text.calculateOffset(node, offset, el), text.text.length);
}

/**
 * The model position under the pointer. Text blocks: the caret position under the pointer (else the start / end of the
 * block, by the pointer's half). Blocks without text or children (image, divider…): before / after, by the pointer's
 * half. Anywhere else (padding of the editor, gaps between blocks, containers): the nearest block, so that a pointer
 * above the first block lands at the start of the document and below the last at its end.
 * @param {Nabu} nabu
 * @param {HTMLElement} root  the editor's root element
 * @param {number} x  viewport coordinates
 * @param {number} y
 * @returns {DropPosition | null}
 */
export function resolveDropPosition(nabu, root, x, y) {
    const under = blockAtPoint(nabu, root, x, y);
    const el = /** @type {HTMLElement | null | undefined} */ (under?.element);
    if (under && el?.isConnected) {
        if (isVoid(under)) return { block: under, offset: 0, side: pointerHalf(y, el.getBoundingClientRect()) };
        if (under.behaviors?.has('text')) {
            const caret = caretPointFromPoint(x, y);
            const offset = caret ? textOffsetOf(under, caret.node, caret.offset) : null;
            if (offset !== null) return { block: under, offset, side: 'inside' };
            return { block: under, offset: pointerHalf(y, el.getBoundingClientRect()) === 'after' ? textLength(under) : 0, side: 'inside' };
        }
    }
    return nearestBlockPosition(nabu, y);
}

/**
 * The drop position for a pointer that is on no block: the vertically nearest block that is a leaf (a text block or a
 * block without text and children), the start / end of its text or beside it, by the pointer's half.
 * @param {Nabu} nabu
 * @param {number} y  viewport ordinate
 * @returns {DropPosition | null}
 */
export function nearestBlockPosition(nabu, y) {
    /** @type {Array<{ block: Block, top: number, bottom: number }>} */
    const candidates = [];
    for (const block of nabu.blocks.values()) {
        const el = /** @type {HTMLElement | null | undefined} */ (block.element);
        if (!el?.isConnected || block.node?.isDeleted?.()) continue;
        if (!block.behaviors?.has('text') && !isVoid(block)) continue; // a container without text: its children are the candidates
        const rect = el.getBoundingClientRect();
        if (!rect.height && !rect.width) continue; // not rendered
        candidates.push({ block, top: rect.top, bottom: rect.bottom });
    }
    const at = nearestRect(candidates, y);
    if (at < 0) return null;
    const { block, ...rect } = candidates[at];
    const half = pointerHalf(y, rect);
    if (isVoid(block)) return { block, offset: 0, side: half };
    return { block, offset: half === 'after' ? textLength(block) : 0, side: 'inside' };
}

/**
 * The end of the document as a drop position: the end of the last visible block's text, or after it when it holds none.
 * @param {Nabu} nabu
 * @returns {DropPosition | null}
 */
export function documentEnd(nabu) {
    const last = nabu.lastVisibleBlock;
    if (!last) return null;
    return last.behaviors?.has('text')
        ? { block: last, offset: textLength(last), side: 'inside' }
        : { block: last, offset: 0, side: 'after' };
}
