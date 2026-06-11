import { untrack } from 'svelte';
import { MegaBlock } from '../megablock.svelte.js';
import { LoroText } from 'loro-crdt';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';

/**
 * @import { Nabu, NabuNode } from '../nabu.svelte.js';
 */

/**
 * @typedef {NabuNode<{type: "zone", synopsis: LoroText, status: string, wordCountTarget: number | null, title: string, template: string | null}>} ZoneNode
 */

export class ZoneBlock extends MegaBlock {
    /** @param {Nabu} nabu @param {ZoneNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        const data = node.data;

        // Synopsis LoroText — get existing or create on first construction
        this.synopsisContainer = /** @type {LoroText} */ (
            data.get('synopsis') ?? data.setContainer('synopsis', new LoroText())
        );

        // Initialize $state backing fields from Loro
        this._status = data.get('status') ?? 'draft';
        this._wordCountTarget = data.get('wordCountTarget') ?? null;
        this._title = data.get('title') ?? '';
        this._template = /** @type {string | null} */ (data.get('template') ?? null);
        this.synopsisText = this.synopsisContainer.toString();

        // Subscribe to map changes for reactive scalar fields
        data.subscribe(() => {
            this._status = data.get('status') ?? 'draft';
            this._wordCountTarget = data.get('wordCountTarget') ?? null;
            this._title = data.get('title') ?? '';
            this._template = /** @type {string | null} */ (data.get('template') ?? null);
        });

        // Subscribe to synopsis LoroText changes
        this.synopsisContainer.subscribe(() => {
            this.synopsisText = this.synopsisContainer.toString();
        });

        this.serializers.set('markdown', () => {
            const header = `<!-- zone: ${this._status} -->`;
            const body = this.children
                .map(child => child.serialize('markdown'))
                .filter(Boolean)
                .join('\n\n');
            return [header, body].filter(Boolean).join('\n');
        });

        this.serializers.set('json', () => ({
            id: this.id,
            type: 'zone',
            props: { status: this._status, wordCountTarget: this._wordCountTarget },
            children: this.children.map(child => child.serialize('json')).filter(Boolean),
        }));

        this.serializers.set('application/x-nabu+json', () => ({
            type: 'zone',
            props: this.clipboardProps,
            children: this.children
                .map(child => child.serialize('application/x-nabu+json'))
                .filter(Boolean),
        }));

        this.zones = Zones.get(nabu);


