/**
 * Undo / redo restore the SELECTION (ADR 015): what is stored with each undo step, how it is captured, and how it comes back.
 *
 * Each endpoint of a selection (anchor, focus) is remembered as Loro stable cursors on the block's text, so concurrent remote
 * edits shift it correctly, plus the block id, its tree path and the plain offset as fallbacks. Pure helpers: they know the
 * `text` behavior (container + `getDOMPoint`) and nothing about any concrete block type.
 *
 * Two cursors per endpoint, because a Loro cursor is bound to ONE character and a character deleted by the very action being
 * undone (and re-created under a new id by the undo) is no anchor any more:
 *  - `next`: bound to the character right AFTER the endpoint (an insertion at the endpoint lands before it);
 *  - `prev`: bound to the character right BEFORE the endpoint (resolved +1).
 * Whichever one still points at a live character wins (see {@link resolveOffset}).
 */

import { tick } from 'svelte';
import { Cursor } from 'loro-crdt';

/**
 * @import { LoroDoc } from 'loro-crdt';
 * @import { Nabu } from './nabu.svelte.js';
 * @import { Block } from './block.svelte.js';
 */

/**
 * @typedef {Object} Endpoint  One end of a stored selection.
 * @property {string} blockId
 * @property {number[]} path  child index at each level, root first (see {@link blockPath})
 * @property {number} offset  model offset when captured: the fallback when no cursor can be used
 * @property {number} [length]  length of the block's text when captured (see {@link resolveOffset}: both cursors dead)
 * @property {string | null} container  id of the block's text container the cursors belong to
 * @property {'start' | 'end'} role  the first end of a range sticks to the character before it, every other end to the one after
 * @property {Uint8Array | null} next  encoded Loro cursor (the UndoManager serializes what it stores: a live Cursor would not survive)
 * @property {Uint8Array | null} prev
 */

/**
 * @typedef {Object} UndoSelection  The selection stored with an undo / redo step.
 * @property {Endpoint} anchor
 * @property {Endpoint} focus  Equal to `anchor` for a caret. The direction of a backward selection is kept by which end is which.
 */

/**
 * Tree path of a block: the child index at each level, root first. Read from the Block's own
 * `parent` / `index` — still valid for a block destroyed in the very transaction being recorded,
 * whose Loro node can no longer tell (a deleted node has no index).
 * @param {Block} block
 * @returns {number[]}
 */
export function blockPath(block) {
    /** @type {number[]} */
    const path = [];
    for (let b = /** @type {any} */ (block); b; b = b.parent) path.unshift(b.index);
    return path;
}

/**
 * @param {Block} block
 * @param {number} offset
 * @param {'start' | 'end'} role
 * @param {boolean} [withCursors]  false for a caret known only after the fact (no pre-change text to bind to)
 * @returns {Endpoint}
 */
export function makeEndpoint(block, offset, role, withCursors = true) {
    const container = /** @type {any} */ (block.behaviors?.get('text'))?.container ?? null;
    /** @type {Uint8Array | null} */
    let next = null;
    /** @type {Uint8Array | null} */
    let prev = null;
    if (container && withCursors) {
        try {
            next = container.getCursor(offset, 0)?.encode() ?? null;
            prev = offset > 0 ? container.getCursor(offset - 1, 0)?.encode() ?? null : null;
        } catch { /* a container without cursor support: the plain offset remains */ }
    }
    const length = container ? container.length : undefined;
    return { blockId: block.id, path: blockPath(block), offset, length, container: container?.id ?? null, role, next, prev };
}

/**
 * Where a DOM point is in the model: the text block holding it and the offset in its text.
 * @param {Nabu} nabu
 * @param {Node} node
 * @param {number} offset
 * @returns {{ block: Block, offset: number } | null}
 */
