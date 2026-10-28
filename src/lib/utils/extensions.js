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
 * @typedef {Object} PasteFileHandler
 * What an extension does with a FILE pasted from the clipboard (a screenshot, a file copied from the OS): it makes a block
 * of it. The engine reads the bytes, stores them through `Files` (in the document, or sent to `files.onBeforePersist` with the
 * optimistic `pending` block) and inserts the blocks at the caret, in the order of the files, as ONE undo step. The engine
 * names no block type: whatever an extension accepts is its own business.
 * @property {number} [priority] - Higher is asked first (default 0). The first handler that accepts a file takes it.
 * @property {(file: File, nabu: Nabu) => boolean} accepts - Whether this handler takes `file` (by MIME type, name…)
 * @property {(file: File, nabu: Nabu) => PasteBlock | null} block - The block the file becomes: `type` and the props other
 *   than `ref` (`name`, `alt`…), which the engine sets to the stored file. `null` declines the file.
 */

/**
 * A rule of a block class's `static htmlRules`: which HTML elements the block reads on paste. The rules of every registered
 * block form one ruleset, tried by descending `priority` (default 0); the first whose `selector` (and `filter`) matches wins and
 * its class's `static fromHTML(el, helpers, rule, siblings)` makes the block. Extra fields are the rule's own: the class reads them
 * back from `rule`.
 * @typedef {{
 *   selector: string,
 *   priority?: number,
 *   filter?: (el: Element) => boolean,
 *   embed?: boolean,
 *   props?: Record<string, any>,
 *   [field: string]: any,
 * }} HtmlRule
 * `selector` is a CSS selector tested with `el.matches()`. `priority`: higher is tried first (a specific block beats a generic
 * fallback). `filter`: an extra test once the selector matches. `embed`: the element may sit inside the inline content of another
 * block and is then lifted out as a block of its own. `props`: props the rule asks `fromHTML` to set.
 */

/**
 * What a block's `static fromHTML` receives to read an element.
 * @typedef {Object} HtmlHelpers
 * @property {(el: Element) => import('loro-crdt').Delta<string>[]} parseInline - The inline content of an element, as a Loro delta
 * @property {(el: Element) => PasteBlock | null} parseBlock - The first block an element makes
 * @property {(el: Element) => PasteBlock[]} parseBlocks - Every block an element makes
 * @property {(el: Element) => PasteBlock[]} parseChildren - The blocks made by each child of an element
 */

/**
 * What a block's `static fromMarkdown` receives to read its lines (and what `markdownRules` callbacks receive).
 * @typedef {Object} MarkdownHelpers
 * @property {(text: string) => import('loro-crdt').Delta<string>[]} parseInline - Inline markdown to a Loro delta
 * @property {(text: string) => any[]} parseInlineSegments - Inline markdown to segments (text, images...)
 * @property {boolean} joinLines - CommonMark semantics: consecutive lines join into one paragraph (`importMarkdown`); false on paste
 * @property {string} [softBreak] - What replaces a soft line break in a nested parse
 * @property {(lines: string[], index: number) => boolean} interrupts - Whether the line at `index` starts a block that ends the paragraph above it
 * @property {(lines: string[], overrides?: { joinLines?: boolean, softBreak?: string }) => PasteBlock[]} [parseBlocks] - Parse lines as a document of their own (the body of a quote...)
 */

/**
 * A rule of a block class's `static markdownRules`: how a block starts and how many lines it takes. The rules of every registered
 * block form one ruleset, tried by descending `priority` (default 0) at each line; the first whose `detect` matches and whose class's
 * `static fromMarkdown(lines, helpers, rule)` returns a block (or several) takes the lines `consume` counted. Extra fields are the
 * rule's own.
 * @typedef {{
 *   detect: RegExp | ((line: string, lines: string[], index: number, helpers: MarkdownHelpers) => boolean),
 *   consume: (lines: string[], index: number, helpers: MarkdownHelpers) => number,
 *   priority?: number,
 *   interruptsParagraph?: boolean | ((line: string, lines: string[], index: number, helpers: MarkdownHelpers) => boolean),
 *   [field: string]: any,
 * }} MarkdownRule
 * `detect`: does the block start at this line. `consume`: how many lines it takes from `index` (at least 1). `priority`: higher is
 * tried first. `interruptsParagraph`: the block may start in the middle of a paragraph (a fence, a heading, a quote...); `true`
 * means "whenever `detect` matches".
 */

/**
 * The second argument of a block's `static toMarkdown(pb, ctx)` / `static toHtml(pb, ctx)`: the clipboard and `serialize` call it
 * once per block, with helpers to serialize children without knowing their type. Other fields are the caller's own (a list passes its `listType`, `index`...).
 * @typedef {{
 *   recurse: (child: PasteBlock, ctx?: Record<string, any>) => string,
 *   recurseAll?: (children: PasteBlock[], ctx?: Record<string, any>) => string[],
 *   before?: PasteBlock[],
 *   after?: PasteBlock[],
 *   [field: string]: any,
 * }} SerializeContext
 * `recurse`: serialize one child block. `recurseAll` (markdown only): serialize siblings in order, telling each its neighbours.
 * `before` / `after` (markdown only): the siblings around this block.
 */

/**
 * @typedef {Object} PasteInterpretOptions
 * @property {boolean} [joinLines] - false/absent (paste): one non-blank line = one block.
 *   true (`importMarkdown`): CommonMark semantics, consecutive lines join into one paragraph.
 *   Forwarded to block markdown rules as `helpers.joinLines` (and 3rd arg of `consume`).
 */

