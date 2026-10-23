/**
 * The FACTS the regions extension adds to the command context (ADR 017 `commandContext`, ADR 018 §3.5). The core builds the
 * context at each key press that has a command bound to it; these facts let the commands' `when` / `label` / `confirm.target`
 * speak about regions without the engine knowing what a region is.
 *
 *  - `region`             the deepest region holding the caret block (a region block, i.e. a title, is its own region);
 *                         `null` at the root outside any region / without caret
 *  - `previousRegion`     the region before `region` in document order (`null` for the first one or at the root)
 *  - `nextRegion`         the first region whose title lies AFTER the caret block in document order (a sub-region of the
 *                         caret's own region included)
 *  - `inTitle`            the caret block IS a region block: the caret is in a title
 *  - `inBodyTextBlock`    the caret is in a text block that holds no children (a paragraph, a heading, a quote…, not a list item,
 *                         a toggle, a callout…) and whose parent is a region (its body) or the root of the document
 *  - `atStartOfRegion`    collapsed caret at offset 0 of the TITLE of `region`, or of the first text-holding block after the
 *                         title (whatever its type, nested or not: the first item of a list counts) that still belongs to it:
 *                         no text block lies between the title and the caret. Blocks without text (an image) do not count.
 *  - `atEndOfRegion`      collapsed caret at the end of its text, and the next text block in document order is the TITLE of a
 *                         region N whose previous sibling node (same parent) contains the caret block, or IS the caret block:
 *                         a seam lies right ahead and a Delete would cross it. Examples: the last paragraph of a chapter
 *                         followed by the next chapter; the last paragraph of a scene that closes a chapter (N = the NEXT
 *                         chapter, the scene's parent being the previous sibling); a root paragraph right before a region; a
 *                         paragraph that precedes a sub-region of its own region (N = that sub-region); the end of the title
 *                         of an empty region (N = the region after it).
 *  - `nextBoundaryRegion` that region N (`null` when `atEndOfRegion` is false)
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 */

import { Regions } from "./regions.svelte.js";

/** The block can hold a caret in a text (same test the engine's Backspace / Delete use to find their merge partner). @param {Block | null | undefined} b */
export const hasText = (b) => !!b?.behaviors?.has('text');

/** The block holds children (a container, a hybrid such as a list item, a toggle or a region). @param {Block} b */
const isContainer = (b) => 'children' in b;

/**
 * A text block without children directly in the body of a region or at the root: where `region:split` applies.
 * @param {Block | null | undefined} block
 * @returns {boolean}
 */
export function isBodyTextBlock(block) {
    return !!block && hasText(block) && !isContainer(block) && (!block.parent || block.parent.type === 'region');
}

/** The blocks that share a parent with `block` (the root blocks of the document for a root block). @param {Nabu} nabu @param {Block} block @returns {Block[]} */
export function siblingsOf(nabu, block) {
    return /** @type {Block[]} */ (block.parent ? /** @type {any} */ (block.parent).children : nabu.children);
}

/** The sibling node right before / after `block` (any type of block), or null. @param {Nabu} nabu @param {Block} block @param {-1 | 1} [step] */
export function neighbourOf(nabu, block, step = -1) {
    const siblings = siblingsOf(nabu, block);
    return siblings[siblings.indexOf(block) + step] ?? null;
}

/**
 * The first block after `block` in document order (its own body included) that satisfies `predicate`: the answer of
 * `block.findForward(predicate)`, in LINEAR time. `Block#findForward` revisits the following siblings recursively, which is
 * exponential in the number of blocks that follow when nothing matches (a document without any region after the caret: 40
 * paragraphs hang the page on every Backspace), and these facts are computed at each key press that has a command bound to it.
 * @param {Nabu} nabu @param {Block} block @param {(b: Block) => boolean} predicate @returns {Block | null}
 */
export function findAfter(nabu, block, predicate) {
    /** @param {Block[]} blocks @returns {Block | null} */
    const scan = (blocks) => {
        for (const b of blocks) {
            if (predicate(b)) return b;
            const kids = /** @type {any} */ (b).children;
            if (kids?.length && !/** @type {any} */ (b).hidesChildren) {
                const found = scan(kids);
                if (found) return found;
            }
        }
        return null;
    };
    const own = /** @type {any} */ (block).children;
    /** @type {Block | null} */
    let found = own?.length && !/** @type {any} */ (block).hidesChildren ? scan(own) : null;
    for (let current = /** @type {Block | null} */ (block); !found && current; current = /** @type {Block | null} */ (current.parent)) {
        const siblings = siblingsOf(nabu, current);
        found = scan(siblings.slice(siblings.indexOf(current) + 1));
    }
    return found;
}

