/**
 * The operations behind the region commands (ADR 016 lot 2): split, insert, merge, move, retype, navigate. Each structural
 * operation is ONE transaction, i.e. one undo step (the undo restores the selection, ADR 015: the selection captured before the
 * operation is the one the step gives back). They mutate the Loro tree, commit once, and put the caret back where it belongs.
 * No key handling here (see commands.js); a function returns whether it changed something.
 *
 * Everything works on the ROOT of the document: a marker lives nowhere else (ADR 016 §3.1).
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 */

import { tick } from "svelte";
import { Regions } from "./regions.svelte.js";
import { createMarker, rootIndexOf } from "./insert.js";
import { hasText, isRootTextBlock } from "./facts.js";

/** The marker block of a region, a marker block or the id of one. @param {Nabu} nabu @param {unknown} target @returns {Region | null} */
export function toRegion(nabu, target) {
    if (!target) return null;
    const regions = Regions.get(nabu);
    if (typeof target === 'string') return regions.of(target);
    const marker = /** @type {any} */ (target).marker ?? target;
    return typeof marker?.id === 'string' ? regions.of(marker.id) : null;
}

/** Puts the caret back after a commit (the DOM is re-rendered by then). @param {Nabu} nabu @param {Block | null | undefined} block @param {number} offset */
async function restoreCaret(nabu, block, offset) {
    if (!block) return;
    await tick();
    const fresh = nabu.blocks.get(block.id);
    if (fresh) nabu.selection.setCursor(fresh, offset);
}

/**
 * "Split here" (ADR 016 §3.4): cuts the root text block at the caret and opens a region of the SAME type as the current one
 * (the default top-level type in the preamble) at the cut. The head stays in the current region, the tail starts the new one.
 *  - mid-text or at the end: the block is split like Enter does (a heading cut at its end gives a paragraph), the marker goes
 *    between the two halves; the caret goes to the start of the tail;
 *  - at the very start of the block: no split, the marker goes right before the block; the caret stays;
 * A block that does not split on Enter (a code block, where Mod-Enter is the user's own) is left alone.
 * One undo step. Returns false when the caret is not in a splittable root text block.
 * @param {Nabu} nabu
 * @param {{ block: Block | null }} ctx
 * @returns {Promise<boolean>}
 */
export async function splitRegion(nabu, ctx) {
    const block = ctx.block;
    if (!block || !isRootTextBlock(block) || block.splitsOnEnter === false) return false;
    const sel = block.selection;
    if (!sel) return false;
    const regions = Regions.get(nabu);
    const current = regions.at(block);
    const type = current && regions.config.types.has(current.type) ? current.type : regions.config.defaultType;
    const length = /** @type {any} */ (block.behaviors.get('text')).text.length;
    const offset = Math.min(sel.from, length);
    const rootIndex = block.node.index() ?? rootIndexOf(nabu, block);

    /** @type {Block | null | undefined} */
    let landing = block;
    if (offset === 0) {
        createMarker(nabu, { type, index: rootIndex });
    } else {
        // The split commits itself (twice: the new block, then the cut head) and the marker commit follows in the same
        // synchronous turn: the engine merges the three into one undo step.
        const cut = block.split({ offset, to: length });
        if (!cut?.block) return false;
        landing = cut.block;
        createMarker(nabu, { type, index: landing.node.index() ?? rootIndex + 1 });
    }
    await nabu.commit();
    await restoreCaret(nabu, landing, 0);
    return true;
}

/**
 * Inserts a marker next to a region, as one undo step; the caret stays where it is.
 *  - `at: 'after'` (default): right after the region's WHOLE range (its sub-regions included); `'before'`: right before its marker;
 *  - the preamble is treated as a region of its own: `'before'` = the start of the document, `'after'` = the end of the preamble.
 * @param {Nabu} nabu
 * @param {Region | null} region  the region the position is relative to (`null` = the preamble)
 * @param {{ type?: string, at?: 'after' | 'before', title?: string, fields?: Record<string, any> }} [options]
 *   `type` defaults to the type of `region`, else the default (top-level) type.
 * @returns {Promise<boolean>}
 */
