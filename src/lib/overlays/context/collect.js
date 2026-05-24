import { CONTEXT_COLLECT_EVENT } from './context.svelte.js';

/** @import { ContextMenuSection } from './context.svelte.js' */

/**
 * Svelte action — registers an element as a context menu contributor.
 * The callback receives the collect event and should push sections into event.detail.sections.
 *
 * Usage:
 *   <div use:collect={() => [{ key: 'my-section', items: [...] }]}>
 *
 * @param {HTMLElement} node
 * @param {() => ContextMenuSection[]} getSections
 */
export function collect(node, getSections) {
    /** @param {Event} e */
    const handler = (e) => {
        const event = /** @type {CustomEvent<{ sections: ContextMenuSection[] }>} */ (e);
        getSections().forEach(section => event.detail.sections.push(section));
    };

    node.addEventListener(CONTEXT_COLLECT_EVENT, handler);

    return {
        /** @param {() => ContextMenuSection[]} newGetSections */
        update(newGetSections) {
            getSections = newGetSections;
        },
        destroy() {
            node.removeEventListener(CONTEXT_COLLECT_EVENT, handler);
        },
    };
}