        $effect.root(() => {
            $effect(() => {
                const templateId = this._template;
                if (!templateId) {
                    this.zones.counters.unsubscribe(this);
                    this.counter = null;
                    return;
                }
                const template = this.zones.templates.get(templateId) || this.zones.templates.new(templateId);
                const counter = template?.counter;
                if (!counter) {
                    this.zones.counters.unsubscribe(this);
                    this.counter = null;
                    return;
                }
                this.counter = template.getCounter(this);
            });
        });
    }




    // zones = $derived.by(() => {
    //     this.nabu.systems.has('zones');
    //     return untrack(() => Zones.get(this.nabu));
    // });

    // ── Reactive backing fields ─────────────────────────────────────────────

    /** @type {string} */
    _status = $state('draft');

    /** @type {number | null} */
    _wordCountTarget = $state(null);

    /** @type {string} */
    _title = $state('');

    /** @type {string | null} */
    _template = $state(null);

    /** Incremented each time the title input should be focused. */
    _focusTitleTick = $state(0);

    /** @type {string} */
    synopsisText = $state('');

    // ── Derived ─────────────────────────────────────────────────────────────

    // Incremental: each child maintains its own wordCount, we just sum.
    // (Inherited MegaBlock.wordCount does the same, but Zone redeclares it
    // explicitly because the word count is part of its public contract.)
    wordCount = $derived(this.children.reduce((sum, c) => sum + (c.wordCount ?? 0), 0));

    // ── Getters / setters ───────────────────────────────────────────────────

    get status() { return this._status; }
    set status(value) {
        this._status = value;
        this.node.data.set('status', value);
        this.commit();
    }

    get wordCountTarget() { return this._wordCountTarget; }
    set wordCountTarget(value) {
        this._wordCountTarget = value ?? null;
        this.node.data.set('wordCountTarget', value ?? null);
        this.commit();
    }

    get title() { return this._title; }
    set title(value) {
        this._title = value ?? '';
        /** @type {any} */ (this.node.data).set('title', value ?? '');
        this.commit();
    }

    get template() { return this._template; }
    set template(value) {
        this._template = value ?? null;
        /** @type {any} */ (this.node.data).set('template', value ?? null);
        this.commit();
    }

    focusTitle() { this._focusTitleTick++; }

    /** Returns the LoroText container for direct CRDT mutation. */
    get synopsis() { return this.synopsisContainer; }

    parentZones = $derived(this.parents.filter(p => p instanceof ZoneBlock));
    parentZone = $derived(this.parentZones[0] ?? null);

    /** @type {Counter?} */
    counter = $state(null);
    count = $state(0);


    /**
     * Replace the synopsis text entirely.
     * @param {string} text
     */
    setSynopsis(text) {
        const len = this.synopsisContainer.length;
        if (len > 0) this.synopsisContainer.delete(0, len);
        if (text) this.synopsisContainer.insert(0, text);
        this.commit();
    }

    get clipboardProps() {
        return { status: this._status, wordCountTarget: this._wordCountTarget };
    }

    // ── Container split ─────────────────────────────────────────────────────

    /**
     * Called via ascend("onSplit") when a child block's Enter key fires.
     * Creates a new paragraph inside this Zone, never outside it.
     *
     * @param {Event | null} event
     * @param {{ from: import('../block.svelte.js').Block, offset: number, delta: import('loro-crdt').Delta<string>[] }} data
     */
    onSplit(event, data) {
        const { from: sourceBlock, offset, delta } = data;

        // Delete content from split point to end of source block
        sourceBlock.delete({ from: offset, to: -1 });

        const currentIndex = sourceBlock.node.index();

        // Insert new paragraph inside THIS zone (not the zone's parent)
        const newParagraph = this.nabu.insert(
            'paragraph',
            { delta },
            this.node.id.toString(),
            currentIndex + 1
        );

        this.nabu.commit().then(() => this.nabu.selection.setCursor(newParagraph, 0));
        return { block: newParagraph };
    }

    // ── Static factory ──────────────────────────────────────────────────────

    /**
     * @param {Nabu} nabu
     * @param {string} type
     * @param {Object} [props]
     * @param {string | null} [parentId]
     * @param {number | null} [index]
     */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(
            parentId || undefined,
            index != null ? index : undefined
        );

        node.data.set('type', 'zone');
        node.data.set('status', props.status ?? 'draft');
        node.data.set('wordCountTarget', props.wordCountTarget ?? null);
        /** @type {any} */ (node.data).set('template', /** @type {any} */ (props).template ?? null);

        const synopsisContainer = node.data.setContainer('synopsis', new LoroText());
        if (props.synopsis) synopsisContainer.insert(0, props.synopsis);

        return new ZoneBlock(nabu, node);
    }
}

export class Zones {
    /** @type {Nabu} */
    #nabu;

