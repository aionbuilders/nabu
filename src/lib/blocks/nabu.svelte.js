import { LoroDoc, UndoManager } from 'loro-crdt';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Block } from './block.svelte.js';
import { MegaBlock } from './megablock.svelte.js';
import { NabuSelection } from './selection.svelte.js';
import { handleContainerBeforeInput, wrapOrphan, deleteSelectionContent, findDirectChildOf, findLCA } from './container.utils.js';
import { jsonToPasteBlocks, degradeUnknownBlocks, CLIPBOARD_FORMAT_VERSION } from '../utils/extensions.js';
import { escapeHtml, sanitizePasteBlocks } from '../utils/html.js';
import { tick } from 'svelte';
import { Pulse } from '@aionbuilders/pulse';
import { normalizePlaceholders } from '../utils/placeholders.js';


/**
* @import {Component} from "svelte";
* @import { LoroTreeNode, LoroTree } from "loro-crdt";
* @import {Extension} from '../utils/extensions.js';
*/

/**
* @template {Object<string, any>} [T={}]
* @typedef {LoroTreeNode<{type: string} & T>} NabuNode
*/

/**
* @typedef {Object} NabuInit
* @property {Extension[]} [extensions]
* @property {Uint8Array<ArrayBufferLike>} [snapshot]
* @property {import('../files/files.svelte.js').FilesConfig} [files]
* @property {import('../utils/placeholders.js').PlaceholdersOption} [placeholders] - Hint text of empty blocks.
*   `false`: none. `true` / omitted: defaults (shown on the empty block holding the cursor).
*   Object: `{ show?: 'focus' | 'empty', text?: Record<blockType, string | false | ((block) => string | false)> }`.
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
 * @typedef {Object} UndoCursor  Caret stored with an undo step.
 * @property {string} blockId
 * @property {number} offset
 * @property {number[]} [path]  child index at each level, root first (see blockPath)
 */

/**
 * Tree path of a block: the child index at each level, root first. Read from the Block's own
 * `parent` / `index` — still valid for a block destroyed in the very transaction being recorded,
 * whose Loro node can no longer tell (a deleted node has no index).
 * @param {Block} block
 * @returns {number[]}
 */
