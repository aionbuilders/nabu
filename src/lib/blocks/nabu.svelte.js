import { LoroDoc, UndoManager } from 'loro-crdt';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { Block } from './block.svelte.js';
import { NabuSelection } from './selection.svelte.js';
import { handleContainerBeforeInput, wrapOrphan, deleteSelectionContent, findDirectChildOf, findLCA } from './container.utils.js';
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
*/

export class Nabu {
    /** @type {Pulse} */
    #pulse = new Pulse();
    /** @type {import('../utils/extensions.js').PasteInterpreter[]} */
    #pasteInterpreters = [];

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

    /** @type {SvelteMap<string, any>} */
    systems = new SvelteMap();
    
    hooks = new Map();

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


    commit() {
        this.trigger("onBeforeTransaction", this);
        this.doc.commit();
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



    /** @param {{from: {offset: number, block: Block}, to: {offset: number, block: Block}}} [options={}]  */
    focus(options) {
        tick().then(() => {
            const sel = this.selection;
            const fromBlock = options?.from?.block || sel.anchorBlock;
            const toBlock = options?.to?.block || sel.focusBlock;
            const fromOffset = options?.from?.offset ?? sel.startOffset ?? 0;
            const toOffset = options?.to?.offset ?? sel.endOffset ?? 0;

            if (fromBlock && toBlock) {
                const fromPoint = fromBlock.getDOMPoint(fromOffset);
                const toPoint = toBlock.getDOMPoint(toOffset);
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
        e.preventDefault(); // Toujours bloquer les mutations natives
        this.dispatchEventToSelection('beforeinput', e, 'onBeforeInput');
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

        // Find the Lowest Common Ancestor of startBlock and endBlock.
        // If LCA is a block (nested selection inside a container), serialize from that
        // block directly — avoids creating phantom ancestor wrappers for unselected content.
        // If LCA is null (selection spans root-level blocks), fall back to nabu-level slice.
        const lca = findLCA(startBlock, endBlock);

        /** @type {Block[]} */
        let rootBlocks;
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

        // text/plain: flatten all text content recursively
        /** @param {import('../utils/extensions.js').PasteBlock} pb @returns {string} */
        const extractText = (pb) =>
            pb.children?.length
                ? pb.children.map(extractText).join('\n')
                : (pb.delta || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('');

        e.clipboardData.setData('text/plain', pasteBlocks.map(extractText).join('\n\n'));

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
            const delta = blocks[0].delta || [];
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

    /** @param  {...any} args */
    warn(...args) {
        if (this.debugging) console.warn("[Nabu]", ...args);
    }
}


