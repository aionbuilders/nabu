/**
 * The known groups of the slash menu, in display order. A group is a free string: an unknown one is listed after these (in the
 * order its first entry is met), and an entry without a group comes last.
 * @type {readonly string[]}
 */
export const SLASH_GROUP_ORDER = ['text', 'lists', 'blocks', 'media', 'structure'];

/**
 * @typedef {Object} SlashCommand
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [icon] A short text glyph (no emoji in the library's own entries). A theme or an integrator overrides an
 *   entry's icon by providing its own entry (`commands` of `SlashMenu`, or `slashCommands` of an extension).
 * @property {string[]} [aliases]
 * @property {'text' | 'lists' | 'blocks' | 'media' | 'structure' | (string & {})} [group] Where the entry is listed. Known
 *   groups, in display order: `text`, `lists`, `blocks`, `media`, `structure`; any other string is a group of its own listed
 *   after them; no group = last.
 * @property {number} [order] Position inside the group (ascending, default 0); ties keep the declaration order. The menu's
 *   order never depends on the load order of the extensions.
 * @property {(engine: import('../blocks/nabu.svelte.js').Nabu, block: any) => boolean} [when]
 *   Where the entry applies; `block` is the block holding the caret. Without it the entry is always offered.
 * @property {(engine: import('../blocks/nabu.svelte.js').Nabu) => void} run
 */

/**
 * Stable sort of slash entries: group (known order, then other groups by first appearance, then ungrouped), then `order`, then
 * declaration order. Returns a new array.
 * @param {SlashCommand[]} commands
 * @returns {SlashCommand[]}
 */
export function sortSlashCommands(commands) {
    /** @type {Map<string, number>} */
    const rank = new Map(SLASH_GROUP_ORDER.map((g, i) => [g, i]));
    const groupRank = (/** @type {SlashCommand} */ c) => {
        if (!c.group) return Infinity;
        if (!rank.has(c.group)) rank.set(c.group, rank.size);
        return /** @type {number} */ (rank.get(c.group));
    };
    return commands
        .map((c, i) => ({ c, i, g: groupRank(c) }))
        .sort((a, b) => (a.g === b.g ? 0 : a.g < b.g ? -1 : 1) || (a.c.order ?? 0) - (b.c.order ?? 0) || a.i - b.i)
        .map((x) => x.c);
}

/**
 * Filter slash commands by a query. Titles match by SUBSTRING (`/head` -> "Heading 1"), aliases
 * by PREFIX (`/bul` -> "Bulleted list" via "bullet"); a substring alias match would make `/ul`
 * also hit Divider through its "r-ul-e" alias. Case-insensitive; an empty query keeps everything.
 * @param {SlashCommand[]} commands @param {string} query
 * @returns {SlashCommand[]}
 */
export function filterSlashCommands(commands, query) {
    const q = query.toLowerCase();
    if (!q) return commands;
    return commands.filter(c =>
        c.title.toLowerCase().includes(q) ||
        (c.aliases || []).some(a => a.toLowerCase().startsWith(q)));
}

export class SlashMenuController {
    /** @type {import('../blocks/nabu.svelte.js').Nabu} */
    #engine;
    /**
     * @param {import('../blocks/nabu.svelte.js').Nabu} engine
     * @param {SlashCommand[]} [commands] EXTRA entries of the integrator, added to the ones the loaded extensions contribute
     *   (`Extension#slashCommands`, collected in `engine.slashCommands`) and sorted with them. The menu has no entry of its own.
     */
    constructor(engine, commands) { this.#engine = engine; this.commands = commands ?? []; }

    /** @type {{ block: any, slashStart: number, cursor: number, query: string } | null} */
    match = $derived.by(() => {
        const sel = this.#engine.selection;
        const block = sel?.anchorBlock;
        if (!block) return null;
        const beh = block.behaviors?.get('text');
        const bsel = beh?.selection;
        if (!beh || !bsel || !bsel.isCollapsed) return null;
        const before = beh.text.slice(0, bsel.from);
        // "/" at block start OR after whitespace, then non-space chars = the query
        const m = before.match(/(?:^|\s)\/(\S*)$/);
        if (!m) return null;
        const query = m[1];
        return { block, slashStart: bsel.from - query.length - 1, cursor: bsel.from, query };
    });

    query = $derived(this.match?.query ?? '');

    /**
     * The entries of the loaded extensions plus the integrator's extras that apply at the caret (`when`), in the documented
     * order (group, `order`, declaration order).
     */
    available = $derived.by(() => {
        const block = this.match?.block;
        const applies = (/** @type {SlashCommand} */ c) => {
            if (typeof c.when !== 'function') return true;
            try { return !!block && !!c.when(this.#engine, block); } catch { return false; }
        };
        return sortSlashCommands([...(this.#engine.slashCommands ?? []), ...this.commands].filter(applies));
    });

    filteredItems = $derived.by(() => {
        if (!this.match) return [];
        return filterSlashCommands(this.available, this.query);
    });

    /** @type {number | null} slashStart of a dismissed (Escape) trigger */
    #dismissedKey = $state(null);

    open = $derived(!!this.match && this.filteredItems.length > 0 && this.match.slashStart !== this.#dismissedKey);

    selectedIndex = $state(0);

    /** @param {number} delta */
    moveSelection(delta) {
        const n = this.filteredItems.length;
        if (!n) return;
        this.selectedIndex = (this.selectedIndex + delta + n) % n;
    }

    /** Run the command at the given index (default: the selected one). @param {number} [index] */
    async select(index) {
        const item = this.filteredItems[index ?? this.selectedIndex];
        const m = this.match;
        if (!item || !m) return;
        const beh = m.block.behaviors?.get('text');
        if (beh) beh.delete({ index: m.slashStart, length: m.cursor - m.slashStart });
        await this.#engine.commit();
        this.#engine.selection.setCursor(m.block, m.slashStart);
        // The command reads selection.anchorBlock: don't wait for the async `selectionchange`.
        this.#engine.selection.sync?.();
        this.close();
        item.run(this.#engine);
    }

    /** Dismiss the menu for the current trigger position (Escape). */
    close() { this.#dismissedKey = this.match?.slashStart ?? null; }
}