export async function insertNearRegion(nabu, region, { type, at = 'after', title, fields } = {}) {
    const regions = Regions.get(nabu);
    const { types, defaultType } = regions.config;
    const wanted = type ?? (region && types.has(region.type) ? region.type : defaultType);
    if (!types.has(wanted)) { nabu.warn(`region:insert: region type "${wanted}" is not declared`); return false; }
    if (at !== 'after' && at !== 'before') { nabu.warn(`region:insert: "at" must be "after" or "before", got ${JSON.stringify(at)}`); return false; }
    const index = region ? (at === 'before' ? region.start : region.end) : (at === 'before' ? 0 : regions.preamble.end);
    createMarker(nabu, { type: wanted, index, title, fields });
    await nabu.commit();
    return true;
}

/**
 * Removes the marker of `region`: its content joins the previous region, or the preamble (the sub-regions follow it and
 * re-nest by their levels). The text is never touched. One undo step. The caret, if given, is put back.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {{ block: Block | null, offset: number } | null} [caret]
 * @returns {Promise<boolean>}
 */
export async function removeMarker(nabu, region, caret = null) {
    nabu.delete(region.marker);
    await nabu.commit();
    if (caret) await restoreCaret(nabu, caret.block, caret.offset);
    return true;
}

/**
 * Whether `region` has something to merge into: a previous region, or a non-empty preamble.
 * @param {Nabu} nabu @param {Region | null} region
 */
export function canMergeIntoPrevious(nabu, region) {
    if (!region) return false;
    const regions = Regions.get(nabu);
    return !!regions.prev(region) || regions.preamble.end > 0;
}

/**
 * Moves a region WITH its sub-regions (its whole block range) before the previous / after the next sibling. A sibling is the
 * neighbour in the parent's children (the top level for a root region) and must be of the SAME level; at an edge, or next to
 * a sibling of another level, nothing moves. One undo step; the caret is put back.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {'up' | 'down'} direction
 * @param {{ block: Block | null, offset: number } | null} [caret]
 * @returns {Promise<boolean>}
 */
export async function moveRegion(nabu, region, direction, caret = null) {
    const regions = Regions.get(nabu);
    const siblings = region.parent ? region.parent.children : regions.tree;
    const sibling = siblings[siblings.indexOf(region) + (direction === 'up' ? -1 : 1)];
    if (!sibling || sibling.level !== region.level) return false;

    const moving = nabu.children.slice(region.start, region.end);
    if (direction === 'up') {
        for (const block of moving) block.node.moveBefore(sibling.marker.node);
    } else {
        /** @type {Block} */
        let anchor = /** @type {Block} */ (nabu.children[sibling.end - 1]);
        for (const block of moving) { block.node.moveAfter(anchor.node); anchor = block; }
    }
    await nabu.commit();
    if (caret) await restoreCaret(nabu, caret.block, caret.offset);
    return true;
}

/**
 * Changes the type of a region's marker to a declared type of the level above (`promote`) or below (`demote`): the level IS
 * the type (ADR 016 §7), the structure re-derives from it. With several types on that level, the first declared one is used.
 * No-op when there is no such level, or when the marker's type is not declared. One undo step.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {'promote' | 'demote'} way
 * @returns {Promise<boolean>}
 */
export async function retypeRegion(nabu, region, way) {
    if (!region.def) return false;
    const level = region.level + (way === 'promote' ? -1 : 1);
    const target = [...Regions.get(nabu).config.types.values()].find((def) => def.level === level);
    if (!target) return false;
    region.marker.setRegionType(target.id, { commit: false });
    await nabu.commit();
    return true;
}

/**
 * Puts the caret at the first text position of `region` (its first text block, in its own content or in a sub-region) and
 * scrolls it into view. A region without text: its seam is scrolled into view and the caret stays.
 * @param {Nabu} nabu
 * @param {Region} region
 * @returns {Promise<boolean>}
 */
export async function goToRegion(nabu, region) {
    const first = region.marker.findForward(hasText);
    const inside = first && rootIndexOf(nabu, first) < region.end;
    await tick();
    if (!first || !inside) {
        /** @type {any} */ (region.marker.element)?.scrollIntoView?.({ block: 'center' });
        return false;
    }
    nabu.selection.setCursor(first, 0);
    /** @type {any} */ (first.element)?.scrollIntoView?.({ block: 'center' });
    return true;
}
