
import { untrack } from "svelte";
import { SvelteSelection } from "../utils/selection.svelte.js";

/**
* @import { Nabu } from "./nabu.svelte.js";
* @import { Block } from "./block.svelte.js";
* @import { LoroTree, LoroTreeNode } from "loro-crdt";
*/

export class NabuSelection extends SvelteSelection {
    /** @param {Nabu} nabu */
    constructor(nabu) {
        super();
        this.nabu = nabu;

        // Every caret the editor itself places (after an action, an undo…) is remembered for undo / redo (ADR 015): it is
        // where that action ended. `setBaseAndExtent` is an own-property arrow function of the base class: wrap it.
        const placeSelection = this.setBaseAndExtent;
        /** @param {Node} anchorNode @param {number} anchorOffset @param {Node} focusNode @param {number} focusOffset */
        this.setBaseAndExtent = (anchorNode, anchorOffset, focusNode, focusOffset) => {
            const done = placeSelection(anchorNode, anchorOffset, focusNode, focusOffset);
            this.nabu.captureUndoSelection?.('settle');
            return done;
        };

        $effect.root(() => {
            $effect(() => {
                if (this.blocks) {
                    this.previous.forEach(block => block.clearSelection());
                    let i = 0;
                    const lastIndex = this.blocks.size - 1;
                    this.blocks.forEach((block) => {
                        block.selected = true;
                        block.isSelectionStart = (i === 0);
                        block.isSelectionEnd = i === lastIndex;
                        i++;
                    });
                    this.previous = new Set(this.blocks);
                }
            });

            // Track the intended navigation direction from arrow key presses.
            // This is the only reliable source of direction — DOM position comparisons
            // break when anchorNode is an ancestor of the previous position.
            $effect(() => {
                /** @param {KeyboardEvent} e */
                const onKeydown = (e) => {
                    // Capture phase on document = runs before every other keydown handler
                    // (root handler, slash menu…): make sure they read the CURRENT caret,
                    // not the one from a not-yet-delivered `selectionchange`.
                    this.sync();
                    this.nabu.captureUndoSelection?.(); // the selection an undo step pushed by this key gives back
                    if (e.isComposing || e.keyCode === 229) return; // IME composition: hands off the caret
                    // A caret left on a dead position by the PREVIOUS key is fixed (with that key's direction)
                    // before this one acts on it.
                    this.normalize();
                    this.#arrowStart = null;
                    this.#shiftAnchor = null;
                    if (e.shiftKey && !e.altKey && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
                        // The anchor of a selection being extended: a browser that cannot extend onto a non-editable
                        // sibling (a block's label…) may drop it; `normalize()` puts it back.
                        const live = window.getSelection();
                        if (live?.anchorNode) this.#shiftAnchor = { node: live.anchorNode, offset: live.anchorOffset };
                    }
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        this.#pendingDirection = 'forward';
                        const live = window.getSelection();
                        if (live?.isCollapsed && live.anchorNode && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                            this.#arrowStart = { key: e.key, node: live.anchorNode, offset: live.anchorOffset };
                        }
                        this.nabu.storedMarks = null;
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        this.#pendingDirection = 'backward';
                        this.nabu.storedMarks = null;
                    } else {
                        this.#pendingDirection = null;
                        if (e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
                            this.nabu.storedMarks = null;
                        }
                    }
                };
                // The browser applies an arrow key's caret move right after `keydown`, but delivers `selectionchange`
                // later (a task of its own): fix a dead landing as soon as the key is released, not a task later.
                const onKeyup = (/** @type {KeyboardEvent} */ e) => {
                    this.sync();
                    if (e.isComposing || e.keyCode === 229) return;
                    this.normalize();
                    const start = this.#arrowStart;
                    this.#arrowStart = null;
                    if (start && start.key === e.key) this.#openTrailingIfStuck(start);
                };
                const onMousedown = () => { this.nabu.storedMarks = null; this.#pendingDirection = null; this.#shiftAnchor = null; this.nabu.sealUndoEnd?.(); };
                // Fires after every selection move, the user's and the editor's: the freshest "selection before the next change".
                const onSelectionChange = () => this.nabu.captureUndoSelection?.();
                document.addEventListener('selectionchange', onSelectionChange);
                document.addEventListener('keydown', onKeydown, true);
                document.addEventListener('keyup', onKeyup, true);
                document.addEventListener('mousedown', onMousedown, true);
                return () => {
                    document.removeEventListener('keyup', onKeyup, true);
                    document.removeEventListener('keydown', onKeydown, true);
                    document.removeEventListener('selectionchange', onSelectionChange);
                    document.removeEventListener('mousedown', onMousedown, true);
                };
            });

            // Normalize invalid caret/focus positions (see `normalize()`). The effect only re-runs it when the
            // DOM selection changed; input entry points (keydown / beforeinput…) call `normalize()` themselves,
            // synchronously, so a keystroke never acts on a not-yet-corrected caret.
            $effect(() => {
                this.anchorNode; this.anchorOffset; this.focusNode; this.focusOffset;
                untrack(() => {
                    this.normalize();
                    // The pending arrow direction only describes the move that just produced this selection.
                    this.#pendingDirection = null;
                    this.#shiftAnchor = null;
                });
            });
        });
    }

