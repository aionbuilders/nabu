/**
 * Texts of the region commands (ADR 016 lot 2, ADR 018 lot A2): the labels of the commands (help sheet, palette, the prompt of
 * a hold) and the prompt of the two protected merges. English by default; override any of them with the `messages` option of
 * `RegionsExtension({ messages })` (partial object; a value is a string or a function of the parameters below).
 */

/**
 * @typedef {Object} RegionMessageParams
 * @property {string} title  the title of the region concerned, else its label, else its type id (never empty)
 * @property {string} label  its computed label ("1.1 The bank"; may be empty)
 * @property {string} type   its type id
 */

/**
 * @typedef {Object} RegionMessages
 * @property {string | (() => string)} [split]  label of `region:split`
 * @property {string | ((p: { type: string }) => string)} [insert]  label of `region:insert`
 * @property {string | ((p: RegionMessageParams) => string)} [mergePrevious]  label of `region:merge-previous`, "the previous region" being `p`
 * @property {string | ((p: RegionMessageParams) => string)} [mergeNext]  label of `region:merge-next` when the next region (`p`, the one that disappears) joins the previous region
 * @property {string | ((p: RegionMessageParams) => string)} [dissolve]  label of a protected merge that has no region to join: the region `p` is dissolved in place
 *   (its body stays where it is, its title goes away)
 * @property {string | (() => string)} [exit]  label of `region:exit`
 * @property {string | (() => string)} [unwrap]  label of `region:unwrap`
 * @property {string | (() => string)} [move]
 * @property {string | (() => string)} [moveUp]
 * @property {string | (() => string)} [moveDown]
 * @property {string | (() => string)} [promote]
 * @property {string | (() => string)} [demote]
 * @property {string | (() => string)} [next]
 * @property {string | (() => string)} [prev]
 * @property {string | (() => string)} [parent]
 * @property {string | (() => string)} [untitled]  placeholder of an empty title (ADR 018)
 * @property {string | ((p: { keys: string, label: string }) => string)} [hold]  the prompt of a protected merge ("Hold ⌫ to merge with “…”"):
 *   shown above the seam and announced to screen readers
 */

/** @type {Required<RegionMessages>} */
export const DEFAULT_REGION_MESSAGES = {
    split: 'Split here',
    insert: 'Insert a region',
    mergePrevious: ({ title }) => `Merge with “${title}”`,
    mergeNext: ({ title }) => `Merge “${title}” into this region`,
    dissolve: ({ title }) => `Dissolve “${title}”`,
    exit: 'Leave the region',
    unwrap: 'Dissolve the region',
    move: 'Move region',
    moveUp: 'Move region up',
    moveDown: 'Move region down',
    promote: 'Promote region',
    demote: 'Demote region',
    next: 'Go to the next region',
    prev: 'Go to the previous region',
    parent: 'Go to the parent region',
    untitled: 'Untitled',
    hold: ({ keys, label }) => `Hold ${keys} to ${label.charAt(0).toLowerCase()}${label.slice(1)}`,
};

/**
 * Resolves the messages of an integrator over the defaults: `text('mergePrevious', params)`.
 * @param {RegionMessages | undefined} custom
 * @returns {<K extends keyof RegionMessages>(key: K, params?: any) => string}
 */
export function createMessages(custom) {
    const own = custom && typeof custom === 'object' ? custom : {};
    return (key, params) => {
        const value = /** @type {any} */ (own)[key] ?? DEFAULT_REGION_MESSAGES[key];
        try {
            return String(typeof value === 'function' ? value(params) : value);
        } catch {
            const fallback = DEFAULT_REGION_MESSAGES[key];
            return String(typeof fallback === 'function' ? /** @type {Function} */ (fallback)(params) : fallback);
        }
    };
}
