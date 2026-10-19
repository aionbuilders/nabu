import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import CodeComponent from "./Code.svelte";
import { tick } from "svelte";
import { escapeHtml } from "../../utils/html.js";

/**
 * @import { Nabu, NabuNode } from "../nabu.svelte.js";
 */

/**
 * @typedef {NabuNode<{type: "code", text: LoroText, language: string | null}>} CodeNode
 */

/**
 * Plain-text content of a PasteBlock (joins all string inserts, ignores embeds).
 * @param {import('../../utils/extensions.js').PasteBlock} pb
 * @returns {string}
 */
function pbText(pb) {
    return (pb.delta || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('');
}

/** The opening fence of a code block: indent, fence characters, info string. */
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Whether `line` closes the fence `open` (same character, at least as long, only spaces after it).
 * @param {string} line
 * @param {string} open
 */
function isClosingFence(line, open) {
    const m = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
    return !!m && m[1][0] === open[0] && m[1].length >= open.length;
}

// @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
/**
 * A fenced code block as markdown. The fence is longer than any run of backticks in the code (a code block that holds a
 * fence round-trips); the info string is the language, without whitespace or backtick (it could not be read back).
 * @param {string | null | undefined} language
 * @param {string} text
 * @returns {string}
 */
function codeToMarkdown(language, text) {
    const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return fence + String(language || '').replace(/[\s`]/g, '') + '\n' + text + '\n' + fence;
}

export class CodeBlock extends TextBlock {
    /** @param {Nabu} nabu @param {CodeNode} node */
    constructor(nabu, node) {
        super(nabu, node);

        this.language = node.data.get('language') || null;

        this.serializers.set('markdown', () => codeToMarkdown(this.language, this.text));
        this.serializers.set('json', () => ({
            id: this.id,
            type: 'code',
            props: { language: this.language },
            content: this.text,
        }));
        this.serializers.set('application/x-nabu+json', (ctx = {}) =>
            this.behavior.toClipboardBlock({ ...ctx, props: { language: this.language } })
        );

        // Sync language from Loro data changes (mirrors Heading's level sync)
        this.node.data.subscribe(() => {
            this.language = this.node.data.get('language') || null;
        });
    }

    // ── Capability flags ─────────────────────────────────────────────────────
    /** @type {boolean} */
    splitsOnEnter = false;
    /** @type {boolean} */
    transformsEnabled = false;
    /** @type {boolean} */
    marksEnabled = false;
    /** @type {boolean} */
    pastesAsPlainText = true;

    /** @type {string | null} */
    language = $state(null);

    static placeholder = 'Code…';

    component = $derived(this.nabu.components.get("code") || CodeComponent);

    /**
     * Set the code language and commit.
     * @param {string | null} lang
     */
    setLanguage(lang) {
        this.language = lang || null;
        /** @type {any} */ (this.node.data).set('language', lang || null);
        this.commit();
    }

    /**
     * Handle special keydown events: Tab, Shift+Tab, ArrowDown.
     * Returns true if handled (engine should preventDefault).
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    keydown(event) {
        const sel = this.behavior.selection;
        if (!sel) return false;

        // Tab without shift — insert 2 spaces
        if (event.key === 'Tab' && !event.shiftKey) {
            if (!sel.isCollapsed) this.behavior.delete({ index: sel.from, length: sel.to - sel.from });
            this.behavior.insert(sel.from, '  ');
            this.commit();
            tick().then(() => this.nabu.selection.setCursor(this, sel.from + 2));
            return true;
        }

        // Shift+Tab — outdent (remove up to 2 leading spaces on current line)
        if (event.key === 'Tab' && event.shiftKey) {
            const ls = this.text.lastIndexOf('\n', sel.from - 1) + 1;
            let n = 0;
            while (n < 2 && this.text[ls + n] === ' ') n++;
            if (n > 0) {
                this.behavior.delete({ index: ls, length: n });
                this.commit();
                tick().then(() => this.nabu.selection.setCursor(this, Math.max(ls, sel.from - n)));
            }
            return true;
        }

        // ArrowDown (no modifiers, collapsed) — escape code block by creating a paragraph after
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
        return codeToMarkdown(pb.props?.language, pbText(pb));
    }

    /** @param {import('../../utils/extensions.js').PasteBlock} pb */
    static toHtml(pb) {
        return `<pre><code>${escapeHtml(pbText(pb))}</code></pre>`;
    }

    /**
     * Fenced code (CommonMark): 3+ backticks or 3+ tildes (up to 3 spaces of indent), an optional info string (the first
     * word is the language), closed by a fence of the SAME character at least as long. An unclosed fence runs to the end.
     * The content is verbatim (no inline parsing, blank lines kept). An indented block (4 spaces) is NOT code.
     */
    static markdownRules = [
        {
            priority: 30,
            interruptsParagraph: true,
            // A backtick fence has no backtick in its info string (otherwise it is an inline code span: ```a```).
            detect: /^ {0,3}(?:`{3,}[^`]*|~{3,}.*)$/,
            /**
             * Consume from the opening fence to the closing fence (or EOF).
             * @param {string[]} lines
             * @param {number} i
             * @returns {number}
             */
            consume(lines, i) {
                const open = FENCE_OPEN.exec(lines[i]);
                if (!open) return 1;
                let j = i + 1;
                while (j < lines.length && !isClosingFence(lines[j], open[2])) j++;
                return Math.min(lines.length, j + 1) - i;
            },
        }
    ];

    /**
     * @param {string[]} lines
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromMarkdown(lines) {
        const open = FENCE_OPEN.exec(lines[0]);
        if (!open) return null;
        const language = open[3].trim().split(/\s+/)[0] || null;
        let body = lines.slice(1);
        // The closing fence is the last line, when it closes this fence (consume stops at the first closer).
        if (body.length > 0 && isClosingFence(body[body.length - 1], open[2])) body = body.slice(0, -1);
        // An indented opening fence removes up to that many spaces from the content lines.
        const indent = open[1].length;
        if (indent) body = body.map((line) => line.replace(new RegExp('^ {0,' + indent + '}'), ''));
        const bodyText = body.join('\n');
        // Empty body is still a valid code block
        if (!bodyText && body.length === 0 && lines.length === 1) return null;
        return {
            type: 'code',
            props: { language },
            delta: [{ insert: bodyText }],
            partial: false,
        };
    }

    static htmlRules = [
        { selector: 'pre', priority: 10 },
    ];

    /**
     * @param {Element} el
     * @returns {import('../../utils/extensions.js').PasteBlock | null}
     */
    static fromHTML(el) {
        const text = el.textContent || '';
        const language = el.querySelector('code')?.className.match(/language-(\w+)/)?.[1] || null;
        return {
            type: 'code',
            props: { language },
            delta: [{ insert: text }],
            partial: false,
        };
    }

    /** @param {Nabu} nabu @param {string} type @param {Object} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
        /** @type {any} */ (node.data).set('type', 'code');
        if (props.language) /** @type {any} */ (node.data).set('language', props.language);
        const container = /** @type {any} */ (node.data).setContainer('text', new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        return new CodeBlock(nabu, /** @type {CodeNode} */ (/** @type {unknown} */ (node)));
    }
}
