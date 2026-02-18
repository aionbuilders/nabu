import { Block } from "../block.svelte";
import { LoroText } from "loro-crdt";
import ParagraphComponent from "./Paragraph.svelte";
import { tick } from "svelte";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte";
 */

/**
 * @typedef {NabuNode<{type: "paragraph", text: LoroText}>} ParagraphNode
 */

export class Paragraph extends Block {
    /** @param {Nabu} nabu @param {ParagraphNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        const data = node.data;
        this.container = data.get("text") ?? data.setContainer("text", new LoroText());
        this.text = this.container.toString();
        console.log("Paragraph text:", this.container);

        this.container.subscribe(() => {
            this.text = this.container.toString();
        })
    }

    component = $derived(this.nabu.components.get("paragraph") || ParagraphComponent);
    
    text = $state("");

    selection = $derived.by(() => {
        if (!this.selected || !this.element || !this.nabu.selection) return null;
        
        const globalRange = this.nabu.selection.firstRange;
        if (!globalRange) return null;

        // On vérifie si ce bloc contient le début et/ou la fin de la sélection globale
        const containsStart = this.element.contains(globalRange.startContainer);
        const containsEnd = this.element.contains(globalRange.endContainer);

        let from = 0;
        let to = this.text.length;

        if (containsStart) {
            from = this.#calculateOffset(globalRange.startContainer, globalRange.startOffset);
        }

        if (containsEnd) {
            to = this.#calculateOffset(globalRange.endContainer, globalRange.endOffset);
        }

        // Si on est dans un bloc "entre les deux", from=0 et to=length par défaut (déjà setté)
        
        return {
            from,
            to,
            isCollapsed: from === to,
            direction: this.nabu.selection.direction
        };
    })

    /**
     * Calcule l'offset textuel d'un point DOM par rapport au début de ce bloc
     * @param {Node} node 
     * @param {number} offset 
     */
    #calculateOffset(node, offset) {
        if (!this.element) return 0;
        const range = document.createRange();
        range.setStart(this.element, 0);
        range.setEnd(node, offset);
        return range.toString().length;
    }

    /** @param {InputEvent} event */
    async beforeinput(event) {
        const sel = this.selection;
        if (!sel) return;

        switch (event.inputType) {
            case "insertText":
                event.preventDefault();
                const textToInsert = event.data || "";
                if (!sel.isCollapsed) {
                    this.delete(sel.from, sel.to - sel.from);
                }
                this.insert(sel.from, textToInsert);
                
                // RESTAURATION DU CURSEUR
                await tick();
                this.nabu.selection.setCursor(this, sel.from + textToInsert.length);
                break;

            case "insertLineBreak":
            case "insertSoftLineBreak":
                event.preventDefault();
                if (!sel.isCollapsed) {
                    this.delete(sel.from, sel.to - sel.from);
                }
                this.insert(sel.from, "\n");
                
                await tick();
                this.nabu.selection.setCursor(this, sel.from + 1);
                break;
            
            case "deleteContentBackward":
                if (sel.isCollapsed && sel.from === 0) {
                    const previousParagraph = this.findBackward(b => b.type === "paragraph");
                    console.log("Previous paragraph:", previousParagraph);
                    if (previousParagraph && previousParagraph instanceof Paragraph) {
                        event.preventDefault();
                        const previousLength = previousParagraph.text.length;
                        // previousParagraph.insert(previousLength, this.text);
                        previousParagraph.delta([
                            { retain: previousLength },
                            ...this.container.toDelta()
                        ])
                        this.destroy();
                        // this.delete(0, this.text.length);
                        
                        // RESTAURATION DU CURSEUR
                        await tick();
                        this.nabu.selection.setCursor(previousParagraph, previousLength);
                    }
                } else {
                    event.preventDefault();
                    const length = sel.isCollapsed ? 1 : sel.to - sel.from;
                    const index = sel.isCollapsed ? sel.from - 1 : sel.from;
                    this.delete(index, length);
                    
                    // RESTAURATION DU CURSEUR
                    await tick();
                    this.nabu.selection.setCursor(this, index);
                }
                break;

            case "deleteContentForward":
                if (sel.isCollapsed && sel.from === this.text.length) {
                    const nextParagraph = this.findForward(b => b.type === "paragraph");
                    console.log("Next paragraph:", nextParagraph);
                    if (nextParagraph && nextParagraph instanceof Paragraph) {
                        event.preventDefault();
                        this.delta([
                            { retain: this.text.length },
                            ...nextParagraph.container.toDelta()
                        ])
                        nextParagraph.destroy();
                        
                        // RESTAURATION DU CURSEUR
                        await tick();
                        this.nabu.selection.setCursor(this, sel.from);
                    }
                } else {
                    event.preventDefault();
                    const length = sel.isCollapsed ? 1 : sel.to - sel.from;
                    this.delete(sel.from, length);
                    
                    await tick();
                    this.nabu.selection.setCursor(this, sel.from);
                }
                break;

            case "insertParagraph":
                event.preventDefault();
                console.log("Split at offset", sel);
                const from = sel.from;
                const to = sel.isCollapsed ? this.text.length : sel.to ;
                this.ascend("onSplit", event, { offset: from, delta: this.container.sliceDelta(from, to)});
                break;

            default:
                console.log("Paragraph: Unhandled inputType", event.inputType);
        }
    }

    /**
     * Retrouve le nœud texte et l'offset DOM pour un offset Modèle donné
     * @param {number} targetOffset 
     */
    getDOMPoint(targetOffset) {
        if (!this.element) return null;

        const walker = document.createTreeWalker(this.element, NodeFilter.SHOW_TEXT);
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
        return { node: this.element, offset: this.element.childNodes.length };
    }

    /** @param {number} index @param {string} text */
    insert(index, text) {
        this.container.insert(index, text);
        this.nabu.doc.commit();
    }

    /** @param {number} index @param {number} length */
    delete(index, length) {
        this.container.delete(index, length);
        this.nabu.doc.commit();
    }

    /** @param {import('loro-crdt').Delta<string>[]} data */
    delta(data = []) {
        this.container.applyDelta(data);
        this.nabu.doc.commit();
    } 

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(parentId || undefined, index || undefined);
        node.data.set("type", "paragraph");
        const container = node.data.setContainer("text", new LoroText());
        if (props.text) container.insert(0, props.text || "Start writing...");
        if (props.delta) container.applyDelta([...props.delta]);
        const block = new Paragraph(nabu, node);
        return block;
    }
}