/**
 * @typedef {Object} InputRule
 * A declarative text-replacement rule applied while typing: when the text before the caret matches `pattern`, `handler` runs
 * (the markdown shortcuts and the typography substitutions are input rules).
 * @property {RegExp} pattern      - Testé sur le texte AVANT le curseur (avec l'inputType "insertText")
 * @property {string} [inputType]  - Défaut: "insertText"
 * @property {(nabu: Nabu, block: Block, match: RegExpMatchArray, sel: {from: number, to: number, isCollapsed: boolean, data: string}) => boolean | void} handler
 *           - `sel.data` est le texte en cours d'insertion (event.data).
 *           - Retourne true pour BREAK. NE PAS appeler commit() dans le handler.
 */

/**
 * @typedef {Object} SplitData
 * What `onSplit` receives besides the block: where the text is cut, and the tail that moves to the new block.
 * @property {number} offset  caret offset in the block's text
 * @property {import('loro-crdt').Delta<string>[]} delta  the text from `offset` to the end, as a Loro delta
 */

/**
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
 * The hooks an extension can register (`ExtensionInit.hooks`). A hook returns `nabu.BREAK` (or, for `onSplit`, an object)
 * to stop the engine from going on; the others return nothing. Any other name is a custom hook, run with `nabu.trigger(name, ...args)`.
 * Declared as methods, so a handler may narrow the block parameter (`(nabu, block: Paragraph) => ...`).
 *
 * `onBlockCreate`, `onBlockDelete`, `onBlockUpdate`, `onAfterTransaction` and `onInput` are declared for forward compatibility:
 * the engine does not call them yet.
 */

/**
 * @typedef {Object} ExtensionInit
 * What an extension is made of: a block class and its component, hooks, serializers, actions, commands, paste interpreters and
 * file handlers, input rules, slash menu entries and Loro text styles. Every field is optional; pass it to `extension(name, init)`.
 * @property {string} [name]
 * @property {import('svelte').Component} [component]
 * @property {typeof Block} [block]
 * @property {boolean} [defaultBlock]
 *   Marks `block` as the editor's DEFAULT text block (the one created when the engine needs an
 *   empty text block of its own: a caret below a trailing void block, …). Last one wins.
 * @property {Partial<ExtensionHooks>} [hooks]
 * @property {Record<string, (nabu: Nabu) => any>} [serializers]
 * @property {Record<string, (nabu: Nabu, data: any, topic: string) => any>} [actions]
 *   Handlers of the action bus, by topic (`nabu.exec(topic, data)`). COLLISION RULE: several extensions may declare the same topic and
 *   ALL their handlers run (that is how an extension observes another one's topic), so give a topic of your own a distinctive name
 *   (`namespace:verb`): two extensions that each mean something different by `code` would both fire. Built-in topics: `mark:*`, `block:*`, `list:*`...
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

/**
 * A named bundle of editor behaviour (see {@link ExtensionInit}); the built-in blocks and behaviours are extensions. Build one with
 * `extension(name, init)` and pass it to `createEditor({ extensions })`.
 */
export class Extension {
    /** @param {string} name @param {ExtensionInit} init */
    constructor(name, init = {}) {
        /** The extension's name (unique in an editor). */
        this.name = name;
        /** The Svelte component that renders the extension's block. */
        this.component = init.component;
        /** The block class this extension registers. */
        this.block = init.block;
        /** Whether `block` is the editor's default text block. */
        this.defaultBlock = !!init.defaultBlock;
        /**
         * The hooks of the extension, by name (see {@link ExtensionHooks}).
         * @type {Partial<ExtensionHooks>}
         */
        this.hooks = init.hooks || {};
        /**
         * Serializers by format name, run by `nabu.serialize(format)`.
         * @type {Record<string, (nabu: Nabu) => any>}
         */
        this.serializers = init.serializers || {};
        /**
         * Handlers of the action bus by topic (`nabu.exec(topic, data)`); several extensions may declare the same topic and all run.
         * @type {Record<string, (nabu: Nabu, data: any, topic: string) => any>}
         */
        this.actions = init.actions || {};
        /**
         * The commands this extension declares, by id (see {@link CommandDef}).
         * @type {Record<string, import('./commands.js').CommandDef>}
         */
        this.commands = init.commands || {};
        /**
         * Contributes facts to the context given to command `when` / `run` functions.
         * @type {ExtensionInit['commandContext']}
         */
        this.commandContext = init.commandContext;
        /**
         * Interpreters of clipboard formats (see {@link PasteInterpreter}).
         * @type {PasteInterpreter[]}
         */
        this.pasteInterpreters = init.pasteInterpreters || [];
        /**
         * Handlers that make a block of a pasted file (see {@link PasteFileHandler}).
         * @type {PasteFileHandler[]}
         */
        this.pasteFileHandlers = init.pasteFileHandlers || [];
        /**
         * Text-replacement rules applied while typing (see {@link InputRule}).
         * @type {InputRule[]}
         */
        this.inputRules = init.inputRules || [];
        /**
         * Entries this extension adds to the slash menu.
         * @type {import('../ui/slash-menu.svelte.js').SlashCommand[]}
         */
        this.slashCommands = init.slashCommands || [];
        /**
         * Loro text style configuration this extension needs for its marks.
         * @type {Record<string, { expand: 'after' | 'before' | 'both' | 'none' }>}
         */
        this.loroTextStyles = init.loroTextStyles || {};
    }
}


/**
 * Create an extension: the unit that bundles a block type, its component, hooks, commands, actions, paste handlers and slash entries.
 * Shorthand for `new Extension(name, init)`.
 * @param {string} name @param {ExtensionInit} init
 */
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
