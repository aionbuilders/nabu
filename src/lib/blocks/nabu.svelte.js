import { LoroDoc, UndoManager } from 'loro-crdt';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Block } from './block.svelte.js';
import { MegaBlock } from './megablock.svelte.js';
import { NabuSelection } from './selection.svelte.js';
import { handleContainerBeforeInput, wrapOrphan, deleteSelectionContent, deleteRange, selectionRange, findDirectChildOf, findLCA, textBlocksInOrder } from './container.utils.js';
import { jsonToPasteBlocks, degradeUnknownBlocks, CLIPBOARD_FORMAT_VERSION, JSON_FORMAT_VERSION, isSupportedJsonVersion } from '../utils/extensions.js';
import { escapeHtml, sanitizePasteBlocks } from '../utils/html.js';
import { tick, flushSync } from 'svelte';
import { Files } from '../files/files.svelte.js';
import { Pulse } from '@aionbuilders/pulse';
import { CommandRegistry } from '../utils/commands.js';
import { CommandConfirmation } from '../utils/command-confirm.svelte.js';
import { normalizePlaceholders } from '../utils/placeholders.js';
import { normalizeLang } from '../utils/spellcheck.js';
import { resolveTabMode, handleTabKey, isModifierKey, DEFAULT_TAB_HINT } from '../utils/tab.js';
import { moveBlocks } from './move.js';
import { closestWithin } from '../utils/dom-scope.js';
import { captureSelection, explicitSelection, legacySelection, restoreSelection, keepSelection, makeEndpoint, resolveOffset, revealFocus } from './undo-selection.js';
import { LARGE_DOC } from './chunks.js';
import { swapEmptyBlocks, restoreEmptyBlocks } from '../utils/composition.js';
import { transferKind, wantsCopy, pickDropEffect, sameTarget, resolveDropPosition, documentEnd, positionInRange, positionAfterRemoval, DRAG_MARKER, NABU_FORMAT } from '../utils/drop.js';


/**
* @import {Component} from "svelte";
* @import { LoroTreeNode, LoroTree } from "loro-crdt";
* @import {Extension} from '../utils/extensions.js';
* @import {DropPosition, DropTarget, DropKind} from '../utils/drop.js';
*/

/**
* The data map of a block's tree node: a `type` plus the block's own (open-ended) properties. Block classes narrow it
* with their own node typedef (`NabuNode<{text: LoroText}>`).
* @typedef {{type: string} & Record<string, any>} NabuNodeData
*/

/**
* @template {Object<string, any>} [T=Record<string, any>]
* @typedef {LoroTreeNode<{type: string} & T>} NabuNode
*/

/**
* @typedef {Object} NabuInit
* The options of an editor: the extensions to load, an initial snapshot, files, placeholders, readonly, language, Tab behaviour, keymap and
* command confirmation. Accepted by `new Nabu(init)`, by `createEditor` and the preset factories, and by `createPersistedEditor`.
* @property {Extension[]} [extensions]
* @property {Uint8Array<ArrayBufferLike>} [snapshot]
* @property {import('../files/files.svelte.js').FilesConfig} [files]
* @property {import('../utils/placeholders.js').PlaceholdersOption} [placeholders] - Hint text of empty blocks.
*   `false`: none. `true` / omitted: defaults (shown on the empty block holding the cursor).
*   Object: `{ show?: 'focus' | 'empty', text?: Record<blockType, string | false | ((block) => string | false)> }`.
* @property {boolean} [spellcheck] - Browser spellcheck on the editor (default `true`). `false` turns it off and adds the opt-out
*   hints of the Grammarly extension (`data-gramm="false"`, ...). Code blocks are never spellchecked. Reactive: `nabu.spellcheck`.
* @property {boolean} [readonly] - Show the document without letting the user change it (default `false`). Reactive: `nabu.readonly`,
*   assign to toggle live (`<NabuEditor readonly>` sets it). The editor root becomes `contenteditable="false"`; the engine ignores
*   typing, paste, cut, drop, drag moves and every command / shortcut (undo and redo included). Copy, text selection and links
*   keep working, and the floating UI (toolbar, slash menu, drag handle) hides itself. Code of the host is NOT restricted:
*   `insert`, `importJSON`, `importMarkdown`, `importRemote`, `transact` still work, which is how a viewer loads its document.
* @property {string} [lang] - Language of the content, a BCP 47 tag (`'fr'`, `'en-GB'`). Set on the root as `lang`, so the browser's
*   spellchecker, hyphenation and screen readers use it. Unset: inherits the page language. An invalid tag is ignored (warning).
*   Reactive: `nabu.lang`.
* @property {'focus' | 'stay' | 'indent'} [tab] - What Tab / Shift+Tab do in a plain text block, where no block handles them
*   structurally (list indent, code indentation and region titles keep their own meaning, whatever this says; P-41).
*   `'focus'`: the browser default, Tab leaves the editor. `'stay'`: both keys are swallowed and the caret stays; Escape then Tab
*   leaves (announced to screen readers, see `tabHint`). `'indent'`: Tab inserts a tab character at the caret (replacing a selection
*   inside one block), Shift+Tab removes one right before it; several blocks selected: like `'stay'`. `'nest'` is planned, not
*   implemented. Default: `tabDefault` (the factories of `presets.js` set it from the preset: Minimal / Text `'focus'`, Document /
*   Full `'stay'`), else `'focus'`. An unknown value warns and uses the default. Reactive: `nabu.tab`.
* @property {'focus' | 'stay' | 'indent'} [tabDefault] - The mode used when `tab` is unset or invalid. Meant for the preset factories.
* @property {string | false} [tabHint] - Text announced on the editor root (`aria-description`) while `tab` traps the focus
*   (`'stay'`, `'indent'`): default `"Press Escape then Tab to leave the editor"`; translate it here, `false` for none.
*   Reactive: `nabu.tabHint`.
* @property {Record<string, string[]>} [keymap] - Replaces the keyboard shortcuts of commands (ADR 017): `{ 'mark:bold': ['Mod-Alt-b'] }`;
*   `[]` disables a command's keys. Chords: see `utils/keys.js`; the same checks as for a declared key apply (reserved chords,
*   a key without modifier needs the command's `when`).
* @property {import('../utils/command-confirm.svelte.js').CommandConfirmOptions} [commandConfirm] - Confirmation of commands asked by a
*   key press (ADR 017 lot 2): `{ holdMs?: number (700), inviteMs?: number (5000), messages?: ConfirmMessages }`. `messages` are the
*   texts of the prompts and outcomes announced to screen readers (English by default; each is a string or a function of the
*   parameters, see `ConfirmMessages`); a command can override them with `confirm.messages`.
* @property {'mac' | 'other'} [platform] - Which platform's conventions `Mod` and the displayed shortcuts follow. Detected from the
*   browser by default; set it for tests or server-side rendering.
*/

/**
 * Whether the character immediately before `pos` in a text behavior carries `name`.
 * Used to decide the toggle direction for stored marks.
 * @param {any} behavior @param {number} pos @param {string} name
 * @returns {boolean}
 */
function inheritedMarkAt(behavior, pos, name) {
    if (pos <= 0) return false;
    const delta = behavior.delta;
    let offset = 0;
    for (const op of delta) {
        if (typeof op.insert !== 'string') continue;
        const end = offset + op.insert.length;
        if (pos <= end) return !!(op.attributes && op.attributes[name]);
        offset = end;
    }
    return false;
}

/**
 * True for the input types that can trigger a block transform (typing / Enter), as opposed to
 * deletions.
 * @param {Event | { inputType?: string }} e
 */
export const isTransformInput = (e) => {
    const type = /** @type {any} */ (e).inputType;
    return type === 'insertText' || type === 'insertParagraph' || type === 'insertLineBreak' || type === 'insertSoftLineBreak';
};

/**
 * @typedef {Object} NabuInternals
 * The engine machinery behind {@link Nabu#internals}. **Unstable**: may change in any version (see `docs/guides/extensions.md`,
 * "Stability"). Methods are bound to the editor; their signatures are those of the `Nabu` methods of the same name.
 * @property {Pulse} pulse The action bus behind `exec()`: `pulse.on(topic, handler)` observes or adds a topic at runtime.
 * @property {CommandConfirmation} commandConfirm The confirmation controller of commands (hold / invite / choose): `start`, `stop`, `offer`, `choose`, `cancel`, `pending`.
 * @property {Map<string, Array<(nabu: Nabu, ...args: any[]) => any>>} hooks Extension hooks by name, in registration order (the normalizers of `onBeforeTransaction`, the `onBeforeInput` handlers...).
 * @property {WeakMap<Function, string>} hookOwners Hook function to the name of the extension that registered it.
 * @property {import('../utils/extensions.js').InputRule[]} inputRules The input rules collected from the extensions.
 * @property {import('../utils/extensions.js').PasteInterpreter[]} pasteInterpreters The paste interpreters collected from the extensions.
 * @property {import('../utils/extensions.js').PasteFileHandler[]} pasteFileHandlers The paste file handlers, by priority.
 * @property {UndoManager} undoManager The Loro undo manager (undo steps, merge window).
 * @property {import('loro-crdt').LoroMap} content The free-form `content` map of the document.
 * @property {import('../files/files.svelte.js').FilesConfig} fileConfig The resolved `files` option.
 * @property {Record<string, boolean> | null} storedMarks Pending inline marks for the next typed character (reactive; assignable).
 * @property {Nabu['toggleStoredMark']} toggleStoredMark
 * @property {Nabu['clearStoredMarks']} clearStoredMarks
 * @property {Nabu['noteTextChange']} noteTextChange
 * @property {Nabu['captureUndoSelection']} captureUndoSelection Remember the selection for the undo step now being recorded.
 * @property {Nabu['sealUndoEnd']} sealUndoEnd Close the "where did the last action end" mark of the undo history.
 * @property {Nabu['updateRoots']} updateRoots Re-read the root blocks from the tree.
 * @property {Nabu['deleteNode']} deleteNode Delete a block by node id (no commit).
 * @property {Nabu['rearmTab']} rearmTab
 * @property {string | undefined} tabDescription The `aria-description` the root carries while `tab` traps the focus.
 * @property {Nabu['dispatchEventToSelection']} dispatchEventToSelection Route a native event to the block that holds the selection.
 * @property {Nabu['handleKeydown']} handleKeydown The keydown pipeline (commands first, then hooks, then the block).
 * @property {Nabu['handleBeforeinput']} handleBeforeinput
 * @property {Nabu['beforeinput']} beforeinput
 * @property {Nabu['handleCompositionStart']} handleCompositionStart
 * @property {Nabu['handleCompositionUpdate']} handleCompositionUpdate
 * @property {Nabu['handleCompositionEnd']} handleCompositionEnd
 * @property {Nabu['handleMousedown']} handleMousedown
 * @property {Nabu['handleCopy']} handleCopy Write the selection to a clipboard (every format).
 * @property {Nabu['handleCut']} handleCut
 * @property {Nabu['handlePaste']} handlePaste The paste pipeline (interpreters, files, `acceptPaste`).
 * @property {Nabu['insertFragment']} insertFragment Insert a `PasteFragment` at the selection (what a paste does after interpreting).
 * @property {Nabu['handleDragStart']} handleDragStart
 * @property {Nabu['handleDragOver']} handleDragOver
 * @property {Nabu['handleDragLeave']} handleDragLeave
 * @property {Nabu['handleDragEnd']} handleDragEnd
 * @property {Nabu['handleDrop']} handleDrop
 * @property {Nabu['dropAt']} dropAt Drop a `DataTransfer` at a position, as the drag and drop does.
 * @property {DropTarget | null} dropTarget The drop indicator being shown (reactive).
 * @property {{ normalize: NabuSelection['normalize'], scheduleRepair: NabuSelection['scheduleRepair'], repairAfterRemoval: NabuSelection['repairAfterRemoval'], placements: number, attachRoot: NabuSelection['attachRoot'], owns: NabuSelection['owns'], scope: NabuSelection['scope'], root: HTMLElement | null }} selection The selection's own repair machinery, and the engine's root element: `attachRoot(el)` (what `Nabu.svelte` calls on mount, it returns the detach function), `root`, `owns(node)` (inside MY root, not in a nested editor) and `scope()` ('mine' | 'outside' | 'foreign': whose business the live DOM selection is).
 */

/**
 * The editor engine. It owns the document (a Loro CRDT), the block tree and its registry, the selection, the commands and the
 * extensions, and runs the event, clipboard and drag and drop pipelines; `NabuEditor` renders it. Create one with `createEditor`
 * (or a preset factory such as `createDocumentEditor`) rather than `new Nabu(...)`, then read and write the content through
 * `serialize`, `importMarkdown`, `importJSON`, `exec` and `transact`. The members documented as public are the stable contract of
 * `@aionbuilders/nabu/extend`; `internals` is the unstable door to the rest.
 */
export class Nabu {
    /** @type {Pulse} */
    #pulse = new Pulse();
    /** @type {import('../utils/extensions.js').PasteInterpreter[]} */
    #pasteInterpreters = [];
    /** @type {import('../utils/extensions.js').PasteFileHandler[]} sorted by priority, highest first */
    #pasteFileHandlers = [];

