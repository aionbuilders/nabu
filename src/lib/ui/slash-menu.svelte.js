import { List } from '../blocks/list/list.svelte.js';
import { ListItem } from '../blocks/list/list-item.svelte.js';

/**
 * Transform the current anchor block (a paragraph) into a list of the given type.
 * Mirrors the "- "/"1. " creation flow. Isolated here so the slash menu doesn't
 * depend on internal list actions.
 * @param {import('../blocks/nabu.svelte.js').Nabu} nabu
 * @param {"bullet"|"ordered"|"todo"} listType
 */
function createListInBlock(nabu, listType) {
    const block = nabu.selection.anchorBlock;
    if (!block) return;
    const beh = block.behaviors?.get('text');
    const delta = beh ? beh.container.toDelta() : [];
    const parentNode = block.node.parent();
    const parentId = parentNode?.id.toString() ?? null;
    const index = block.node.index();
    const list = List.create(nabu, 'list', { listType }, parentId, index);
    const itemProps = listType === 'todo' ? { delta, checked: false } : { delta };
    const item = ListItem.create(nabu, 'list-item', itemProps, list.node.id.toString());
    block.destroy();
    nabu.commit().then(() => { const f = nabu.blocks.get(item.id); if (f) f.focus({ start: 0, end: 0 }); });
}

/**
 * @typedef {Object} SlashCommand
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} [icon]
 * @property {string[]} [aliases]
 * @property {(engine: import('../blocks/nabu.svelte.js').Nabu) => void} run
 */

/** @type {SlashCommand[]} */
export const DEFAULT_SLASH_COMMANDS = [
  { title: 'Text',          icon: '¶',  aliases: ['paragraph','p','plain'], run: (e) => e.exec('paragraph') },
  { title: 'Heading 1',     icon: 'H1', aliases: ['h1','title','heading'],  run: (e) => e.exec('heading:1') },
  { title: 'Heading 2',     icon: 'H2', aliases: ['h2','subtitle'],         run: (e) => e.exec('heading:2') },
  { title: 'Heading 3',     icon: 'H3', aliases: ['h3'],                    run: (e) => e.exec('heading:3') },
  { title: 'Bulleted list', icon: '•',  aliases: ['bullet','ul','list'],    run: (e) => createListInBlock(e, 'bullet') },
  { title: 'Numbered list', icon: '1.', aliases: ['numbered','ol','ordered'], run: (e) => createListInBlock(e, 'ordered') },
  { title: 'To-do list',    icon: '☑',  aliases: ['todo','task','checkbox','checklist'], run: (e) => createListInBlock(e, 'todo') },
  { title: 'Code',          icon: '<>', aliases: ['code','snippet'],        run: (e) => e.exec('code') },
  { title: 'Callout',       icon: '💡', aliases: ['callout','note','info','warning'], run: (e) => e.exec('callout') },
  { title: 'Quote',         icon: '"',  aliases: ['quote','blockquote'],    run: (e) => e.exec('blockquote') },
  { title: 'Toggle',        icon: '▸',  aliases: ['toggle','collapse','details'], run: (e) => e.exec('toggle') },
  { title: 'Divider',       icon: '—',  aliases: ['divider','hr','separator','rule'], run: (e) => e.exec('divider:insert') },
  { title: 'Image',         icon: '🖼', aliases: ['image','img','photo','picture'],  run: (e) => e.exec('image:pick') },
  { title: 'Video',         icon: '🎬', aliases: ['video','movie','mp4'],            run: (e) => e.exec('video:pick') },
  { title: 'File',          icon: '📎', aliases: ['file','attachment','upload','document'], run: (e) => e.exec('file:pick') },
];

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
    /** @param {import('../blocks/nabu.svelte.js').Nabu} engine @param {SlashCommand[]} commands */
    constructor(engine, commands) { this.#engine = engine; this.commands = commands ?? DEFAULT_SLASH_COMMANDS; }

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

    filteredItems = $derived.by(() => {
        if (!this.match) return [];
        return filterSlashCommands(this.commands, this.query);
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
