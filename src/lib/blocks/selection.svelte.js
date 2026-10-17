
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
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        this.#pendingDirection = 'forward';
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
                const onMousedown = () => { this.nabu.storedMarks = null; };
                document.addEventListener('keydown', onKeydown, true);
                document.addEventListener('mousedown', onMousedown, true);
                return () => {
                    document.removeEventListener('keydown', onKeydown, true);
                    document.removeEventListener('mousedown', onMousedown, true);
                };
            });

            // Normalize invalid caret/focus positions: inert elements and element-node
            // cursors (which happen in container padding / between block children).
            // Works for both collapsed cursors and non-collapsed selections (shift+arrow):
            //   - anchor invalid → collapse to corrected anchor
            //   - only focus invalid → keep anchor, correct only focus (preserves the selection)
            $effect(() => {
                const activeEl = document.activeElement;
                if (activeEl && activeEl.closest?.('[data-nabu-ui], input, textarea, select, button')) {
                    this.#pendingDirection = null;
                    return;
                }

                const anchor = this.anchorNode;
                const anchorOffset = this.anchorOffset;
                const focus = this.focusNode;
                const focusOffset = this.focusOffset;
                if (!anchor) return;

                const anchorEl = /** @type {Element | null} */ (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement);
                const focusEl = /** @type {Element | null} */ (focus?.nodeType === Node.ELEMENT_NODE ? focus : focus?.parentElement);

                // Skip normalization when the selection touches a UI element (e.g. zone title input).
                if (anchorEl?.closest('[data-nabu-ui]') || focusEl?.closest('[data-nabu-ui]')) {
                    this.#pendingDirection = null;
                    return;
                }

                const anchorInvalid = isInInert(anchor) || (
                    anchor.nodeType !== Node.TEXT_NODE &&
                    !!/** @type {Element} */ (anchor).closest?.('[data-block-id]')
                );
                const focusInvalid = !!focus && (isInInert(focus) || (
                    focus.nodeType !== Node.TEXT_NODE &&
                    !!/** @type {Element} */ (focus).closest?.('[data-block-id]')
                ));

                if (!anchorInvalid && !focusInvalid) {
                    this.#pendingDirection = null;
                    return;
                }

                if (anchorInvalid) {
                    const dir = this.#pendingDirection ?? offsetHeuristic(anchor, anchorOffset);
                    this.#pendingDirection = null;
                    const target = findNearestTextNode(anchor, anchorOffset, dir);
                    if (!target) return;
                    const offset = dir === 'forward' ? 0 : (target.textContent?.length ?? 0);
                    this.setBaseAndExtent(target, offset, target, offset);
                } else if (focusInvalid && focus) {
                    const dir = this.#pendingDirection ?? offsetHeuristic(focus, focusOffset);
                    this.#pendingDirection = null;
                    const target = findNearestTextNode(focus, focusOffset, dir);
                    if (!target) return;
                    const offset = dir === 'forward' ? 0 : (target.textContent?.length ?? 0);
                    this.setBaseAndExtent(anchor, anchorOffset, target, offset);
                }
            });
        });
    }

    /** @type {'forward' | 'backward' | null} */
    #pendingDirection = null;

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
    blocks = $derived(new Set(getNodesBetween(this.nabu.tree, this.startBlock?.node.id.toString() || "", this.endBlock?.node.id.toString() || "").map(node => {
        return this.nabu.blocks.get(node.id.toString());
    }).filter(b => !!b)));
    
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

/** @type {NodeFilter} */
const TEXT_FILTER = {
    acceptNode(/** @type {Node} */ node) {
        if (isInInert(node)) return NodeFilter.FILTER_REJECT;
        if (!/** @type {Text} */ (node).parentElement?.closest('[data-block-id]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
    }
};

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
 * @returns {Text | null}
 */
function findNearestTextNode(fromNode, fromOffset, direction) {
    // @ts-ignore — TreeWalker filter shape is correct, TS typedef is overly strict
    const bodyWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, TEXT_FILTER);

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
        const sub = document.createTreeWalker(fromNode, NodeFilter.SHOW_TEXT, TEXT_FILTER);
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