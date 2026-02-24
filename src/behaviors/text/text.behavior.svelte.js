/**
* @import {NabuNode, Block, NabuSelection} from "../../blocks";
*/

import { LoroText } from "loro-crdt";
import { tick } from "svelte";

/**
* @typedef {NabuNode<{type: "paragraph", text: LoroText}>} TextNode
*/

export class TextBehavior {
    /** @param {Block} block @param {LoroText} [container] */
    constructor(block, container) {
        this.block = block;
        this.nabu = block.nabu;
        const node = /** @type {TextNode} */ (block.node);
        /** @type {LoroText} */
        this.container = container ?? node.data.get("text") ?? node.data.setContainer("text", new LoroText());
        this.text = $state(this.container.toString());
        this.container.subscribe(() => this.text = this.container.toString());
    }
    
    selection = $derived(this.block.element && this.block.nabu.selection && this.getSelection(this.block.element, this.block.nabu.selection));
    
    /**
    * 
    * @param {Boolean} selected 
    * @param {HTMLElement} element 
    * @param {NabuSelection} globalSelection 
    */
    getSelection(element, globalSelection) {
        if (!this.block.selected || !element || !globalSelection) return null;
        
        const globalRange = globalSelection.firstRange;
        if (!globalRange) return null;
        
        const containsStart = element.contains(globalRange.startContainer);
        const containsEnd = element.contains(globalRange.endContainer);
        
        let from = 0;
        let to = this.text.length;
        
        if (containsStart) {
            from = this.calculateOffset(globalRange.startContainer, globalRange.startOffset);
        }
        
        if (containsEnd) {
            to = this.calculateOffset(globalRange.endContainer, globalRange.endOffset);
        }
        
        return {
            from,
            to,
            isCollapsed: from === to,
            direction: globalSelection.direction,
        };
    }
    