    /**
     * Move a caret / focus that sits on a NON-TEXT position to the nearest valid text position, in the
     * direction of travel (arrow keys; a heuristic otherwise): inert blocks (dividers, images…), element
     * carets (container padding, between blocks, the editor root) and stray text nodes outside any text
     * block (whitespace around a toggle's arrow…) are all "dead" positions where typing would be swallowed.
     * Hidden content is never a target (it is not rendered). Works for collapsed carets and for ranges
     * (shift+arrow): invalid anchor → collapse to the corrected anchor; only the focus invalid → keep the
     * anchor, correct the focus.
     *
     * Synchronous and idempotent (reads the live DOM selection): call it right after `sync()`.
     * When ArrowDown / ArrowRight leaves the document with no text position after the caret, the nabu
     * "opens" a trailing caret (see `Nabu.openTrailingCaret`).
     * @returns {boolean} True if the selection was moved
     */
    normalize() {
        if (typeof window === 'undefined' || !window.getSelection) return false;
        if (this.nabu.composing) return false; // IME composition: the browser owns the DOM and the caret
        const live = window.getSelection();
        if (!live || live.rangeCount === 0) return false;

        const activeEl = document.activeElement;
        if (activeEl && activeEl.closest?.('[data-nabu-ui], input, textarea, select, button')) {
            this.#pendingDirection = null;
            return false;
        }

        const anchor = live.anchorNode;
        const anchorOffset = live.anchorOffset;
        const focus = live.focusNode;
        const focusOffset = live.focusOffset;
        if (!anchor) return false;

        const anchorEl = /** @type {Element | null} */ (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement);
        const focusEl = /** @type {Element | null} */ (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement);

        // Skip normalization when the selection touches a UI element (e.g. a block's UI controls).
        if (anchorEl?.closest('[data-nabu-ui]') || focusEl?.closest('[data-nabu-ui]')) {
            this.#pendingDirection = null;
            return false;
        }

        // A caret the browser put right beside a render filler (`<br data-nabu-filler>`, the empty last line after a
        // trailing "\n") is an element position: bring it back onto the end of the block's text, same model offset.
        const anchorFix = this.#fillerEndpoint(anchor, anchorOffset);
        const focusFix = focus ? this.#fillerEndpoint(focus, focusOffset) : null;
        if (anchorFix || focusFix) {
            const a = anchorFix ?? { node: anchor, offset: anchorOffset };
            const f = focusFix ?? { node: /** @type {Node} */ (focus), offset: focusOffset };
            this.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
            return true;
        }

        const anchorInvalid = this.#isDead(anchor);
        const focusInvalid = !!focus && this.#isDead(focus);

        if (!anchorInvalid && !focusInvalid) return this.#confine(live, anchor, anchorOffset, focus, focusOffset);

        /** @type {NodeFilter} */
        const filter = { acceptNode: (node) => this.#isValidTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT };
        const explicit = this.#pendingDirection;
        this.#pendingDirection = null;
        const shiftAnchor = this.#shiftAnchor;
        this.#shiftAnchor = null;

        // Shift+arrow that the browser answered by moving the ANCHOR onto a dead position (it re-expresses a text position as an
        // element position, or loses it next to a non-editable sibling): the selection is still being extended from where it
        // started, up to the focus (corrected to the nearest valid text in the direction of travel when it is dead too).
        if (anchorInvalid && explicit && focus && shiftAnchor?.node.isConnected && !this.#isDead(shiftAnchor.node)) {
            /** @type {{ node: Node, offset: number } | null} */
            let end = { node: focus, offset: focusOffset };
            if (focusInvalid) {
                const target = findNearestTextNode(focus, focusOffset, explicit, filter);
                const block = target && this.#blockOf(target);
                end = block ? /** @type {any} */ (block).getDOMPoint?.(explicit === 'forward' ? 0 : (block.behaviors?.get('text')?.text.length ?? 0)) ?? null : null;
            }
            if (end) {
                this.setBaseAndExtent(shiftAnchor.node, shiftAnchor.offset, end.node, end.offset);
                return true;
            }
        }

        if (anchorInvalid) {
            const dir = explicit ?? offsetHeuristic(anchor, anchorOffset);
            const target = findNearestTextNode(anchor, anchorOffset, dir, filter);
            if (!target) {
                // Leaving the document by keyboard with nothing to land on: the document must offer a caret there.
                if (explicit === 'forward') this.nabu.openTrailingCaret();
                return false;
            }
            const offset = dir === 'forward' ? 0 : (target.textContent?.length ?? 0);
            this.setBaseAndExtent(target, offset, target, offset);
            return true;
        }
        if (focusInvalid && focus) {
            const dir = explicit ?? offsetHeuristic(focus, focusOffset);
            const target = findNearestTextNode(focus, focusOffset, dir, filter);
            if (!target) return false;
            const offset = dir === 'forward' ? 0 : (target.textContent?.length ?? 0);
            this.setBaseAndExtent(anchor, anchorOffset, target, offset);
            return true;
        }
        return false;
    }

    /** The block whose element holds `node` (null outside any block). @param {Node | null} node @returns {Block | null} */
    #blockOf(node) {
        const el = /** @type {Element | null} */ (node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement));
        const id = el?.closest('[data-block-id]')?.getAttribute('data-block-id');
        return (id && this.nabu.blocks.get(id)) || null;
    }

    /**
     * The rules of ISOLATED text fields (`Block#isolatesSelection`, ADR 018 §3.9) on a live, non-collapsed selection whose ends
     * are in two different blocks:
     *  - the ANCHOR is in an isolated block: the selection stays BOUNDED to it, the focus is brought back to the end of that
     *    block (the focus is after the anchor) or to its start (before);
     *  - the FOCUS is in an isolated block and the anchor is outside: the focus is moved PAST it, in the direction of travel,
     *    onto the nearest text of a block that is not isolated (nothing there: the selection is given up, collapsed on its anchor).
     * Idempotent. Returns whether the selection was moved.
     * @param {Selection} live @param {Node} anchor @param {number} anchorOffset @param {Node | null} focus @param {number} focusOffset
     * @returns {boolean}
     */
    #confine(live, anchor, anchorOffset, focus, focusOffset) {
        if (!focus || live.isCollapsed) return false;
        const anchorBlock = this.#blockOf(anchor);
        const focusBlock = this.#blockOf(focus);
        if (!anchorBlock || !focusBlock || anchorBlock === focusBlock) return false;
        if (!anchorBlock.isolatesSelection && !focusBlock.isolatesSelection) return false;

        // Direction of travel: is the focus after the anchor?
        const probe = document.createRange();
        probe.setStart(anchor, anchorOffset);
        probe.collapse(true);
        let forward;
        try { forward = probe.comparePoint(focus, focusOffset) > 0; } catch { return false; }

        /** @param {Block} block @param {boolean} end @returns {{ node: Node, offset: number } | null} */
        const edgeOf = (block, end) => {
            const text = block.behaviors?.get('text');
            return /** @type {any} */ (block).getDOMPoint?.(end ? (text?.text.length ?? 0) : 0) ?? null;
        };

        if (anchorBlock.isolatesSelection) {
            const edge = edgeOf(anchorBlock, forward);
            if (!edge) return false;
            this.setBaseAndExtent(anchor, anchorOffset, edge.node, edge.offset);
            return true;
        }

        // The focus is in an isolated block: the nearest text outside any isolated block, past it.
        /** @type {NodeFilter} */
        const filter = { acceptNode: (node) => this.#isValidTextNode(node) && !this.#blockOf(node)?.isolatesSelection ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT };
        // @ts-ignore — TreeWalker filter shape is correct, TS typedef is overly strict
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, filter);
        const host = focusBlock.element ?? focus;
        walker.currentNode = forward ? getLastDescendant(host) : host;
        const target = forward ? walker.nextNode() : walker.previousNode();
        const targetBlock = target && this.#blockOf(target);
        const point = targetBlock && edgeOf(targetBlock, !forward);
        if (!point) this.setBaseAndExtent(anchor, anchorOffset, anchor, anchorOffset);
        else this.setBaseAndExtent(anchor, anchorOffset, point.node, point.offset);
        return true;
    }

    /**
     * Selects exactly the text of `block` (Select All inside an isolated field).
     * @param {Block} block
     * @returns {boolean} False when the block has no DOM point to select
     */
    selectBlockText(block) {
        const text = block.behaviors?.get('text');
        const from = /** @type {any} */ (block).getDOMPoint?.(0);
        const to = /** @type {any} */ (block).getDOMPoint?.(text?.text.length ?? 0);
        if (!from || !to) return false;
        this.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
        return true;
    }

    /**
     * Selects the text of the document between two blocks (first block start -> last block end).
     * @param {Block} first @param {Block} last
     * @returns {boolean}
     */
    selectBetween(first, last) {
        const lastText = last.behaviors?.get('text');
        const from = /** @type {any} */ (first).getDOMPoint?.(0);
        const to = /** @type {any} */ (last).getDOMPoint?.(lastText?.text.length ?? 0);
        if (!from || !to) return false;
        this.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
        return true;
    }

    /**
     * If `(node, offset)` is an element position adjacent to a block's trailing render filler, the equivalent text
     * position (end of the block's text); else null.
     * @param {Node} node
     * @param {number} offset
     * @returns {{ node: Node, offset: number } | null}
     */
    #fillerEndpoint(node, offset) {
        if (node.nodeType !== Node.ELEMENT_NODE) return null;
        const kids = node.childNodes;
        const isFiller = (/** @type {Node | undefined} */ n) => n instanceof Element && n.hasAttribute('data-nabu-filler');
        if (!isFiller(kids[offset]) && !isFiller(kids[offset - 1])) return null;
        const id = /** @type {Element} */ (node).closest('[data-block-id]')?.getAttribute('data-block-id');
        const block = id ? this.nabu.blocks.get(id) : null;
        const text = block?.behaviors?.get('text');
        if (!block || !text || !block.element?.contains(node)) return null;
        const point = /** @type {any} */ (block).getDOMPoint?.(text.text.length);
        // Only a real text point is an improvement (an element fallback would be dead again).
        return point && point.node.nodeType === Node.TEXT_NODE ? point : null;
    }

    /**
     * A selection endpoint where nothing can be typed: inside an inert block, an element caret anywhere
     * in an editor, or a text node that is not part of a text block's own text. Endpoints outside any
     * editor are none of our business.
     * @param {Node} node
     */
    #isDead(node) {
        const el = /** @type {Element | null} */ (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
        if (!el?.closest('[data-nabu-root]')) return false;
        if (isInInert(node)) return true;
        if (node.nodeType !== Node.TEXT_NODE) return true;
        return !this.#isValidTextNode(node);
    }

    /**
     * True for a text node that belongs to the text of a text block (not inert, not whitespace
     * between a container's children / around its UI).
     * @param {Node} node
     */
    #isValidTextNode(node) {
        if (isInInert(node)) return false;
        const id = node.parentElement?.closest('[data-block-id]')?.getAttribute('data-block-id');
        const block = id ? this.nabu.blocks.get(id) : null;
        if (!block || !block.behaviors?.has('text')) return false;
        return !block.element || block.element.contains(node);
    }

    /** @type {'forward' | 'backward' | null} */
    #pendingDirection = null;

    /** The anchor a Shift+arrow started from (see the keydown listener). @type {{ node: Node, offset: number } | null} */
    #shiftAnchor = null;

    /**
     * Caret at the keydown of an unmodified ArrowRight / ArrowDown, to tell at keyup whether the key moved it.
     * @type {{ key: string, node: Node, offset: number } | null}
     */
    #arrowStart = null;

    /**
     * ArrowRight / ArrowDown that could not move the caret (browsers do not step onto a non-editable block such
     * as an image), pressed in the last text block of a document that ends with a non-text block: the document
     * must offer a caret after it.
     * @param {{ node: Node, offset: number }} start
     */
    #openTrailingIfStuck(start) {
        const live = window.getSelection();
        if (!live?.isCollapsed || live.anchorNode !== start.node || live.anchorOffset !== start.offset) return;
        const block = this.anchorBlock;
        if (!block?.behaviors?.has('text') || block.findForward((b) => !!b.behaviors?.has('text'))) return;
        const last = this.nabu.lastVisibleBlock;
        if (!last || last.behaviors?.has('text')) return;
        this.nabu.openTrailingCaret();
    }

    anchorBlock = $derived.by(() => {
        this.anchorNode;
        const id = this.anchorNode?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });
    
    focusBlock = $derived.by(() => {
        this.focusNode;
        const id = this.focusNode?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });
    
    startBlock = $derived.by(() => {
        this.range;
        const id = this.range?.startContainer?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });
    
    endBlock = $derived.by(() => {
        this.range;
        const id = this.range?.endContainer?.parentElement?.closest("[data-block-id]")?.getAttribute("data-block-id");
        return id ? this.nabu.blocks.get(id) : null;
    });

    start = $derived(this.startBlock?.selection && {
        block: this.startBlock,
        ...this.startBlock.selection
    });

    end = $derived(this.endBlock?.selection && {
        block: this.endBlock,
        ...this.endBlock.selection
    });

    /**
     * Définit le curseur à un endroit précis du document (Modèle -> DOM)
     * @param {Block} block 
     * @param {number} offset 
     */
    setCursor(block, offset) {
        if (!block.element) return;
        
        // On délègue au bloc le soin de trouver le bon point DOM
        // (Chaque type de bloc sait comment il affiche son texte)
        //@ts-ignore
        const point = block.getDOMPoint?.(offset);
        if (!point) return;

        this.setBaseAndExtent(point.node, point.offset, point.node, point.offset);
    }

    /** @type {Set<Block>} */
    previous = new Set();
    /**
     * The blocks the selection covers (flagged `selected`: highlighted, marked, …). A selection that does not lie entirely in
     * one block leaves out the blocks that isolate their text (`Block#isolatesSelection`): a title is not part of a range.
     * @type {Set<Block>}
     */
    blocks = $derived.by(() => {
        const range = this.startBlock !== this.endBlock;
        return new Set(/** @type {Block[]} */ (getNodesBetween(this.nabu.tree, this.startBlock?.node.id.toString() || "", this.endBlock?.node.id.toString() || "").map(node => {
            return this.nabu.blocks.get(node.id.toString());
        }).filter(b => !!b && !(range && b.isolatesSelection))));
    });

    /**
     * True while the selection is a non-collapsed range across several blocks. The editor mirrors it as `data-nabu-range` on its
     * root, which the stylesheet uses to not highlight isolated blocks (the model leaves them out of the range, see `blocks`).
     */
    isRange = $derived(!this.isCollapsed && !!this.startBlock && !!this.endBlock && this.startBlock !== this.endBlock);
    
}



