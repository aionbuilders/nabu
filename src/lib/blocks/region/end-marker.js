/**
 * The end marker of a region (ADR 018 §3.3 "repère de fin", board 9 option B: "only when needed"). When text of the PARENT
 * follows a region (a block that is not a region comes right after it, in the same body or at the root), the interface draws a
 * discreet line after the region's body so that its end is readable: "End of 1.2 · back to 1. The ferryman", or "… · outside
 * regions" at the root. Nothing is drawn when the next sibling is a region (its seam already says so) or when the region is the
 * last child (the parent's own end follows).
 *
 * Pure functions, so that the condition and the text are testable on their own. `Region.svelte` draws the result.
 *
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 * @import { createMessages } from "./messages.js";
 */

/**
 * Whether a region block is followed, among `siblings` (the children of its parent, or the root blocks), by something that is NOT a
 * region.
 * @param {ReadonlyArray<{ id: string, type: string }>} siblings
 * @param {{ id: string }} block  the region block
 * @returns {boolean}
 */
export function needsEndMarker(siblings, block) {
    const index = siblings.findIndex((b) => b.id === block.id);
    const next = index < 0 ? undefined : siblings[index + 1];
    return !!next && next.type !== 'region';
}

/** @param {Pick<Region, 'prefix' | 'title' | 'label' | 'type' | 'def'>} region */
function params(region) {
    return {
        name: region.prefix || region.title || region.def?.name || region.type,
        prefix: region.prefix,
        title: region.title,
        label: region.label,
        type: region.type,
    };
}

/**
 * The text of the end marker of `region`, from the messages (`endOf`, then `backTo` with the parent or `outside`), joined by " · ".
 * @param {ReturnType<typeof createMessages>} text  the region messages (`createMessages`)
 * @param {Region} region
 * @returns {string}
 */
export function endMarkerText(text, region) {
    const parent = region.parent;
    const second = parent
        ? text('backTo', { ...params(parent), name: parent.label || params(parent).name })
        : text('outside');
    return `${text('endOf', params(region))} · ${second}`;
}