    // ── IME composition state ────────────────────────────────────────────────
    // During an active IME composition the browser mutates the DOM freely
    // (insertCompositionText cannot be canceled). We switch to "DOM-first"
    // for the duration of the composition and sync the result into Loro at
    // compositionend. See issue #6.
    #composing = false;
    /**
     * True during an IME composition: the browser owns the DOM, the caret must not be touched.
     * @public
     */
    get composing() { return this.#composing; }
    /** @type {number | null} offset modèle au début de la composition (repli si le curseur Loro ne se résout pas) */
    #compositionStartOffset = null;
    /**
     * Where the composed text goes, as Loro cursors (P-101): an edit of the SAME block before the caret during the composition
     * (a programmatic insert, a direct `importRemote`) shifts it, a plain offset would not.
     * @type {import('./undo-selection.js').Endpoint | null}
     */
    #compositionAnchor = null;
    /** Empty blocks before the composing one, their "\n" placeholder swapped for a `<br>` meanwhile (Chromium offset drift, issue #6). @type {Array<{ br: Element, text: Text }>} */
    #swappedEmpties = [];
    /** The block a composition runs in, reactive: its placeholder is hidden meanwhile (P-103). @type {Block | null} */
    #composingBlock = $state.raw(null);
    /**
     * The block holding the running composition, or null. Reactive.
     * @public
     */
    get composingBlock() { return this.#composingBlock; }
    /** An undo group is open: the deletion of a selection replaced by a composition and the composed text are ONE undo step. */
    #compositionGroup = false;
    /** @type {Block | null} bloc cible au début de la composition */
    #compositionStartBlock = null;
    /** Configured UndoManager merge window (ms), restored after a paste isolation. */
    #mergeInterval = 1000;
    /** Undo steps still to push with merging disabled (paste / structural op / cut + the next one); 0 = not isolating. */
    #isolatedSteps = 0;
    #isolating = false;
    /** True during the synchronous turn that started a structural undo step (see commit()). */
    #structuralBurst = false;
    /**
     * Explicit caret to store with the NEXT pushed undo step (instead of the live selection): set by
     * shortcut() so that undoing a block shortcut puts the caret back right after the typed trigger.
     * @type {{ block: Block, offset: number } | null}
     */
    #undoCursor = null;
    /**
     * The selection as it was before the change now being recorded, kept as Loro cursors (see undo-selection.js): refreshed by
     * {@link Nabu#captureUndoSelection} while the model and the DOM agree, handed to the UndoManager when it pushes a step.
     * @type {import('./undo-selection.js').UndoSelection | null}
     */
    #undoSel = null;
    /** Undo / redo whose render is still pending: they put the selection back themselves. */
    #undoing = 0;
    /** Value of `selection.placements` when `#undoSel` was captured: tells whether the editor placed the selection since. */
    #undoSelPlacements = 0;
    /** A selection fix-up after a text change is already scheduled. */
    #keepPending = false;
    /** Commits and undo / redo whose render is still pending: the DOM lags the model, so the selection must not be captured. */
    #busy = 0;
    /** Counter end of the undo step just pushed: the next settled selection is where that action ENDED (what redo restores). */
    #endKey = /** @type {number | null} */ (null);
    /** Counter end of the step being undone (set by its pop, read by the redo step pushed right after). */
    #undoneEnd = /** @type {number | null} */ (null);
    /** Selection where each recent action ended, by the counter end of its undo step. @type {Map<number, import('./undo-selection.js').UndoSelection>} */
    #actionEnds = new Map();

    /** @param {NabuInit} init */
    constructor(init = {}) {
        this.doc = new LoroDoc();
        if (init.snapshot) {
            this.doc.import(init.snapshot);
        }
        
        /**
         * The text selection of the editor (a reactive wrapper of the DOM selection, in terms of blocks).
         * @type {NabuSelection}
         * @public
         */
        this.selection = new NabuSelection(this);
        /**
         * The document tree (Loro): one node per block, `node.data` holds the block's `type` and props.
         * @public
         */
        this.tree = /** @type {LoroTree<NabuNodeData>} */ (this.doc.getTree("blocks"));
        this.content = this.doc.getMap("content");

        // Initialize Undo/Redo Manager
        this.undoManager = new UndoManager(this.doc, {
            maxUndoSteps: 100,
            // Background completions (e.g. a pasted file finishing its upload) are not undo steps of their own.
            excludeOriginPrefixes: ['nabu:silent'],
            mergeInterval: this.#mergeInterval,
            onPush: (isUndo, range) => {
                if (this.#isolatedSteps > 0) this.#isolatedSteps--;
                // The selection to give back when this step is popped. An undo step: the selection right BEFORE the change
                // (it is pushed after the commit, but the captured selection predates the change). The redo step pushed by
                // an undo: where the undone action ENDED. A caret decided by the caller (block shortcut) wins.
                const explicit = this.#undoCursor;
                this.#undoCursor = null;
                const ended = !isUndo && this.#undoneEnd !== null ? this.#actionEnds.get(this.#undoneEnd) : undefined;
                const stored = (explicit ? explicitSelection(explicit.block, explicit.offset) : ended ?? this.#undoSel) ?? legacySelection(this);
                this.#endKey = isUndo ? range?.end ?? null : null;
                return { value: /** @type {any} */ (stored), cursors: [] };
            },
            onPop: (isUndo, storedValue, range) => {
                this.#undoneEnd = isUndo ? range?.end ?? null : null;
                this.#endKey = null;
                const value = /** @type {any} */ (storedValue?.value);
                if (value && typeof value === 'object' && 'anchor' in value) restoreSelection(this, value);
            }
        });

        /**
         * The extensions the editor was built with, in order.
         * @type {Extension[]}
         * @public
         */
        this.extensions = init.extensions || [];
        this.fileConfig = init.files || {};
        this.placeholders = normalizePlaceholders(init.placeholders);
        this.spellcheck = init.spellcheck !== false;
        this.lang = init.lang;
        this.readonly = !!init.readonly;
        this.#tabDefault = resolveTabMode(init.tabDefault, 'focus', (message) => this.warn(message));
        this.tab = init.tab;
        if (typeof init.tabHint === 'string' || init.tabHint === false) this.tabHint = init.tabHint;

        /**
         * Commands and keyboard shortcuts (ADR 017): `list()`, `get(id)`, `run(id, data)`. A plain snapshot API, the set of
         * commands is fixed once the editor is built.
         */
        this.commandConfirm = new CommandConfirmation(this, init.commandConfirm);
        this.systems.set('command-confirm', { start: () => this.commandConfirm.start(), stop: () => this.commandConfirm.stop() });
        /**
         * Commands and keyboard shortcuts (ADR 017): `list()`, `get(id)`, `has(id)`, `run(id, data)`, `offer(id)`. A plain
         * snapshot API; the set of commands is fixed once the editor is built.
         * @type {CommandRegistry}
         * @public
         */
        this.commands = new CommandRegistry(this, { keymap: init.keymap, platform: init.platform });
        // Engine commands first: they win a tie with an extension's command on the same chord.
        this.#registerCommands('core', {
            undo: { label: 'Undo', keys: ['Mod-z'], run: () => { this.undo(); } },
            redo: { label: 'Redo', keys: ['Mod-Shift-z', 'Mod-y'], run: () => { this.redo(); } },
            // Keyboard alternative to dragging (see move.js): `data.block` (a Block or its id) moves that block instead.
            'block:move-up': { label: 'Move block up', keys: ['Mod-Shift-ArrowUp'], run: (_nabu, _ctx, data) => moveBlocks(this, 'up', data?.block ?? null) },
            'block:move-down': { label: 'Move block down', keys: ['Mod-Shift-ArrowDown'], run: (_nabu, _ctx, data) => moveBlocks(this, 'down', data?.block ?? null) },
        });
        
        if (this.extensions?.length) {
            for (const ext of this.extensions) {
                if (ext.block) this.registry.set(ext.name, ext.block);
                if (ext.block && ext.defaultBlock) this.defaultBlockType = ext.name;
                if (ext.component) this.components.set(ext.name, ext.component);
                if (ext.hooks) {
                    for (const [hookName, hookFn] of /** @type {[string, (nabu: Nabu, ...args: any[]) => any][]} */ (Object.entries(ext.hooks))) {
                        if (!this.hooks.has(hookName)) {
                            this.hooks.set(hookName, []);
                        }
                        /** @type {Array<(nabu: Nabu, ...args: any[]) => any>} */ (this.hooks.get(hookName)).push(hookFn);
                        this.hookOwners.set(hookFn, ext.name);
                    }
                }

                if (ext.serializers) {
                    for (const [format, fn] of Object.entries(ext.serializers)) {
                        this.serializers.set(format, fn);
                    }
                }

                if (ext.actions) {
                    for (const [topic, handler] of Object.entries(ext.actions)) {
                        this.#pulse.on(topic, ({ event }) => { if (this.#readonly) return; return handler(this, event.data, event.topic); }); // read-only: actions are edits, they do nothing
                    }
                }

                if (ext.commands) this.#registerCommands(ext.name, ext.commands);
                if (ext.commandContext) this.commands.addContextProvider(ext.commandContext, ext.name);

                if (ext.pasteInterpreters?.length) {
                    for (const interpreter of ext.pasteInterpreters) {
                        this.#pasteInterpreters.push(interpreter);
                    }
                }

                if (ext.pasteFileHandlers?.length) {
                    this.#pasteFileHandlers.push(...ext.pasteFileHandlers);
                    this.#pasteFileHandlers.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
                }

                if (ext.inputRules?.length) {
                    for (const rule of ext.inputRules) {
                        this.inputRules.push(rule);
                    }
                }

                if (ext.slashCommands?.length) this.slashCommands.push(...ext.slashCommands);

                if (ext.loroTextStyles && Object.keys(ext.loroTextStyles).length) {
                    this.doc.configTextStyle(ext.loroTextStyles);
                }

            }
        }

        // Core actions (`undo`, `redo`) are commands, registered above.
        this.commands.checkKeymap();

        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        if (roots?.length) {
            for (const root of roots) {
                const block = Block.load(this, root);
                block.index = this.children.length;
                this.children.push(block);
            }
        }
        
        // Files: the local asset store, and the migration of a beta document whose files are still inside it (ADR 014 §3.7).
        Files.get(this);

        // this.doc.subscribe((event) => {
        //     // event.events contient un tableau listant TOUTES les opérations 
        //     // (texte ajouté, nœuds déplacés, etc.) qui viennent d'être commitées.
        //     console.log("Rapport de la transaction :", event.events);
        // });

        // One event batch = one refresh. The affected containers are COLLECTED while the batch is read, then each is refreshed
        // once (the root list at most once, every parent at most once): refreshing per action made an import / a mass undo / a
        // big paste quadratic (P-104). The doc already holds the final state of the batch, so the order of the actions is moot.
        this.tree.subscribe((event) => {
            let rootsDirty = false;
            /** @type {Set<string>} */
            const parents = new Set();
            /** @type {Set<string>} */
            const retyped = new Set();

            let removed = false;
            event.events.forEach(e => {
                if (e.diff.type === "tree") {
                    e.diff.diff.forEach(action => {
                        if (action.action === 'delete') removed = true;
                        if (action.action === 'create' || action.action === 'move' || action.action === 'delete') {
                            // `parent` is set on create / move, `oldParent` on move / delete (a TreeDiffItem is a union of the three)
                            const { parent, oldParent } = /** @type {{ parent?: string, oldParent?: string }} */ (action);
                            if (parent) parents.add(parent.toString());
                            else rootsDirty = true;

                            if (oldParent) parents.add(oldParent.toString());
                            // A node that LEAVES the root for a container has no `oldParent` (the root is no node): the
                            // root list must be refreshed too, else the old element stays rendered next to the new one.
                            else if (action.action === 'move' && parent) rootsDirty = true;
                        }
                    })
                }

                if (e.diff.type === "map") {
                    const newType = e.diff.updated["type"];
                    if (newType !== undefined) {
                        const nodeId = e.path[1].toString();
                        const block = this.blocks.get(nodeId);
                        if (block && block.type !== newType) {
                            retyped.add(nodeId);
                            if (block.parent) parents.add(block.parent.id);
                            else rootsDirty = true;
                        }
                    }
                }
            })

            if (removed) this.selection.scheduleRepair?.(); // the caret may have been in the removed blocks (P-108)
            if (rootsDirty) this.updateRoots(retyped);
            for (const parentId of parents) {
                // A block retyped into a leaf (no children) in the same transaction has no updateChildren().
                /** @type {{ updateChildren?: (retyped?: Set<string>) => void } | undefined} */ (this.blocks.get(parentId))?.updateChildren?.(retyped);
            }
        });
        
        this.init();
    }
    
    /**
     * What a hook or an `onBeforeInput` handler returns to stop the engine (and the hooks after it).
     * @type {symbol}
     * @public
     */
    static BREAK = Symbol("BREAK");
    /**
     * What a hook returns to let the engine go on (same as returning nothing).
     * @type {symbol}
     * @public
     */
    static CONTINUE = Symbol("CONTINUE");
    /**
     * `Nabu.BREAK`, reachable from the instance a hook receives.
     * @type {symbol}
     * @public
     */
    BREAK = Nabu.BREAK;
    /**
     * `Nabu.CONTINUE`, reachable from the instance a hook receives.
     * @type {symbol}
     * @public
     */
    CONTINUE = Nabu.CONTINUE;
    
    /**
     * The Loro document behind the editor (public: connect it to a server with `doc.subscribeLocalUpdates` and `importRemote`).
     * @type {LoroDoc}
     * @public
     */
    doc;
    /**
     * The block classes registered by the loaded extensions, by block type.
     * @type {SvelteMap<string, typeof Block>}
     * @public
     */
    registry = new SvelteMap();

    /**
     * Type of the default text block (declared by an extension with `defaultBlock: true`): created by the
     * engine when it needs an empty text block of its own, e.g. a caret after a trailing void block.
     * @type {string | null}
     * @public
     */
    defaultBlockType = null;
    /**
     * The Svelte components registered by the loaded extensions, by block type.
     * @type {SvelteMap<string, Component>}
     * @public
     */
    components = new SvelteMap();
    /**
     * Every live block of the document, by tree id.
     * @type {SvelteMap<string, Block>}
     * @public
     */
    blocks = new SvelteMap();

    /**
     * The live blocks of each type (reactive sets, by block type).
     * @type {SvelteMap<string, SvelteSet<Block>>}
     * @public
     */
    blocksByType = new SvelteMap();

    /**
     * Registered subsystems. Each system should implement:
     *   - `start(): void` — called when the editor mounts
     *   - `stop(): void`  — called when the editor unmounts
     * @type {SvelteMap<string, { start?: () => void, stop?: () => void, [key: string]: any }>}
     * @public
     */
    systems = new SvelteMap();
    
    /**
     * Extension hooks by name, in registration order (see `ExtensionHooks`).
     * @type {Map<string, Array<(nabu: Nabu, ...args: any[]) => any>>}
     */
    hooks = new Map();

    /**
     * Hook function -> name of the extension that registered it. Lets `Block#ascend` run the hooks of the
     * extension that OWNS the block type before the generic ones (type-specific handler wins).
     * @type {WeakMap<Function, string>}
     */
    hookOwners = new WeakMap();

    /**
     * Declarative input rules collected from extensions, tested by TextBehavior
     * against the text before the cursor on matching beforeinput events.
     * @type {import('../utils/extensions.js').InputRule[]}
     */
    inputRules = [];

    /**
     * Slash-menu entries contributed by extensions (`Extension#slashCommands`); the slash menu lists ONLY these (plus the
     * integrator's extras), sorted by `group` / `order`, keeping those whose `when(engine, block)` holds at the caret.
     * @type {import('../ui/slash-menu.svelte.js').SlashCommand[]}
     * @public
     */
    slashCommands = [];

    /** @type {import('../files/files.svelte.js').FilesConfig} */
    fileConfig = {};

    /**
     * Resolved `placeholders` option (see NabuInit). Reassign to change it at runtime.
     * @type {import('../utils/placeholders.js').ResolvedPlaceholders}
     * @public
     */
    placeholders = $state.raw(normalizePlaceholders());

    /**
     * Resolved `spellcheck` option (see NabuInit). Reactive: assign to change it at runtime.
     * @type {boolean}
     * @public
     */
    spellcheck = $state.raw(true);

    #readonly = $state.raw(false);

    /**
     * Read-only mode (see the `readonly` option of NabuInit). Reactive: assign to switch it on or off at runtime. While `true`
     * the user cannot change the document: input, paste, cut, drop, drag moves and commands (shortcuts, `commands.run`,
     * `exec` of a command, undo / redo) are ignored by the engine, and the UI components hide themselves. Programmatic
     * edits by the host (`insert`, `importJSON`...) are not blocked. View state that is not part of the document (a toggle
     * opened to read it) stays possible and is never written to the document.
     * @type {boolean}
     * @public
     */
    get readonly() { return this.#readonly; }
    set readonly(value) {
        this.#readonly = !!value;
        if (this.#readonly) this.commandConfirm?.cancel('api'); // a hold / invite / chooser in progress is moot
    }

    /** @type {string | undefined} */
    #lang = $state.raw(undefined);

    /**
     * Resolved `lang` option (see NabuInit): a valid BCP 47 tag, or `undefined` (inherit the page language).
     * Reactive: assign to change it at runtime; an invalid value is ignored (warning) and leaves it unchanged.
     * @type {string | undefined}
     * @public
     */
    get lang() { return this.#lang; }
    set lang(value) {
        const { lang, valid } = normalizeLang(value);
        if (!valid) { this.warn(`Ignoring invalid "lang" (not a BCP 47 tag): ${String(value)}`); return; }
        this.#lang = lang;
    }

    /** @type {import('../utils/tab.js').TabMode} */
    #tabDefault = 'focus';

    /** @type {import('../utils/tab.js').TabMode} */
    #tab = $state.raw('focus');

    /**
     * Resolved `tab` option (see NabuInit): what Tab / Shift+Tab do in a plain text block. Reactive: assign to change it at runtime;
     * an unknown value warns and gives the default of the editor (its preset).
     * @type {import('../utils/tab.js').TabMode}
     * @public
     */
    get tab() { return this.#tab; }
    /** @param {unknown} value */
    set tab(value) { this.#tab = resolveTabMode(value, this.#tabDefault, (message) => this.warn(message)); }

    /**
     * Announcement of the Escape-then-Tab way out (option `tabHint`), `false` for none. Reactive.
     * @type {string | false}
     * @public
     */
    tabHint = $state.raw(DEFAULT_TAB_HINT);

    /** What the editor root exposes as `aria-description`: the hint, only while the mode keeps the focus in. */
    get tabDescription() { return !this.#readonly && this.#tab !== 'focus' && this.tabHint ? this.tabHint : undefined; }

    /** An Escape nobody consumed was the previous key: the next Tab / Shift+Tab leaves the editor (see `utils/tab.js`). */
    #tabEscaped = false;

    /** Close the Escape-then-Tab way out (any other key, a click, the focus leaving). */
    rearmTab() { this.#tabEscaped = false; }

    /**
     * Pending inline formatting for the next typed character (active marks at a
     * collapsed cursor). null = inherit from the span at the cursor.
     * @type {Record<string, boolean> | null}
     */
    storedMarks = $state(null);

    /**
     * When true, `nabu.warn()` logs to the console (`[Nabu]`).
     * @public
     */
    debugging = $state(false);

    /**
     * Root-level serializers. Each function receives the Nabu instance and returns the serialized document.
     * @type {Map<string, (nabu: Nabu) => any>}
     * @public
     */
    serializers = new Map(/** @type {Array<[string, (nabu: Nabu) => any]>} */ ([
        ['markdown', (nabu) =>
            nabu.children
                .map(b => b.serialize('markdown'))
                .filter(Boolean)
                .join('\n\n')
        ],
        ['json', (nabu) => {
            const blocks = nabu.children.map(b => b.serialize('json')).filter(Boolean);
            // The bytes of the `nabu-asset:` media travel with the document (same `assets` map as the clipboard format).
            const assets = Files.get(nabu).embedAssets(blocks);
            return { version: JSON_FORMAT_VERSION, blocks, ...(assets ? { assets } : {}) };
        }]
    ]));

    /**
     * The root blocks of the document, in order (reactive).
     * @type {Block[]}
     * @public
     */
    children = $state([]);

    /**
     * Number of caret positions in the document (the sum of the root blocks').
     * @public
     */
    positions = $derived(this.children.reduce((sum, child) => sum + (child.positions ?? 0), 0));
    
    /**
     * True when the document has no block.
     * @public
     */
    get isEmpty() {
        return this.children.length === 0;
    }

    /**
     * Serialize the document with the root serializer registered for `format` (`'markdown'`, `'json'`, or one an extension
     * adds with `serializers`); `null` (and a warning) for an unknown format.
     * @param {string} format
     * @returns {any}
     * @public
     */
    serialize(format) {
        const fn = this.serializers.get(format);
        if (!fn) {
            this.warn(`No serializer registered for format "${format}" on Nabu`);
            return null;
        }
        return fn(this);
    }
    
    init() {
        this.hooks.get("onInit")?.forEach(hook => hook(this));
    }

    /**
     * Rafraîchit les blocs racines de l'éditeur. Les blocs déjà connus sont réutilisés tels quels : seul le type des nœuds
     * listés dans `retyped` (ids dont le `type` vient de changer) est relu.
     * @param {Set<string>} [retyped]  without it, the type of every root is checked
     */
    updateRoots(retyped) {
        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        this.children = roots.map((root, i) => {
            const id = root.id.toString();
            let block = this.blocks.get(id);

            if (!block || !retyped || retyped.has(id)) {
                const currentType = root.data.get("type");
                if (!block || block.type !== currentType) {
                    if (block) {
                        this.blocks.delete(id);
                        this.blocksByType.get(block.type)?.delete(block);
                    }

                    block = Block.load(this, root);
                }
            }
            block.index = i;
            block.parent = null;
            return block;
        });
    }

    /**
     * Dispatch an action to all registered handlers for the given topic.
     * Re-syncs the model selection from the DOM first: `selectionchange` is async, so right after a
     * keyboard-only selection change (Shift+Arrow, Home/End, Ctrl+A) the model would be stale.
     * @param {string} topic
     * @param {any} [data]
     * @returns {Promise<import('@aionbuilders/pulse').PulseEvent>}
     * @public
     */
    exec(topic, data) {
        this.selection.sync();
        return this.#pulse.emit(topic, data);
    }

    /**
     * The command waiting for the user's confirmation (ADR 017 §3.4), reactive; `null` when none:
     * `{ id, strategy: 'hold' | 'invite' | 'choose', label, display, message, target?, progress, options?, selectedIndex }`.
     * `progress` (hold, 0 → 1) and `selectedIndex` (choose) are reactive fields of that object.
     * @returns {import('../utils/command-confirm.svelte.js').PendingCommand | null}
     * @public
     */
    get pendingCommand() { return this.commandConfirm.pending; }

    /**
     * Cancel the pending confirmation, if any: nothing runs.
     * @public
     */
    cancelPendingCommand() { this.commandConfirm.cancel('api'); }

    /**
     * The pending confirmation when it is ABOUT `target` (what `confirm.target(ctx)` returned: usually a block), else `null`.
     * Reactive: a block that draws its own hold progress reads `nabu.pendingCommandOn(block)?.progress`.
     * @param {any} target
     * @returns {import('../utils/command-confirm.svelte.js').PendingCommand | null}
     * @public
     */
    pendingCommandOn(target) { return this.commandConfirm.pendingOn(target); }

    /**
     * Text of the polite live region of the editor (prompts and outcomes of confirmations). Reactive.
     * @returns {string}
     * @public
     */
    get commandAnnouncement() { return this.commandConfirm.announcement; }

    /**
     * Register commands (ADR 017): the registry keeps them and resolves their keys; each one is also an action of the bus.
     * @param {string} owner  extension name
     * @param {Record<string, import('../utils/commands.js').CommandDef>} commands
     */
    #registerCommands(owner, commands) {
        for (const [id, def] of Object.entries(commands)) {
            const entry = this.commands.register(id, def, owner);
            if (entry) this.#pulse.on(id, ({ event }) => (this.#readonly ? undefined : this.commands.invoke(entry, event.data)));
        }
    }

    /**
     * Run the `hookName` hooks of every extension, in order, until one returns `BREAK`. Each is called as `hook(nabu, ...args)`.
     * @param {string} hookName
     * @param {...any} args
     * @public
     */
    trigger(hookName, ...args) {
        const hooks = this.hooks.get(hookName) || [];
        for (const hook of hooks) {
            const result = hook(this, ...args);
            if (result === this.BREAK) {
                break;
            }

        }
    }


    /**
     * Commit the pending changes as one Loro transaction.
     * @param {{ origin?: string }} [options] `origin` tags the transaction; an origin starting with `nabu:silent` is
     *   not recorded as an undo step (background completions that must not be undone on their own).
     * @public
     */
    async commit({ origin } = {}) {
        this.#evictChildrenOfLeaves();
        this.trigger("onBeforeTransaction", this);
        // Structural operations (split, merge, delete/move of blocks, type change, list indent…)
        // are their own undo step, and so is the typing that follows (see #hasPendingStructuralOps).
        // Skipped when an isolation is already armed for this very commit (paste, cut).
        let continuation = false;
        const stepsBefore = this.#isolatedSteps;
        if (!(this.#isolating && this.#isolatedSteps === 2) && this.#hasPendingStructuralOps()) {
            if (this.#structuralBurst) {
                // A second structural commit in the same synchronous turn is the same user
                // operation (e.g. a list indent = create the sublist via nabu.insert(), which
                // commits, then move the item): let it merge into the step just pushed.
                continuation = true;
                this.undoManager.setMergeInterval(this.#mergeInterval);
            } else {
                this.#structuralBurst = true;
                queueMicrotask(() => { this.#structuralBurst = false; });
                this.#isolateNextCommits();
            }
        }
        this.#busy++; // until the render: the DOM lags the model, no selection capture meanwhile (see captureUndoSelection)
        try {
            this.doc.commit(typeof origin === 'string' ? { origin } : undefined);
        } catch (err) {
            this.#busy--;
            throw err;
        }
        if (continuation && this.#isolating) {
            // The merge above must not leak: the typing after the operation stays isolated
            // (a merged commit may still call onPush, so don't count it as a pushed step).
            this.#isolatedSteps = stepsBefore;
            this.undoManager.setMergeInterval(0);
        }
        if (this.#isolating && this.#isolatedSteps === 0) {
            this.#isolating = false;
            this.undoManager.setMergeInterval(this.#mergeInterval);
        }
        await tick();
        this.#busy--;
        // Rendered: the selection is where the action left it (the caller may still move it, which is captured again).
        this.captureUndoSelection('settle');
    }

    /**
     * Generic schema rule: a block whose class cannot hold children (anything that is not a MegaBlock)
     * never keeps child nodes. When the pending transaction retypes a node into such a block (transform,
     * markdown shortcut, `data.set('type')`) or moves / creates a node under one, its children are moved
     * out to right after it, in order, in the same transaction: nothing is lost, and the (type-specific)
     * `onBeforeTransaction` normalizers then reshape the result. Knows no concrete block type.
     */
    #evictChildrenOfLeaves() {
        const pending = this.doc.getUncommittedOpsAsJson();
        if (!pending) return;
        const treeId = this.tree.id;
        /** @type {Set<string>} */
        const candidates = new Set();
        for (const change of pending.changes) {
            for (const op of change.ops) {
                const content = /** @type {any} */ (op.content);
                if (op.container === treeId) {
                    if ((content.type === 'move' || content.type === 'create') && content.parent) candidates.add(String(content.parent));
                } else if (content.type === 'insert' && content.key === 'type' && op.container.endsWith(':Map')) {
                    candidates.add(op.container.slice(4, -4));
                }
            }
        }
        for (const id of candidates) {
            if (!this.tree.has(/** @type {any} */ (id))) continue;
            const node = /** @type {NabuNode | undefined} */ (this.tree.getNodeByID(/** @type {any} */ (id)));
            if (!node || node.isDeleted()) continue;
            const BlockClass = this.registry.get(/** @type {any} */ (node.data.get('type')));
            if (!BlockClass || BlockClass === MegaBlock || BlockClass.prototype instanceof MegaBlock) continue;
            /** @type {NabuNode} */
            let anchor = node;
            for (const child of /** @type {NabuNode[]} */ (node.children() ?? [])) {
                child.moveAfter(anchor);
                anchor = child;
            }
        }
    }

    /**
     * Whether the pending (uncommitted) Loro transaction changes the document structure:
     * a tree create / move / delete (every block creation, destruction, re-parenting or
     * reordering — split, merge, multi-block deletion, list indent…) or a change of a
     * block's `type` (transforms, markdown shortcuts).
     *
     * This is the one central choke point: whatever the call site (tree.createNode,
     * node.move, destroy, adoptChildren, data.set('type')…), the ops end up in the
     * pending transaction that commit() is about to flush, so nothing has to be marked
     * at the ~46 mutation sites.
     * @returns {boolean}
     */
    #hasPendingStructuralOps() {
        const pending = this.doc.getUncommittedOpsAsJson();
        if (!pending) return false;
        const treeId = this.tree.id;
        for (const change of pending.changes) {
            for (const op of change.ops) {
                const content = /** @type {any} */ (op.content);
                if (op.container === treeId) {
                    if (content.type === 'create' || content.type === 'move' || content.type === 'delete') return true;
                } else if (content.type === 'insert' && content.key === 'type' && op.container.endsWith(':Map')) {
                    // `type` set on a block's data map ("cid:<nodeId>:Map"), not e.g. a file asset's MIME type.
                    if (this.blocks.has(op.container.slice(4, -4))) return true;
                }
            }
        }
        return false;
    }

    /**
     * Make the next commit (a paste, a cut, a structural op) AND the one after it their own undo steps:
     * merging is off until both pushed a step (empty commits don't count), then
     * the configured interval is restored at the end of commit().
     */
    #isolateNextCommits() {
        this.undoManager.setMergeInterval(0);
        this.#isolating = true;
        this.#isolatedSteps = 2;
    }

    /**
     * Make the NEXT commit its own undo step (and the typing right after it another one), even though it
     * holds no structural op: for a non-structural change that must undo on its own, e.g. a flag toggled
     * from the keyboard, which would otherwise merge with the typing around it. Call it just before commit().
     * @public
     */
    isolateUndoStep() {
        this.#isolateNextCommits();
    }

    /**
     * Run Loro mutations as a single transaction, then optionally restore the cursor.
     * Centralizes the "mutate → commit → setCursor" dance used by most actions.
     * @param {() => void} mutateFn  - Mutations Loro ici. Ne PAS appeler commit() dedans.
     * @param {{ block: Block, offset: number } | null} [cursorIntent]
     * @returns {Promise<void>}
     * @public
     */
    async transact(mutateFn, cursorIntent = null) {
        mutateFn();
        await this.commit();
        if (cursorIntent) {
            this.selection.setCursor(cursorIntent.block, cursorIntent.offset);
        }
    }

    /**
     * Apply a markdown BLOCK shortcut (`# `, `- `, `> `, `--- `…) so that undo gives back exactly what
     * the user typed, trigger included: one Ctrl+Z after `# ` leaves a paragraph "# " with the caret
     * after the space; a second one removes the typing as usual.
     *
     *  1. `trigger` (the swallowed space) is inserted at the caret and committed like normal typing;
     *  2. `transform` runs (delete the prefix incl. the trigger, change/replace the block…) and is
     *     committed as its own structural undo step (see commit()), whose stored caret is right
     *     after the trigger.
     * Both commits run in the same synchronous turn, so the intermediate "# " is never painted.
     *
     * For a trigger that is not text (``` + Enter), pass `trigger = ''`: nothing is inserted and
     * undo restores the text typed before the key (the fence line, without the Enter).
     * @param {Block} block  the block the shortcut was typed in
     * @param {string} trigger  text of the trigger key, inserted before transforming ('' = none)
     * @param {(behavior: any) => void} transform  mutations only (it may commit itself, e.g. via transformTo)
     * @returns {Promise<void>}  resolves immediately, doing nothing, when `block.transformsEnabled === false`
     * @public
     */
    async shortcut(block, trigger, transform) {
        // Defence in depth: a block that opts out of transforms (`transformsEnabled === false`) never
        // converts. The primary guard is upstream (dispatchEventToSelection skips the extension hooks
        // for typing in such a block, so the keystroke proceeds as plain text); this covers direct callers.
        if (block.transformsEnabled === false) return;
        const behavior = block.behaviors.get('text');
        const sel = behavior?.selection;
        if (!behavior || !sel) return;
        const at = sel.from;
        if (trigger) {
            behavior.insert(at, trigger);
            this.commit();
        }
        this.#undoCursor = { block, offset: at + trigger.length };
        transform(behavior);
        const committed = this.commit(); // pushes the undo step synchronously (the await is only a tick)
        this.#undoCursor = null;
        await committed;
    }

    /**
     * True when every selected text run carries the given mark.
     * Reactive: reads block.selected and the behaviors' selections/deltas,
     * so it can be used directly in component templates (e.g. FloatingToolbar).
     * @param {string} markName
     * @returns {boolean}
     * @public
     */
    isMarkActive(markName) {
        let found = false;
        for (const [, block] of this.blocks) {
            if (!block.selected) continue;
            const behavior = block.behaviors?.get('text');
            if (!behavior || typeof behavior.isMarkActive !== 'function') continue;
            const sel = behavior.selection;
            if (!sel || sel.isCollapsed) continue;
            found = true;
            if (!behavior.isMarkActive(markName, sel)) return false;
        }
        return found;
    }

    /**
     * Import changes made ELSEWHERE (another tab, a peer, a stored copy of the document: ADR 010 multi-tab sync). They are the
     * document's own history, not the user's actions: Loro's UndoManager records local commits only, so an import is never an undo
     * step (undoing the user's own edits afterwards still works, Loro transforms them). The DOM follows through the normal Loro
     * events. The caret of the local user stays on the same CHARACTER: it is captured as Loro cursors before the import and put
     * back after the render (a text node rewritten by Svelte would otherwise send it to the start of the block); the page is
     * never scrolled for it. Idempotent (importing what the document already has changes nothing).
     * Called DURING an IME composition it is applied at once (not held): the model is safe, because the composition anchor is a Loro
     * cursor that follows the edit, and the caret restore is skipped meanwhile (the browser owns it). (`persistence/sync.js` still
     * holds the updates it receives while composing, which keeps the composing text node untouched by the render.)
     * @param {Uint8Array} bytes a Loro snapshot or update
     * @returns {import('loro-crdt').ImportStatus}
     * @public
     */
    importRemote(bytes) {
        const keep = !this.#composing && this.#busy === 0 && this.doc.getPendingTxnLength() === 0 ? captureSelection(this) : null;
        const status = this.doc.import(bytes);
        if (keep) restoreSelection(this, keep, 0, false);
        return status;
    }

    /**
     * Undo the last operation. The selection as it was before that operation comes back (see ADR 015).
     * @public
     */
    undo() {
        if (this.undoManager.canUndo()) this.#whileRendering(() => this.undoManager.undo());
    }

    /**
     * Redo the last undone operation. The selection comes back where that operation ended.
     * @public
     */
    redo() {
        if (this.undoManager.canRedo()) this.#whileRendering(() => this.undoManager.redo());
    }

    /**
     * Run `fn` (an undo / redo, whose render is asynchronous) with the selection capture off until it is rendered.
     * @param {() => void} fn
     */
    #whileRendering(fn) {
        this.#busy++;
        this.#undoing++;
        try { fn(); } finally { tick().then(() => { this.#busy--; this.#undoing--; }); }
    }


    /**
     * The text of `block` just changed (a Loro event of its text container: local, programmatic or imported). When a selection end
     * is in that block and the change is NOT the user's own typing (the handlers place their caret themselves), the selection is
     * put back on the characters it was on once the render is done: Svelte rewrites the edited text node, which would send the end
     * of the DOM range to offset 0 of it (P-109). The ends are the Loro cursors of the last selection captured while the model and
     * the DOM agreed (`#undoSel`), so an insertion before them shifts them. O(1) when the block holds no selection end. Skipped
     * during a composition and an undo / redo (which restore the selection themselves), and when the editor has placed the selection
     * since that capture (an input handler puts its own caret after the render: it is the one that knows where the caret goes, and
     * what it placed is captured again, `captureUndoSelection('settle')`).
     * @param {Block} block
     */
    noteTextChange(block) {
        const snap = this.#undoSel;
        if (!snap || this.#keepPending || this.#composing || this.#undoing > 0) return;
        if (snap.anchor.blockId !== block.id && snap.focus.blockId !== block.id) return;
        const placed = this.#undoSelPlacements;
        if (this.selection.placements !== placed) return;
        this.#keepPending = true;
        tick().then(() => {
            this.#keepPending = false;
            if (this.#composing || this.#undoing > 0 || this.selection.placements !== placed) return;
            keepSelection(this, snap);
        });
    }

    /**
     * Remember the live selection as the one an undo step pushed from now on gives back (ADR 015). Called wherever the selection
     * changes or an input starts (selection change, key down, programmatic caret placement), always while the model and the DOM
     * agree: it does nothing during a composition, while a commit / undo is rendering, and while a transaction is pending (the
     * Loro cursors have to bind to the text as it was BEFORE the change).
     * @param {'user' | 'settle'} [source]  'settle' = the editor itself placed the selection after an action: it is where that
     *   action ended (what a redo gives back). 'user' = the user moved it.
     */
    captureUndoSelection(source = 'user') {
        if (this.#composing || this.#busy > 0 || this.doc.getPendingTxnLength() > 0) return;
        const snap = captureSelection(this);
        if (!snap) return;
        this.#undoSel = snap;
        this.#undoSelPlacements = this.selection.placements ?? 0;
        if (source === 'settle' && this.#endKey !== null) {
            this.#actionEnds.set(this.#endKey, snap);
            if (this.#actionEnds.size > 200) this.#actionEnds.delete(/** @type {number} */ (this.#actionEnds.keys().next().value));
        }
    }

    /** A pointer interaction starts: the selection that follows is the user's, no longer where the last action ended. */
    sealUndoEnd() { this.#endKey = null; }

    /** Clear the pending stored marks. */
    clearStoredMarks() { this.storedMarks = null; }

    /**
     * Toggle a stored mark for the next typed char (Ctrl+B etc. at a collapsed cursor).
     * @param {string} name
     */
    toggleStoredMark(name) {
        const anchor = this.selection.anchorBlock;
        const beh = anchor?.behaviors?.get('text');
        const sel = beh?.selection;
        if (!beh || !sel) return;
        let active;
        if (this.storedMarks && name in this.storedMarks) active = this.storedMarks[name];
        else active = inheritedMarkAt(beh, sel.from, name);
        this.storedMarks = { ...(this.storedMarks || {}), [name]: !active };
    }



    /**
     * Place the DOM + model selection. Asynchronous by nature: it waits for Svelte to flush pending state
     * (`tick()`), because the target blocks' DOM may not be rendered yet (e.g. right after a commit/insert).
     * The returned promise resolves once the selection has been set, i.e. once `nabu.selection` reflects it:
     * `await nabu.focus(...)` before `exec(...)` / typing. Fire-and-forget callers are unaffected.
     * @param {{from?: {offset?: number, block?: Block}, to?: {offset?: number, block?: Block}, offset?: number}} [options]
     * @returns {Promise<void>}
     * @public
     */
    focus(options) {
        return tick().then(() => {
            const sel = this.selection;

            const {offset: fromOffset, block: fromBlock} = options?.from?.block ? 
            {offset: options?.from?.offset ?? sel.startOffset ?? 0, block: options?.from?.block} :
            this.resolveDocumentOffset(options?.offset ?? options?.from?.offset ?? sel.startOffset ?? 0) || {offset: sel.startOffset ?? 0, block: sel.anchorBlock};

            const {offset: toOffset, block: toBlock} = options?.to?.block ? 
            {offset: options?.to?.offset ?? sel.endOffset ?? 0, block: options?.to?.block} :
            this.resolveDocumentOffset(options?.offset ?? options?.to?.offset ?? sel.endOffset ?? 0) || {offset: sel.endOffset ?? 0, block: sel.focusBlock};
            
            this.warn('Focusing from', fromBlock, 'offset', fromOffset, 'to', toBlock, 'offset', toOffset);

            if (fromBlock && toBlock) {
                const fromPoint = fromBlock.getDOMPoint(fromOffset);
                const toPoint = toBlock.getDOMPoint(toOffset);
                this.warn('Resolved DOM points:', fromPoint, toPoint);
                if (fromPoint && toPoint) this.selection.setBaseAndExtent(fromPoint.node, fromPoint.offset, toPoint.node, toPoint.offset);
            }
        });
    }

    /**
     * The deepest last block of the document that can hold a caret in the rendered document: follows
     * the last child at each level, but never enters a block that hides its children.
     * @returns {Block | null}
     * @public
     */
    get lastVisibleBlock() {
        /** @type {any} */
        let block = this.children[this.children.length - 1] ?? null;
        while (block) {
            /** @type {Block[] | undefined} */
            const kids = block.children;
            if (!kids?.length || block.hidesChildren) break;
            block = kids[kids.length - 1];
        }
        return block;
    }

    #openingTrailingCaret = false;

    /**
     * The document must always offer a caret after its last block. Call it on user intent (ArrowDown /
     * ArrowRight leaving the document, a click below the last block): when the last block holds text, the
     * caret goes to its end; when it does not (a void block such as a divider / image, or a container
     * whose end is not a text position), an empty default text block is appended at the root, in one
     * undo step, and takes the caret. Never called eagerly on load.
     * @returns {Promise<Block | null>} The block now holding the caret
     * @public
     */
    async openTrailingCaret() {
        if (this.#openingTrailingCaret) return null;
        const last = this.lastVisibleBlock;
        if (!last) return null;
        this.#openingTrailingCaret = true;
        try {
            /** @type {Block | null | undefined} */
            let target = last;
            let offset = last.behaviors?.get('text')?.text?.length ?? 0;
            if (!last.behaviors?.has('text')) {
                const type = this.defaultBlockType;
                if (!type || !this.registry.has(type)) return null;
                const created = this.insert(type, {}, null, this.children.length);
                await this.commit();
                target = this.blocks.get(created.id);
                offset = 0;
            }
            if (!target) return null;
            await tick();
            this.selection.setCursor(target, offset);
            return target;
        } finally {
            this.#openingTrailingCaret = false;
        }
    }

    /**
     * Mouse down on the editor itself (not on a block): below the last block, that block is a void →
     * put a caret after it (see `openTrailingCaret`).
     * @param {MouseEvent} e
     */
    handleMousedown(e) {
        this.rearmTab();
        if (this.#readonly) return;
        if (e.button !== 0 || e.defaultPrevented || e.target !== e.currentTarget) return;
        const last = this.lastVisibleBlock;
        const lastEl = /** @type {HTMLElement | null} */ (last?.element);
        if (!last || last.behaviors?.has('text') || !lastEl?.isConnected) return;
        if (e.clientY <= lastEl.getBoundingClientRect().bottom) return;
        this.openTrailingCaret(); // overrides the native caret the click leaves on the root

    }

    /**
     * Insert a new block of a registered type and commit (throws when the type is not registered).
     * @param {string} type - Block type (`'paragraph'`, or the name of an extension that declares a `block`)
     * @param {Record<string, any>} [props] - Initial props, read by the class's `static create` (`text`, `delta`...)
     * @param {string | null} [parentId] - Id of the parent block (`null`: the document root)
     * @param {number | null} [index] - Position among the siblings (`null`: last)
     * @returns {Block} The created block
     * @public
     */
    insert(type, props = {}, parentId = null, index = null) {
        
        const BlockClass = this.registry.get(type);
        if (!BlockClass) {
            throw new Error(`Block type "${type}" not registered.`);
        }
        
        const block = BlockClass.create(this, type, props, parentId, index);
        
        
        this.commit();
        return block;
    }
    
    
    
    /**
     * Delete a block (and its children) from the tree. No commit: call `commit()` afterwards.
     * @param {Block} block
     * @public
     */
    delete(block) {
        this.deleteNode(block.node.id);
    }
    


    
    /**
    * @param {string} nodeId 
    * @returns 
    */
    deleteNode(nodeId) {
        const block = this.blocks.get(nodeId);
        if (!block) return;
        this.tree.delete(block.node.id);
    }
    
    // EVENT HANDLING

    /** 
     * Route un événement vers le bon bloc en fonction de la sélection courante.
     * @param {string} handlerName - Le nom de la méthode à appeler sur le bloc (ex: 'beforeinput', 'keydown')
     * @param {Event} e - L'événement natif
     * @param {string} [hookName] - Optionnel : Le nom du hook d'extension à vérifier en premier
     */
    dispatchEventToSelection(handlerName, e, hookName) {
        const sel = this.selection;
        if (!sel.anchorBlock || !sel.focusBlock) return;
        
        // 1. Essayer les hooks globaux d'extension d'abord.
        // Un bloc `transformsEnabled === false` (code, callout, toggle…) ne se laisse pas transformer
        // par la frappe (raccourcis markdown `# `, `> `, ``` …) : on saute les hooks sur les insertions
        // (les hooks de suppression — sortie de bloc, garde-fous — tournent toujours) et la frappe
        // continue comme du texte normal. Même règle que TextBehavior.handleBeforeInput.
        if (hookName && !(hookName === 'onBeforeInput' && isTransformInput(e) && sel.anchorBlock.transformsEnabled === false)) {
            const hooks = this.hooks.get(hookName) || [];
            for (const hook of hooks) {
                const handled = hook(this, e, sel.anchorBlock);
                if (handled === this.BREAK) {
                    e.preventDefault();
                    return;
                }
            }
        }
        
        // 2. Trouver la cible et lui déléguer
        let targetBlock = null;
        if (sel.anchorBlock === sel.focusBlock) {
            targetBlock = sel.anchorBlock;
        } else {
            const anchorParents = sel.anchorBlock.parents || [];
            const focusParents = sel.focusBlock.parents || [];
            targetBlock = anchorParents.find(ancestor => focusParents.includes(ancestor)) || this;
        }

        // 3. Appeler la méthode sur le bloc cible s'il la possède
        if (targetBlock && typeof (/** @type {any} */ (targetBlock))[handlerName] === 'function') {
            const handled = (/** @type {any} */ (targetBlock))[handlerName](e);
            if (handled) {
                e.preventDefault();
            }
        }
    }
    
    /** @param {InputEvent} e */
    handleBeforeinput(e) {
        if (this.#readonly) { e.preventDefault(); return; } // nothing is typed, deleted, pasted or dropped in a read-only editor
        this.selection.sync(); // selectionchange is async: don't act on a stale caret
        // Ne pas interférer avec la composition IME en cours : le navigateur
        // doit pouvoir muter librement le text node (insertCompositionText
        // n'est de toute façon pas annulable). Sync dans Loro à compositionend.
        if (this.#composing && (e.inputType === 'insertCompositionText' || e.inputType === 'deleteCompositionText')) {
            return;
        }
        // Any other input while a composition runs (a real Enter that the IME did not swallow, a paste, a delete…): the model
        // does not hold the composing text yet, so acting on it would use a stale offset (P-102). It is ignored; the composition
        // goes on and its commit (compositionend) follows. Never throws, `composing` is only ever reset by compositionend.
        if (this.#composing) {
            e.preventDefault();
            return;
        }
        this.selection.normalize(); // a caret on a dead position (void block, wrapper…) must not swallow the keystroke
        e.preventDefault(); // Toujours bloquer les mutations natives
        this.dispatchEventToSelection('beforeinput', e, 'onBeforeInput');
    }

    // ── IME composition (issue #6) ───────────────────────────────────────────

    /**
     * Capture the model position at the start of an IME composition and
     * switch to DOM-first mode for its duration.
     * @param {CompositionEvent} e
     */
    handleCompositionStart(e) {
        if (this.#readonly) return;
        this.selection.sync();
        // A second compositionstart in the SAME block while one runs (Chrome silently restarts a composition when a script
        // rewrites its text node, e.g. a programmatic edit of the block: no compositionend in between): the first start is the
        // one that counts, its Loro-cursor anchor already follows the edit.
        if (this.#composing && this.#compositionStartBlock && this.#compositionStartBlock === this.selection.anchorBlock) return;
        // A composition over a selection replaces it (P-98 / P-99): the range is deleted through the MODEL first, rendered, and the
        // caret put at the junction, BEFORE the browser starts mutating the DOM (it would otherwise merge the blocks natively and
        // leave the model untouched). The deletion and the composed text are one undo step (see #compositionGroup).
        if (!this.selection.isCollapsed) this.#replaceSelectionForComposition();
        this.#composing = true;
        const anchor = this.selection.anchorBlock;
        if (!anchor) {
            this.#compositionStartBlock = null;
            this.#compositionStartOffset = null;
            this.#compositionAnchor = null;
            this.#endCompositionGroup();
            return;
        }
        const behavior = anchor.behaviors?.get('text');
        const sel = behavior?.selection;
        this.#compositionStartBlock = anchor;
        this.#compositionStartOffset = sel?.from ?? 0;
                this.#compositionAnchor = behavior ? makeEndpoint(anchor, sel?.from ?? 0, 'end') : null;
        this.#composingBlock = anchor;
        restoreEmptyBlocks(this.#swappedEmpties); // (a composition that never ended)
        this.#swappedEmpties = swapEmptyBlocks(anchor.element);
        /** @type {any} */ (behavior)?.snapshotForComposition?.();
    }

    /**
     * Delete the selected range (one block or several, isolated fields honoured: exactly what typing a character over it does,
     * see {@link deleteRange}) and leave a collapsed caret at the junction, with the DOM rendered synchronously.
     * Undo: the deletion opens an undo group that the end of the composition closes, so "replace the selection with the composed
     * text" is ONE step; a composition canceled right away leaves the deletion as its own step.
     */
    #replaceSelectionForComposition() {
        const range = selectionRange(this);
        if (!range) return;
        try { this.undoManager.groupStart(); this.#compositionGroup = true; } catch { this.#compositionGroup = false; }
        const junction = deleteRange(this, range);
        if (!junction) { this.#endCompositionGroup(); return; }
        this.commit();  // the Loro transaction (and its undo step) is made synchronously; the await is only the render
        flushSync();    // the DOM matches the model before the browser starts the composition
        const block = this.blocks.get(junction.block.id) ?? junction.block;
        this.selection.setCursor(block, junction.offset);
        this.selection.sync();
    }

    #endCompositionGroup() {
        if (!this.#compositionGroup) return;
        this.#compositionGroup = false;
        try { this.undoManager.groupEnd(); } catch { /* the group already ended (remote import) */ }
    }

    /**
     * No-op: the browser manages the DOM freely during composition.
     * @param {CompositionEvent} e
     */
    handleCompositionUpdate(e) {}

    /**
     * Sync the composed text into Loro. The browser already inserted `e.data`
     * into the DOM; committing the same text to the model lets the next render
     * converge without duplication.
     * @param {CompositionEvent} e
     */
    handleCompositionEnd(e) {
        if (this.#readonly && !this.#composing) return;
        this.#composing = false;
        const composedIn = this.#compositionStartBlock?.behaviors?.get('text');
        const composedBlock = this.#compositionStartBlock;
        this.#composingBlock = null;
        restoreEmptyBlocks(this.#swappedEmpties);
        this.#swappedEmpties = [];
        /** @type {any} */ (composedIn)?.restoreAfterComposition?.(e.data || ''); // before the model catches up: no duplicate of the composed text
        try {
            this.#syncComposition(e);
        } finally {
            this.#endCompositionGroup();
        }
        this.selection.normalize(); // a dead caret must not survive the composition
        // A canceled composition in an EMPTY block: its render is back (restoreAfterComposition), so is the caret.
        if (!(e.data || '') && composedBlock && composedBlock.element?.isConnected && !composedIn?.text) {
            this.selection.setCursor(composedBlock, 0);
            tick().then(() => { if (!this.#composing && composedBlock.element?.isConnected && !composedIn?.text) this.selection.setCursor(composedBlock, 0); });
        }
    }

    /** @param {CompositionEvent} e */
    #syncComposition(e) {
        const block = this.#compositionStartBlock;
        let startOffset = this.#compositionStartOffset;
        const anchor = this.#compositionAnchor;
        this.#compositionStartBlock = null;
        this.#compositionStartOffset = null;
        this.#compositionAnchor = null;
        if (!block || startOffset === null) return;

        // The block may have been destroyed/replaced during the composition
        // (e.g. the user clicked elsewhere and a transform happened).
        const fresh = this.blocks.get(block.id);
        if (!fresh || fresh !== block) return;
        // nabu.blocks can still hold a deleted block — check the Loro tree too.
        if (block.node.isDeleted?.() || !this.tree.has(block.node.id)) return;

        const behavior = block.behaviors?.get('text');
        if (!behavior) return;

        // Canceled composition (Escape) fires compositionend with e.data === ''.
        const composedText = e.data || '';
        if (!composedText) return;

        // Where the composition began NOW: the Loro cursors followed every edit of this text made meanwhile (P-101).
        if (anchor) {
            const moved = resolveOffset(this.doc, anchor, behavior.container.length);
            if (moved !== null) startOffset = moved;
        }
        startOffset = Math.max(0, Math.min(startOffset, behavior.container.length));

        behavior.insert(startOffset, composedText);
        block.commit();
        const caret = startOffset + composedText.length;
        tick().then(() => {
            this.selection.setCursor(block, caret);
        });
    }

    /** @param {KeyboardEvent} e */
    handleKeydown(e) {
        // Read-only: no command, hook or block sees the key. The browser keeps its own keys (selection, copy, scrolling).
        if (this.#readonly) return;
        this.selection.sync(); // no-op when the document capture listener already synced
        this.selection.normalize();
        // The Escape-then-Tab way out of the `tab` option (utils/tab.js): any key but a lone modifier closes it, whoever handles the key.
        const escaped = this.#tabEscaped;
        if (!isModifierKey(e)) this.#tabEscaped = false;
        // Commands first (ADR 017): undo / redo and every declared shortcut. What no command handles falls through to the
        // legacy `onKeyDown` hooks and the block's own keydown, then to the native behavior.
        if (this.commands.handleKeydown(e)) return;
        if (this.#selectAll(e) || this.#landOnIsolated(e) || this.#jumpToEdge(e)) return;

        this.dispatchEventToSelection('keydown', e, 'onKeyDown');
        // Tab / Shift+Tab that no command, hook or block took: the `tab` option decides (structural meanings come first).
        if (handleTabKey(this, e, escaped)) return;
        // An Escape that nothing consumed (slash menu, chooser, pending command, a block…) opens the way out for the next Tab.
        if (e.key === 'Escape' && !e.defaultPrevented && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) this.#tabEscaped = true;
    }

    /**
     * Ctrl / Cmd + A when the document holds ISOLATED text fields (`Block#isolatesSelection`, e.g. region titles). Inside one it
     * selects exactly that field's text (like an input); elsewhere it selects the text of the document from the first to the last
     * block that is not isolated (the isolated fields are left out of the selection, as of any range). A document without
     * isolated block keeps the browser's own Select All.
     * @param {KeyboardEvent} e
     * @returns {boolean} Whether the key was handled
     */
    #selectAll(e) {
        if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || typeof e.key !== 'string' || e.key.toLowerCase() !== 'a') return false;
        if (e.isComposing || this.#composing) return false;
        const sel = this.selection;
        const inside = sel.anchorBlock;
        if (inside?.isolatesSelection && sel.focusBlock === inside) {
            e.preventDefault();
            sel.selectBlockText(inside);
            return true;
        }
        const texts = textBlocksInOrder(this, { visible: true });
        if (!texts.some((b) => b.isolatesSelection)) return false;
        e.preventDefault();
        const plain = texts.filter((b) => !b.isolatesSelection && b.element);
        const first = plain[0];
        const last = plain.at(-1);
        if (first && last) sel.selectBetween(first, last);
        return true;
    }

    /**
     * Ctrl / Cmd + End and Ctrl / Cmd + Home (with Shift: extend the selection) in a LARGE document (`LARGE_DOC` blocks, whose
     * off-screen parts the browser skips, see `blocks/chunks.js`). The browser moves the caret to the end of what it has laid out, and
     * a skipped part has none: it would stop short of the real end. The caret goes to the end of the last text block (the start of
     * the first) of the model instead, and the page scrolls to it. A smaller document keeps the browser's own key.
     * @param {KeyboardEvent} e
     * @returns {boolean} Whether the key was handled
     */
    #jumpToEdge(e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== 'End' && e.key !== 'Home')) return false;
        if (e.isComposing || this.#composing || this.blocks.size < LARGE_DOC) return false;
        const texts = textBlocksInOrder(this, { visible: true });
        const toEnd = e.key === 'End';
        const target = toEnd ? texts[texts.length - 1] : texts[0];
        const point = target?.element ? /** @type {any} */ (target).getDOMPoint?.(toEnd ? (target.behaviors?.get('text')?.text.length ?? 0) : 0) : null;
        if (!target || !point) return false;
        e.preventDefault();
        const live = typeof window !== 'undefined' ? window.getSelection() : null;
        const anchor = e.shiftKey && live?.anchorNode && this.selection.owns(live.anchorNode) ? { node: live.anchorNode, offset: live.anchorOffset } : point;
        this.selection.setBaseAndExtent(anchor.node, anchor.offset, point.node, point.offset);
        // The skipped parts above take their real height as they are shown: reveal again once the layout has settled.
        revealFocus(target);
        requestAnimationFrame(() => requestAnimationFrame(() => { if (target.element?.isConnected) revealFocus(target); }));
        return true;
    }

    /**
     * Arrow keys at the edge of an ISOLATED text field (`Block#isolatesSelection`): a field is entered at its START going down /
     * right and at its END going up / left, whatever the column the caret had, and ArrowDown / ArrowRight at the end of a field
     * goes to the start of the next text. Only a collapsed caret at the very end (down / right) or start (up / left) of its
     * block is concerned; anywhere else the browser moves the caret as usual.
     * @param {KeyboardEvent} e
     * @returns {boolean} Whether the key was handled
     */
    #landOnIsolated(e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing || this.#composing) return false;
        const down = e.key === 'ArrowDown' || e.key === 'ArrowRight';
        if (!down && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft') return false;
        const sel = this.selection;
        const block = sel.anchorBlock;
        const text = block?.behaviors?.get('text');
        const caret = block?.selection;
        if (!block || !text || !sel.isCollapsed || !caret || caret.from !== caret.to) return false;
        const hasText = (/** @type {Block} */ b) => !!b.behaviors?.has('text');
        if (down) {
            if (caret.to !== text.text.length) return false;
            const next = block.findForward(hasText);
            if (!next || !(next.isolatesSelection || block.isolatesSelection)) return false;
            e.preventDefault();
            sel.setCursor(next, 0);
        } else {
            if (caret.from !== 0) return false;
            const previous = block.findBackward(hasText);
            if (!previous?.isolatesSelection) return false;
            e.preventDefault();
            sel.setCursor(previous, previous.behaviors.get('text').text.length);
        }
        return true;
    }
    
    /** @param {InputEvent} e */
    beforeinput(e) {
        return handleContainerBeforeInput(this, this, e);
    }
    




    // CLIPBOARD

    /** @param {ClipboardEvent} e */
    handleCopy(e) {
        this.selection.sync();
        if (this.selection.isCollapsed) return;
        e.preventDefault();
        if (!e.clipboardData) return;
        this.#writeSelection(e.clipboardData);
    }

    /**
     * Serialize the current (non-collapsed) selection into `dt`: `application/x-nabu+json` (the fragment, with the bytes of
     * the stored media), `text/plain` (raw text for one text block, markdown otherwise) and `text/html`. Shared by copy / cut
     * (the clipboard) and by the drag of a text selection.
     * @param {DataTransfer} dt
     * @returns {boolean} False when there is nothing to serialize
     */
    #writeSelection(dt) {
        const startBlock = this.selection.startBlock;
        const endBlock   = this.selection.endBlock;
        if (!startBlock || !endBlock) return false;

        const startFrom = this.selection.start?.from ?? 0;
        const endTo     = this.selection.end?.to ?? null;

        // Find the root block(s) to serialize.
        // - Same block: serialize it directly (partial 'both'). Going up to its parent
        //   would wrap it in its container (e.g. List), producing a fragment with children
        //   that bypasses the inline paste path on the receiving end.
        // - Cross-block: use LCA so nested containers are serialized as a unit.
        // - LCA is null: selection spans root-level blocks, fall back to nabu-level slice.
        /** @type {Block[]} */
        let rootBlocks;
        if (startBlock === endBlock) {
            rootBlocks = [startBlock];
        } else {
            const lca = findLCA(startBlock, endBlock);
            if (lca) {
                rootBlocks = [/** @type {Block} */ (/** @type {any} */ (lca))];
            } else {
                const startRoot = findDirectChildOf(startBlock, this);
                const endRoot   = findDirectChildOf(endBlock,   this);
                if (!startRoot || !endRoot) return false;
                const si = this.children.indexOf(startRoot);
                const ei = this.children.indexOf(endRoot);
                if (si === -1 || ei === -1) return false;
                rootBlocks = this.children.slice(si, ei + 1);
            }
        }

        const lastI = rootBlocks.length - 1;

        const pasteBlocks = rootBlocks.map((block, i) => {
            const isFirst = i === 0;
            const isLast  = i === lastI;

            // MegaBlocks use the generic recursive serializer
            const mb = /** @type {any} */ (block);
            if (typeof mb.serializeForClipboard === 'function') {
                return mb.serializeForClipboard({
                    startBlock: isFirst ? startBlock : null,
                    startFrom:  isFirst ? startFrom  : 0,
                    endBlock:   isLast  ? endBlock   : null,
                    endTo:      isLast  ? endTo      : null,
                    textOnly:   true, // a text selection: isolated fields (region titles) and their containers are not copied
                });
            }

            // Leaf blocks use their own serializer with flat context
            return block.serialize('application/x-nabu+json', {
                from:    isFirst ? startFrom : 0,
                to:      isLast  ? endTo     : null,
                partial: isFirst && isLast ? 'both' : isFirst ? 'start' : isLast ? 'end' : false,
            });
        }).flat().filter(Boolean); // an isolating container returns its selected children directly (an array)

        if (!pasteBlocks.length) return false;

        // Media stored in the document (`nabu-asset:` refs) is meaningless in another document: its bytes travel in the
        // fragment (`assets`), the blocks keep their ref. Outside Nabu (html / plain) such a ref is replaced, never leaked.
        const files = Files.get(this);
        const assets = files.embedAssets(pasteBlocks);
        const fragment = { version: CLIPBOARD_FORMAT_VERSION, blocks: pasteBlocks, ...(assets ? { assets } : {}) };
        dt.setData('application/x-nabu+json', JSON.stringify(fragment));

        // Recursive serializers — dispatch to each BlockClass's static toMarkdown/toHtml.
        // helpers.recurse lets blocks serialize a child without knowing its type; helpers.recurseAll serializes a list of
        // siblings in order, telling each one the siblings before it (`before`) and after it (`after`): a block may depend on
        // its neighbours (adjacent lists must not read back as one; a block that closes only when something follows it).
        /** @param {import('../utils/extensions.js').PasteBlock} pb @param {Record<string,any>} [ctx] @returns {string} */
        const pbToMarkdown = (pb, ctx = {}) => {
            const BlockClass = /** @type {any} */ (this.registry.get(pb.type));
            if (BlockClass?.toMarkdown) {
                return BlockClass.toMarkdown(pb, {
                    ...ctx,
                    recurse: (/** @type {any} */ child, /** @type {any} */ childCtx) => pbToMarkdown(child, { ...ctx, before: [], after: [], ...childCtx }),
                    recurseAll: (/** @type {any[]} */ children, /** @type {any} */ childCtx) => children.map((child, k) => pbToMarkdown(child, { ...ctx, ...childCtx, before: children.slice(0, k), after: children.slice(k + 1) })),
                });
            }
            return (pb.delta || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('');
        };

        /** @param {import('../utils/extensions.js').PasteBlock} pb @param {Record<string,any>} [ctx] @returns {string} */
        const pbToHtml = (pb, ctx = {}) => {
            const BlockClass = /** @type {any} */ (this.registry.get(pb.type));
            if (BlockClass?.toHtml) {
                return BlockClass.toHtml(pb, { ...ctx, recurse: (/** @type {any} */ child, /** @type {any} */ childCtx) => pbToHtml(child, { ...ctx, ...childCtx }) });
            }
            const text = (pb.delta || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('');
            return text ? `<p>${escapeHtml(text)}</p>` : ''; // unknown block type: escaped, never raw
        };

        // text/plain: a selection inside ONE text block is its raw selected text (no markdown syntax: no `**`, fences,
        // `# `, `- `); several blocks -> markdown.
        const single = pasteBlocks.length === 1 && startBlock === endBlock && !pasteBlocks[0].children?.length && Array.isArray(pasteBlocks[0].delta)
            ? pasteBlocks[0] : null;
        const plain = single
            ? /** @type {any[]} */ (single.delta).map(op => typeof op.insert === 'string' ? op.insert : '').join('')
            : files.externalize(pasteBlocks).map((pb, k, all) => pbToMarkdown(pb, { before: all.slice(0, k), after: all.slice(k + 1) })).join('\n\n');
        dt.setData('text/plain', plain);
        dt.setData('text/html',  files.externalize(pasteBlocks, { inline: true }).map(pb => pbToHtml(pb)).join('\n'));
        return true;
    }

    /** @param {ClipboardEvent} e */
    handleCut(e) {
        this.selection.sync();
        if (this.selection.isCollapsed) return;
        e.preventDefault();
        if (this.#readonly) { this.handleCopy(e); return; } // cutting a read-only text copies it and removes nothing

        // 1. Copy selection to clipboard
        this.handleCopy(e);

        // 2. Delete the selected content without committing
        const result = deleteSelectionContent(this, this);
        if (!result) return;

        // 3. Single Loro transaction (its own undo step, like a structural op) + restore cursor. The caret is placed
        //    once the commit has re-rendered the text: set earlier, the DOM node it points into is replaced.
        this.#isolateNextCommits();
        this.commit().then(() => this.selection.setCursor(this.blocks.get(result.block.id) ?? result.block, result.offset));
    }

    /** @param {ClipboardEvent} e */
    handlePaste(e) {
        e.preventDefault();
        if (this.#readonly) return;
        this.selection.sync();
        const clipboard = e.clipboardData;
        if (!clipboard) return;
        this.#insertTransfer(clipboard, null);
    }

    /**
     * THE pipeline that turns a `DataTransfer` (the clipboard of a paste, the payload of a drop) into content: files become
     * the blocks their file handlers make of them, text goes to the verbatim buffer of a `pastesAsPlainText` block, else the
     * first paste interpreter (internal fragment, HTML, markdown, plain text) that reads the payload makes the fragment.
     * One undo step. `at` is where it lands: null = at the caret (a paste), else a drop position.
     * @param {DataTransfer} clipboard
     * @param {DropPosition | null} at
     */
    #insertTransfer(clipboard, at) {
        const sorted = [...this.#pasteInterpreters].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        // Files on the clipboard (a screenshot, a file copied from the OS) win over its text payloads: each one becomes the
        // block their file handler makes of it. Except an internal copy (`application/x-nabu+json` already holds the blocks,
        // and their bytes), and a text payload that declares itself worth more (a spreadsheet range comes with an image of it).
        const planned = this.#planPastedFiles(clipboard, sorted);

        // A block with `pastesAsPlainText` (code…) is a verbatim buffer: take the clipboard text as-is,
        // before any interpreter (markdown / HTML / nabu JSON) gets a chance to split it into blocks.
        const target = at ? (at.side === 'inside' ? at.block : null) : this.selection.anchorBlock;
        if (target && (at || target === this.selection.focusBlock) && target.pastesAsPlainText) {
            const text = clipboard.getData('text/plain');
            if (text) { this.#pasteVerbatim(target, text, at ? at.offset : undefined); return; }
            if (!planned.length) return;
        }

        if (planned.length) {
            this.#pasteFiles(planned, at);
            return;
        }

        for (const interpreter of sorted) {
            const raw = clipboard.getData(interpreter.format);
            if (!raw) continue;
            const fragment = interpreter.interpret(raw, this);
            if (fragment) {
                this.insertFragment(fragment, at ? { at } : undefined);
                return;
            }
        }

        this.warn('handlePaste: no interpreter matched');
    }

    /**
     * The files of a paste event that an extension's `pasteFileHandlers` takes, with the block each one becomes. Empty when
     * the paste is not a file paste (no file, no handler accepting one, an internal copy, a text payload that outranks them).
     * @param {DataTransfer} clipboard
     * @param {import('../utils/extensions.js').PasteInterpreter[]} interpreters
     * @returns {Array<{ file: File, block: import('../utils/extensions.js').PasteBlock }>}
     */
    #planPastedFiles(clipboard, interpreters) {
        if (!this.#pasteFileHandlers.length) return [];
        /** @type {File[]} */
        let files = [...(clipboard.files ?? [])];
        if (!files.length) {
            files = [...(clipboard.items ?? [])].filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((f) => !!f);
        }
        if (!files.length) return [];
        if (clipboard.getData('application/x-nabu+json')) return [];
        for (const interpreter of interpreters) {
            if (!interpreter.outranksFiles) continue;
            const raw = clipboard.getData(interpreter.format);
            if (raw && interpreter.outranksFiles(raw)) return [];
        }
        /** @type {Array<{ file: File, block: import('../utils/extensions.js').PasteBlock }>} */
        const planned = [];
        for (const file of files) {
            for (const handler of this.#pasteFileHandlers) {
                let block = null;
                try { if (handler.accepts(file, this)) block = handler.block(file, this); } catch (error) { this.warn('paste: a file handler failed: ' + error); }
                if (block) { planned.push({ file, block }); break; }
            }
        }
        return planned;
    }

    /**
     * Insert the blocks made of pasted files, at the caret, in order. The files are hashed and stored first (`Files#stage`),
     * then ONE `insertFragment` does the rest like any other paste: the blocks hold the hash refs (`pending` while a host's
     * `onBeforePersist` uploads the file, `rejected` for a file over `files.maxFileSize`); a single undo step.
     * @param {Array<{ file: File, block: import('../utils/extensions.js').PasteBlock }>} planned
     * @param {DropPosition | null} [at]  where the blocks land (a drop); null = at the caret (a paste)
     */
    async #pasteFiles(planned, at = null) {
        const files = Files.get(this);
        // Staging is asynchronous: a drop position is followed through concurrent edits (Loro cursor), not re-read as an offset.
        const resolveAt = at ? this.#followPosition(at) : null;
        /** @type {import('../utils/extensions.js').PasteBlock[]} */
        const blocks = [];
        /** @type {Record<string, import('../files/files.svelte.js').EmbeddedAsset>} */
        const assets = {};
        for (const { file, block } of planned) {
            try {
                const staged = await files.stage(file);
                blocks.push({ ...block, props: { ...block.props, ref: staged.ref, ...staged.props }, partial: false });
                if (staged.asset) assets[staged.id] = staged.asset;
            } catch (error) {
                this.warn(`paste: could not read file "${file.name}": ${error}`);
            }
        }
        if (!blocks.length) return;
        const where = resolveAt ? resolveAt() : null;
        this.insertFragment({ blocks, assets }, where ? { at: where } : undefined);
    }

    /**
     * Insert `text` verbatim at the caret of `block`, replacing its selection: no interpretation, no new
     * block. One undo step (isolated commit).
     * @param {Block} block
     * @param {string} text
     * @param {number} [offset]  insert here instead of replacing the selection (a drop)
     */
    #pasteVerbatim(block, text, offset) {
        const behavior = block.behaviors?.get('text');
        const sel = offset === undefined ? behavior?.selection : { from: offset, to: offset };
        if (!behavior || !sel) return;
        const from = Math.min(sel.from, sel.to);
        const to = Math.max(sel.from, sel.to);
        if (to > from) behavior.delete({ index: from, length: to - from });
        behavior.insert(from, text);
        this.#isolateNextCommits();
        this.commit();
        tick().then(() => this.selection.setCursor(this.blocks.get(block.id) || block, from + text.length));
    }

    // DRAG & DROP (ADR 014, lot 4)
    //
    // The browser never edits the document: every `dragover` / `drop` over the editor is taken here, whatever it carries.
    // What is dropped goes through the SAME pipeline as a paste (`#insertTransfer`: files → media blocks, then the paste
    // interpreters), at the model position under the pointer. The editor's own text selection can be dragged: it is a MOVE.
    // (The block drag handle — `ui/DragHandle.svelte` — uses pointer events, not HTML5 DnD: the two never meet.)

    /**
     * Where the drop would land while something is dragged over the editor, `null` otherwise (left, dropped, cancelled, or
     * nothing the editor can take). Reactive state for a UI: Nabu itself draws nothing.
     *  - `block` / `offset` / `side`: a caret position in the text of `block` (`side: 'inside'`, `offset` in its text), or
     *    beside a block that holds no text (image, divider…: `side: 'before' | 'after'`, by the pointer's half).
     *  - `kind`: `'files'` (OS files → media blocks), `'content'` (text / HTML / markdown / Nabu fragment from outside, or a
     *    copy of the editor's own selection), `'move'` (the editor's own selection being moved). Decided from the drag's
     *    declared types: a drag that mixes files and text resolves as it does for a paste (files win) at the drop.
     * @type {DropTarget | null}
     */
    dropTarget = $state.raw(null);

    /**
     * The text selection being dragged out of this editor (set by `handleDragStart`, until the drop / dragend).
     * @type {{ token: string, range: import('./container.utils.js').DeletionRange } | null}
     */
    #dragSource = null;

    /** @param {DropTarget | null} target */
    #setDropTarget(target) {
        if (!sameTarget(this.dropTarget, target)) this.dropTarget = target;
    }

    /** What this editor can take from a drag: the formats its interpreters read, whether it takes files. */
    #dropCaps() {
        return { formats: this.#pasteInterpreters.map((interpreter) => interpreter.format), files: this.#pasteFileHandlers.length > 0 };
    }

    /**
     * Whether a drag event is for this editor's own content: not for a nested editor, a UI island or a form control
     * inside it (those keep their native behavior), and not during an IME composition.
     * @param {DragEvent} e
     */
    #ownsDrag(e) {
        const root = /** @type {HTMLElement | null} */ (e.currentTarget);
        const target = /** @type {Node | null} */ (e.target instanceof Node ? e.target : null);
        const el = target && (target.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (target) : target.parentElement);
        if (!root || !el || this.#composing) return false;
        if (el.closest('[data-nabu-root]') !== root) return false;
        return !closestWithin(el, '[data-nabu-ui], input, textarea, select', root);
    }

    /**
     * Start of a drag inside the editor. A drag of the TEXT SELECTION is serialized like a copy (internal fragment, plain text,
     * HTML — so it can also be dropped in another editor or application) and remembered: dropped back in the editor it is a
     * MOVE (see `dropAt`). Any other drag (an image, a link, a draggable element) is cancelled: the browser would hand a drop
     * its own serialization of the DOM node.
     * @param {DragEvent} e
     */
    handleDragStart(e) {
        this.#dragSource = null;
        this.#setDropTarget(null);
        if (!this.#ownsDrag(e) || !e.dataTransfer) return;
        const target = e.target;
        const draggedElement = target instanceof Element && !!target.closest('img, a[href], [draggable="true"]');
        this.selection.sync();
        const range = draggedElement || this.selection.isCollapsed ? null : selectionRange(this);
        const canMove = this.#pasteInterpreters.some((interpreter) => interpreter.format === NABU_FORMAT);
        if (!range || !canMove || !this.#writeSelection(e.dataTransfer)) {
            e.preventDefault();
            return;
        }
        const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
        e.dataTransfer.setData(DRAG_MARKER, token);
        e.dataTransfer.effectAllowed = this.#readonly ? 'copy' : 'copyMove'; // read-only: the text can be dragged out, never moved
        this.#dragSource = { token, range };
    }

    /**
     * `dragenter` / `dragover` over the editor: accept what it can take (cancelling the event is how a drop is allowed),
     * announce move vs copy, and publish the position in `dropTarget`.
     * @param {DragEvent} e
     */
    handleDragOver(e) {
        const dt = e.dataTransfer;
        if (!dt) return;
        if (this.#readonly) { this.#setDropTarget(null); dt.dropEffect = 'none'; return; } // not cancelled: nothing can be dropped
        if (!this.#ownsDrag(e)) { this.#setDropTarget(null); return; }
        const own = !!this.#dragSource && Array.from(dt.types ?? []).includes(DRAG_MARKER);
        const copy = own && wantsCopy(e);
        /** @type {DropKind | null} */
        const kind = own ? (copy ? 'content' : 'move') : transferKind(dt.types, this.#dropCaps());
        if (!kind) { this.#setDropTarget(null); dt.dropEffect = 'none'; return; }
        const root = /** @type {HTMLElement} */ (e.currentTarget);
        const position = resolveDropPosition(this, root, e.clientX, e.clientY);
        e.preventDefault(); // allows the drop
        if (kind === 'move' && position && this.#dragSource && positionInRange(this.#dragSource.range, position)) {
            dt.dropEffect = 'none'; // onto the dragged text itself: nothing to do
            this.#setDropTarget(null);
            return;
        }
        dt.dropEffect = pickDropEffect(dt.effectAllowed, kind === 'move' ? 'move' : 'copy');
        this.#setDropTarget(position ? { ...position, kind } : null);
    }

    /** @param {DragEvent} e */
    handleDragLeave(e) {
        if (!this.#ownsDrag(e)) return;
        const root = /** @type {HTMLElement} */ (e.currentTarget);
        if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return; // still inside the editor
        this.#setDropTarget(null);
    }

    /** The drag that started in this editor ended (dropped anywhere, or cancelled). @param {DragEvent} [e] */
    handleDragEnd(e) {
        this.#dragSource = null;
        this.#setDropTarget(null);
    }

    /**
     * `drop` on the editor: the browser's default (inserting DOM nodes behind Loro's back, or navigating to a dropped
     * file) never happens. The position under the pointer is resolved, then {@link Nabu#dropAt} does the rest.
     * @param {DragEvent} e
     */
    handleDrop(e) {
        const dt = e.dataTransfer;
        if (!dt || !this.#ownsDrag(e)) return;
        e.preventDefault(); // the browser never navigates to a dropped file, read-only or not
        if (this.#readonly) { this.#dragSource = null; this.#setDropTarget(null); return; }
        const source = this.#dragSource;
        this.#dragSource = null;
        this.#setDropTarget(null);
        const root = /** @type {HTMLElement} */ (e.currentTarget);
        const position = resolveDropPosition(this, root, e.clientX, e.clientY) ?? documentEnd(this);
        if (!position) return;
        // The editor takes the focus (undo, typing…) even when the drop leaves no text caret to put in it (a dropped image).
        if (document.activeElement !== root) root.focus({ preventScroll: true });
        const own = !!source && dt.getData(DRAG_MARKER) === source.token;
        this.dropAt(dt, position, { source: own && !wantsCopy(e) ? source : null });
    }

    /**
     * Drop `dt` at `position`, as ONE undo step, through the paste pipeline (files → media blocks, `pasteInterpreters`:
     * internal fragment, HTML, markdown, plain text; verbatim text into a `pastesAsPlainText` block).
     * With `opts.source` (the editor's own dragged selection) it is a MOVE: the source range is deleted and the content
     * inserted in the same transaction, the position corrected for the deletion; a position inside (or at the edge of) the
     * source range does nothing. Without it, content from outside — or a copy of the selection — is simply inserted.
     * @param {DataTransfer} dt
     * @param {DropPosition} position
     * @param {{ source?: { range: import('./container.utils.js').DeletionRange } | null }} [opts]
     */
    dropAt(dt, position, opts = {}) {
        if (this.#readonly) return;
        const source = opts.source ?? null;
        if (source) {
            const { range } = source;
            const alive = (/** @type {Block} */ b) => !!b && !b.node?.isDeleted?.() && this.blocks.get(b.id) === b;
            if (!alive(range.startBlock) || !alive(range.endBlock) || !alive(position.block)) return;
            if (positionInRange(range, position)) return;
            // Check the payload reads back BEFORE deleting anything: a move that cannot insert must not lose text.
            const reader = this.#pasteInterpreters.find((interpreter) => interpreter.format === NABU_FORMAT);
            const raw = dt.getData(NABU_FORMAT);
            if (!reader || !raw || !reader.interpret(raw, this)) return;
            if (!deleteRange(this, range)) return;
            position = positionAfterRemoval(range, position, !!range.endBlock.node?.isDeleted?.());
        }
        this.#insertTransfer(dt, position);
    }

    /**
     * Degrades the pasted / imported blocks whose type is not registered in THIS editor to the default text
     * block (text kept, children kept as following siblings, nothing dropped). See `degradeUnknownBlocks`.
     * @param {import('../utils/extensions.js').PasteBlock[]} blocks
     * @returns {import('../utils/extensions.js').PasteBlock[]}
     */
    #degradeUnknown(blocks) {
        const fallback = this.defaultBlockType && this.registry.has(this.defaultBlockType) ? this.defaultBlockType
            : this.registry.has('paragraph') ? 'paragraph' : null;
        if (!Array.isArray(blocks)) return blocks;
        /** @type {Set<string>} */
        const unknown = new Set();
        const degraded = degradeUnknownBlocks(blocks, (type) => {
            const known = this.registry.has(type);
            if (!known) unknown.add(type);
            return known;
        }, fallback);
        if (fallback && unknown.size) this.warn(`paste: unregistered block type(s) [${[...unknown].join(', ')}] degraded to "${fallback}"`);
        return degraded;
    }

    /**
     * What a block IS for the clipboard (its type and structural props), used to continue it after a paste.
     * @param {Block} block
     * @returns {{ type: string, props: Record<string, any> }}
     */
    #blockSpec(block) {
        /** @type {any} */
        let serialized = null;
        try { serialized = block.serialize('application/x-nabu+json', { from: 0, to: 0, partial: false }); } catch { /* no serializer */ }
        return { type: block.type, props: { ...(serialized?.props ?? {}) } };
    }

    /**
     * The caret position a drop position stands for. Beside a block without text (before / after an image, a divider…) there
     * is no caret: an empty default text block is created there (same transaction as the insertion, so one undo step), and the
     * fragment lands in it like in any empty block (a text becomes its text, a media block replaces it).
     * @param {DropPosition} at
     * @returns {{ block: Block, offset: number } | null}
     */
    #landingFor(at) {
        const { block, side } = at;
        if (!block || block.node?.isDeleted?.()) return null;
        if (side === 'inside') {
            const length = block.behaviors?.get('text')?.text?.length;
            if (length === undefined) return null;
            return { block, offset: Math.max(0, Math.min(at.offset, length)) };
        }
        const type = this.defaultBlockType;
        const Class = type && this.registry.get(type);
        if (!Class) return null;
        const created = Class.create(this, type, {});
        if (side === 'before') created.node.moveBefore(block.node);
        else created.node.moveAfter(block.node);
        wrapOrphan(this, created);
        return { block: created, offset: 0 };
    }

    /**
     * A function that re-reads a drop position later, after edits that happened meanwhile (the files of a drop are hashed
     * asynchronously): a text position follows the text through a Loro cursor; a block that vanished falls back to the end
     * of the document.
     * @param {DropPosition} at
     * @returns {() => DropPosition | null}
     */
    #followPosition(at) {
        const text = at.side === 'inside' ? /** @type {any} */ (at.block.behaviors?.get('text')?.container) : null;
        /** @type {any} */
        let cursor = null;
        try { cursor = text?.getCursor?.(at.offset) ?? null; } catch { /* static fallback */ }
        return () => {
            if (at.block.node?.isDeleted?.()) return documentEnd(this);
            if (!cursor) return at;
            try {
                const pos = this.doc.getCursorPos(cursor);
                return pos ? { ...at, offset: pos.offset } : at;
            } catch { return at; }
        };
    }

    /**
     * Insère un PasteFragment à la position du curseur courant — or at `opts.at` (a drop position: a caret position in a
     * text block, or beside a block without text, where an empty text block receives the fragment), whatever the DOM selection is.
     * @param {import('../utils/extensions.js').PasteFragment} fragment
     * @param {{ at?: DropPosition }} [opts]
     */
    insertFragment(fragment, opts = {}) {
        this.selection.sync(); // public entry point: may be called outside an input event
        // Every fragment (HTML / markdown / nabu JSON / API) goes through here: unsafe link & media URLs are dropped.
        const files = Files.get(this);
        let adopted = files.adoptAssets(sanitizePasteBlocks(fragment.blocks), fragment.assets);
        // Content from outside (a web page): remote images are fetched and stored, when the host asked for it (`files.importRemote`).
        if (fragment.external) adopted = files.importRemote(adopted);
        const blocks = this.#degradeUnknown(adopted);
        if (!blocks?.length) return;

        let anchorBlock;
        let offset;

        if (opts.at) {
            const landing = this.#landingFor(opts.at);
            if (!landing) return;
            anchorBlock = landing.block;
            offset = landing.offset;
        } else if (!this.selection.isCollapsed) {
            const result = deleteSelectionContent(this, this);
            if (!result) return;
            anchorBlock = result.block;
            offset = result.offset;
        } else {
            anchorBlock = this.selection.anchorBlock;
            if (!anchorBlock) return;
            offset = anchorBlock.selection?.from ?? 0;
        }

        const textBehavior = anchorBlock.behaviors?.get('text');
        if (!textBehavior) {
            this.warn('insertFragment: anchorBlock has no text behavior');
            return;
        }

        // The caret block may take over the insertion (a list item keeps pasted paragraphs in its list, and
        // splits the list around a block it cannot hold…). It declines with null: the default path runs.
        const landing = anchorBlock.acceptPaste(blocks, { offset });
        if (landing) {
            this.#isolateNextCommits();
            this.commit();
            tick().then(() => {
                if (!landing.block) return;
                const fb = this.blocks.get(landing.block.id) || landing.block;
                this.selection.setCursor(fb, landing.offset);
            });
            return;
        }

        // A whole pasted block landing in an EMPTY root-level block (e.g. `# Title` into an
        // empty paragraph) brings its type along. Pasting into existing text never coerces.
        // Blocks nested in a container (list item…) keep their type to preserve the structure, unless that
        // container holds free-form content (`Block#adoptsPastedTypes`, e.g. a toggle body).
        const anchorEmpty = textBehavior.container.length === 0 && (!anchorBlock.parent || anchorBlock.parent.adoptsPastedTypes);
        /** @param {import('../utils/extensions.js').PasteBlock} pb */
        const adoptType = (pb) => {
            if (!anchorEmpty || pb.partial !== false || pb.type === anchorBlock.type || !this.registry.has(pb.type)) return;
            const data = /** @type {any} */ (anchorBlock.node.data);
            data.set('type', pb.type);
            for (const [key, value] of Object.entries(pb.props || {})) data.set(key, value);
        };

        // A pasted block is TEXT when it carries a delta; one without (image, divider…) cannot merge into the caret block's
        // text: it is inserted as a block (the caret block is split around it), or replaces an empty caret block (see adoptType).
        /** @param {import('../utils/extensions.js').PasteBlock} pb */
        const isText = (pb) => Array.isArray(pb.delta);

        // ── Inline: single flat block ─────────────────────────────────────────
        if (blocks.length === 1 && !blocks[0].children?.length && (isText(blocks[0]) || anchorEmpty)) {
            const pb = blocks[0];
            const delta = pb.delta || [];
            const len = delta.reduce((s, op) => s + (typeof op.insert === 'string' ? op.insert.length : 0), 0);

            adoptType(pb);
            textBehavior.applyDelta([{ retain: offset }, ...delta]);
            this.#isolateNextCommits();
            this.commit();
            // A type change makes updateRoots() replace the block instance — re-fetch it.
            tick().then(() => this.selection.setCursor(this.blocks.get(anchorBlock.id) || anchorBlock, offset + len));
            return;
        }

        // ── Multi-block or container ──────────────────────────────────────────
        // Save and cut right fragment
        const rightDelta = textBehavior.container.sliceDelta(offset, textBehavior.container.length);
        if (textBehavior.container.length > offset) {
            textBehavior.delete({ index: offset, length: textBehavior.container.length - offset });
        }

        // What the caret block IS (type + props), captured before it may adopt a pasted type: the text that
        // follows the caret continues in a block of the same kind, like Enter would (`Ti|tle` heading stays a
        // heading on both sides of the pasted blocks).
        const tailSpec = rightDelta.length ? this.#blockSpec(anchorBlock) : null;

        const firstPb  = blocks[0];
        const lastPb   = blocks[blocks.length - 1];
        const midPbs   = blocks.slice(1, -1);
        let prevNode   = anchorBlock.node;
        let focusBlock = anchorBlock;
        let focusOffset = offset;

        // ── First block ───────────────────────────────────────────────────────
        if (!firstPb.children?.length && (isText(firstPb) || anchorEmpty)) {
            // Leaf: merge content into anchor (anchor type survives, unless it was empty — see adoptType)
            adoptType(firstPb);
            const firstDelta = firstPb.delta || [];
            if (firstDelta.length) textBehavior.applyDelta([{ retain: offset }, ...firstDelta]);
            focusOffset = offset + firstDelta.reduce((s, op) => s + (typeof op.insert === 'string' ? op.insert.length : 0), 0);
        } else {
            // Container (e.g. List) or void block (image…): insert it after anchor
            prevNode = this.insertPasteBlock(firstPb, prevNode);
        }
        // The caret was at the very start of a text block and a block (not text) comes first: nothing precedes the pasted
        // block, the blank head left behind goes (the tail, created below, is the block that keeps the text).
        const dropHead = offset === 0 && !!rightDelta.length && !isText(firstPb) && !anchorEmpty && !/** @type {any} */ (anchorBlock).children?.length;

        // ── Middle blocks ─────────────────────────────────────────────────────
        for (const pb of midPbs) {
            prevNode = this.insertPasteBlock(pb, prevNode);
        }

        // ── Last block (only when blocks.length > 1) ──────────────────────────
        // The text after the caret (`rightDelta`) merges with the last pasted block when that one is TEXT
        // (cut at the edge of a partial copy, or a default text block), in a block of the caret block's kind;
        // otherwise (heading, code, image, container…) the block is inserted as it is and the tail follows in
        // a block of the caret block's kind. Without a tail the last block is simply inserted as it is.
        /** @param {{type: string, props?: Record<string, any>}} spec @param {import('loro-crdt').Delta<string>[]} delta @param {any} after */
        const insertLeaf = (spec, delta, after) => {
            const Class = this.registry.get(spec.type) || this.registry.get('paragraph');
            if (!Class) return null;
            const created = Class.create(this, spec.type, spec.props || {});
            created.node.moveAfter(after);
            const wrapper = wrapOrphan(this, created);
            if (delta.length) created.behaviors?.get('text')?.applyDelta(delta);
            return { block: created, node: wrapper ? wrapper.node : created.node };
        };
        const deltaLen = (/** @type {any[]} */ d) => d.reduce((n, op) => n + (typeof op.insert === 'string' ? op.insert.length : 0), 0);

        if (blocks.length > 1) {
            if (!lastPb.children?.length) {
                const lastDelta = lastPb.delta || [];
                const lastIsText = lastPb.partial === 'end' || lastPb.partial === 'both' || lastPb.type === this.defaultBlockType;
                if (!tailSpec) {
                    const done = insertLeaf({ type: lastPb.type, props: lastPb.props }, lastDelta, prevNode);
                    if (done) { focusBlock = done.block; focusOffset = deltaLen(lastDelta); prevNode = done.node; }
                } else if (lastIsText) {
                    const done = insertLeaf(tailSpec, [...lastDelta, ...rightDelta], prevNode);
                    if (done) { focusBlock = done.block; focusOffset = deltaLen(lastDelta); prevNode = done.node; }
                } else {
                    prevNode = this.insertPasteBlock(lastPb, prevNode);
                    const done = insertLeaf(tailSpec, rightDelta, prevNode);
                    if (done) { focusBlock = done.block; focusOffset = 0; prevNode = done.node; }
                }
            } else {
                // Container last block: insert it, the tail goes in a new block after it
                prevNode = this.insertPasteBlock(lastPb, prevNode);
                if (tailSpec) {
                    const done = insertLeaf(tailSpec, rightDelta, prevNode);
                    if (done) { focusBlock = done.block; focusOffset = 0; }
                }
            }
        } else if (tailSpec) {
            // Single container block: the tail goes in a new block after it
            const done = insertLeaf(tailSpec, rightDelta, prevNode);
            if (done) { focusBlock = done.block; focusOffset = 0; }
        }

        if (dropHead && focusBlock !== anchorBlock) this.tree.delete(anchorBlock.node.id);

        this.#isolateNextCommits();
        this.commit();
        tick().then(() => {
            const fb = this.blocks.get(focusBlock.id) || focusBlock;
            this.selection.setCursor(fb, focusOffset);
        });
    }

    /**
     * Inserts a PasteBlock after `afterNode`. Handles both leaf blocks (wrapOrphan)
     * and container blocks (creates container, recurses into children).
     * Returns the outer node to use as the next prevNode. Public: part of the paste toolbox a block's
     * `acceptPaste` hook builds on. No commit.
     * @param {import('../utils/extensions.js').PasteBlock} pb
     * @param {any} afterNode
     * @returns {any}
     * @public
     */
    insertPasteBlock(pb, afterNode) {
        if (!this.registry.has(pb.type)) {
            // Unknown type: degraded to the default text block, its children follow it (nothing is dropped).
            const degraded = this.#degradeUnknown([pb]);
            if (degraded.length === 1 && !this.registry.has(degraded[0].type)) return afterNode; // no default block to degrade to
            let previous = afterNode;
            for (const d of degraded) previous = this.insertPasteBlock(d, previous);
            return previous;
        }
        if (pb.children?.length) {
            const ContainerClass = this.registry.get(pb.type);
            if (!ContainerClass) return afterNode;
            const container = ContainerClass.create(this, pb.type, pb.props || {});
            container.node.moveAfter(afterNode);
            // A container with its own text (list item, toggle…) keeps it.
            const ctb = container.behaviors?.get('text');
            if (ctb && pb.delta?.length) ctb.applyDelta(pb.delta);
            for (const child of pb.children) {
                this.createPasteBlock(child, container.node.id.toString());
            }
            const wrapper = wrapOrphan(this, container);
            return wrapper ? wrapper.node : container.node;
        }

        const BlockClass = this.registry.get(pb.type) || this.registry.get('paragraph');
        if (!BlockClass) return afterNode;
        const block = BlockClass.create(this, pb.type, pb.props || {});
        block.node.moveAfter(afterNode);
        const wrapper = wrapOrphan(this, block);
        const tb = block.behaviors?.get('text');
        if (tb && pb.delta?.length) tb.applyDelta(pb.delta);
        // After wrapOrphan, outer node is the wrapper (if created) or the block itself
        return wrapper ? wrapper.node : block.node;
    }

    /**
     * Creates a block inside a container, recursively handling nested children. Public: part of the paste
     * toolbox a block's `acceptPaste` hook builds on. No commit.
     * @param {import('../utils/extensions.js').PasteBlock} pb
     * @param {string} parentId
     * @returns {Block | null}  the created block
     * @public
     */
    createPasteBlock(pb, parentId) {
        if (!this.registry.has(pb.type)) {
            // Unknown type: the default text block, then its children as ITS following siblings (not inside it).
            const [head, ...rest] = this.#degradeUnknown([pb]);
            if (!head || !this.registry.has(head.type)) return null;
            const created = this.createPasteBlock(head, parentId);
            for (const sibling of rest) this.createPasteBlock(sibling, parentId);
            return created;
        }
        const BlockClass = this.registry.get(pb.type) || this.registry.get('paragraph');
        if (!BlockClass) return null;
        const block = BlockClass.create(this, pb.type, pb.props || {}, parentId);
        const tb = block.behaviors?.get('text');
        if (tb && pb.delta?.length) tb.applyDelta(pb.delta);
        for (const child of pb.children || []) {
            this.createPasteBlock(child, block.node.id.toString());
        }
        return block;
    }

    // DOCUMENT IMPORT

    /**
     * Replace the entire document with the given PasteFragment.
     * Unlike insertFragment(), this does not depend on a live DOM selection:
     * blocks are created at the root through the same registry pipeline as paste.
     * @param {import('../utils/extensions.js').PasteFragment} fragment
     * @returns {Promise<void>}
     * @public
     */
    async importFragment(fragment) {
        const blocks = this.#degradeUnknown(Files.get(this).adoptAssets(sanitizePasteBlocks(fragment.blocks), fragment.assets));
        if (!blocks?.length) return;

        [...this.tree.roots()].forEach(root => this.tree.delete(root.id));

        for (const pb of blocks) {
            const BlockClass = this.registry.get(pb.type) || this.registry.get('paragraph');
            if (!BlockClass) continue;
            const block = BlockClass.create(this, pb.type, pb.props || {});
            const tb = block.behaviors?.get('text');
            if (tb && pb.delta?.length) tb.applyDelta(pb.delta);
            for (const child of pb.children || []) {
                this.createPasteBlock(child, block.node.id.toString());
            }
        }

        await this.commit();
        // The files of the import are verified and stored in the background: the import is complete once they are (a host upload is not waited for).
        await Files.get(this).whenIdle();
    }

    /**
     * Replace the entire document with content parsed from a Markdown string.
     * Requires MarkdownPasteExtension (or any text/plain interpreter) to be loaded.
     * @param {string} markdown
     * @returns {Promise<void>}
     * @public
     */
    async importMarkdown(markdown) {
        const interpreter = [...this.#pasteInterpreters]
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .find(i => i.format === 'text/plain');
        if (!interpreter) {
            this.warn('importMarkdown: MarkdownPasteExtension not loaded');
            return;
        }

        // CommonMark semantics: consecutive lines join into one paragraph (paste splits per line).
        const fragment = interpreter.interpret(markdown, this, { joinLines: true });
        if (!fragment) {
            this.warn('importMarkdown: nothing to import');
            return;
        }

        await this.importFragment(fragment);
    }

    /**
     * Replace the entire document with a `serialize('json')` export. An export of a version this editor does not know
     * is refused with a warning (the document is left untouched), like the clipboard does; a block type that is not
     * registered is degraded to the default text block (`degradeUnknownBlocks`), nothing is dropped.
     * @param {{version?: string | number, blocks: Parameters<typeof import('../utils/extensions.js').jsonToPasteBlocks>[0], assets?: Record<string, import('../files/files.svelte.js').EmbeddedAsset>} | string} json
     * @returns {Promise<void>}
     * @public
     */
    async importJSON(json) {
        const doc = typeof json === 'string' ? JSON.parse(json) : json;
        if (!isSupportedJsonVersion(doc?.version)) {
            this.warn(`importJSON: unsupported export version ${JSON.stringify(doc.version)} (this editor reads version ${JSON_FORMAT_VERSION}): nothing imported`);
            return;
        }
        const blocks = jsonToPasteBlocks(doc?.blocks || []);
        if (!blocks.length) {
            this.warn('importJSON: nothing to import');
            return;
        }
        await this.importFragment({ blocks, ...(doc.assets && typeof doc.assets === 'object' ? { assets: doc.assets } : {}) });
    }

    /**
     * The block and local offset that hold a document-wide caret offset (`positions` counted from the start of the document).
     * @param {number} globalOffset
     * @returns {{ block: Block, offset: number } | null}
     * @public
     */
    resolveDocumentOffset(globalOffset) {
        let remaining = globalOffset;
        for (const block of this.children) {
            const blockPositions = block.positions ?? 0;
            if (remaining < blockPositions) return block.resolveOffset(remaining);
            remaining -= blockPositions;
        }
        // Fallback: clamp to end of last root block
        const last = this.children[this.children.length - 1];
        return last ? last.resolveOffset(Math.max(0, (last.positions ?? 1) - 1)) : null;
    }

    /** @type {NabuInternals | null} */
    #internals = null;

    /**
     * The door to everything the engine uses internally that the stable contract (the members tagged `public` in their JSDoc) does not cover: the
     * command-confirm controller, the action bus, the hook and rule registries, the clipboard / drop / event pipelines, undo
     * capture, stored marks, the selection's repair machinery. They are the same references the engine runs on, not copies.
     *
     * The door itself is part of the stable contract; **@unstable** is everything behind it: nothing reached through `internals` is a
     * promise, it may change, move or disappear in ANY minor version.
     * Prefer the stable members; use this when you must, and pin the version of the package. The set of keys is frozen by a
     * test, so a change shows up in the changelog.
     * @returns {NabuInternals}
     * @public
     * @unstable
     */
    get internals() {
        if (this.#internals) return this.#internals;
        const nabu = this;
        const selection = nabu.selection;
        return this.#internals = Object.freeze({
            pulse: this.#pulse,
            commandConfirm: this.commandConfirm,
            hooks: this.hooks,
            hookOwners: this.hookOwners,
            inputRules: this.inputRules,
            pasteInterpreters: this.#pasteInterpreters,
            pasteFileHandlers: this.#pasteFileHandlers,
            undoManager: this.undoManager,
            content: this.content,
            fileConfig: this.fileConfig,
            get storedMarks() { return nabu.storedMarks; },
            set storedMarks(value) { nabu.storedMarks = value; },
            toggleStoredMark: this.toggleStoredMark.bind(this),
            clearStoredMarks: this.clearStoredMarks.bind(this),
            noteTextChange: this.noteTextChange.bind(this),
            captureUndoSelection: this.captureUndoSelection.bind(this),
            sealUndoEnd: this.sealUndoEnd.bind(this),
            updateRoots: this.updateRoots.bind(this),
            deleteNode: this.deleteNode.bind(this),
            rearmTab: this.rearmTab.bind(this),
            get tabDescription() { return nabu.tabDescription; },
            dispatchEventToSelection: this.dispatchEventToSelection.bind(this),
            handleKeydown: this.handleKeydown.bind(this),
            handleBeforeinput: this.handleBeforeinput.bind(this),
            beforeinput: this.beforeinput.bind(this),
            handleCompositionStart: this.handleCompositionStart.bind(this),
            handleCompositionUpdate: this.handleCompositionUpdate.bind(this),
            handleCompositionEnd: this.handleCompositionEnd.bind(this),
            handleMousedown: this.handleMousedown.bind(this),
            handleCopy: this.handleCopy.bind(this),
            handleCut: this.handleCut.bind(this),
            handlePaste: this.handlePaste.bind(this),
            insertFragment: this.insertFragment.bind(this),
            handleDragStart: this.handleDragStart.bind(this),
            handleDragOver: this.handleDragOver.bind(this),
            handleDragLeave: this.handleDragLeave.bind(this),
            handleDragEnd: this.handleDragEnd.bind(this),
            handleDrop: this.handleDrop.bind(this),
            dropAt: this.dropAt.bind(this),
            get dropTarget() { return nabu.dropTarget; },
            selection: Object.freeze({
                normalize: selection.normalize.bind(selection),
                scheduleRepair: selection.scheduleRepair.bind(selection),
                repairAfterRemoval: selection.repairAfterRemoval.bind(selection),
                get placements() { return selection.placements; },
                attachRoot: selection.attachRoot.bind(selection),
                owns: selection.owns.bind(selection),
                scope: selection.scope.bind(selection),
                get root() { return selection.root; },
            }),
        });
    }

    /**
     * Log a diagnostic to the console when `debugging` is on. Silent otherwise.
     * @param {...any} args
     * @returns {void}
     * @public
     */
    warn(...args) {
        if (this.debugging) console.warn("[Nabu]", ...args);
    }
}


