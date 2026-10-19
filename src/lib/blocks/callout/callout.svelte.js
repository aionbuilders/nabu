import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import CalloutComponent from "./Callout.svelte";
import { tick } from "svelte";
import { escapeAttr } from "../../utils/html.js";
import { deltaToHtml, deltaToMarkdown } from "../../behaviors/text";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "callout", text: LoroText, variant: string}>} CalloutNode
 */

export const CALLOUT_VARIANTS = ['note', 'tip', 'important', 'warning', 'caution'];

// @ts-ignore — static-side variance on create()
export class CalloutBlock extends TextBlock {
    /** @param {Nabu} nabu @param {CalloutNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.variant = node.data.get('variant') || 'note';

        this.serializers.set('markdown', () => {
            const header = '> [!' + this.variant.toUpperCase() + ']';
            const body = this.behavior.toMarkdown({ rawBreaks: true });
            if (!body) return header;
            return header + '\n' + body.split('\n').map(l => '> ' + l).join('\n');
        });
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'callout',
            props: { variant: this.variant },
            content: this.behavior.toJSON()
        }));
        this.serializers.set('application/x-nabu+json', (ctx = {}) =>
            this.behavior.toClipboardBlock({ ...ctx, props: { variant: this.variant } })
        );

        // Sync variant from Loro data changes (mirrors Heading's level sync)
        this.node.data.subscribe(() => {
            this.variant = this.node.data.get('variant') || 'note';
        });
    }

    // ── Capability flags ─────────────────────────────────────────────────────
    /** Enter inserts a literal \n (multi-line cohesive note) */
    splitsOnEnter = false;
    /** a typed "# " or "> " must NOT transform the callout away */
    transformsEnabled = false;
    // marksEnabled stays true (default) — bold/italic work inside callouts

    /** @type {string} */
    variant = $state('note');

    static placeholder = 'Callout…';

    component = $derived(this.nabu.components.get("callout") || CalloutComponent);

    /**
     * Set the callout variant and commit.
     * @param {string} v
     */
    setVariant(v) {
        if (!CALLOUT_VARIANTS.includes(v)) return;
        this.variant = v;
        /** @type {any} */ (this.node.data).set('variant', v);
        this.commit();
    }

    /**
     * Cycle to the next callout variant.
     */
    cycleVariant() {
        const i = CALLOUT_VARIANTS.indexOf(this.variant);
        this.setVariant(CALLOUT_VARIANTS[(i + 1) % CALLOUT_VARIANTS.length]);
    }

    /**
     * Handle special keydown events: ArrowDown escape.
     * Returns true if handled (engine should preventDefault).
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    keydown(event) {
        const sel = this.behavior.selection;
        if (!sel) return false;

        // ArrowDown (no modifiers, collapsed) — escape callout by creating a paragraph after
        if (event.key === 'ArrowDown' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && sel.isCollapsed) {
            const onLastLine = this.text.indexOf('\n', sel.from) === -1;
            const hasNextTextBlock = !!this.findForward(b => b.behaviors?.has('text'));
            if (onLastLine && !hasNextTextBlock) {
                const p = this.nabu.insert('paragraph', {}, this.node.parent()?.id.toString() || null, (this.node.index() ?? 0) + 1);
                this.nabu.commit().then(() => {
                    const fresh = this.nabu.blocks.get(p.id);
                    if (fresh) this.nabu.selection.setCursor(fresh, 0);
                });
                return true;
            }
            return false;
        }

        return false;
    }

    // ── Statics ──────────────────────────────────────────────────────────────

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toMarkdown(pb) {
        const v = (pb.props?.variant || 'note').toUpperCase();
        const header = '> [!' + v + ']';
        const body = deltaToMarkdown(pb.delta || [], { rawBreaks: true }); // the callout rule re-reads its own lines
        if (!body) return header;
        return header + '\n' + body.split('\n').map(l => '> ' + l).join('\n');
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        const v = escapeAttr(pb.props?.variant || 'note');
        return '<aside class="callout callout-' + v + '" data-callout="' + v + '">' + deltaToHtml(pb.delta || []) + '</aside>';
    }

    static markdownRules = [
        {
            priority: 20,
            detect: /^> \[!(note|tip|important|warning|caution)\]/i,
            /**
             * Consume the callout header line plus all subsequent ">" prefixed lines.
             * @param {string[]} lines
             * @param {number} i
             * @returns {number}
             */
            consume(lines, i) {
                let j = i + 1;
                while (j < lines.length && /^>\s?/.test(lines[j])) j++;
                return j - i;
            }
        }
    ];

    /**
     * @param {string[]} lines
     * @param {{ parseInline: (text: string) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines, { parseInline }) {
        const m = lines[0].match(/^> \[!(\w+)\]/i);
        if (!m) return null;
        let variant = m[1].toLowerCase();
        if (!CALLOUT_VARIANTS.includes(variant)) variant = 'note';
        const body = lines.slice(1).map(l => l.replace(/^>\s?/, '')).join('\n');
        const delta = parseInline(body);
        return { type: 'callout', props: { variant }, delta, partial: false };
    }

    static htmlRules = [
        { selector: '[data-callout]', priority: 20 },
        { selector: 'aside.callout', priority: 20 },
    ];

    /**
     * @param {Element} el
     * @param {{ parseInline: (el: Element) => import('loro-crdt').Delta<string>[] }} helpers
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el, { parseInline }) {
        let variant = el.getAttribute('data-callout') || (el.className.match(/callout-(\w+)/)?.[1]) || 'note';
        if (!CALLOUT_VARIANTS.includes(variant)) variant = 'note';
        const delta = parseInline(el);
        return { type: 'callout', props: { variant }, delta, partial: false };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
        /** @type {any} */ (node.data).set('type', 'callout');
        const variant = CALLOUT_VARIANTS.includes(props.variant) ? props.variant : 'note';
        /** @type {any} */ (node.data).set('variant', variant);
        const container = /** @type {any} */ (node.data).setContainer('text', new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        return new CalloutBlock(nabu, /** @type {CalloutNode} */ (/** @type {unknown} */ (node)));
    }
}
