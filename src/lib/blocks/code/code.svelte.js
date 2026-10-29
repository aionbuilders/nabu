import { TextBlock } from "../text-block.svelte.js";
import { LoroText } from "loro-crdt";
import CodeComponent from "./Code.svelte";
import { tick } from "svelte";
import { escapeHtml } from "../../utils/html.js";
import { INDENT, leadingIndent, indentLines, outdentLines, lineStart } from "./indent.js";

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

/** What a language name may hold: a word, plus what real ones use (`c++`, `c#`, `objective-c`, `vue.js`). */
export const LANGUAGE_CHARS = '[\\w#+.-]';

/**
 * The language a `<pre>` (or its `<code>`, or the wrapper of a highlighter) declares: `language-js` / `lang-js` classes (Markdown
 * renderers, Prism, highlight.js, Shiki), GitHub's `highlight-source-js` wrapper, a `data-language` / `data-lang` attribute.
 * @param {Element} pre
 * @returns {string | null}
 */
function languageOf(pre) {
    const code = pre.querySelector('code');
    const own = new RegExp('(?:^|\\s)(?:language|lang)-(' + LANGUAGE_CHARS + '+)');
    for (const el of [code, pre]) {
        const m = el && own.exec(el.getAttribute('class') || '');
        if (m) return m[1];
    }
    for (const el of [code, pre]) {
        const attr = el?.getAttribute('data-language') || el?.getAttribute('data-lang');
        if (attr && new RegExp('^' + LANGUAGE_CHARS + '+$').test(attr)) return attr;
    }
    // The wrapper of a highlighter: only its explicit names (a `lang-selector` class there would not be a language).
    const wrapper = new RegExp('(?:^|\\s)(?:language-(' + LANGUAGE_CHARS + '+)|highlight-source-([\\w-]+))').exec(pre.parentElement?.getAttribute('class') || '');
    return wrapper ? (wrapper[1] || wrapper[2]) : null;
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
     * Put the selection back on model offsets once the edit is rendered (`backward`: the focus is the start).
     * @param {number} from @param {number} to @param {boolean} [backward]
     */
    #select(from, to, backward = false) {
        tick().then(() => {
            if (from === to) return this.nabu.selection.setCursor(this, from);
            const a = this.getDOMPoint(backward ? to : from);
            const f = this.getDOMPoint(backward ? from : to);
            if (a && f) this.nabu.selection.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
        });
    }

    /**
     * Enter keeps the indentation of the line (auto-indent): the new line starts with the same spaces / tabs, up to the caret.
     * Every other input is the text behavior's (Enter without indentation inserts a plain "\n").
     * @param {InputEvent} event
     */
    beforeinput(event) {
        if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
            const sel = this.behavior.selection;
            const indent = sel ? leadingIndent(this.text, sel.from) : '';
            if (sel && indent) {
                if (!sel.isCollapsed) this.behavior.delete({ index: sel.from, length: sel.to - sel.from });
                this.behavior.insert(sel.from, '\n' + indent);
                this.commit();
                this.#select(sel.from + 1 + indent.length, sel.from + 1 + indent.length);
                return true;
            }
        }
        return super.beforeinput(event);
    }

    /**
     * Apply an indent plan (see indent.js) as one commit and keep the selection on the same characters.
     * @param {import('./indent.js').IndentPlan} plan @param {boolean} backward
     */
    #apply(plan, backward) {
        for (const { index, remove, insert } of plan.edits) {
            if (remove) this.behavior.delete({ index, length: remove });
            if (insert) this.behavior.insert(index, insert);
        }
        this.commit();
        this.#select(plan.from, plan.to, backward);
    }

    /**
     * Handle special keydown events: Tab, Shift+Tab (except the one that follows an Escape), Ctrl+A, ArrowUp / ArrowDown at the edges of the block.
     * Returns true if handled (engine should preventDefault).
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    keydown(event) {
        const sel = this.behavior.selection;
        if (!sel) return false;
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        const backward = sel.direction === 'backward';

        // The way out (WCAG 2.1.2): Tab / Shift+Tab right after an Escape nobody consumed is not the code's. Forward, the browser moves the
        // focus out of the editor. Backward, it would go before the editor and never reach the language select, so the focus goes there.
        if (event.key === 'Tab' && this.nabu.tabWayOut) {
            if (!event.shiftKey) return false;
            const select = /** @type {HTMLSelectElement | null | undefined} */ (this.element?.parentElement?.querySelector('select.nabu-code-lang'));
            if (!select || select.disabled) return false;
            select.focus();
            return true;
        }

        // Tab without shift: over several lines, indent every line; else insert 2 spaces (replacing a selection within one line)
        if (event.key === 'Tab' && !event.shiftKey) {
            const plan = indentLines(this.text, sel.from, sel.to);
            if (plan) { this.#apply(plan, backward); return true; }
            if (!sel.isCollapsed) this.behavior.delete({ index: sel.from, length: sel.to - sel.from });
            this.behavior.insert(sel.from, INDENT);
            this.commit();
            this.#select(sel.from + INDENT.length, sel.from + INDENT.length);
            return true;
        }

        // Shift+Tab: outdent every line the selection touches (the caret's own line when collapsed)
        if (event.key === 'Tab' && event.shiftKey) {
            const plan = outdentLines(this.text, sel.from, sel.to);
            if (plan) this.#apply(plan, backward);
            return true;
        }

        // Ctrl/Cmd+A: the code first, the whole document with the next press (the browser's own Select All)
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && typeof event.key === 'string' && event.key.toLowerCase() === 'a') {
            const length = this.text.length;
            if (length && !(sel.from === 0 && sel.to === length)) {
                this.nabu.selection.selectBlockText(this);
                return true;
            }
            return false;
        }

        // ArrowDown from the last line / ArrowUp from the first one, with no text block beyond: a paragraph is created there, so
        // that a code block at the end (start) of the document, or before a divider, can be left with the keyboard.
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain && sel.isCollapsed) {
            const down = event.key === 'ArrowDown';
            const onEdge = down ? this.text.indexOf('\n', sel.from) === -1 : lineStart(this.text, sel.from) === 0;
            const hasNeighbour = !!(down ? this.findForward(b => b.behaviors?.has('text')) : this.findBackward(b => b.behaviors?.has('text')));
            if (onEdge && !hasNeighbour) {
                const p = this.nabu.insert('paragraph', {}, this.node.parent()?.id.toString() || null, (this.node.index() ?? 0) + (down ? 1 : 0));
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
        const language = String(pb.props?.language || '');
        const cls = new RegExp('^' + LANGUAGE_CHARS + '+$').test(language) ? ` class="language-${language}"` : '';
        return `<pre><code${cls}>${escapeHtml(pbText(pb))}</code></pre>`;
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
        // A <br> in a <pre> is a line break (old sites, some editors); textContent alone would glue the lines.
        const copy = /** @type {Element} */ (el.cloneNode(true));
        for (const br of copy.querySelectorAll('br')) br.replaceWith('\n');
        const text = copy.textContent || '';
        const language = languageOf(el);
        return {
            type: 'code',
            props: { language },
            delta: [{ insert: text }],
            partial: false,
        };
    }

    /** @param {Nabu} nabu @param {string} type @param {Record<string, any>} [props={}] @param {string|null} [parentId=null] @param {number|null} [index=null] */
    static create(nabu, type, props = {}, parentId = null, index = null) {
        const node = nabu.tree.createNode(/** @type {import('loro-crdt').TreeID | undefined} */ (parentId || undefined), index ?? undefined);
        /** @type {any} */ (node.data).set('type', 'code');
        if (props.language) /** @type {any} */ (node.data).set('language', props.language);
        const container = /** @type {any} */ (node.data).setContainer('text', new LoroText());
        if (props.text) container.insert(0, props.text);
        if (props.delta) container.applyDelta([...props.delta]);
        return new CodeBlock(nabu, /** @type {CodeNode} */ (/** @type {unknown} */ (node)));
    }
}
