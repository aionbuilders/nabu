/**
 * The operations behind the region commands (ADR 018 lot A2): split, insert, merge, unwrap, exit, move, promote / demote,
 * navigate. A region is a CONTAINER: every structural operation is a handful of tree moves (a block that survives is MOVED,
 * never deleted and recreated, so its id, its text and the caret survive), committed ONCE = one undo step (the undo restores
 * the selection, ADR 015: the selection captured before the operation is the one the step gives back). They put the caret
 * back where it belongs. No key handling here (see commands.js); a function returns whether it changed something.
 *
 * Reads go through the registry and the blocks (the committed, rendered state); writes go through the Loro tree nodes. An
 * operation reads EVERYTHING it needs before its first write.
 *
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 */

import { tick } from "svelte";
import { Regions } from "./regions.svelte.js";
import { createRegion } from "./insert.js";
import { hasText, isBodyTextBlock, mergePlan, neighbourOf, siblingsOf } from "./facts.js";

/** @typedef {{ block: Block, offset: number }} Caret */

/** The children nodes of a node (a snapshot, in order). @param {NabuNode} node @returns {NabuNode[]} */
export const kids = (node) => /** @type {NabuNode[]} */ (node.children() ?? []);

/** The id of a node's parent, `null` at the root. @param {NabuNode} node @returns {string | null} */
export const parentIdOf = (node) => node.parent()?.id.toString() ?? null;

/** The region of a `Region`, of a region block, or of the id of a region block. @param {Nabu} nabu @param {unknown} target @returns {Region | null} */
export function toRegion(nabu, target) {
    if (!target) return null;
    const regions = Regions.get(nabu);
    if (typeof target === 'string') return regions.of(target);
    const block = /** @type {any} */ (target).block ?? /** @type {any} */ (target).marker ?? target;
    return typeof block?.id === 'string' ? regions.of(block.id) : null;
}

/** The type of the blocks the editor creates by default (a paragraph). @param {Nabu} nabu @returns {string} */
export const defaultType = (nabu) => (nabu.defaultBlockType && nabu.registry.has(nabu.defaultBlockType) ? nabu.defaultBlockType : 'paragraph');

/**
 * Creates a block of the default text type WITHOUT committing (the caller owns the transaction).
 * @param {Nabu} nabu @param {Record<string, any>} props @param {string | null} parentId @param {number} index @returns {Block}
 */
export function createDefaultBlock(nabu, props, parentId, index) {
    const type = defaultType(nabu);
    return /** @type {any} */ (nabu.registry.get(type)).create(nabu, type, props, parentId, index);
}

/** Puts the caret back after a commit (the DOM is re-rendered by then). @param {Nabu} nabu @param {Block | null | undefined} block @param {number} offset */
export async function restoreCaret(nabu, block, offset) {
    if (!block) return;
    await tick();
    const fresh = nabu.blocks.get(block.id);
    if (fresh) nabu.selection.setCursor(fresh, offset);
}

/** The first block holding text, in document order, among `blocks` and their descendants (a sub-region's title counts). @param {Block[]} blocks @returns {Block | null} */
function firstTextBlock(blocks) {
    for (const block of blocks) {
        if (hasText(block)) return block;
        const found = firstTextBlock(/** @type {any} */ (block).children ?? []);
        if (found) return found;
    }
    return null;
}

/** The first declared type of a level (several types may share one level: the first declared wins). @param {Regions} regions @param {number} level */
const typeOfLevel = (regions, level) => [...regions.config.types.values()].find((def) => def.level === level);

/**
 * "Split here" (ADR 018 §3.5): the region C whose body directly holds the caret block (none at the root) gets a new sibling N
 * of the same type (the default type at the root) right after it. The caret block is cut like Enter does (a heading cut at its
 * end gives a paragraph, mid-text both halves keep their type; at offset 0 there is no cut), then the tail and ALL the blocks
 * that follow it move, in order, into the body of N. At the root N takes the tail and the root blocks that follow it up to
 * (excluding) the next root region. The caret goes to the start of the tail.
 * A block that does not split on Enter (a code block, where Mod-Enter is the user's own) is left alone. One undo step: the
 * block split commits itself (twice), and the engine merges those commits with ours, which follows in the same synchronous turn.
 * @param {Nabu} nabu
 * @param {{ block: Block | null }} ctx
 * @returns {Promise<boolean>} false when the caret is not in a splittable text block
 */
