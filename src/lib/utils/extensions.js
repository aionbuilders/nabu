/**
 * @import { Nabu, Block } from '../blocks'
 */

/**
 * @typedef {Object} PasteBlock
 * @property {string} type
 * @property {'start' | 'end' | 'both' | false} partial
 * @property {Record<string, any>} [props]
 * @property {import('loro-crdt').Delta<string>[]} [delta]
 * @property {PasteBlock[]} [children]
 */

/**
 * @typedef {Object} PasteFragment
 * @property {PasteBlock[]} blocks
 */

/**
 * @typedef {Object} PasteInterpreter
 * @property {string} format - MIME type géré ('application/x-nabu+json', 'text/html', 'text/plain')
 * @property {number} [priority] - Plus haut = appelé en premier (default: 0)
 * @property {(raw: string, nabu: Nabu, options?: PasteInterpretOptions) => PasteFragment | null} interpret
 */

/**
 * @typedef {Object} PasteInterpretOptions
 * @property {boolean} [joinLines] - false/absent (paste): one non-blank line = one block.
 *   true (`importMarkdown`): CommonMark semantics, consecutive lines join into one paragraph.
 *   Forwarded to block markdown rules as `helpers.joinLines` (and 3rd arg of `consume`).
 */

/**
 * @typedef {Object} InputRule
 * @property {RegExp} pattern      - Testé sur le texte AVANT le curseur (avec l'inputType "insertText")
 * @property {string} [inputType]  - Défaut: "insertText"
 * @property {(nabu: Nabu, block: Block, match: RegExpMatchArray, sel: {from: number, to: number, isCollapsed: boolean, data: string}) => boolean | void} handler
 *           - `sel.data` est le texte en cours d'insertion (event.data).
 *           - Retourne true pour BREAK. NE PAS appeler commit() dans le handler.
 */

/**
 * @typedef {{
 * onInit: function(Nabu): void,
 * onBlockCreate: function(Nabu, Block): void,
 * onBlockDelete: function(Nabu, Block): void,
 * onBlockUpdate: function(Nabu, Block): void,
 * onBeforeTransaction: function(Nabu, Array<{type: string, block: Block}>): void,
 * onAfterTransaction: function(Nabu, Array<{type: string, block: Block}>): void,
 * onSplit: function(Nabu, Block, Event, {offset: number, delta: import('loro-crdt').Delta<string>}): {block: Block},
 * onBeforeInput: function(Nabu, InputEvent, Block): void,
 * onInput: function(Nabu, InputEvent, Block): void,
 * } & Object<string, function>} ExtensionHooks
 */

/**
 * @typedef {Object} ExtensionInit
 * @property {string} [name]
 * @property {import('svelte').Component} [component]
 * @property {typeof Block} [block]
 * @property {boolean} [defaultBlock]
 *   Marks `block` as the editor's DEFAULT text block (the one created when the engine needs an
 *   empty text block of its own: a caret below a trailing void block, …). Last one wins.
 * @property {Partial<ExtensionHooks>} [hooks]
 * @property {Record<string, (nabu: Nabu) => any>} [serializers]
 * @property {Record<string, (nabu: Nabu, data: any, topic: string) => any>} [actions]
 * @property {PasteInterpreter[]} [pasteInterpreters]
 * @property {InputRule[]} [inputRules]
 *   Declarative text-replacement rules applied while typing (e.g. markdown
 *   shortcuts, smart typography). Tested against the text before the cursor.
 * @property {Record<string, { expand: 'after' | 'before' | 'both' | 'none' }>} [loroTextStyles]
 *   Loro text style configuration required by this extension.
 *   Passed to `LoroDoc.configTextStyle()` during Nabu initialization so that
 *   `applyDelta` with these attributes works correctly.
 */

export class Extension {
    /** @param {string} name @param {ExtensionInit} init */
    constructor(name, init = {}) {
        this.name = name;
        this.component = init.component;
        this.block = init.block;
        this.defaultBlock = !!init.defaultBlock;
        /** @type {Partial<ExtensionHooks>} */
        this.hooks = init.hooks || {};
        /** @type {Record<string, (nabu: Nabu) => any>} */
        this.serializers = init.serializers || {};
        /** @type {Record<string, (nabu: Nabu, data: any, topic: string) => any>} */
        this.actions = init.actions || {};
        /** @type {PasteInterpreter[]} */
        this.pasteInterpreters = init.pasteInterpreters || [];
        /** @type {InputRule[]} */
        this.inputRules = init.inputRules || [];
        /** @type {Record<string, { expand: 'after' | 'before' | 'both' | 'none' }>} */
        this.loroTextStyles = init.loroTextStyles || {};
    }
}


/** @param {string} name @param {ExtensionInit} init */
export const extension = (name, init) => new Extension(name, init);

/**
 * Convert a `serialize('json')` document export back into PasteBlocks.
 * The json format stores text as Slate-like runs (`{text, ...marks}`);
 * PasteBlocks store Loro deltas (`{insert, attributes}`).
 * @param {Array<{type: string, props?: Record<string, any>, content?: Array<{text: string, [mark: string]: any}>, children?: any[]}>} blocks
 * @returns {PasteBlock[]}
 */
export function jsonToPasteBlocks(blocks) {
    return (blocks || []).map(b => {
        /** @type {PasteBlock} */
        const pb = { type: b.type, partial: false };
        if (b.props) pb.props = b.props;
        if (Array.isArray(b.content)) {
            pb.delta = b.content.map(run => {
                const { text, ...marks } = run;
                return Object.keys(marks).length
                    ? { insert: text, attributes: marks }
                    : { insert: text };
            });
        }
        if (Array.isArray(b.children)) pb.children = jsonToPasteBlocks(b.children);
        return pb;
    });
}