function blockPath(block) {
    /** @type {number[]} */
    const path = [];
    for (let b = /** @type {any} */ (block); b; b = b.parent) path.unshift(b.index);
    return path;
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

export class Nabu {
    /** @type {Pulse} */
    #pulse = new Pulse();
    /** @type {import('../utils/extensions.js').PasteInterpreter[]} */
    #pasteInterpreters = [];

    // ── IME composition state ────────────────────────────────────────────────
    // During an active IME composition the browser mutates the DOM freely
    // (insertCompositionText cannot be canceled). We switch to "DOM-first"
    // for the duration of the composition and sync the result into Loro at
    // compositionend. See issue #6.
    #composing = false;
    /** True during an IME composition: the browser owns the DOM, the caret must not be touched. */
    get composing() { return this.#composing; }
    /** @type {number | null} offset modèle au début de la composition */
    #compositionStartOffset = null;
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

    /** @param {NabuInit} init */
    constructor(init = {}) {
        this.doc = new LoroDoc();
        if (init.snapshot) {
            this.doc.import(init.snapshot);
        }
        
        this.selection = new NabuSelection(this);
        this.tree = /** @type {LoroTree<Record<string, NabuNode>>} */ (this.doc.getTree("blocks"));
        this.content = this.doc.getMap("content");

        // Initialize Undo/Redo Manager
        this.undoManager = new UndoManager(this.doc, {
            maxUndoSteps: 100,
            mergeInterval: this.#mergeInterval,
            onPush: () => {
                if (this.#isolatedSteps > 0) this.#isolatedSteps--;
                // Save cursor position for restoration on undo/redo
                const explicit = this.#undoCursor;
                this.#undoCursor = null;
                const sel = this.selection;
                const block = explicit ? explicit.block : sel?.anchorBlock;
                if (!block) return { value: null, cursors: [] };

                return {
                    value: {
                        blockId: block.id,
                        offset: explicit ? explicit.offset : sel.startOffset,
                        // Tree path (child index at each level): Loro gives a block RESTORED by undo
                        // (after a delete) a new id, so the id alone can't find it again.
                        path: blockPath(block),
                    },
                    cursors: []
                };
            },
            onPop: (_, storedValue) => {
                // Restore cursor position after undo/redo
                const value = /** @type {UndoCursor | null} */ (storedValue?.value);
                if (value && typeof value === 'object' && 'blockId' in value) this.#restoreCursor(value);
            }
        });

        this.extensions = init.extensions || [];
        this.fileConfig = init.files || {};
        this.placeholders = normalizePlaceholders(init.placeholders);
        
        if (this.extensions?.length) {
            for (const ext of this.extensions) {
                if (ext.block) this.registry.set(ext.name, ext.block);
                if (ext.block && ext.defaultBlock) this.defaultBlockType = ext.name;
                if (ext.component) this.components.set(ext.name, ext.component);
                if (ext.hooks) {
                    for (const [hookName, hookFn] of Object.entries(ext.hooks)) {
                        if (!this.hooks.has(hookName)) {
                            this.hooks.set(hookName, []);
                        }
                        this.hooks.get(hookName).push(hookFn);
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
                        this.#pulse.on(topic, ({ event }) => handler(this, event.data, event.topic));
                    }
                }

                if (ext.pasteInterpreters?.length) {
                    for (const interpreter of ext.pasteInterpreters) {
                        this.#pasteInterpreters.push(interpreter);
                    }
                }

                if (ext.inputRules?.length) {
                    for (const rule of ext.inputRules) {
                        this.inputRules.push(rule);
                    }
                }

                if (ext.loroTextStyles && Object.keys(ext.loroTextStyles).length) {
                    this.doc.configTextStyle(ext.loroTextStyles);
                }

            }
        }

        // Core actions — always available
        this.#pulse.on('undo', () => this.undo());
        this.#pulse.on('redo', () => this.redo());

        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        if (roots?.length) {
            for (const root of roots) {
                const block = Block.load(this, root);
                this.children.push(block);
            }
        }
        
        // this.doc.subscribe((event) => {
        //     // event.events contient un tableau listant TOUTES les opérations 
        //     // (texte ajouté, nœuds déplacés, etc.) qui viennent d'être commitées.
        //     console.log("Rapport de la transaction :", event.events);
        // });

        this.tree.subscribe((event) => {
            event.events.forEach(e => {
                if (e.diff.type === "tree") {
                    e.diff.diff.forEach(action => {
                        if (action.action === 'create' || action.action === 'move' || action.action === 'delete') {
                            if (action.parent) {
                                const parentId = action.parent.toString();
                                const parentBlock = this.blocks.get(parentId);
                                // A block retyped into a leaf (no children) in the same transaction has no updateChildren().
                                if (parentBlock) parentBlock.updateChildren?.();
                            } else {
                                this.updateRoots();
                            }

                            if (action.oldParent) {
                                const oldParentId = action.oldParent.toString();
                                const oldParentBlock = this.blocks.get(oldParentId);
                                if (oldParentBlock) oldParentBlock.updateChildren?.();
                            }
                        }
                    })
                }

                if (e.diff.type === "map") {
                    
                    const newType = e.diff.updated["type"];
                    if (newType !== undefined) {
                        const nodeId = e.path[1].toString();
                        const block = this.blocks.get(nodeId);
                        if (block && block.type !== newType) {
                            if (block.parent) block.parent.updateChildren();
                            else this.updateRoots();
                        }
                    }
                }
            })
        });
        
        this.init();
    }
    
    static BREAK = Symbol("BREAK");
    static CONTINUE = Symbol("CONTINUE");
    BREAK = Nabu.BREAK;
    CONTINUE = Nabu.CONTINUE;
    
    /** @type {LoroDoc} */
    doc;
    /** @type {SvelteMap<string, typeof Block>} */
    registry = new SvelteMap();

    /**
     * Type of the default text block (declared by an extension with `defaultBlock: true`): created by the
     * engine when it needs an empty text block of its own, e.g. a caret after a trailing void block.
     * @type {string | null}
     */
    defaultBlockType = null;
    /** @type {SvelteMap<string, Component>} */
    components = new SvelteMap();
    /** @type {SvelteMap<string, Block>} */
    blocks = new SvelteMap();

    /** @type {SvelteMap<string, SvelteSet<Block>>} */
    blocksByType = new SvelteMap();

    /**
     * Registered subsystems. Each system should implement:
     *   - `start(): void` — called when the editor mounts
     *   - `stop(): void`  — called when the editor unmounts
     * @type {SvelteMap<string, { start?: () => void, stop?: () => void, [key: string]: any }>}
     */
    systems = new SvelteMap();
    
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

    /** @type {import('../files/files.svelte.js').FilesConfig} */
    fileConfig = {};

    /**
     * Resolved `placeholders` option (see NabuInit). Reassign to change it at runtime.
     * @type {import('../utils/placeholders.js').ResolvedPlaceholders}
     */
    placeholders = $state.raw(normalizePlaceholders());

    /**
     * Pending inline formatting for the next typed character (active marks at a
     * collapsed cursor). null = inherit from the span at the cursor.
     * @type {Record<string, boolean> | null}
     */
    storedMarks = $state(null);

    debugging = $state(false);

    /**
     * Root-level serializers. Each function receives the Nabu instance and returns the serialized document.
     * @type {Map<string, (nabu: Nabu) => any>}
     */
    serializers = new Map([
        ['markdown', (nabu) =>
            nabu.children
                .map(b => b.serialize('markdown'))
                .filter(Boolean)
                .join('\n\n')
        ],
        ['json', (nabu) => ({
            version: '1',
            blocks: nabu.children.map(b => b.serialize('json')).filter(Boolean)
        })]
    ]);

    /** @type {Block[]} */
    children = $state([]);

    positions = $derived(this.children.reduce((sum, child) => sum + (child.positions ?? 0), 0));
    
    get isEmpty() {
        return this.children.length === 0;
    }

    /** @param {string} format */
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

    /** Rafraîchit les blocs racines de l'éditeur */
    updateRoots() {
        const roots = /** @type {NabuNode[]} */ (this.tree.roots());
        this.children = roots.map((root, i) => {
            const id = root.id.toString();
            let block = this.blocks.get(id);
            const currentType = root.data.get("type");
            
            if (!block || block.type !== currentType) {
                if (block) {
                    this.blocks.delete(id);
                    this.blocksByType.get(block.type)?.delete(block);
                }

                block = Block.load(this, root);
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
     */
    exec(topic, data) {
        this.selection.sync();
        return this.#pulse.emit(topic, data);
    }

    trigger(hookName, ...args) {
        const hooks = this.hooks.get(hookName) || [];
        for (const hook of hooks) {
            const result = hook(this, ...args);
            if (result === this.BREAK) {
                break;
            }

        }
    }


    async commit() {
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
        this.doc.commit();
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
     * Put the caret back after an undo / redo. The stored block may have been destroyed and restored
     * under a new id (Loro), so resolve it by id when it is still alive, else by its tree path,
     * else the nearest text block; the offset is clamped to the block's text.
     * @param {UndoCursor} value
     * @param {number} [attempt]  retries while the (re)created block is not rendered yet
     */
    #restoreCursor(value, attempt = 0) {
        tick().then(() => {
            const target = this.#resolveCursor(value);
            if (!target) return;
            if (!target.block.element && attempt < 3) return this.#restoreCursor(value, attempt + 1);
            this.selection.setCursor(target.block, target.offset);
        });
    }

    /**
     * @param {UndoCursor} value
     * @returns {{ block: Block, offset: number } | null}
     */
    #resolveCursor(value) {
        /** @param {Block | undefined | null} b */
        const alive = (b) => !!b && !b.node.isDeleted?.() && this.tree.has(b.node.id);
        /** @param {Block} b */
        const withText = (b) => b.behaviors?.has('text');
        /** @param {Block} b */
        const clamp = (b) => Math.max(0, Math.min(value.offset, b.behaviors.get('text')?.text?.length ?? 0));

        const byId = this.blocks.get(value.blockId);
        if (alive(byId) && withText(/** @type {Block} */ (byId))) {
            return { block: /** @type {Block} */ (byId), offset: clamp(/** @type {Block} */ (byId)) };
        }

        // Walk the stored path as far as it still exists…
        /** @type {Block | null} */
        let found = null;
        /** @type {any} */
        let level = this;
        for (const i of value.path ?? []) {
            const next = level.children?.[i];
            if (!next) break;
            found = next;
            level = next;
        }
        // …then settle on a text block: that one, else its first text descendant / following block.
        if (found && !withText(found)) found = found.findForward(withText);
        if (!found) found = this.children.find(withText) ?? this.children[0]?.findForward(withText) ?? null;
        return found ? { block: found, offset: clamp(found) } : null;
    }

    /**
     * True when every selected text run carries the given mark.
     * Reactive: reads block.selected and the behaviors' selections/deltas,
     * so it can be used directly in component templates (e.g. FloatingToolbar).
     * @param {string} markName
     * @returns {boolean}
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
     * Undo the last operation
     */
    undo() {
        if (this.undoManager.canUndo()) {
            this.undoManager.undo();
        }
    }

    /**
     * Redo the last undone operation
     */
    redo() {
        if (this.undoManager.canRedo()) {
            this.undoManager.redo();
        }
    }

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
        if (e.button !== 0 || e.defaultPrevented || e.target !== e.currentTarget) return;
        const last = this.lastVisibleBlock;
        const lastEl = /** @type {HTMLElement | null} */ (last?.element);
        if (!last || last.behaviors?.has('text') || !lastEl?.isConnected) return;
        if (e.clientY <= lastEl.getBoundingClientRect().bottom) return;
        this.openTrailingCaret(); // overrides the native caret the click leaves on the root

    }

    /**
    * Insère un nouveau bloc dans le document
    * @param {string} type - Le type du bloc (ex: 'paragraph')
    * @param {Object} [props={}] - Les propriétés initiales
    * @param {string|null} [parentId=null] - ID du parent (null pour racine)
    * @param {number|null} [index=null] - Position dans la liste des enfants
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
    
    
    
    /** @param {Block} block */
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
        this.selection.sync(); // selectionchange is async: don't act on a stale caret
        // Ne pas interférer avec la composition IME en cours : le navigateur
        // doit pouvoir muter librement le text node (insertCompositionText
        // n'est de toute façon pas annulable). Sync dans Loro à compositionend.
        if (this.#composing && (e.inputType === 'insertCompositionText' || e.inputType === 'deleteCompositionText')) {
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
        this.selection.sync();
        this.#composing = true;
        const anchor = this.selection.anchorBlock;
        if (!anchor) {
            this.#compositionStartBlock = null;
            this.#compositionStartOffset = null;
            return;
        }
        const behavior = anchor.behaviors?.get('text');
        const sel = behavior?.selection;
        this.#compositionStartBlock = anchor;
        this.#compositionStartOffset = sel?.from ?? 0;
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
        this.#composing = false;
        this.#syncComposition(e);
        this.selection.normalize(); // a dead caret must not survive the composition
    }

    /** @param {CompositionEvent} e */
    #syncComposition(e) {
        const block = this.#compositionStartBlock;
        const startOffset = this.#compositionStartOffset;
        this.#compositionStartBlock = null;
        this.#compositionStartOffset = null;
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

        behavior.insert(startOffset, composedText);
        block.commit();
        tick().then(() => {
            this.selection.setCursor(block, startOffset + composedText.length);
        });
    }

    /** @param {KeyboardEvent} e */
    handleKeydown(e) {
        this.selection.sync(); // no-op when the document capture listener already synced
        this.selection.normalize();
        // Undo: Ctrl+Z or Cmd+Z (without Shift)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return;
        }

        // Redo: Ctrl+Y, Cmd+Y, or Ctrl+Shift+Z, Cmd+Shift+Z
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            this.redo();
            return;
        }

        this.dispatchEventToSelection('keydown', e, 'onKeyDown');
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

        const startBlock = this.selection.startBlock;
        const endBlock   = this.selection.endBlock;
        if (!startBlock || !endBlock || !e.clipboardData) return;

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
                if (!startRoot || !endRoot) return;
                const si = this.children.indexOf(startRoot);
                const ei = this.children.indexOf(endRoot);
                if (si === -1 || ei === -1) return;
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
                });
            }

            // Leaf blocks use their own serializer with flat context
            return block.serialize('application/x-nabu+json', {
                from:    isFirst ? startFrom : 0,
                to:      isLast  ? endTo     : null,
                partial: isFirst && isLast ? 'both' : isFirst ? 'start' : isLast ? 'end' : false,
            });
        }).filter(Boolean);

        if (!pasteBlocks.length) return;

        const fragment = { version: CLIPBOARD_FORMAT_VERSION, blocks: pasteBlocks };
        e.clipboardData.setData('application/x-nabu+json', JSON.stringify(fragment));

        // Recursive serializers — dispatch to each BlockClass's static toMarkdown/toHtml.
        // helpers.recurse lets blocks serialize their children without knowing their types.
        /** @param {import('../utils/extensions.js').PasteBlock} pb @param {Record<string,any>} [ctx] @returns {string} */
        const pbToMarkdown = (pb, ctx = {}) => {
            const BlockClass = /** @type {any} */ (this.registry.get(pb.type));
            if (BlockClass?.toMarkdown) {
                return BlockClass.toMarkdown(pb, { ...ctx, recurse: (/** @type {any} */ child, /** @type {any} */ childCtx) => pbToMarkdown(child, { ...ctx, ...childCtx }) });
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
            : pasteBlocks.map(pb => pbToMarkdown(pb)).join('\n\n');
        e.clipboardData.setData('text/plain', plain);
        e.clipboardData.setData('text/html',  pasteBlocks.map(pb => pbToHtml(pb)).join('\n'));

    }

    /** @param {ClipboardEvent} e */
    handleCut(e) {
        this.selection.sync();
        if (this.selection.isCollapsed) return;
        e.preventDefault();

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
        this.selection.sync();
        e.preventDefault();
        const clipboard = e.clipboardData;
        if (!clipboard) return;

        // A block with `pastesAsPlainText` (code…) is a verbatim buffer: take the clipboard text as-is,
        // before any interpreter (markdown / HTML / nabu JSON) gets a chance to split it into blocks.
        const target = this.selection.anchorBlock;
        if (target && target === this.selection.focusBlock && target.pastesAsPlainText) {
            const text = clipboard.getData('text/plain');
            if (text) this.#pasteVerbatim(target, text);
            return;
        }

        const sorted = [...this.#pasteInterpreters].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        for (const interpreter of sorted) {
            const raw = clipboard.getData(interpreter.format);
            if (!raw) continue;
            const fragment = interpreter.interpret(raw, this);
            if (fragment) {
                this.insertFragment(fragment);
                return;
            }
        }

        this.warn('handlePaste: no interpreter matched');
    }

    /**
     * Insert `text` verbatim at the caret of `block`, replacing its selection: no interpretation, no new
     * block. One undo step (isolated commit).
     * @param {Block} block
     * @param {string} text
     */
    #pasteVerbatim(block, text) {
        const behavior = block.behaviors?.get('text');
        const sel = behavior?.selection;
        if (!behavior || !sel) return;
        const from = Math.min(sel.from, sel.to);
        const to = Math.max(sel.from, sel.to);
        if (to > from) behavior.delete({ index: from, length: to - from });
        behavior.insert(from, text);
        this.#isolateNextCommits();
        this.commit();
        tick().then(() => this.selection.setCursor(this.blocks.get(block.id) || block, from + text.length));
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
     * Insère un PasteFragment à la position du curseur courant.
     * @param {import('../utils/extensions.js').PasteFragment} fragment
     */
    insertFragment(fragment) {
        this.selection.sync(); // public entry point: may be called outside an input event
        // Every fragment (HTML / markdown / nabu JSON / API) goes through here: unsafe link & media URLs are dropped.
        const blocks = this.#degradeUnknown(sanitizePasteBlocks(fragment.blocks));
        if (!blocks?.length) return;

        let anchorBlock;
        let offset;

        if (!this.selection.isCollapsed) {
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

        // ── Inline: single flat block ─────────────────────────────────────────
        if (blocks.length === 1 && !blocks[0].children?.length) {
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
        if (!firstPb.children?.length) {
            // Leaf: merge content into anchor (anchor type survives, unless it was empty — see adoptType)
            adoptType(firstPb);
            const firstDelta = firstPb.delta || [];
            if (firstDelta.length) textBehavior.applyDelta([{ retain: offset }, ...firstDelta]);
            focusOffset = offset + firstDelta.reduce((s, op) => s + (typeof op.insert === 'string' ? op.insert.length : 0), 0);
        } else {
            // Container (e.g. List): insert it after anchor
            prevNode = this.insertPasteBlock(firstPb, prevNode);
        }

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
     */
    async importFragment(fragment) {
        const blocks = this.#degradeUnknown(sanitizePasteBlocks(fragment.blocks));
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
    }

    /**
     * Replace the entire document with content parsed from a Markdown string.
     * Requires MarkdownPasteExtension (or any text/plain interpreter) to be loaded.
     * @param {string} markdown
     * @returns {Promise<void>}
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
     * Replace the entire document with a `serialize('json')` export.
     * @param {{version?: string, blocks: any[]} | string} json
     * @returns {Promise<void>}
     */
    async importJSON(json) {
        const doc = typeof json === 'string' ? JSON.parse(json) : json;
        const blocks = jsonToPasteBlocks(doc?.blocks || []);
        if (!blocks.length) {
            this.warn('importJSON: nothing to import');
            return;
        }
        await this.importFragment({ blocks });
    }

    /** @param {number} globalOffset */
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

    /** @param  {...any} args */
    warn(...args) {
        if (this.debugging) console.warn("[Nabu]", ...args);
    }
}