function locate(nabu, node, offset) {
    const el = /** @type {Element | null} */ (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    if (!el || nabu.selection.closestOwn(el, '[data-nabu-ui]')) return null;
    if (!nabu.selection.owns(node)) return null; // a point of another editor (or of none) is not a position in THIS model
    const id = el.closest('[data-block-id]')?.getAttribute('data-block-id');
    const block = id ? nabu.blocks.get(id) : null;
    if (!block) return null;
    const text = /** @type {any} */ (block.behaviors?.get('text'));
    if (!text) return { block, offset: 0 };
    const at = block.element ? text.calculateOffset(node, offset, block.element) : 0;
    return { block, offset: Math.max(0, Math.min(at, text.text.length)) };
}

/**
 * The live DOM selection as MODEL points (block + text offset), anchor and focus kept apart so the direction survives.
 * The only reliable way to carry a selection across a change that rewrites the DOM of its blocks (a mark toggled, a text
 * rewritten): DOM offsets are relative to a text node, and the text nodes change with the spans.
 * @param {Nabu} nabu
 * @returns {{ anchor: { block: Block, offset: number }, focus: { block: Block, offset: number } } | null}
 */
export function livePoints(nabu) {
    if (typeof window === 'undefined' || !window.getSelection) return null;
    const live = window.getSelection();
    if (!live || live.rangeCount === 0 || !live.anchorNode || !live.focusNode) return null;
    if (nabu.selection.scope(live) !== 'mine') return null;
    const anchor = locate(nabu, live.anchorNode, live.anchorOffset);
    const focus = locate(nabu, live.focusNode, live.focusOffset);
    return anchor && focus ? { anchor, focus } : null;
}

/**
 * Put a selection given as model points (see {@link livePoints}) on the rendered DOM, direction included. Offsets are clamped to
 * the text. Does nothing when a block has no DOM point (not rendered).
 * @param {Nabu} nabu
 * @param {{ anchor: { block: Block, offset: number }, focus: { block: Block, offset: number } }} points
 * @returns {boolean} whether the selection was placed
 */
export function placePoints(nabu, { anchor, focus }) {
    /** @param {{ block: Block, offset: number }} p */
    const point = (p) => {
        const len = /** @type {any} */ (p.block.behaviors?.get('text'))?.text?.length ?? p.offset;
        return /** @type {any} */ (p.block).getDOMPoint?.(Math.max(0, Math.min(p.offset, len))) ?? null;
    };
    const a = point(anchor);
    const f = point(focus);
    if (!a || !f) return false;
    nabu.selection.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
    return true;
}

/**
 * Capture the live DOM selection as an {@link UndoSelection}. The cursors are created on the CURRENT text, so call it while the
 * model and the DOM agree and before the change to be undone is applied (see `Nabu#captureUndoSelection`).
 * @param {Nabu} nabu
 * @returns {UndoSelection | null}  null when the selection is not in this editor
 */
export function captureSelection(nabu) {
    if (typeof window === 'undefined' || !window.getSelection) return null;
    const live = window.getSelection();
    if (!live || live.rangeCount === 0 || !live.anchorNode || !live.focusNode) return null;
    if (nabu.selection.scope(live) !== 'mine') return null;
    const a = locate(nabu, live.anchorNode, live.anchorOffset);
    const f = locate(nabu, live.focusNode, live.focusOffset);
    if (!a || !f) return null;

    const collapsed = a.block === f.block && a.offset === f.offset;
    if (collapsed) {
        const ep = makeEndpoint(a.block, a.offset, 'end');
        return { anchor: ep, focus: ep };
    }
    // Which end comes first in the document decides the roles; the anchor / focus order (the direction) is kept as is.
    let anchorFirst = a.offset <= f.offset;
    if (a.block !== f.block) {
        try {
            const probe = document.createRange();
            probe.setStart(live.anchorNode, live.anchorOffset);
            probe.collapse(true);
            anchorFirst = probe.comparePoint(live.focusNode, live.focusOffset) >= 0;
        } catch { /* keep the offset order */ }
    }
    return {
        anchor: makeEndpoint(a.block, a.offset, anchorFirst ? 'start' : 'end'),
        focus: makeEndpoint(f.block, f.offset, anchorFirst ? 'end' : 'start'),
    };
}

/**
 * A caret decided by a caller (a block shortcut puts it right after the typed trigger): plain block + offset, no cursors
 * (the text it refers to is not the one the change is applied on).
 * @param {Block} block
 * @param {number} offset
 * @returns {UndoSelection}
 */
export function explicitSelection(block, offset) {
    const ep = makeEndpoint(block, offset, 'end', false);
    return { anchor: ep, focus: ep };
}

/**
 * The caret the selection state reports, when the DOM selection could not be captured (no DOM selection: a blurred editor, a
 * test environment). No cursors.
 * @param {Nabu} nabu
 * @returns {UndoSelection | null}
 */
export function legacySelection(nabu) {
    const sel = /** @type {any} */ (nabu.selection);
    const block = sel?.anchorBlock;
    if (!block) return null;
    const ep = makeEndpoint(block, sel.startOffset ?? 0, 'end', false);
    return { anchor: ep, focus: ep };
}

/**
 * Offset an endpoint stands at NOW. A cursor whose character was deleted (`update` set) is the one to distrust; of the
 * two cursors, the live one wins — for two live ones the role decides (a range start sticks to the character before it).
 * Both dead: the position of the tombstones, unless the text has the very length it had when the endpoint was captured — the
 * characters around it were then deleted and re-created by an undo / redo of the action (typing over a range: the caret between
 * the typed character and the merged tail, and both are new characters after the redo), and the stored offset is the right one.
 * @param {LoroDoc} doc
 * @param {Endpoint} ep
 * @param {number} length  current length of the text
 * @returns {number | null}  null when no cursor resolves (use the stored offset)
 */
export function resolveOffset(doc, ep, length) {
    /** @param {Uint8Array | null} encoded @param {number} shift @returns {{ offset: number, deleted: boolean } | null} */
    const at = (encoded, shift) => {
        if (!encoded) return null;
        try {
            const r = doc.getCursorPos(Cursor.decode(encoded));
            return r ? { offset: r.offset + shift, deleted: !!r.update } : null;
        } catch { return null; }
    };
    const next = at(ep.next, 0);
    // No `prev` cursor at offset 0: the start of the text is a position that cannot be deleted.
    const prev = ep.prev ? at(ep.prev, 1) : (ep.offset === 0 ? { offset: 0, deleted: false } : null);
    /** @type {{ offset: number, deleted: boolean } | null} */
    let chosen;
    if (next && prev) {
        if (next.deleted !== prev.deleted) chosen = next.deleted ? prev : next;
        else if (next.deleted && prev.deleted && ep.length === length) chosen = { offset: ep.offset, deleted: true };
        else chosen = ep.role === 'start' && !prev.deleted ? prev : next;
    } else chosen = next ?? prev;
    return chosen ? Math.max(0, Math.min(chosen.offset, length)) : null;
}

/**
 * The block and offset an endpoint stands at now. The block is found by id when it is still alive; Loro gives a block RESTORED
 * by an undo (after a delete) a new id and a new text container, so otherwise by its tree path (walked as far as it still
 * exists, then the nearest text block); the offset is the cursors' answer when they belong to the block's current text, else
 * the stored one clamped to the text.
 * @param {Nabu} nabu
 * @param {Endpoint} ep
 * @param {boolean} [strict]  only the block of that very id, still alive (no fallback by tree path): null otherwise
 * @returns {{ block: Block, offset: number } | null}
 */
function resolveEndpoint(nabu, ep, strict = false) {
    /** @param {Block | undefined | null} b */
    const alive = (b) => !!b && !b.node.isDeleted?.() && nabu.tree.has(b.node.id);
    /** @param {Block} b */
    const withText = (b) => !!b.behaviors?.has('text');
    /** @param {Block} b */
    const length = (b) => /** @type {any} */ (b.behaviors.get('text'))?.text?.length ?? 0;
    /** @param {Block} b */
    const resolve = (b) => {
        const container = /** @type {any} */ (b.behaviors.get('text'))?.container;
        const fromCursors = container && ep.container === container.id ? resolveOffset(nabu.doc, ep, length(b)) : null;
        return { block: b, offset: fromCursors ?? Math.max(0, Math.min(ep.offset, length(b))) };
    };

    const byId = nabu.blocks.get(ep.blockId);
    if (byId && alive(byId) && withText(byId)) return resolve(byId);
    if (strict) return null;

    /** @type {Block | null} */
    let found = null;
    /** @type {any} */
    let level = nabu;
    for (const i of ep.path ?? []) {
        const next = level.children?.[i];
        if (!next) break;
        found = next;
        level = next;
    }
    if (found && !withText(found)) found = found.findForward(withText);
    if (!found) found = nabu.children.find(withText) ?? nabu.children[0]?.findForward(withText) ?? null;
    return found ? resolve(found) : null;
}

/**
 * Put the stored selection back, after the undo / redo has re-rendered, then scroll it into view. A block recreated by the undo
 * may not be rendered yet: retried a few ticks.
 * @param {Nabu} nabu
 * @param {UndoSelection} snap
 * @param {number} [attempt]
 * @param {boolean} [reveal]  scroll the focus end into view (default); `false` for a change the user did not make (a remote import)
 */
export function restoreSelection(nabu, snap, attempt = 0, reveal = true) {
    tick().then(() => {
        const a = resolveEndpoint(nabu, snap.anchor);
        const f = resolveEndpoint(nabu, snap.focus);
        if (!a && !f) return;
        const anchor = /** @type {NonNullable<typeof a>} */ (a ?? f);
        const focus = /** @type {NonNullable<typeof f>} */ (f ?? a);
        if ((!anchor.block.element || !focus.block.element) && attempt < 3) return restoreSelection(nabu, snap, attempt + 1, reveal);

        if (anchor.block === focus.block && anchor.offset === focus.offset) {
            nabu.selection.setCursor(anchor.block, anchor.offset);
        } else {
            const from = /** @type {any} */ (anchor.block).getDOMPoint?.(anchor.offset);
            const to = /** @type {any} */ (focus.block).getDOMPoint?.(focus.offset);
            if (from && to) nabu.selection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
            else nabu.selection.setCursor(focus.block, focus.offset);
        }
        if (reveal) revealFocus(focus.block);
    });
}

/**
 * Keep the live selection on the characters it was on: after a change the user did not make in a block holding one of its ends
 * (a programmatic edit, a collaborator's), the DOM selection is put back where the stored endpoints (Loro cursors) now stand,
 * if it is anywhere else. Svelte rewrites the text node of an edited block, which sends the end of a DOM range to offset 0 of it
 * (P-109). Does nothing when there is no live selection in the editor, when a block of the snapshot is gone, or when the
 * selection is already right. Never scrolls.
 * @param {Nabu} nabu
 * @param {UndoSelection} snap  the selection BEFORE the change
 * @returns {boolean} whether the selection was moved
 */
export function keepSelection(nabu, snap) {
    const live = livePoints(nabu);
    if (!live) return false;
    const a = resolveEndpoint(nabu, snap.anchor, true);
    const f = resolveEndpoint(nabu, snap.focus, true);
    if (!a || !f) return false;
    if (a.block === live.anchor.block && a.offset === live.anchor.offset && f.block === live.focus.block && f.offset === live.focus.offset) return false;
    return placePoints(nabu, { anchor: a, focus: f });
}

/**
 * Scroll the moving end of the selection into view, "nearest": nothing moves when it is already visible (in the window and in
 * the scroll container that holds the editor).
 * @param {Block} block  the block holding the focus end (its element is the fallback target)
 */
export function revealFocus(block) {
    if (typeof window === 'undefined') return;
    const live = window.getSelection();
    if (!live || live.rangeCount === 0 || !live.focusNode) return;
    const holder = /** @type {Element | null} */ (live.focusNode.nodeType === Node.ELEMENT_NODE ? live.focusNode : live.focusNode.parentElement);
    const target = holder?.closest('[data-block-id]') ?? block.element;
    if (!target) return;

    /** @type {{ top: number, bottom: number } | null} */
    let rect = null;
    try {
        const caret = document.createRange();
        caret.setStart(live.focusNode, live.focusOffset);
        caret.collapse(true);
        const r = caret.getClientRects()[0] ?? caret.getBoundingClientRect();
        if (r && (r.height > 0 || r.top !== 0)) rect = r;
    } catch { /* fall back to the block */ }
    rect ??= target.getBoundingClientRect();

    // Visible band: the window, narrowed by every scrollable ancestor.
    let top = 0;
    let bottom = window.innerHeight;
    for (let el = target.parentElement; el; el = el.parentElement) {
        const overflow = getComputedStyle(el).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && el.scrollHeight > el.clientHeight) {
            const box = el.getBoundingClientRect();
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
        }
    }
    if (rect.top >= top && rect.bottom <= bottom) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
