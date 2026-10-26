import { tick } from "svelte";
import { extension } from "../../utils/extensions";
import { RegionBlock } from "./region.svelte.js";
import RegionComponent from "./Region.svelte";
import { Regions } from "./regions.svelte.js";
import { normalizeRegions } from "./normalize.js";
import { createRegionCommands } from "./commands.js";
import { mergeCrossesRegion, regionFacts } from "./facts.js";
import { resolveConfig } from "./types.js";
import { createMessages } from "./messages.js";
import { placeOf, regionChoices } from "./create.js";
import { closeOnEnter } from "./close.js";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { RegionTypeInit } from "./types.js";
 * @import { RegionMessages } from "./messages.js";
 */

/**
 * @param {Nabu} nabu @param {InputEvent} event @param {import("../block.svelte.js").Block} block
 */
function openCreateChooser(nabu, event, block) {
    const { BREAK, CONTINUE } = nabu;
    if (event.inputType !== "insertText" || event.data !== " ") return CONTINUE;
    const behavior = /** @type {any} */ (block.behaviors.get("text"));
    const sel = behavior?.selection;
    if (!sel || !sel.isCollapsed || behavior.text !== ":::" || sel.from !== 3) return CONTINUE;
    if (block.type !== nabu.defaultBlockType || /** @type {any} */ (block).children?.length || !placeOf(nabu, block)) return CONTINUE;
    behavior.insert(3, " ");
    nabu.commit().then(async () => {
        nabu.selection.setCursor(block, 4);
        await tick();
        nabu.selection.sync?.(); // the command reads selection.anchorBlock: don't wait for the async `selectionchange`
        nabu.commandConfirm.offer("region:create");
    });
    return BREAK;
}

/**
 * Regions extension factory (ADR 016, data model of ADR 018): structure a text in divisions. Installs the `region` container
 * block (its header is its title, its body is its children), the placement / nesting normalizer, and the reactive registry
 * (`nabu.regions`, also `Regions.get(nabu)`).
 *
 * It also declares the region commands (`region:split` on Mod-Enter, the protected merges on Backspace / Delete, and the keyless
 * `region:insert` / `move` / `promote` / `demote` / `next` / `prev` / `parent`: see commands.js) and vetoes any silent text merge
 * into, out of or across a title (`onBeforeMerge`).
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
    const text = createMessages(options.messages);
    // The configuration is carried by the block class (as the dash of the dialogue extension).
    const BlockClass = class extends RegionBlock { static config = config; static messages = options.messages; };
    return extension("region", {
        // @ts-ignore — static-side variance on create() (same pattern as Divider/Image)
        block: BlockClass,
        component: RegionComponent,
        commands: createRegionCommands(options.messages),
        commandContext: regionFacts,
        // One slash entry per declared type, offered where the type fits INSIDE the caret's place (create.js).
        slashCommands: [...config.types.values()].map((def) => ({
            title: text('slash', { name: def.name, type: def.id }),
            icon: '§',
            aliases: [def.id, 'region'],
            when: (/** @type {Nabu} */ nabu, /** @type {import("../block.svelte.js").Block} */ block) => {
                const place = placeOf(nabu, block);
                return !!place && regionChoices(nabu, place.parent).here.some((d) => d.id === def.id);
            },
            run: (/** @type {Nabu} */ nabu) => { nabu.exec('region:create', { type: def.id }); },
        })),
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
            // `:::` + Space in an empty default paragraph (at the root or in a region body) asks which region to create: the
            // space is typed as usual (so Escape leaves `::: ` as text), then the `choose` confirmation of `region:create`
            // opens at the caret. See create.js.
            // `:::` + Enter in a paragraph of a region body closes a region (close.js); the Enter is not applied.
            /** @param {Nabu} nabu @param {InputEvent} event @param {import("../block.svelte.js").Block} block */
            onBeforeInput: (nabu, event, block) => {
                const closed = closeOnEnter(nabu, event, block);
                return closed === nabu.BREAK ? closed : openCreateChooser(nabu, event, block);
            },
            // Runs before doc.commit(): a region that ended up in a list / toggle is brought back next to it, and a region too
            // shallow for its parent is moved out, in the same transaction (same undo step) as the operation that displaced it.
            // See normalize.js.
            onBeforeTransaction: normalizeRegions,
            // Backspace / Delete never merge text into a title, out of it, or across a seam, whoever asks (ADR 016 §6.1,
            // ADR 018 §3.9: structure is protected; the merge is the hold of `region:merge-previous` / `region:merge-next`).
            /** @param {Nabu} nabu @param {import("../block.svelte.js").Block} survivor @param {import("../block.svelte.js").Block} victim */
            onBeforeMerge: (nabu, survivor, victim) => (mergeCrossesRegion(nabu, survivor, victim) ? nabu.BREAK : undefined),
        },
    });
}

/** Alias following the `createXxxExtension` naming of the other factories. */
export const createRegionsExtension = RegionsExtension;