/** @param {Node | null} node */
function isInInert(node) {
    if (!node) return false;
    const el = node.nodeType === Node.ELEMENT_NODE
        ? /** @type {Element} */ (node)
        : node.parentElement;
    return !!el?.closest('[data-nabu-inert]');
}

/**
 * Heuristic for mouse clicks: infer direction from where in the element the
 * cursor landed. At/past the last child → user likely moving forward; otherwise
 * backward.
 * @param {Node} anchor
 * @param {number} anchorOffset
 * @returns {'forward' | 'backward'}
 */
function offsetHeuristic(anchor, anchorOffset) {
    if (anchor.nodeType !== Node.TEXT_NODE) {
        return anchorOffset >= anchor.childNodes.length ? 'forward' : 'backward';
    }
    return 'backward';
}

/**
 * Returns the deepest last descendant of a node (for positioning a TreeWalker
 * so that nextNode() starts at the node immediately after the subtree).
 * @param {Node} node
 */
function getLastDescendant(node) {
    let n = node;
    while (n.lastChild) n = n.lastChild;
    return n;
}

/**
 * Find the nearest valid (non-inert, inside a block) text node from a given
 * DOM position, respecting the intended navigation direction.
 *
 * For element-node cursors, (fromNode, fromOffset) means the caret sits between
 * child[fromOffset-1] and child[fromOffset]. We use fromOffset to start the
 * search at the right position — NOT from the beginning/end of the element —
 * so we never jump back to a position the user is trying to leave.
 *
 * @param {Node} fromNode
 * @param {number} fromOffset
 * @param {'forward' | 'backward'} direction
 * @param {NodeFilter} filter  Accepts the valid text nodes
 * @returns {Text | null}
 */