export async function splitRegion(nabu, ctx) {
    const block = ctx.block;
    if (!block || !isBodyTextBlock(block) || block.splitsOnEnter === false) return false;
    const sel = block.selection;
    if (!sel) return false;
    const regions = Regions.get(nabu);
    const current = block.parent ? regions.of(block.parent) : null;
    const type = current && regions.config.types.has(current.type) ? current.type : regions.config.defaultType;
    const length = /** @type {any} */ (block.behaviors.get('text')).text.length;
    const offset = Math.min(sel.from, length);

    // The first block that moves: the caret block itself at offset 0, else the tail of the cut.
    let first = block;
    if (offset > 0) {
        const cut = block.split({ offset, to: length });
        if (!cut?.block) return false;
        first = cut.block;
    }

    const node = first.node;
    const siblings = node.parent() ? kids(/** @type {NabuNode} */ (node.parent())) : /** @type {NabuNode[]} */ (nabu.tree.roots());
    const from = siblings.findIndex((n) => n.id === node.id);
    let movers = siblings.slice(from);
    if (!current) {
        const stop = movers.findIndex((n) => n.data.get('type') === 'region');
        if (stop >= 0) movers = movers.slice(0, stop);
    }

    // Right after the region (a sibling), or at the cut at the root.
    const fresh = current
        ? createRegion(nabu, { type, parentId: parentIdOf(current.block.node), index: (current.block.node.index() ?? 0) + 1 })
        : createRegion(nabu, { type, parentId: null, index: from });
    movers.forEach((n, i) => n.move(fresh.node, i));

    await nabu.commit();
    await restoreCaret(nabu, first, 0);
    return true;
}

/**
 * Inserts an empty region next to a region, as one undo step; the caret stays where it is.
 *  - `at: 'after'` (default): right after `region`, in its parent (a sibling; its whole body stays with it); `'before'`: right before it;
 *  - without `region` (the caret is outside any region): at the caret's position among the root blocks (`from` = the caret
 *    block): after / before the root block that holds it.
 * @param {Nabu} nabu
 * @param {Region | null} region  the region the position is relative to
 * @param {{ type?: string, at?: 'after' | 'before', title?: string, fields?: Record<string, any> }} [options]
 *   `type` defaults to the type of `region`, else the default (top-level) type.
 * @param {Block | null} [from]  the caret block, for the case without region
 * @returns {Promise<boolean>}
 */
export async function insertNearRegion(nabu, region, { type, at = 'after', title, fields } = {}, from = null) {
    const regions = Regions.get(nabu);
    const { types, defaultType: topType } = regions.config;
    const wanted = type ?? (region && types.has(region.type) ? region.type : topType);
    if (!types.has(wanted)) { nabu.warn(`region:insert: region type "${wanted}" is not declared`); return false; }
    if (at !== 'after' && at !== 'before') { nabu.warn(`region:insert: "at" must be "after" or "before", got ${JSON.stringify(at)}`); return false; }

    /** @type {string | null} */
    let parentId = null;
    let index;
    if (region) {
        parentId = parentIdOf(region.block.node);
        index = (region.block.node.index() ?? 0) + (at === 'before' ? 0 : 1);
    } else {
        /** @type {Block | null} */
        let root = from;
        while (root?.parent) root = /** @type {Block} */ (root.parent);
        const position = root ? nabu.children.indexOf(root) : -1;
        index = position < 0 ? (at === 'before' ? 0 : nabu.children.length) : position + (at === 'before' ? 0 : 1);
    }
    createRegion(nabu, { type: wanted, parentId, index, title, fields });
    await nabu.commit();
    return true;
}

/**
 * Where the caret goes once `region`'s title is gone (merge, unwrap): the start of the first text block of its body, else null.
 * @param {Region} region @returns {Caret | null}
 */
function bodyLanding(region) {
    const first = firstTextBlock(region.block.children);
    return first ? { block: first, offset: 0 } : null;
}

