/**
 * Closing a region from inside it (ADR 018 §3.5, "Fermer une région"): the operation behind `region:close` and the `:::` + Enter
 * trigger (the counterpart of `:::` + Space, which creates one: see create.js).
 *
 * The TRIGGER is an Enter (`insertParagraph`) in a default paragraph that holds exactly `:::` (trailing spaces allowed), the
 * collapsed caret at its end, and that is a DIRECT child of a region body. Anywhere else (outside any region, in a list, with other
 * text) Enter is an ordinary Enter. The regions that CONTAIN the caret, innermost first, are the things that can be closed:
 *
 *  - one region: it is closed at once;
 *  - several: the `choose` confirmation of `region:close` lists them ("Close Scene 2.2 — The ferryman", detail = the numbering
 *    prefix). While it is open the Enter is NOT applied: Escape (or a click away) leaves the paragraph with its `:::` as it was,
 *    and the user can press Enter again or type on.
 *
 * THE EFFECT of closing X (R0 the innermost region, p the `:::` paragraph, a child of R0; X = R_k): p is deleted; the blocks that
 * FOLLOWED p in the body of R0, then those that followed R0 in the body of R1, … up to those that followed R_{k-1} in the body of X
 * (document order) leave their bodies and are moved, in that order, right after X, in the parent of X. The caret goes to the first
 * text position of the first block that moved (a sub-region: its title); when nothing followed, an empty default paragraph is created
 * right after X for it. Moved sub-regions stay valid for the nesting rule: they are deeper than the region they were in, which was
 * deeper than X, which is deeper than the parent of X. One undo step; undo gives back the typed `:::` (and the caret after it).
 *
 * At the end of a region this is the same as `region:exit` (Mod-Shift-Enter): nothing follows, a paragraph comes after the region.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { Block } from "../block.svelte.js";
 * @import { Region } from "./regions.svelte.js";
 * @import { createMessages } from "./messages.js";
 */

import { tick } from "svelte";
import { Regions } from "./regions.svelte.js";
import { createDefaultBlock, defaultType, firstTextBlock, parentIdOf } from "./actions.js";
import { siblingsOf } from "./facts.js";

/** The text of a block, `null` when it holds none. @param {Block} block @returns {string | null} */
const textOf = (block) => /** @type {any} */ (block.behaviors.get('text'))?.text ?? null;

/**
 * The regions that contain `block` when it is a closing mark: a default paragraph without children, a DIRECT child of a region
 * body, whose text is `:::` (trailing spaces allowed) or empty. Innermost first. Empty when `block` is not such a mark.
 * @param {Nabu} nabu @param {Block | null | undefined} block
 * @returns {Region[]}
 */
export function closeChain(nabu, block) {
    if (!block || block.type !== defaultType(nabu) || /** @type {any} */ (block).children?.length) return [];
    if (!block.parent || block.parent.type !== 'region') return [];
    const text = textOf(block);
    if (text === null || !/^(::: *)?$/.test(text)) return [];
    /** @type {Region[]} */
    const chain = [];
    for (let r = Regions.get(nabu).of(block.parent); r; r = r.parent) chain.push(r);
    return chain;
}

/**
 * The options of the `region:close` chooser: one per region of `chain`, innermost first. `region` is what the command runs on.
 * @param {Region[]} chain
 * @param {ReturnType<typeof createMessages>} text  the region messages (`createMessages`)
 * @returns {Array<{ id: string, label: string, detail: string, region: Region }>}
 */
export function closeOptions(chain, text) {
    return chain.map((region) => ({
        id: region.block.id,
        label: text('closeOption', {
            typeName: region.def?.name ?? region.type, name: region.prefix || region.title || region.def?.name || region.type,
            prefix: region.prefix, title: region.title, label: region.label, type: region.type,
        }),
        detail: region.prefix,
        region,
    }));
}

/**
 * Closes `region` (an ancestor of the closing mark `mark`, see the module doc). Resolves to false (nothing changed) when `mark` is
 * not a closing mark inside `region`.
 * @param {Nabu} nabu @param {Region} region @param {Block} mark
 * @returns {Promise<boolean>}
 */
export async function closeRegionAt(nabu, region, mark) {
    const chain = closeChain(nabu, mark);
    const k = chain.findIndex((r) => r.block.id === region.block.id);
    if (k < 0) return false;

    /** The blocks that follow `block` in its parent. @param {Block} block @returns {Block[]} */
    const after = (block) => { const all = siblingsOf(nabu, block); return all.slice(all.indexOf(block) + 1); };
    // Everything is read before the first write.
    const moved = [...after(mark)];
    for (let j = 0; j < k; j++) moved.push(...after(chain[j].block));
    const target = chain[k].block.node;
    const landing = firstTextBlock(moved);

    /** @type {Block | null} */
    let created = null;
    const mutate = () => {
        /** @type {import("../nabu.svelte.js").NabuNode} */
        let anchor = target;
        for (const block of moved) { block.node.moveAfter(anchor); anchor = block.node; }
        if (!landing) created = createDefaultBlock(nabu, {}, parentIdOf(target), (target.index() ?? 0) + 1 + moved.length);
        nabu.delete(mark);
    };

    // The typed `:::` is already in the document and the Enter was not applied: `shortcut` (no trigger text) makes the closing its
    // own undo step, whose undo gives the `:::` back with the caret after it. Same technique as `createRegionHere`.
    if (mark.transformsEnabled !== false && /** @type {any} */ (mark.behaviors.get('text'))?.selection) await nabu.shortcut(mark, '', mutate);
    else { mutate(); await nabu.commit(); }

    const caretBlock = landing ?? created;
    const fresh = caretBlock && nabu.blocks.get(caretBlock.id);
    if (fresh) { await tick(); nabu.selection.setCursor(fresh, 0); }
    return true;
}

/**
 * `Extension#hooks.onBeforeInput` of the `:::` + Enter trigger (see the module doc). Returns BREAK when it took the Enter.
 * @param {Nabu} nabu @param {InputEvent} event @param {Block} block
 */
export function closeOnEnter(nabu, event, block) {
    const { BREAK, CONTINUE } = nabu;
    if (event.inputType !== 'insertParagraph') return CONTINUE;
    const behavior = /** @type {any} */ (block.behaviors.get('text'));
    const sel = behavior?.selection;
    if (!sel || !sel.isCollapsed || sel.from !== behavior.text.length || !/^::: *$/.test(behavior.text)) return CONTINUE;
    const chain = closeChain(nabu, block);
    if (!chain.length) return CONTINUE;
    if (chain.length === 1) {
        closeRegionAt(nabu, chain[0], block);
        return BREAK;
    }
    nabu.selection.sync?.(); // the command reads selection.anchorBlock: don't wait for the async `selectionchange`
    return nabu.commandConfirm.offer('region:close') ? BREAK : CONTINUE;
}