function findNearestTextNode(fromNode, fromOffset, direction, filter) {
    // @ts-ignore — TreeWalker filter shape is correct, TS typedef is overly strict
    const bodyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, filter);

    if (fromNode.nodeType === Node.TEXT_NODE) {
        bodyWalker.currentNode = fromNode;
        return /** @type {Text | null} */ (
            direction === 'backward' ? bodyWalker.previousNode() : bodyWalker.nextNode()
        );
    }

    // Element-node cursor: caret is between child[fromOffset-1] and child[fromOffset].
    const childCount = fromNode.childNodes.length;

    if (direction === 'backward') {
        if (fromOffset === 0) {
            // Before all children → escape before element
            bodyWalker.currentNode = fromNode;
            return /** @type {Text | null} */ (bodyWalker.previousNode());
        }
        if (fromOffset < childCount) {
            // Between child[fromOffset-1] and child[fromOffset]:
            // last valid text before child[fromOffset] (may be inside or before element)
            bodyWalker.currentNode = fromNode.childNodes[fromOffset];
            return /** @type {Text | null} */ (bodyWalker.previousNode());
        }
        // Past last child → last valid text inside the element (sub-walker), or before it
        // @ts-ignore
        const sub = document.createTreeWalker(fromNode, NodeFilter.SHOW_TEXT, filter);
        let last = null, n;
        while ((n = sub.nextNode())) last = n;
        if (last) return /** @type {Text} */ (last);
        bodyWalker.currentNode = fromNode;
        return /** @type {Text | null} */ (bodyWalker.previousNode());
    } else {
        if (fromOffset >= childCount) {
            // Past last child → escape after element
            bodyWalker.currentNode = getLastDescendant(fromNode);
            return /** @type {Text | null} */ (bodyWalker.nextNode());
        }
        // Between child[fromOffset-1] and child[fromOffset]:
        // first valid text at or after child[fromOffset] (may be inside or after element).
        // Pivot to the last descendant of child[fromOffset-1] so nextNode() starts
        // from child[fromOffset] onward — never re-entering already-visited content.
        const pivot = fromOffset > 0
            ? getLastDescendant(fromNode.childNodes[fromOffset - 1])
            : fromNode;
        bodyWalker.currentNode = pivot;
        return /** @type {Text | null} */ (bodyWalker.nextNode());
    }
}

