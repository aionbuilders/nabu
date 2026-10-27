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
        /**
         * The Loro text of the block: the source of its `text` and `delta`.
         * @type {LoroText}
         * @public
         */
        this.container = textContainer ?? data.get("text") ?? data.setContainer("text", new LoroText());
        this.#behavior = new TextBehavior(/** @type {Block} */ (/** @type {unknown} */ (this)), this.container);
        this.behaviors.set("text", this.#behavior);
    }

    /**
     * The text behavior of the block (`behaviors.get('text')`): reads and edits the text, selection, marks and clipboard form.
     * @returns {TextBehavior}
     * @public
     */
    get behavior() { return this.#behavior; }

    /** The plain text of the block (reactive). @public */
    get text() { return this.behavior.text; }

    /** The text with its marks, as a Loro delta (reactive). @public */
    get delta() { return this.behavior.delta; }

    /** The selection inside this block, `{ from, to, direction }` in text offsets, or `null` (reactive). @public */
    selection = $derived(this.behavior.selection);
    /** Caret positions of the block: its text length plus one (reactive). @public */
    positions = $derived(this.behavior.positions);
    /** Number of words in the text (reactive). @public */
    wordCount = $derived(this.behavior.wordCount);

    /**
     * @param {InputEvent} event
     * @public
     */
    beforeinput(event) { return this.behavior.handleBeforeInput(event); }

    /**
     * Retrouve le nœud texte et l'offset DOM pour un offset Modèle donné
     * @param {number} targetOffset
     * @returns {{node: Node, offset: number} | null}
     * @public
     */
    getDOMPoint(targetOffset) { return this.behavior.getDOMPoint(targetOffset); }

    /**
     * @param {Block} block
     * @public
     */
    absorbs(block) { return this.behavior.absorbs(block); }

    /**
     * @param {number} index
     * @param {string} text
     * @public
     */
    insert(index, text) { return this.behavior.insert(index, text); }

    /**
     * @param {Parameters<Block["delete"]>[0]} [deletion]
     * @public
     */
    delete(deletion) { return this.behavior.delete(deletion); }

    /**
     * @param {import('loro-crdt').Delta<string>[]} data
     * @public
     */
    applyDelta(data = []) { return this.behavior.applyDelta(data); }

    /**
     * @param {Parameters<Block["split"]>[0]} [options]
     * @returns {ReturnType<Block["split"]>}
     * @public
     */
    split(options) { return this.behavior.split(options); }
}
