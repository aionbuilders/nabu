/**
 * @import { Nabu, Block } from '../blocks'
 */

/**
 * @typedef {Object} PasteBlock
 * @property {string} type
 * @property {'start' | 'end' | 'both' | false} [partial] absent = false (a whole block)
 * @property {Record<string, any>} [props]
 * @property {import('loro-crdt').Delta<string>[]} [delta]
 * @property {PasteBlock[]} [children]
 */

/**
 * @typedef {Object} PasteFragment
 * @property {boolean} [external] the content comes from outside the editor (the HTML of a web page, Docs…) rather than from
 *   Nabu itself: `files.importRemote` applies to its remote media URLs
 * @property {PasteBlock[]} blocks
 * @property {Record<string, import('../files/files.svelte.js').EmbeddedAsset>} [assets] bytes (base64) of the
 *   `nabu-asset:` refs used by `blocks` (see docs/design/clipboard-format.md)
 */

/**
 * @typedef {Object} PasteInterpreter
 * @property {string} format - MIME type géré ('application/x-nabu+json', 'text/html', 'text/plain')
 * @property {number} [priority] - Plus haut = appelé en premier (default: 0)
 * @property {(raw: string, nabu: Nabu, options?: PasteInterpretOptions) => PasteFragment | null} interpret
 * @property {(raw: string) => boolean} [outranksFiles] - Files on the clipboard normally win over the text payloads. Return
 *   true when THIS payload is worth more than the files that come with it (a spreadsheet range is put on the clipboard as
 *   a table AND as an image of it).
 */

/**
 * What an extension does with a FILE pasted from the clipboard (a screenshot, a file copied from the OS): it makes a block
 * of it. The engine reads the bytes, stores them through `Files` (in the document, or sent to `files.onBeforePersist` with the
 * optimistic `pending` block) and inserts the blocks at the caret, in the order of the files, as ONE undo step. The engine
 * names no block type: whatever an extension accepts is its own business.
 * @typedef {Object} PasteFileHandler
 * @property {number} [priority] - Higher is asked first (default 0). The first handler that accepts a file takes it.
 * @property {(file: File, nabu: Nabu) => boolean} accepts - Whether this handler takes `file` (by MIME type, name…)
 * @property {(file: File, nabu: Nabu) => PasteBlock | null} block - The block the file becomes: `type` and the props other
 *   than `ref` (`name`, `alt`…), which the engine sets to the stored file. `null` declines the file.
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
 * What `onSplit` receives besides the block: where the text is cut, and the tail that moves to the new block.
 * @typedef {Object} SplitData
 * @property {number} offset  caret offset in the block's text
 * @property {import('loro-crdt').Delta<string>[]} delta  the text from `offset` to the end, as a Loro delta
 */

