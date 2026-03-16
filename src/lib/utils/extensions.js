/**
 * @import { Nabu, Block } from '../blocks'
 */

/**
 * @typedef {{
 * onInit: function(Nabu): void,
 * onBlockCreate: function(Nabu, Block): void,
 * onBlockDelete: function(Nabu, Block): void,
 * onBlockUpdate: function(Nabu, Block): void,
 * onBeforeTransaction: function(Nabu, Array<{type: string, block: Block}>): void,
 * onAfterTransaction: function(Nabu, Array<{type: string, block: Block}>): void,
 * onSplit: function(Nabu, Block, Event, {offset: number, delta: import('loro-crdt').Delta<string>}): {block: Block},
 * onBeforeInput: function(Nabu, InputEvent, Block): void,
 * onInput: function(Nabu, InputEvent, Block): void,
 * } & Object<string, function>} ExtensionHooks
 */

/**
 * @typedef {Object} ExtensionInit
 * @property {string} [name]
 * @property {import('svelte').Component} [component]
 * @property {typeof Block} [block]
 * @property {Partial<ExtensionHooks>} [hooks]
 * @property {Record<string, (nabu: Nabu) => any>} [serializers]
 * @property {Record<string, (nabu: Nabu, data: any, topic: string) => any>} [actions]
 */

export class Extension {
    /** @param {string} name @param {ExtensionInit} init */
    constructor(name, init = {}) {
        this.name = name;
        this.component = init.component;
        this.block = init.block;
        /** @type {Partial<ExtensionHooks>} */
        this.hooks = init.hooks || {};
        /** @type {Record<string, (nabu: Nabu) => any>} */
        this.serializers = init.serializers || {};
        /** @type {Record<string, (nabu: Nabu, data: any, topic: string) => any>} */
        this.actions = init.actions || {};
    }
}


/** @param {string} name @param {ExtensionInit} init */
export const extension = (name, init) => new Extension(name, init);