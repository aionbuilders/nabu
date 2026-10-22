/**
 * The FACTS the regions extension adds to the command context (ADR 017 `commandContext`, ADR 016 lot 2). The core builds the
 * context at each key press that has a command bound to it; these facts let the commands' `when` / `label` / `confirm.target`
 * speak about regions without the engine knowing what a region is.
 *
 *  - `region`            the deepest region holding the caret block (`null` in the preamble / without caret)
 *  - `previousRegion`    the region before it in document order (`null` for the first one or in the preamble)
 *  - `nextRegion`        the first region that STARTS after the caret block (the next marker the caret would cross
 *                        going forward); the first region of the document from the preamble
 *  - `inRootTextBlock`   the caret is in a top-level text block that holds no children (not in a list, a toggle, a callout…)
 *  - `atStartOfRegion`   collapsed caret at offset 0 of the first root text block of a region: no text block lies between the
 *                        marker and the caret
 *  - `atEndOfRegion`     collapsed caret at the end of its text, and the text block that a Delete would merge into this one
 *                        (the next one in document order) belongs to ANOTHER region (a marker lies in between)
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 */

import { Regions } from "./regions.svelte.js";

/** The block can hold a caret in a text (same test the engine's Backspace / Delete use to find their merge partner). @param {Block | null | undefined} b */
export const hasText = (b) => !!b?.behaviors?.has('text');

/** The block holds children (a container, a hybrid such as a list item or a toggle). @param {Block} b */
const isContainer = (b) => 'children' in b;

/**
 * A top-level text block without children: where `region:split` applies.
 * @param {Block | null | undefined} block
 * @returns {boolean}
 */
export function isRootTextBlock(block) {
    return !!block && !block.parent && hasText(block) && !isContainer(block);
}

/**
 * @typedef {Object} RegionFacts
 * @property {Region | null} region
 * @property {Region | null} previousRegion
 * @property {Region | null} nextRegion
 * @property {boolean} inRootTextBlock
 * @property {boolean} atStartOfRegion
 * @property {boolean} atEndOfRegion
 */

/**
 * `Extension#commandContext` of the regions extension.
 * @param {Nabu} nabu
 * @param {{ block: Block | null, isCollapsed: boolean, inRoot: boolean }} ctx
 * @returns {RegionFacts}
 */
export function regionFacts(nabu, ctx) {
    /** @type {RegionFacts} */
    const facts = { region: null, previousRegion: null, nextRegion: null, inRootTextBlock: false, atStartOfRegion: false, atEndOfRegion: false };
    const block = ctx.block;
    if (!block) return facts;

    const regions = Regions.get(nabu);
    const region = regions.at(block);
    facts.region = region;
    facts.previousRegion = region ? regions.prev(region) : null;
    facts.nextRegion = region ? regions.next(region) : (regions.list[0] ?? null);
    facts.inRootTextBlock = isRootTextBlock(block);

    if (!ctx.isCollapsed || !hasText(block)) return facts;
    const sel = block.selection;
    if (!sel || sel.from !== sel.to) return facts;
    const length = /** @type {any} */ (block.behaviors.get('text')).text?.length ?? 0;

    if (sel.from === 0 && facts.inRootTextBlock && region) {
        // Nothing but non-text blocks (an image, a divider) between the marker and here: a Backspace would cross the marker.
        const partner = block.findBackward(hasText);
        facts.atStartOfRegion = !partner || regions.at(partner) !== region;
    }
    if (sel.from === length) {
        const partner = block.findForward(hasText);
        facts.atEndOfRegion = !!partner && regions.at(partner) !== region;
    }
    return facts;
}

/**
 * Whether a Backspace / Delete merge of two text blocks would cross a region marker, i.e. the two blocks are not in the same
 * region. This is the `onBeforeMerge` veto: it refuses ANY silent merge through a marker, whatever started it (a key not bound
 * to a command, a virtual keyboard, a block type that handles Backspace itself…).
 * @param {Nabu} nabu @param {Block} survivor @param {Block} victim
 * @returns {boolean}
 */
export function mergeCrossesMarker(nabu, survivor, victim) {
    const regions = Regions.get(nabu);
    return regions.at(survivor) !== regions.at(victim);
}