/**
* Récupère tous les nœuds situés entre deux nœuds dans un arbre Loro (version aplatie).
* L'ordre dans lequel on passe A et B n'a pas d'importance.
* @param {LoroTree} tree - L'arbre Loro à parcourir
* @param {string} nodeIdA - ID du premier nœud de la sélection
* @param {string} nodeIdB - ID du second nœud de la sélection
*/
function getNodesBetween(tree, nodeIdA, nodeIdB) {
    const roots = tree.roots();
    
    let isRecording = false;
    /** @type {LoroTreeNode[]} */
    const nodesInRange = [];
    
    
    // if (nodeIdA && nodeIdA === nodeIdB) {
    //     
    // }
    
    /** @param {LoroTreeNode[]} nodes */
    function traverse(nodes) {
        for (const node of nodes) {
            const currentId = node.id.toString();

            if (currentId === nodeIdA) {
                isRecording = true;
                nodesInRange.push(node);
                
                if (currentId === nodeIdB) {
                    return true;
                }
            } else if (isRecording) {
                nodesInRange.push(node);
                if (currentId === nodeIdB) {
                    return true; 
                }
            }
            
            const children = node.children();
            if (children && children.length > 0) {
                if (traverse(children)) {
                    return true; 
                }
            }
        }
        return false; // La fin n'a pas été trouvée dans cette branche
    }
    
    traverse(roots);
    return nodesInRange;
}