    /**
    * Calcule l'offset textuel d'un point DOM par rapport au début de ce bloc
    * @param {Node} node 
    * @param {number} offset 
    * @param {HTMLElement?} [element]
    */
    calculateOffset(node, offset, element = this.block.element) {
        if (!element) return 0;
        const range = document.createRange();
        range.setStart(element, 0);
        range.setEnd(node, offset);
        return range.toString().length;
    }

    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [selection] */
    handleBeforeInput(event, selection = this.selection) {
        switch (event.inputType) {
            case "insertText":
                return this.handleInsertText(event, selection);
            case "insertLineBreak":
            case "insertSoftLineBreak":
                return this.handleInsertLineBreak(event, selection);
            case "deleteContentBackward":
                return this.handleDeleteContentBackward(event, selection);
            case "deleteContentForward":
                return this.handleDeleteContentForward(event, selection);
            case "insertParagraph":
                return this.handleInsertParagraph(event, selection);
            default:
                console.warn("Unhandled input type:", event.inputType);
                return;
        }
    }
    
    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [selection] */
    handleInsertText(event, selection = this.selection) {
        if (!selection) return;
        const textToInsert = event.data || "";
        if (!selection.isCollapsed) this.delete({index: selection.from, length: selection.to - selection.from}, selection);
        this.insert(selection.from, textToInsert);
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, selection.from + textToInsert.length));
    }
    
    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleInsertLineBreak(event, sel = this.selection) {
        if (!sel) return;
        if (!sel.isCollapsed) {
            this.delete({index: sel.from, length: sel.to - sel.from}, sel);
        }
        this.insert(sel.from, "\n");
        this.block.commit();
        
        tick().then(() => this.nabu.selection.setCursor(this.block, sel.from + 1));
    }
    
    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleDeleteContentBackward(event, sel = this.selection) {
        if (!sel) return;
        if (sel.isCollapsed && sel.from === 0) {
            const previousBlock = this.block.findBackward(b => b.behaviors.has("text") && b.behaviors.get("text") instanceof TextBehavior);
            const previousBehavior = previousBlock?.behaviors.get("text");
            if (previousBehavior && previousBehavior instanceof TextBehavior) {
                event.preventDefault();
                const previousLength = previousBehavior.text.length;
                previousBehavior.delta([
                    { retain: previousLength },
                    ...this.container.toDelta()
                ])
                this.block.destroy();
                this.block.commit();
                
                tick().then(() => this.nabu.selection.setCursor(previousBehavior.block, previousLength));
            }
        } else {
            event.preventDefault();
            const length = sel.isCollapsed ? 1 : sel.to - sel.from;
            const index = sel.isCollapsed ? sel.from - 1 : sel.from;
            this.delete({index, length});
            this.block.commit();
            
            tick().then(() => this.nabu.selection.setCursor(this.block, index));
        }
    }


    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleDeleteContentForward(event, sel = this.selection) {
        if (!sel) return;
        if (sel.isCollapsed && sel.from === this.text.length) {
            const nextBlock = this.block.findForward(b => b.behaviors.has("text") && b.behaviors.get("text") instanceof TextBehavior);
            const nextBehavior = nextBlock?.behaviors.get("text");
            if (nextBehavior && nextBehavior instanceof TextBehavior) {
                event.preventDefault();
                this.delta([
                    { retain: this.container.length },
                    ...nextBehavior.container.toDelta()
                ]);
                nextBehavior.block.destroy();
                this.block.commit();
                
                tick().then(() => this.nabu.selection.setCursor(this.block, sel.from));
            }
        }
    }

    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleInsertParagraph(event, sel = this.selection) {
        if (!sel) return;
        const from = sel.from;
        const to = sel.isCollapsed ? this.text.length : sel.to ;
        const newBlock = this.block.ascend("onSplit", event, { offset: from, delta: this.container.sliceDelta(from, to)});    
        return newBlock;
    }
    
    /**
    * Retrouve le nœud texte et l'offset DOM pour un offset Modèle donné
    * @param {number} targetOffset 
    * @param {HTMLElement?} [element]
    */
    getDOMPoint(targetOffset, element = this.block.element) {
        if (!element) return null;
        
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let currentOffset = 0;
        let node = walker.nextNode();
        
        while (node) {
            const length = node.textContent?.length || 0;
            if (currentOffset + length >= targetOffset) {
                return { node, offset: targetOffset - currentOffset };
            }
            currentOffset += length;
            node = walker.nextNode();
        }
        
        // Fallback : fin du bloc ou élément lui-même si vide
        return { node: element, offset: element.childNodes.length };
    }
    
    /** @param {number} index @param {string} text */
    insert(index, text) {
        this.container.insert(index, text);
    }
    
    /** @param {Parameters<Block["delete"]>[0]} [deletion] @param {ReturnType<TextBehavior["getSelection"]>} [selection] */
    delete(deletion, selection = this.selection) {
        const l = this.container.length;
        let from = deletion?.from ?? selection?.from ?? 0;
        if (from < 0) from = l + from + 1;
        let to = deletion?.to ?? selection?.to ?? l;
        if (to < 0) to = l + (to + 1) ;
        const index = deletion?.index ?? from;
        const length = deletion?.length ?? (to - from);
        this.container.delete(index, length);
    }
    
    /** @param {import('loro-crdt').Delta<string>[]} data */
    delta(data = []) {
        this.container.applyDelta(data);
    }
    
    /** 
    * @param {Parameters<Block["split"]>[0]} [options] 
    * @param {ReturnType<TextBehavior["getSelection"]>} [selection] 
    * @returns {ReturnType<Block["split"]>} 
    */
    split(options, selection = this.selection) {
        const sel = selection;
        if (!sel) return null;
        const offset = options?.index ?? options?.offset ?? options?.from;
        const from = options?.from ?? offset ?? sel.from;
        const to = options?.to ?? (options?.length ? from + options.length : (offset ?? sel.to));
        return this.block.ascend("onSplit", null, { offset: from, delta: this.container.sliceDelta(from, to)});
    }
    
    /** @param {Block} other */
    mergeWith(other) {
        const otherBehavior = other.behaviors.get("text");
        if (!otherBehavior || !(otherBehavior instanceof TextBehavior)) return false;
        this.delta([
            { retain: this.container.length },
            ...otherBehavior.container.toDelta()
        ]);
        other.destroy();
        return true;
    }
    
}