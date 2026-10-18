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
 * Current version of the `application/x-nabu+json` clipboard format (see docs/design/clipboard-format.md).
 * Written on copy as `version`; the Nabu paste interpreter accepts it (and fragments without a version).
 */
export const CLIPBOARD_FORMAT_VERSION = 1;

/**
 * Degrades the blocks whose type is NOT registered in the receiving editor (a fragment copied from a richer
 * editor, an old document, a third-party extension that is not loaded): nothing is dropped.
 *  - the block becomes a block of `fallbackType` (the editor's default text block) with its text (`delta`) and
 *    `partial` kept; its props are dropped (they belong to the unknown type);
 *  - its children are kept as normal blocks RIGHT AFTER it, at the same level (an unknown container has no
 *    body to hold them), recursively degraded;
 *  - the children of a known block are degraded in place.
 * Pure: returns new objects, never mutates the input; the engine names no block type (`isKnown` and
 * `fallbackType` come from the registry / `defaultBlockType`).
 * @param {PasteBlock[]} blocks
 * @param {(type: string) => boolean} isKnown
 * @param {string | null | undefined} fallbackType  the default text block type; falsy = nothing to degrade to
 * @returns {PasteBlock[]}
 */
export function degradeUnknownBlocks(blocks, isKnown, fallbackType) {
    if (!Array.isArray(blocks) || !fallbackType) return blocks;
    /** @param {PasteBlock[]} list @returns {PasteBlock[]} */
    const walk = (list) => list.flatMap((pb) => {
        if (!pb || typeof pb !== 'object') return [pb];
        const kids = Array.isArray(pb.children) && pb.children.length ? walk(pb.children) : null;
        if (isKnown(pb.type)) {
            const { children: _drop, ...rest } = pb;
            return [kids ? { ...rest, children: kids } : rest];
        }
        const { children: _c, props: _p, ...rest } = pb;
        /** @type {PasteBlock} */
        const own = { ...rest, type: fallbackType, delta: Array.isArray(pb.delta) ? pb.delta : [], partial: kids ? (pb.partial === 'start' || pb.partial === 'both' ? 'start' : false) : (pb.partial ?? false) };
        return kids ? [own, ...kids] : [own];
    });
    return walk(blocks);
}

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