/**
 * Dissolves a region node in place: its children take its position in its parent, in order, and the node is deleted by the
 * caller. Writes only.
 * @param {NabuNode} node
 */
function spill(node) {
    /** @type {NabuNode} */
    let anchor = node;
    for (const child of kids(node)) {
        child.moveAfter(anchor);
        anchor = child;
    }
}

/**
 * Merges a region with what is before it (ADR 018 §3.5, see `mergePlan`): into its previous sibling when that one is a region
 * of the same level (its body joins the end of that body), else the region is dissolved in place (its body takes its
 * position in its parent). The title goes away in both cases (an undo gives it back). One undo step. The caret, if given,
 * is put back; when it was in the title that went away it goes to the start of the body (else the end of the region joined).
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {Caret | null} [caret]
 * @returns {Promise<boolean>} false when there is nothing to merge with (the first region of the document)
 */
export async function mergeRegion(nabu, region, caret = null) {
    const plan = mergePlan(nabu, region);
    if (!plan) return false;
    const landing = caret && caret.block !== region.block
        ? caret
        : (bodyLanding(region) ?? (plan.kind === 'merge' ? { block: plan.into.block, offset: plan.into.block.title.length } : null));

    if (plan.kind === 'merge') {
        const target = plan.into.block.node;
        let at = kids(target).length;
        for (const child of kids(region.block.node)) child.move(target, at++);
    } else {
        spill(region.block.node);
    }
    nabu.delete(region.block);
    await nabu.commit();
    if (landing) await restoreCaret(nabu, landing.block, landing.offset);
    return true;
}

/**
 * Dissolves a region (ADR 018 §3.5): its title, when not empty, becomes a default paragraph at the region's position (delta and
 * marks kept), followed by the children of its body, in order; the region is deleted. One undo step. The caret goes to the
 * same offset in the paragraph if it was in the title, else it is put back.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {Caret | null} [caret]
 * @returns {Promise<boolean>}
 */
export async function unwrapRegion(nabu, region, caret = null) {
    const node = region.block.node;
    /** @type {Caret | null} */
    let landing = caret && caret.block !== region.block ? caret : bodyLanding(region);

    /** @type {NabuNode} */
    let anchor = node;
    if (region.block.title.length) {
        const paragraph = createDefaultBlock(nabu, { delta: region.block.container.toDelta() }, parentIdOf(node), node.index() ?? 0);
        anchor = paragraph.node;
        if (caret && caret.block === region.block) landing = { block: paragraph, offset: caret.offset };
    }
    for (const child of kids(node)) {
        child.moveAfter(anchor);
        anchor = child;
    }
    nabu.delete(region.block);
    await nabu.commit();
    if (landing) await restoreCaret(nabu, landing.block, landing.offset);
    return true;
}

/**
 * Leaves a region (ADR 018 §3.5, `region:exit`): the caret ends up in an empty default paragraph right after the region, in the
 * region's parent (one level up).
 *  - the caret block is an EMPTY default paragraph that is the LAST child of the region's body: that very paragraph moves out,
 *    right after the region (so repeating the command climbs scene, chapter, part, root);
 *  - otherwise a new empty paragraph is created there.
 * One undo step.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {Block | null} [from]  the block holding the caret
 * @returns {Promise<boolean>}
 */
export async function exitRegion(nabu, region, from = null) {
    const node = region.block.node;
    const last = region.block.children[region.block.children.length - 1];
    const movable = !!from && from === last && from.type === defaultType(nabu)
        && /** @type {any} */ (from.behaviors.get('text'))?.text === '' && !(/** @type {any} */ (from).children?.length);

    /** @type {Block} */
    let landing;
    if (movable && from) {
        from.node.moveAfter(node);
        landing = from;
    } else {
        landing = createDefaultBlock(nabu, {}, parentIdOf(node), (node.index() ?? 0) + 1);
    }
    await nabu.commit();
    await restoreCaret(nabu, landing, 0);
    return true;
}

/**
 * Swaps a region with the previous / next sibling node that is a region of the SAME level, in the same parent: they trade
 * places with their bodies (a region is a container, it moves with its subtree); the text siblings in between stay where
 * they are. At an edge, or when the next sibling region has another level, nothing moves (no commit). One undo step.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {'up' | 'down'} direction
 * @param {Caret | null} [caret]
 * @returns {Promise<boolean>}
 */
