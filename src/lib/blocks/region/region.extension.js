import { extension } from "../../utils/extensions";
import { RegionBlock } from "./region.svelte.js";
import RegionComponent from "./Region.svelte";
import { Regions } from "./regions.svelte.js";
import { normalizeRegions } from "./normalize.js";
import { createRegionCommands } from "./commands.js";
import { mergeCrossesMarker, regionFacts } from "./facts.js";
import { resolveConfig } from "./types.js";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { RegionTypeInit } from "./types.js";
 * @import { RegionMessages } from "./messages.js";
 */

/**
 * Regions extension factory (ADR 016): structure a continuous text with MARKERS. Installs the `region` marker block, the
 * root-only normalizer, and the reactive registry (`nabu.regions`, also `Regions.get(nabu)`).
 *
 * It also declares the region commands (`region:split` on Mod-Enter, the protected merges on Backspace / Delete, and the keyless
 * `region:insert` / `move` / `promote` / `demote` / `next` / `prev` / `parent`: see commands.js) and vetoes any silent text merge
 * through a marker (`onBeforeMerge`).
 *
 * @param {{ types?: Record<string, RegionTypeInit>, messages?: RegionMessages }} [options]
 *   `types`: the region types of the integrator (see `types.js`: `level`, `label`, `numbering`, `fields`). Without it,
 *   a generic `section` division over three levels is declared, as the types `section-1`, `section-2`, `section-3`.
 *   Throws on an invalid declaration.
 *   `messages`: texts of the commands and of the hold prompt (see messages.js), English by default.
 *
 * @example
 * RegionsExtension({
 *   types: {
 *     part:    { level: 1, label: 'Part {index}' },
 *     chapter: { level: 2, label: 'Chapter {index}', numbering: 'document' },
 *     scene:   { level: 3, fields: { pov: 'text' } },
 *   },
 * })
 */
export function RegionsExtension(options = {}) {
    const config = resolveConfig(options);
    // The configuration is carried by the block class (as the dash of the dialogue extension).
    const BlockClass = class extends RegionBlock { static config = config; };
    return extension("region", {
        // @ts-ignore — static-side variance on create() (same pattern as Divider/Image)
        block: BlockClass,
        component: RegionComponent,
        commands: createRegionCommands(options.messages),
        commandContext: regionFacts,
        hooks: {
            /** @param {Nabu} nabu */
            onInit: (nabu) => {
                Regions.get(nabu);
                // `nabu.regions`: installed here, so that the engine knows nothing about it (same exposure as other
                // subsystems, `Todos.get(nabu)` / `Files.get(nabu)`, plus a getter for convenience).
                if (!('regions' in nabu)) {
                    Object.defineProperty(nabu, 'regions', { get: () => Regions.get(nabu), configurable: true, enumerable: false });
                }
            },
            // Runs before doc.commit(): a marker that ended up in a container is brought back to the root, in the same
            // transaction (same undo step) as the operation that displaced it. See normalize.js.
            onBeforeTransaction: normalizeRegions,
            // Backspace / Delete never merge text through a marker, whoever asks (ADR 016 §6.1: structure is protected;
            // the merge is the hold of `region:merge-previous` / `region:merge-next`, or a selection that spans the marker).
            /** @param {Nabu} nabu @param {import("../block.svelte.js").Block} survivor @param {import("../block.svelte.js").Block} victim */
            onBeforeMerge: (nabu, survivor, victim) => (mergeCrossesMarker(nabu, survivor, victim) ? nabu.BREAK : undefined),
        },
    });
}

/** Alias following the `createXxxExtension` naming of the other factories. */
export const createRegionsExtension = RegionsExtension;
