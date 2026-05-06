import { untrack } from 'svelte';
import { MegaBlock } from '../megablock.svelte.js';
import { LoroText } from 'loro-crdt';

/**
 * @import { Nabu, NabuNode } from '../nabu.svelte.js';
 */

/**
 * @typedef {NabuNode<{type: "zone", synopsis: LoroText, status: string, wordCountTarget: number | null, title: string}>} ZoneNode
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
        this.synopsisText = this.synopsisContainer.toString();

        // Subscribe to map changes for reactive scalar fields
        data.subscribe(() => {
            this._status = data.get('status') ?? 'draft';
            this._wordCountTarget = data.get('wordCountTarget') ?? null;
            this._title = data.get('title') ?? '';
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

    /** @type {string} */
    synopsisText = $state('');

    // ── Derived ─────────────────────────────────────────────────────────────

    wordCount = $derived.by(() => {
        let count = 0;
        /** @param {import('../block.svelte.js').Block[]} blocks */
        const traverse = (blocks) => {
            for (const block of blocks) {
                const tb = block.behaviors?.get('text');
                if (tb && typeof tb.text === 'string') {
                    count += tb.text.trim().split(/\s+/).filter(Boolean).length;
                }
                // @ts-ignore — children exists on MegaBlock
                if (block.children?.length) traverse(block.children);
            }
        };
        traverse(this.children);
        return count;
    });

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

    /** Returns the LoroText container for direct CRDT mutation. */
    get synopsis() { return this.synopsisContainer; }

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
}