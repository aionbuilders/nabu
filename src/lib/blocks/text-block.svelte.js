import { Block } from "./block.svelte.js";
import { LoroText } from "loro-crdt";
import { TextBehavior } from "../behaviors/text/text.behavior.svelte.js";

/**
 * @import { Nabu, NabuNode } from "./nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{text: LoroText}>} TextBlockNode
 */

/**
 * Base class for purely textual blocks (paragraph, heading, dialogue…).
 * Owns a single TextBehavior and proxies the standard Block text API to it,
 * removing the proxy boilerplate previously duplicated in every text block.
 *
 * Hybrid blocks (MegaBlock + TextBehavior, like ListItem) must NOT extend
 * this class — their children/positions logic differs.
 */
export class TextBlock extends Block {
    /** @type {TextBehavior} */
    #behavior;

    /**
     * @param {Nabu} nabu
     * @param {NabuNode} node
     * @param {LoroText} [textContainer] - Existing LoroText container. Defaults to the node's "text" container (created if missing).
     */
    constructor(nabu, node, textContainer) {
        super(nabu, node);
        const data = /** @type {TextBlockNode} */ (node).data;
        /** @type {LoroText} */
        this.container = textContainer ?? data.get("text") ?? data.setContainer("text", new LoroText());
        this.#behavior = new TextBehavior(/** @type {Block} */ (/** @type {unknown} */ (this)), this.container);
        this.behaviors.set("text", this.#behavior);
    }

    /** @returns {TextBehavior} */
    get behavior() { return this.#behavior; }

    get text() { return this.behavior.text; }

    get delta() { return this.behavior.delta; }

    selection = $derived(this.behavior.selection);
    positions = $derived(this.behavior.positions);
    wordCount = $derived(this.behavior.wordCount);

    /** @param {InputEvent} event */
    beforeinput(event) { return this.behavior.handleBeforeInput(event); }

    /**
     * Retrouve le nœud texte et l'offset DOM pour un offset Modèle donné
     * @param {number} targetOffset
     * @returns {{node: Node, offset: number} | null}
     */
    getDOMPoint(targetOffset) { return this.behavior.getDOMPoint(targetOffset); }

    /** @param {Block} block */
    absorbs(block) { return this.behavior.absorbs(block); }

    /** @param {number} index @param {string} text */
    insert(index, text) { return this.behavior.insert(index, text); }

    /** @param {Parameters<Block["delete"]>[0]} [deletion] */
    delete(deletion) { return this.behavior.delete(deletion); }

    /** @param {import('loro-crdt').Delta<string>[]} data */
    applyDelta(data = []) { return this.behavior.applyDelta(data); }

    /** @param {Parameters<Block["split"]>[0]} [options] @returns {ReturnType<Block["split"]>} */
    split(options) { return this.behavior.split(options); }
}