    /** @param {Nabu} nabu */
    constructor(nabu) {
        this.#nabu = nabu;
        this.templates = new Templates(this.#nabu, this);
    }

    /** @param {Nabu} nabu */
    static get(nabu) {
        if (!nabu.systems.has('zones')) {
            const zones = new Zones(nabu);
            nabu.systems.set('zones', zones);
            return zones;
        }
        return /** @type {Zones} */ (nabu.systems.get('zones'));
    }

    /**
     * Flat list of all ZoneBlocks in document order (DFS traversal).
     * @type {ZoneBlock[]}
     */
    all = $derived.by(() => {
        /** @type {ZoneBlock[]} */
        const result = [];
        /** @param {import('../block.svelte.js').Block[]} blocks */
        const traverse = (blocks) => {
            for (const block of blocks) {
                if (block.type === 'zone') result.push(/** @type {ZoneBlock} */ (block));
                const children = /** @type {any} */ (block).children;
                if (children?.length) traverse(children);
            }
        };
        traverse(this.#nabu.children);
        return result;
    });

    /**
     * Total number of zones.
     */
    count = $derived(this.all.length);

    /**
     * Hierarchical zone tree — zones nested inside other zones.
     * @type {Array<{zone: ZoneBlock, children: any[]}>}
     */
    tree = $derived.by(() => {
        /** @param {import('../block.svelte.js').Block[]} blocks */
        const buildTree = (blocks) => {
            /** @type {Array<{zone: ZoneBlock, children: any[]}>} */
            const result = [];
            for (const block of blocks) {
                const children = /** @type {any} */ (block).children ?? [];
                if (block.type === 'zone') {
                    result.push({ zone: /** @type {ZoneBlock} */ (block), children: buildTree(children) });
                } else if (children.length) {
                    result.push(...buildTree(children));
                }
            }
            return result;
        };
        return buildTree(this.#nabu.children);
    });

    /**
     * The innermost zone containing the current cursor, or null if outside any zone.
     * @type {ZoneBlock | null}
     */
    current = $derived.by(() => {
        const anchor = this.#nabu.selection.anchorBlock;
        if (!anchor) return null;
        let node = anchor.parent;
        while (node) {
            if (node.type === 'zone') return /** @type {ZoneBlock} */ (node);
            node = node.parent;
        }
        return null;
    });

    /**
     * Index of the current zone in `all` (-1 if cursor is outside any zone).
     */
    currentIndex = $derived.by(() => {
        const zone = this.current;
        if (!zone) return -1;
        return this.all.indexOf(zone);
    });

    /**
     * Navigate to the next zone (moves cursor to its first text position).
     */
    goToNext() {
        const idx = this.currentIndex;
        const next = idx === -1
            ? this.all[0]
            : this.all[idx + 1];
        if (next) this.#focusZone(next);
    }

    /**
     * Navigate to the previous zone.
     */
    goToPrevious() {
        const idx = this.currentIndex;
        if (idx <= 0) return;
        this.#focusZone(this.all[idx - 1]);
    }

    /** @param {ZoneBlock} zone */
    #focusZone(zone) {
        const firstChild = /** @type {any} */ (zone).children?.[0];
        if (firstChild) this.#nabu.selection.setCursor(firstChild, 0);
    }

    counters = new Counters();
    
}

/** @extends SvelteMap<string, Template> */
export class Templates extends SvelteMap {
    /** @param {Nabu} nabu @param {Zones} zones */
    constructor(nabu, zones) {
        super();
        this.nabu = nabu;
        this.zones = zones;


        this.map = this.nabu.doc.getMap('zones::templates');
        Object.entries(this.map.toJSON()).forEach(([key, value]) => {
            this.set(key, new Template(value, this));
        });
    }

    /** @param {string} id @param {TemplateData} [data] */
    new(id, data) {
        const templateData = { id, label: id, ...data };
        const template = new Template(templateData, this);
        this.set(id, template);
        this.map.set(id, templateData);
        return template;
    } 
}

/**
 * @typedef {Object} TemplateData
 * @property {string} id - Unique identifier for the template.
 * @property {string} label - The template's display name.
 * @property {{
 *  scope: "root" | "parent",
 * } | boolean | null | undefined} [counter]
 */

export class Template {
    /** @param {TemplateData} init @param {Templates} templates */
    constructor(init, templates) {
        this.templates = templates;
        this.id = init.id;
        this._label = init.label;
        this._counter = init.counter;

    }

    _label = $state('');
    get label() { return this._label; }
    set label(value) {
        this._label = value;
        this.update(data => ({ ...data, label: value }));
    }

    renderLabel(index, title = '') {
        return formatTemplateLabel(this.label, index, title);
    }

    /** @type {TemplateData['counter']} */
    _counter = $state(null);
    /**
     * @returns {{scope: "root" | "parent"} | null | undefined}
     */
    get counter() {
        if (this._counter === true) return { scope: 'root' };
        if (this._counter === false) return null;
        return this._counter;
    }
    /** @param {TemplateData['counter']} value */
    set counter(value) {
        this._counter = value;
        this.update(data => ({ ...data, counter: value }));
    }


    /** @param {ZoneBlock} zone */
    getCounter(zone) {
        if (this.counter?.scope === 'root') {
            return this.templates.zones.counters.subscribe(zone, 'root', this.id);
        } else if (this.counter?.scope === 'parent') {
            const parentZone = zone.parentZone;
            const parentZoneId = parentZone ? parentZone.id : null;
            if (!parentZoneId) return null;
            return this.templates.zones.counters.subscribe(zone, parentZoneId, this.id);
        }
    }

    /** @param {function(TemplateData): TemplateData} callback */
    update(callback) {
        const updatedData = callback({
            id: this.id,
            label: this._label,
            counter: this._counter,
        });
        this.templates.map.set(this.id, updatedData);
    }
}

export function formatTemplateLabel(formatString, index, title = '') {
    if (!formatString) return '';
    let text = formatString;
    if (text.includes('{{1}}')) text = text.replace(/\{\{1\}\}/g, String(index));
    if (text.includes('{{A}}')) text = text.replace(/\{\{A\}\}/g, toAlpha(index, true));
    if (text.includes('{{a}}')) text = text.replace(/\{\{a\}\}/g, toAlpha(index, false));
    if (text.includes('{{I}}')) text = text.replace(/\{\{I\}\}/g, toRoman(index, true));
    if (text.includes('{{i}}')) text = text.replace(/\{\{i\}\}/g, toRoman(index, false));
    if (text.includes('{{title}}')) text = text.replace(/\{\{title\}\}/g, title);
    return text;
}

function toAlpha(num, upper) {
    let result = '';
    while (num > 0) {
        num--;
        result = String.fromCharCode((upper ? 65 : 97) + (num % 26)) + result;
        num = Math.floor(num / 26);
    }
    return result || (upper ? 'A' : 'a');
}

function toRoman(num, upper) {
    if (num <= 0) return String(num);
    const roman = {M:1000, CM:900, D:500, CD:400, C:100, XC:90, L:50, XL:40, X:10, IX:9, V:5, IV:4, I:1};
    let str = '';
    for (let i of Object.keys(roman)) {
        let q = Math.floor(num / roman[i]);
        num -= q * roman[i];
        str += i.repeat(q);
    }
    return upper ? str : str.toLowerCase();
}

export class Counters {
    /** @type {SvelteMap<string, Counter>} */
    counters = new SvelteMap();

    /** @type {SvelteMap<ZoneBlock, string>} */
    index = new SvelteMap();

    /**
     * @param {ZoneBlock} zone
     */
    unsubscribe(zone) {
        if (this.index.has(zone)) {
            const oldName = this.index.get(zone);
            if (oldName) {
                const set = this.counters.get(oldName);
                if (set) {
                    set.delete(zone);
                    untrack(() => set.size === 0 && set.unwatch());
                }
            }
            this.index.delete(zone);
        }
    }

    /**
     * @param {ZoneBlock} zone
     * @param {"root"|string} scope
     * @param {string} name
     */
    subscribe(zone, scope, name) {
        const c = scope + ':' + name;

        if (this.index.has(zone)) {
            const oldName = this.index.get(zone);
            if (oldName) {
                if (oldName === c) return this.counters.get(c);
                this.unsubscribe(zone);
            }
        }

        this.index.set(zone, c);

        if (!this.counters.has(c)) {
            this.counters.set(c, new Counter(scope, name));
        }
        const counter = this.counters.get(c);
        counter?.add(zone);
        return counter;
    }
}

/**
 * @extends SvelteSet<ZoneBlock>
 */
class Counter extends SvelteSet {
    /**
     * @param {"root"|string} scope
     * @param {string} name
     */
    constructor(scope, name) {
        super();
        this.scope = scope;
        this.name = name;

        // L'effet racine qui observe les changements dans l'ensemble (Set)
        // et déclenche la mise à jour des `.count` des zones.
        this.watcher = $effect.root(() => {
            $effect(() => {
                if (this.zones) {
                    // console.log(`Counter "${this.name}" (${this.scope}) has ${this.size} zones.`);
                    // On recalcule l'index pour chaque zone du compteur
                    this.zones.forEach(zone => {
                        // untrack n'est pas strictement nécessaire ici si count n'est pas lu
                        // dans cet effet, mais c'est une bonne pratique pour une simple écriture.
                        untrack(() => zone.count = this.getIndex(zone));
                    });
                }
            })
        });
    }

    unwatch = () => {
        // console.log(`Unwatching counter "${this.name}" (${this.scope}).`);
        if (this.watcher) this.watcher();
    }
    
    // 1. Correction du Tri (Utiliser l'ordre du document plat) + Filtrage des fantômes
    zones = $derived.by(() => {
        const zonesInSet = Array.from(this);
        if (zonesInSet.length === 0) return [];
        
        // On récupère la liste maître aplatie via n'importe quelle zone de notre Set
        const allZonesInDoc = zonesInSet[0].zones.all;

        // On filtre les zones qui auraient été supprimées du document (fantômes)
        const activeZones = zonesInSet.filter(z => allZonesInDoc.includes(z));

        // On trie en utilisant la position globale dans le document
        activeZones.sort((a, b) => allZonesInDoc.indexOf(a) - allZonesInDoc.indexOf(b));
        return activeZones;
    });

    /**
     * @param {ZoneBlock} targetZone
     * @returns {number}
     */
    getIndex(targetZone) {
        const sortedZones = this.zones;
        const targetIndexInList = sortedZones.indexOf(targetZone);
        
        if (targetIndexInList === -1) return 1;

        // Grâce à l'architecture du Template qui crée des compteurs isolés (un par ID de parent),
        // le Set ne contient DEJA que les zones qui doivent être comptées ensemble !
        // L'index est donc tout simplement sa position dans ce sous-groupe.
        return targetIndexInList + 1;
    }
}