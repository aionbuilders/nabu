import { LoroDoc, UndoManager } from 'loro-crdt';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Block } from './block.svelte.js';
import { NabuSelection } from './selection.svelte.js';
import { handleContainerBeforeInput, wrapOrphan, deleteSelectionContent, findDirectChildOf, findLCA } from './container.utils.js';
import { jsonToPasteBlocks } from '../utils/extensions.js';
import { tick } from 'svelte';
import { Pulse } from '@aionbuilders/pulse';


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
    /** @type {number | null} offset modèle au début de la composition */
    #compositionStartOffset = null;
    /** @type {Block | null} bloc cible au début de la composition */
    #compositionStartBlock = null;

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
            mergeInterval: 1000,
            onPush: () => {
                // Save cursor position for restoration on undo/redo
                const sel = this.selection;
                if (!sel || !sel.anchorBlock) return { value: null, cursors: [] };

                return {
                    value: {
                        blockId: sel.anchorBlock.id,
                        offset: sel.startOffset
                    },
                    cursors: []
                };
            },
            onPop: (_, storedValue) => {
                // Restore cursor position after undo/redo
                const value = /** @type {{blockId: string, offset: number} | null} */ (storedValue?.value);
                if (value && typeof value === 'object' && 'blockId' in value) {
                    tick().then(() => {
                        const block = this.blocks.get(value.blockId);
                        if (block && block.behaviors?.has('text')) {
                            this.selection.setCursor(block, value.offset);
                        }
                    });
                }
            }
        });

        this.extensions = init.extensions || [];
        this.fileConfig = init.files || {};
        
        if (this.extensions?.length) {
            for (const ext of this.extensions) {
                if (ext.block) this.registry.set(ext.name, ext.block);
                if (ext.component) this.components.set(ext.name, ext.component);
                if (ext.hooks) {
                    for (const [hookName, hookFn] of Object.entries(ext.hooks)) {
                        if (!this.hooks.has(hookName)) {
                            this.hooks.set(hookName, []);
                        }
                        this.hooks.get(hookName).push(hookFn);
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
                                if (parentBlock) parentBlock.updateChildren();
                            } else {
                                this.updateRoots();
                            }

                            if (action.oldParent) {
                                const oldParentId = action.oldParent.toString();
                                const oldParentBlock = this.blocks.get(oldParentId);
                                if (oldParentBlock) oldParentBlock.updateChildren();
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
     * Declarative input rules collected from extensions, tested by TextBehavior
     * against the text before the cursor on matching beforeinput events.
     * @type {import('../utils/extensions.js').InputRule[]}
     */
    inputRules = [];

    /** @type {import('../files/files.svelte.js').FilesConfig} */
    fileConfig = {};

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
     * @param {string} topic
     * @param {any} [data]
     * @returns {Promise<import('@aionbuilders/pulse').PulseEvent>}
     */
    exec(topic, data) {
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
        this.trigger("onBeforeTransaction", this);
        this.doc.commit();
        await tick();
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



    /** @param {{from: {offset: number, block: Block}, to: {offset: number, block: Block}, offset?: number}} [options={}]  */
    focus(options) {
        tick().then(() => {
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
        })

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
        
        // 1. Essayer les hooks globaux d'extension d'abord
        if (hookName) {
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
        // Ne pas interférer avec la composition IME en cours : le navigateur
        // doit pouvoir muter librement le text node (insertCompositionText
        // n'est de toute façon pas annulable). Sync dans Loro à compositionend.
        if (this.#composing && (e.inputType === 'insertCompositionText' || e.inputType === 'deleteCompositionText')) {
            return;
        }
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

        const fragment = { blocks: pasteBlocks };
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
            return text ? `<p>${text}</p>` : '';
        };

        e.clipboardData.setData('text/plain', pasteBlocks.map(pb => pbToMarkdown(pb)).join('\n\n'));
        e.clipboardData.setData('text/html',  pasteBlocks.map(pb => pbToHtml(pb)).join('\n'));

    }

    /** @param {ClipboardEvent} e */
    handleCut(e) {
        if (this.selection.isCollapsed) return;
        e.preventDefault();

        // 1. Copy selection to clipboard
        this.handleCopy(e);

        // 2. Delete the selected content without committing
        const result = deleteSelectionContent(this, this);
        if (!result) return;

        // 3. Single Loro transaction + restore cursor
        this.commit();
        this.selection.setCursor(result.block, result.offset);
    }

    /** @param {ClipboardEvent} e */
    handlePaste(e) {
        e.preventDefault();
        const clipboard = e.clipboardData;
        if (!clipboard) return;

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
     * Insère un PasteFragment à la position du curseur courant.
     * @param {import('../utils/extensions.js').PasteFragment} fragment
     */
    insertFragment(fragment) {
        const { blocks } = fragment;
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

        // ── Inline: single flat block ─────────────────────────────────────────
        if (blocks.length === 1 && !blocks[0].children?.length) {
            const pb = blocks[0];
            const delta = pb.delta || [];
            const len = delta.reduce((s, op) => s + (typeof op.insert === 'string' ? op.insert.length : 0), 0);

            textBehavior.applyDelta([{ retain: offset }, ...delta]);
            this.commit();
            tick().then(() => this.selection.setCursor(anchorBlock, offset + len));
            return;
        }

        // ── Multi-block or container ──────────────────────────────────────────
        // Save and cut right fragment
        const rightDelta = textBehavior.container.sliceDelta(offset, textBehavior.container.length);
        if (textBehavior.container.length > offset) {
            textBehavior.delete({ index: offset, length: textBehavior.container.length - offset });
        }

        const firstPb  = blocks[0];
        const lastPb   = blocks[blocks.length - 1];
        const midPbs   = blocks.slice(1, -1);
        let prevNode   = anchorBlock.node;
        let focusBlock = anchorBlock;
        let focusOffset = offset;

        // ── First block ───────────────────────────────────────────────────────
        if (!firstPb.children?.length) {
            // Leaf: merge content into anchor (anchor type survives)
            const firstDelta = firstPb.delta || [];
            if (firstDelta.length) textBehavior.applyDelta([{ retain: offset }, ...firstDelta]);
            focusOffset = offset + firstDelta.reduce((s, op) => s + (typeof op.insert === 'string' ? op.insert.length : 0), 0);
        } else {
            // Container (e.g. List): insert it after anchor
            prevNode = this.#insertPasteBlock(firstPb, prevNode);
        }

        // ── Middle blocks ─────────────────────────────────────────────────────
        for (const pb of midPbs) {
            prevNode = this.#insertPasteBlock(pb, prevNode);
        }

        // ── Last block (only when blocks.length > 1) ──────────────────────────
        if (blocks.length > 1) {
            if (!lastPb.children?.length) {
                // Leaf last block: create it, append rightDelta
                const LastClass = this.registry.get(lastPb.type) || this.registry.get('paragraph');
                if (LastClass) {
                    const newLast = LastClass.create(this, lastPb.type, lastPb.props || {});
                    newLast.node.moveAfter(prevNode);
                    const wrapper = wrapOrphan(this, newLast);
                    const tb = newLast.behaviors?.get('text');
                    if (tb) {
                        const lastDelta = lastPb.delta || [];
                        if (lastDelta.length || rightDelta.length) tb.applyDelta([...lastDelta, ...rightDelta]);
                        focusOffset = lastDelta.reduce((s, op) => s + (typeof op.insert === 'string' ? op.insert.length : 0), 0);
                    }
                    focusBlock = newLast;
                    prevNode = wrapper ? wrapper.node : newLast.node;
                }
            } else {
                // Container last block: insert it, put rightDelta in a new paragraph after
                prevNode = this.#insertPasteBlock(lastPb, prevNode);
                if (rightDelta.length) {
                    const PClass = this.registry.get('paragraph');
                    if (PClass) {
                        const p = PClass.create(this, 'paragraph', {});
                        p.node.moveAfter(prevNode);
                        p.behaviors?.get('text')?.applyDelta(rightDelta);
                        focusBlock = p;
                        focusOffset = 0;
                    }
                }
            }
        } else {
            // Single container block: rightDelta goes in a new paragraph after it
            if (rightDelta.length) {
                const PClass = this.registry.get('paragraph');
                if (PClass) {
                    const p = PClass.create(this, 'paragraph', {});
                    p.node.moveAfter(prevNode);
                    p.behaviors?.get('text')?.applyDelta(rightDelta);
                    focusBlock = p;
                    focusOffset = 0;
                }
            }
        }

        this.commit();
        tick().then(() => {
            const fb = this.blocks.get(focusBlock.id) || focusBlock;
            this.selection.setCursor(fb, focusOffset);
        });
    }

    /**
     * Inserts a PasteBlock after `afterNode`. Handles both leaf blocks (wrapOrphan)
     * and container blocks (creates container, recurses into children).
     * Returns the outer node to use as the next prevNode.
     * @param {import('../utils/extensions.js').PasteBlock} pb
     * @param {any} afterNode
     * @returns {any}
     */
    #insertPasteBlock(pb, afterNode) {
        if (pb.children?.length) {
            const ContainerClass = this.registry.get(pb.type);
            if (!ContainerClass) return afterNode;
            const container = ContainerClass.create(this, pb.type, pb.props || {});
            container.node.moveAfter(afterNode);
            for (const child of pb.children) {
                this.#createInContainer(child, container.node.id.toString());
            }
            return container.node;
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
     * Creates a block inside a container, recursively handling nested children.
     * @param {import('../utils/extensions.js').PasteBlock} pb
     * @param {string} parentId
     */
    #createInContainer(pb, parentId) {
        const BlockClass = this.registry.get(pb.type) || this.registry.get('paragraph');
        if (!BlockClass) return;
        const block = BlockClass.create(this, pb.type, pb.props || {}, parentId);
        const tb = block.behaviors?.get('text');
        if (tb && pb.delta?.length) tb.applyDelta(pb.delta);
        for (const child of pb.children || []) {
            this.#createInContainer(child, block.node.id.toString());
        }
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
        const { blocks } = fragment;
        if (!blocks?.length) return;

        [...this.tree.roots()].forEach(root => this.tree.delete(root.id));

        for (const pb of blocks) {
            const BlockClass = this.registry.get(pb.type) || this.registry.get('paragraph');
            if (!BlockClass) continue;
            const block = BlockClass.create(this, pb.type, pb.props || {});
            const tb = block.behaviors?.get('text');
            if (tb && pb.delta?.length) tb.applyDelta(pb.delta);
            for (const child of pb.children || []) {
                this.#createInContainer(child, block.node.id.toString());
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

        const fragment = interpreter.interpret(markdown, this);
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