/** Whether `ancestor` is `block` or one of its ancestors. @param {Block} ancestor @param {Block} block */
function holds(ancestor, block) {
    /** @type {Block | null} */
    let current = block;
    while (current) {
        if (current === ancestor) return true;
        current = /** @type {Block | null} */ (current.parent);
    }
    return false;
}

/**
 * What a protected merge of `region` does (ADR 018 §3.5): the region MERGES INTO its previous sibling node when that one is a
 * region of the SAME level (its body joins the end of that one's body, the title goes away); otherwise it is DISSOLVED in
 * place (its body takes its position in its parent, the title goes away). `null` when there is nothing before it and no
 * parent region (the first region of the document: nothing to merge with).
 * @param {Nabu} nabu @param {Region} region
 * @returns {{ kind: 'merge', into: Region } | { kind: 'dissolve' } | null}
 */
export function mergePlan(nabu, region) {
    const regions = Regions.get(nabu);
    const previous = neighbourOf(nabu, region.block, -1);
    const into = previous?.type === 'region' ? regions.of(previous) : null;
    if (into && into.level === region.level) return { kind: 'merge', into };
    return previous || region.parent ? { kind: 'dissolve' } : null;
}

/**
 * @typedef {Object} RegionFacts
 * @property {Region | null} region
 * @property {Region | null} previousRegion
 * @property {Region | null} nextRegion
 * @property {boolean} inTitle
 * @property {boolean} inBodyTextBlock
 * @property {boolean} atStartOfRegion
 * @property {boolean} atEndOfRegion
 * @property {Region | null} nextBoundaryRegion
 */

/**
 * `Extension#commandContext` of the regions extension.
 * @param {Nabu} nabu
 * @param {{ block: Block | null, isCollapsed: boolean, inRoot: boolean }} ctx
 * @returns {RegionFacts}
 */
export function regionFacts(nabu, ctx) {
    /** @type {RegionFacts} */
    const facts = { region: null, previousRegion: null, nextRegion: null, inTitle: false, inBodyTextBlock: false, atStartOfRegion: false, atEndOfRegion: false, nextBoundaryRegion: null };
    const block = ctx.block;
    if (!block) return facts;

    const regions = Regions.get(nabu);
    const region = regions.at(block);
    facts.region = region;
    facts.previousRegion = region ? regions.prev(region) : null;
    const ahead = findAfter(nabu, block, (b) => b.type === 'region');
    facts.nextRegion = ahead ? regions.of(ahead) : null;
    facts.inTitle = block.type === 'region';
    facts.inBodyTextBlock = isBodyTextBlock(block);

    if (!ctx.isCollapsed || !hasText(block)) return facts;
    const sel = block.selection;
    if (!sel || sel.from !== sel.to) return facts;
    const length = /** @type {any} */ (block.behaviors.get('text')).text?.length ?? 0;

    if (sel.from === 0 && region) {
        // The title itself, or: no text block between the title and here (the title is the previous text in document order).
        facts.atStartOfRegion = facts.inTitle || block.findBackward(hasText) === region.block;
    }
    if (sel.from === length) {
        const partner = findAfter(nabu, block, hasText);
        const boundary = partner?.type === 'region' ? regions.of(partner) : null;
        const before = boundary && neighbourOf(nabu, boundary.block, -1);
        if (boundary && before && holds(before, block)) {
            facts.atEndOfRegion = true;
            facts.nextBoundaryRegion = boundary;
        }
    }
    return facts;
}

/**
 * Whether a Backspace / Delete merge of two text blocks must be refused (ADR 018 §3.9): one of them is a region block (its
 * TITLE: nothing merges into or out of a title), or they are not in the same region (the merge would cross a seam). This is
 * the `onBeforeMerge` veto: it refuses ANY silent merge through a seam, whatever started it (a key not bound to a command,
 * a virtual keyboard, a block type that handles Backspace itself…).
 * @param {Nabu} nabu @param {Block} survivor @param {Block} victim
 * @returns {boolean}
 */
export function mergeCrossesRegion(nabu, survivor, victim) {
    if (survivor.type === 'region' || victim.type === 'region') return true;
    const regions = Regions.get(nabu);
    return regions.at(survivor) !== regions.at(victim);
}
