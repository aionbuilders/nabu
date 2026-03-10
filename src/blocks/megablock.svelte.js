import { Block } from "./block.svelte";

/**
 * @import { Nabu, NabuNode } from "./nabu.svelte";
 */

export class MegaBlock extends Block {

    /** @param {Nabu} nabu @param {NabuNode} node */
	constructor(nabu, node) {
		super(nabu, node);
        this.updateChildren();
	}

    /** @type {Block[]} */
    children = $state([]);

    updateChildren() {
        const childrenNodes = this.node.children();
        if (!childrenNodes) return;
        this.children = childrenNodes.map((childNode, i) => {
            const id = childNode.id.toString();
            let block = this.nabu.blocks.get(id);
            const currentType = childNode.data.get("type");

            if (!block || block.type !== currentType) {
                if (block) {
                    this.nabu.blocks.delete(id);
                    this.nabu.blocksByType.get(block.type)?.delete(block);
                }
                block = Block.load(this.nabu, childNode);
            }
            block.parent = this;
            block.index = i;
            console.log("Loaded block:", block.text, "with type:", block.type);
            return block;
        });
    }


    /** @param {Block[]} children @param {number | null} [index] */
    adoptChildren(children, index = null) {
        /** @type {Block[]} */
        let skipped = [];
        children.reverse().forEach(child => {
            const childNode = child.node;
            if (!childNode) return;
            if (false) {
                //TODO: conditions de skip, ex: si le block est déjà dans la mega block, ou si c'est un block parent de la mega block, etc.
                console.warn("Skipping child with id", child.id, "because ...");
                return skipped.push(child);
            }
            this.nabu.tree.move(childNode.id, this.node.id, index);
        })

        return {skipped: skipped.length ? skipped.reverse() : false};
    }


    /** @param {InputEvent} event */
    beforeinput(event) {
        console.clear();
        const startBlock = /** @type {Block} */ (this.nabu.selection.startBlock);    
        const endBlock = /** @type {Block} */ (this.nabu.selection.endBlock);

        const focusData = startBlock.focus(undefined, true);
        const inputType = event.inputType;

        const startSpine = [startBlock]
        while (startSpine.at(-1) && startSpine.at(-1) !== this) {
            const current = startSpine.at(-1);
            const parent = current?.parent;
            if (!current || !parent) break;
            startSpine.push(parent);

            if (!(parent === this)) {
                const nextSiblings = parent.children.slice(current.index + 1);
                console.log("Next siblings to delete:", nextSiblings.map(b => b.text));
                if (nextSiblings.length) nextSiblings.forEach(block => block.destroy());
            }
        }
        const endSpine = [endBlock]
        while (endSpine.at(-1) && endSpine.at(-1) !== this) {
            const current = endSpine.at(-1);
            const parent = current?.parent;
            if (!current || !parent) break;
            endSpine.push(parent);

            if (!(parent === this)) {
                const previousSiblings = parent.children.slice(0, current.index);
                console.log("Previous siblings to delete:", previousSiblings.map(b => b.text));
                if (previousSiblings.length) previousSiblings.forEach(block => block.destroy());
            }
        }

        const startOfStartSpine = startSpine.at(-2);
        const startOfEndSpine = endSpine.at(-2);

        console.assert(startOfStartSpine?.parent === startOfEndSpine?.parent, "Start and end spines should have the same parent at the top level of the mega block");
        console.assert(startOfStartSpine?.parent === this, "The parent of the start and end spines should be the mega block");

        const intermediates = this.children.slice(startOfStartSpine.index + 1, startOfEndSpine.index);
        intermediates.forEach(block => block.destroy());

        if (startBlock === endBlock) {
            return startBlock.beforeinput(event);
        }

        startBlock.delete();
        endBlock.delete();

        let focusBlock = startBlock;

        if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") {
            
        } else if (inputType === "insertParagraph") {
            // startBlock.insert(focusData.options.startOffset, "\n");
            const {block: newBlock} = startBlock.split({offset: focusData.options.startOffset}) || {};
            if (newBlock) focusBlock = newBlock;
        } else if (inputType === "insertText" || event.inputType === "insertLineBreak") {
            const text = event.data || (inputType === "insertLineBreak" ? "\n" : "");
            startBlock.insert(focusData.options.startOffset, text);
        } else {
            console.warn("Unhandled input type:", inputType);
            return false;
        }

        
        // const absorbed = focusBlock.absorbs(endBlock);
        // if (absorbed && endBlock instanceof MegaBlock && endBlock.children.length) {
        //     if (focusBlock instanceof MegaBlock) focusBlock.adoptChildren(endBlock.children, 0);
        //     else {
        //         endBlock.children.forEach(child => {
        //             child.node.moveAfter(focusBlock.node);
        //         });
        //     }
        // } else if (!absorbed) {
        //     endBlock.node.moveAfter(focusBlock.node);
        // }

        focusBlock.consume(endBlock);

        endSpine.forEach(block => {
            if (block === this) return;
            console.warn("Destroying block in end spine:", block.type, block.text);
            const brotherhood = block.parent?.children || [];
            const index = brotherhood.indexOf(block);
            if (index !== -1) {
                const nextSiblings = brotherhood.slice(index + 1);
                if (nextSiblings.length) nextSiblings.forEach(sibling => sibling.node.moveAfter(focusBlock.node));
            }
        })

        startOfEndSpine?.destroy();

        this.commit();
        startBlock.focus({ offset: focusData.options.startOffset + (inputType === "insertText" ? (event.data?.length || 0) : 0) });
        return true;

        
        return false;
    }
}