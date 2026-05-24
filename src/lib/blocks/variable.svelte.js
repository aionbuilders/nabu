/**
 * @import {Block} from "./block.svelte.js"
 */


/**
 * @template {Block} [TBlock=Block]
 * @typedef {Object} VariableInit
 * @property {"string"|"number"|"boolean"} type - The variable type (e.g., "string", "number", "boolean").
 * @property {function(TBlock): any} get - A function that returns the current value of the variable.
 * @property {function(TBlock, any): void} [set] - A function that updates the variable's value.
 */

/**
 * @template {Block} [TBlock=Block]
 */
export class Variable {
    /**
     * Creates a new Variable instance.
     * @param {TBlock} block - The block that owns this variable.
     * @param {string} name
     * @param {VariableInit<TBlock>} init
     */
    constructor(block, name, init) {
        this.block = block;
        this.name = name;
        this.init = init;
        this.type = init.type;
        this.get = init.get;
        this.set = init.set;

        this.block.variables.set(name, this);
    }

    writable = $derived(!!this.set);

    set value(newValue) {
        if (!this.set) {
            throw new Error(`Variable "${this.name}" is read-only.`);
        }
        this.set(this.block, newValue);
    }

    get value() {
        return this.get(this.block);
    }

    destroy() {
        this.block.variables.delete(this.name);
    }
}