export async function moveRegion(nabu, region, direction, caret = null) {
    const siblings = siblingsOf(nabu, region.block);
    const step = direction === 'up' ? -1 : 1;
    let j = siblings.indexOf(region.block) + step;
    while (siblings[j] && siblings[j].type !== 'region') j += step;
    const other = siblings[j] ? Regions.get(nabu).of(siblings[j]) : null;
    if (!other || other.level !== region.level) return false;

    const [first, second] = direction === 'up' ? [other, region] : [region, other];
    const beforeSecond = neighbourOf(nabu, second.block, -1);
    second.block.node.moveBefore(first.block.node);
    // Text between the two: the first one goes after it, i.e. to where the second one was.
    if (beforeSecond && beforeSecond !== first.block) first.block.node.moveAfter(beforeSecond.node);

    await nabu.commit();
    if (caret) await restoreCaret(nabu, caret.block, caret.offset);
    return true;
}

/**
 * Demotes a region (ADR 018 §3.5), structurally like a list indent: it is retyped to the first type of the level below and
 * becomes the LAST child of its previous sibling node, which must be a region shallower than the new type. The sub-regions of
 * its body that are now too shallow for it (level <= its new level) are moved out, in order, right after it (inside the
 * sibling). No-op (no commit) when there is no deeper type or no such sibling. One undo step.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {Caret | null} [caret]
 * @returns {Promise<boolean>}
 */
export async function demoteRegion(nabu, region, caret = null) {
    const regions = Regions.get(nabu);
    const target = region.def && typeOfLevel(regions, region.level + 1);
    if (!target) return false;
    const previous = neighbourOf(nabu, region.block, -1);
    const into = previous?.type === 'region' ? regions.of(previous) : null;
    if (!into || into.level >= target.level) return false;
    const out = region.children.filter((child) => child.def && child.level <= target.level);

    const node = region.block.node;
    region.block.setRegionType(target.id, { commit: false });
    node.move(into.block.node, kids(into.block.node).length);
    /** @type {NabuNode} */
    let anchor = node;
    for (const child of out) {
        child.block.node.moveAfter(anchor);
        anchor = child.block.node;
    }

    await nabu.commit();
    if (caret) await restoreCaret(nabu, caret.block, caret.offset);
    return true;
}

/**
 * Promotes a region (ADR 018 §3.5, Q4), the inverse of a demotion: it is retyped to the first type of the level above and
 * leaves its parent region P to sit right after it (in P's parent); every block that FOLLOWED it in P's body, text and
 * regions, follows it into its body, in order, appended after its own. No-op (no commit) when it has no parent region or
 * there is no type one level up. One undo step.
 * @param {Nabu} nabu
 * @param {Region} region
 * @param {Caret | null} [caret]
 * @returns {Promise<boolean>}
 */
export async function promoteRegion(nabu, region, caret = null) {
    const regions = Regions.get(nabu);
    const parent = region.parent;
    const target = region.def && parent && typeOfLevel(regions, region.level - 1);
    if (!parent || !target) return false;
    const siblings = parent.block.children;
    const followers = siblings.slice(siblings.indexOf(region.block) + 1);

    const node = region.block.node;
    region.block.setRegionType(target.id, { commit: false });
    node.moveAfter(parent.block.node);
    let at = kids(node).length;
    for (const follower of followers) follower.node.move(node, at++);

    await nabu.commit();
    if (caret) await restoreCaret(nabu, caret.block, caret.offset);
    return true;
}

/**
 * Puts the caret at the first text position of the BODY of `region` (the first text block after its title, inside it), else
 * at the end of its title, and scrolls it into view.
 * @param {Nabu} nabu
 * @param {Region} region
 * @returns {Promise<boolean>}
 */
export async function goToRegion(nabu, region) {
    await tick();
    const first = firstTextBlock(region.block.children);
    if (first) nabu.selection.setCursor(first, 0);
    else nabu.selection.setCursor(region.block, region.block.title.length);
    /** @type {any} */ ((first ?? region.block).element)?.scrollIntoView?.({ block: 'center' });
    return true;
}