/**
 * The hooks an extension can register (`ExtensionInit.hooks`). A hook returns `nabu.BREAK` (or, for `onSplit`, an object)
 * to stop the engine from going on; the others return nothing. Any other name is a custom hook, run with `nabu.trigger(name, ...args)`.
 * Declared as methods, so a handler may narrow the block parameter (`(nabu, block: Paragraph) => ...`).
 *
 * `onBlockCreate`, `onBlockDelete`, `onBlockUpdate`, `onAfterTransaction` and `onInput` are declared for forward compatibility:
 * the engine does not call them yet.
 * @typedef {{
 * onInit(nabu: Nabu): void,
 * onBlockCreate(nabu: Nabu, block: Block): void,
 * onBlockDelete(nabu: Nabu, block: Block): void,
 * onBlockUpdate(nabu: Nabu, block: Block): void,
 * onBeforeTransaction(nabu: Nabu, ...args: any[]): void,
 * onAfterTransaction(nabu: Nabu, ...args: any[]): void,
 * onSplit(nabu: Nabu, block: Block, event: Event | null, data: SplitData): { block: Block } | void,
 * onBeforeInput(nabu: Nabu, event: InputEvent, block: Block): symbol | boolean | void,
 * onKeyDown(nabu: Nabu, event: KeyboardEvent, block: Block): symbol | boolean | void,
 * onBeforeMerge(nabu: Nabu, survivor: Block, victim: Block): symbol | void,
 * onInput(nabu: Nabu, event: InputEvent, block: Block): void,
 * [hook: string]: (nabu: Nabu, ...args: any[]) => any,
 * }} ExtensionHooks
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
 * @property {Record<string, import('./commands.js').CommandDef>} [commands]
 *   Commands (ADR 017): `{ [id]: { label, keys?, when?, scope?, run(nabu, ctx, data?), confirm? } }`. Each one is also an action of the
 *   bus (`nabu.exec(id, data)`); the engine resolves their `keys` at keydown, before the legacy `onKeyDown` hooks.
 * @property {(nabu: Nabu, ctx: import('./commands.js').CommandContext) => Record<string, any> | void} [commandContext]
 *   Contributes FACTS to the context given to the `when` / `run` / `label` of commands (e.g. `{ atStartOfRegion: true }`).
 *   Called once per candidate key press; keep it cheap. It cannot replace the engine's own fields.
 * @property {PasteInterpreter[]} [pasteInterpreters]
 * @property {PasteFileHandler[]} [pasteFileHandlers]
 *   Make a block of a file pasted from the clipboard (see {@link PasteFileHandler}).
 * @property {InputRule[]} [inputRules]
 *   Declarative text-replacement rules applied while typing (e.g. markdown
 *   shortcuts, smart typography). Tested against the text before the cursor.
 * @property {import('../ui/slash-menu.svelte.js').SlashCommand[]} [slashCommands]
 *   Entries this extension adds to the slash menu (collected in `nabu.slashCommands`; the menu has no entry of its own, so a
 *   block type absent from the editor is never offered). The menu sorts them by `group`, `order`, then declaration order,
 *   whatever the load order of the extensions. A `when(engine, block)` limits an entry to the places where it applies (the
 *   block holding the caret); without it the entry is always offered.
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
        /** @type {Record<string, import('./commands.js').CommandDef>} */
        this.commands = init.commands || {};
        /** @type {ExtensionInit['commandContext']} */
        this.commandContext = init.commandContext;
        /** @type {PasteInterpreter[]} */
        this.pasteInterpreters = init.pasteInterpreters || [];
        /** @type {PasteFileHandler[]} */
        this.pasteFileHandlers = init.pasteFileHandlers || [];
        /** @type {InputRule[]} */
        this.inputRules = init.inputRules || [];
        /** @type {import('../ui/slash-menu.svelte.js').SlashCommand[]} */
        this.slashCommands = init.slashCommands || [];
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

/** Version written by `serialize('json')` (document export). `importJSON` reads this one (a missing version is read as it). */
export const JSON_FORMAT_VERSION = '1';

/**
 * Whether `importJSON` can read a document export of this `version` (see {@link JSON_FORMAT_VERSION}). A missing version is
 * read as the current one; the number `1` and the string `'1'` are the same version.
 * @param {unknown} version
 * @returns {boolean}
 */
export function isSupportedJsonVersion(version) {
    return version === undefined || version === null || String(version) === JSON_FORMAT_VERSION;
}

/**
 * Convert a `serialize('json')` document export back into PasteBlocks.
 * The json format stores text as Slate-like runs (`{text, ...marks}`) or, for a code block, as a plain string;
 * PasteBlocks store Loro deltas (`{insert, attributes}`). Top-level keys other than `id` / `type` / `props` / `content` /
 * `children` are read as props (the `checked` of a to-do item in the first exports sat next to `type`).
 * @param {Array<{type: string, props?: Record<string, any>, content?: Array<{text: string, [mark: string]: any}> | string, children?: any[], [key: string]: any}>} blocks
 * @returns {PasteBlock[]}
 */
export function jsonToPasteBlocks(blocks) {
    return (Array.isArray(blocks) ? blocks : []).filter(b => b && typeof b === 'object' && typeof b.type === 'string').map(b => {
        const { id: _id, type, props, content, children, ...extra } = b;
        /** @type {PasteBlock} */
        const pb = { type, partial: false };
        const merged = { ...extra, ...(props && typeof props === 'object' ? props : {}) };
        if (Object.keys(merged).length) pb.props = merged;
        if (typeof content === 'string') {
            if (content) pb.delta = [{ insert: content }];
        } else if (Array.isArray(content)) {
            pb.delta = content.filter(run => run && typeof run.text === 'string').map(run => {
                const { text, ...marks } = run;
                return Object.keys(marks).length
                    ? { insert: text, attributes: marks }
                    : { insert: text };
            });
        }
        if (Array.isArray(children)) pb.children = jsonToPasteBlocks(children);
        return pb;
    });
}
