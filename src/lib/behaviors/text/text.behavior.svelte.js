/**
* @import {NabuNode, Block, NabuSelection} from "../../blocks";
*/

import { LoroText } from "loro-crdt";
import { tick } from "svelte";
import { escapeHtml, escapeAttr, sanitizeUrl } from "../../utils/html.js";
import { escapeMarkdownText, escapeBlockStart } from "./markdown-syntax.js";
import { countWords } from "../../utils/words.js";

/**
 * Converts a Loro text delta to inline HTML.
 * Marks are rendered as semantic HTML tags.
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @returns {string}
 */
export function deltaToHtml(delta) {
    return delta.map(op => {
        if (typeof op.insert !== 'string') return '';
        let text = escapeHtml(op.insert);
        const attrs = op.attributes || {};
        if (attrs.code)          text = `<code>${text}</code>`;
        if (attrs.bold)          text = `<strong>${text}</strong>`;
        if (attrs.italic)        text = `<em>${text}</em>`;
        if (attrs.underline)     text = `<u>${text}</u>`;
        if (attrs.strikethrough) text = `<s>${text}</s>`;
        if (attrs.link) {
            // An unsafe href (javascript:, data:…) never becomes a live link: the label survives, the <a> does not.
            const href = sanitizeUrl(attrs.link, { kind: 'link' });
            if (href !== null) text = `<a href="${escapeAttr(href)}">${text}</a>`;
        }
        return text;
    }).join('');
}

/**
 * Converts a Loro text delta to inline Markdown.
 * A line break (`\n` in the text) is exported as a markdown hard break (backslash + newline), unless `rawBreaks`
 * (a block that re-reads its own lines, like a callout body, keeps the plain newline).
 * @param {import('loro-crdt').Delta<string>[]} delta
 * @param {{ rawBreaks?: boolean }} [options]
 * @returns {string}
 */
export function deltaToMarkdown(delta, { rawBreaks = false } = {}) {
    const ops = delta.filter((op) => typeof op.insert === 'string' && op.insert);
    let out = '';
    for (let i = 0; i < ops.length;) {
        const link = ops[i].attributes?.link;
        let j = i + 1;
        while (j < ops.length && ops[j].attributes?.link === link) j++;
        const run = markdownRuns(ops.slice(i, j), rawBreaks); // same href (or none): ONE `[…](href)`, marks inside
        out += link ? `[${run}](${markdownDestination(String(link))})` : run;
        i = j;
    }
    return escapeBlockStart(out);
}

/** Mark delimiters, outermost first (nesting order). Code is not here: a code span takes no other mark. */
const MARK_DELIMITERS = /** @type {const} */ ([
    ['underline', '<u>', '</u>'],
    ['strikethrough', '~~', '~~'],
    ['bold', '**', '**'],
    ['italic', '*', '*'],
]);

/**
 * Runs of text (no link boundary inside) as markdown. A mark spanning several runs is ONE delimiter pair
 * (`**a *b* c**`); whitespace at the edge of a span moves outside the delimiters (`**a **` would not parse).
 * @param {any[]} ops
 * @param {boolean} rawBreaks
 * @returns {string}
 */
function markdownRuns(ops, rawBreaks) {
    /** @type {Array<{ text?: string, raw?: boolean, open?: string, close?: string }>} */
    let tokens = [];
    /** @type {number[]} */
    let active = [];
    const closeFrom = (/** @type {number} */ k) => {
        for (let j = active.length - 1; j >= k; j--) tokens.push({ close: MARK_DELIMITERS[active[j]][2] });
        active = active.slice(0, k);
    };
    for (const op of ops) {
        const attrs = op.attributes || {};
        if (attrs.code) { closeFrom(0); tokens.push({ text: markdownCodeSpan(op.insert), raw: true }); continue; }
        const want = MARK_DELIMITERS.map((m, idx) => (attrs[m[0]] ? idx : -1)).filter((idx) => idx >= 0);
        let k = 0;
        while (k < active.length && k < want.length && active[k] === want[k]) k++;
        closeFrom(k);
        for (let j = k; j < want.length; j++) tokens.push({ open: MARK_DELIMITERS[want[j]][1] });
        active = want;
        tokens.push({ text: op.insert });
    }
    closeFrom(0);

    // Whitespace at the inner edge of a delimiter run moves outside it.
    for (let t = 0; t < tokens.length; t++) {
        if (tokens[t].open !== undefined && tokens[t - 1]?.open === undefined) {
            let j = t;
            while (tokens[j + 1]?.open !== undefined) j++;
            const next = tokens[j + 1];
            const m = next && next.text !== undefined && !next.raw ? /^\s+/.exec(next.text) : null;
            if (next && m) { next.text = /** @type {string} */ (next.text).slice(m[0].length); tokens.splice(t, 0, { text: m[0] }); t += 1; }
        } else if (tokens[t].close !== undefined && tokens[t - 1]?.close === undefined) {
            let j = t;
            while (tokens[j + 1]?.close !== undefined) j++;
            const prev = tokens[t - 1];
            const m = prev && prev.text !== undefined && !prev.raw ? /\s+$/.exec(prev.text) : null;
            if (prev && m) { prev.text = /** @type {string} */ (prev.text).slice(0, -m[0].length); tokens.splice(j + 1, 0, { text: m[0] }); }
        }
    }
    // Drop the delimiter pairs left empty.
    tokens = tokens.filter((tk) => tk.text !== '');
    for (let t = 0; t < tokens.length - 1;) {
        if (tokens[t].open !== undefined && tokens[t + 1].close !== undefined) { tokens.splice(t, 2); t = Math.max(0, t - 1); } else t++;
    }
    return tokens.map((tk) => tk.open ?? tk.close ?? (tk.raw ? tk.text : escapeMarkdownText(/** @type {string} */ (tk.text)).replace(/\n/g, rawBreaks ? '\n' : '\\\n'))).join('');
}

/** A code span: a backtick fence longer than any run inside, padded when the text touches a backtick or is space-wrapped. */
function markdownCodeSpan(/** @type {string} */ text) {
    const runs = new Set((text.match(/`+/g) || []).map((r) => r.length));
    let n = 1;
    while (runs.has(n)) n++;
    const fence = '`'.repeat(n);
    const pad = /^`|`$/.test(text) || (text.startsWith(' ') && text.endsWith(' ') && text.trim()) ? ' ' : '';
    return fence + pad + text + pad + fence;
}

/** A link destination: raw when plain, `<…>` when it holds whitespace, angle brackets or unbalanced parentheses. */
export function markdownDestination(/** @type {string} */ href) {
    let depth = 0;
    let balanced = true;
    for (const ch of href) {
        if (ch === '(') depth++;
        else if (ch === ')' && --depth < 0) balanced = false;
    }
    if (!href || depth !== 0 || !balanced || /[\s<>\u0000-\u001f]/.test(href)) return '<' + href.replace(/[<>\\]/g, (m) => '\\' + m) + '>';
    return href.replace(/\\/g, '\\\\');
}

/**
* @typedef {NabuNode<{type: "paragraph", text: LoroText}>} TextNode
*/

/** @type {Intl.Segmenter | null} */
const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/**
 * Length (UTF-16 units) of the user-perceived character starting at `index` — the unit one Delete press removes.
 * `Intl.Segmenter` handles ZWJ sequences, flags and combining marks; without it a surrogate pair is kept whole.
 * A caret inside a cluster deletes up to the end of that cluster. 0 at the end of the text.
 * @param {string} text @param {number} index
 */
export function nextGraphemeLength(text, index) {
    if (index < 0 || index >= text.length) return 0;
    if (graphemeSegmenter) {
        const seg = graphemeSegmenter.segment(text).containing(index);
        if (seg) return seg.index + seg.segment.length - index;
    }
    const code = text.charCodeAt(index);
    const low = text.charCodeAt(index + 1);
    return code >= 0xD800 && code <= 0xDBFF && low >= 0xDC00 && low <= 0xDFFF ? 2 : 1;
}

/**
 * Length (UTF-16 units) of the user-perceived character ENDING at `index` — the unit one Backspace press removes.
 * Mirror of {@link nextGraphemeLength}: `Intl.Segmenter` handles ZWJ sequences, flags and combining marks; without it a
 * surrogate pair is kept whole. A caret inside a cluster deletes back to the start of that cluster. 0 at the start.
 * @param {string} text @param {number} index
 */
export function prevGraphemeLength(text, index) {
    if (index <= 0 || index > text.length) return 0;
    if (graphemeSegmenter) {
        const seg = graphemeSegmenter.segment(text).containing(index - 1);
        if (seg) return index - seg.index;
    }
    const low = text.charCodeAt(index - 1);
    const high = text.charCodeAt(index - 2);
    return low >= 0xDC00 && low <= 0xDFFF && high >= 0xD800 && high <= 0xDBFF ? 2 : 1;
}

/**
 * The editing of a block's rich text: wraps a Loro text and offers the reactive `text` and `delta`, the selection in that text, and insertion, deletion, splitting, marks and links. Text blocks use it through `TextBlock`; a container with a header (list item, toggle) owns one.
 */
export class TextBehavior {
    /** @param {Block} block @param {LoroText} [container] */
    constructor(block, container) {
        /** @public */
        this.block = block;
        this.nabu = block.nabu;
        const node = /** @type {TextNode} */ (block.node);
        /**
         * @type {LoroText}
         * @public
         */
        this.container = container ?? node.data.get("text") ?? node.data.setContainer("text", new LoroText());
        /** @public */
        this.text = $state(this.container.toString());
        /** @public */
        this.delta = $state(this.container.toDelta());
        this.container.subscribe(() => {
            this.text = this.container.toString();
            this.delta = this.container.toDelta();
            this.nabu.noteTextChange?.(this.block); // a selection end in this block must follow the edit (P-109)
        });
    }
    
    /** @public */
    selection = $derived(this.block.element && this.block.nabu.selection && this.getSelection(this.block.element, this.block.nabu.selection));

    /** @public */
    positions = $derived(this.text.length + 1);

    /**
     * Number of words in this text: segmented with `Intl.Segmenter` in the language of the editor (`nabu.lang`) when the platform
     * has it, so Chinese or Japanese text counts its words rather than one per sentence; whitespace-separated otherwise. See
     * `utils/words.js`. Reactive in the text and in `nabu.lang`.
     * @returns {number}
     * @public
     */
    get wordCount() {
        return countWords(this.text, this.nabu?.lang);
    }
    
    /**
    * @param {HTMLElement} element 
    * @param {NabuSelection} globalSelection 
    */
    getSelection(element, globalSelection) {
        if (!this.block.selected || !element || !globalSelection) return null;
        
        const globalRange = globalSelection.firstRange;
        if (!globalRange) return null;
        
        const containsStart = element.contains(globalRange.startContainer);
        const containsEnd = element.contains(globalRange.endContainer);
        
        let from = 0;
        let to = this.text.length;
        
        if (containsStart) {
            from = this.modelOffset(globalRange.startContainer, globalRange.startOffset);
        }
        
        if (containsEnd) {
            to = this.modelOffset(globalRange.endContainer, globalRange.endOffset);
        }
        
        return {
            from,
            to,
            isCollapsed: from === to,
            direction: globalSelection.direction,
        };
    }
    
    /**
    * Calcule l'offset textuel d'un point DOM par rapport au début de ce bloc
    * @param {Node} node 
    * @param {number} offset 
    * @param {HTMLElement?} [element]
    */
    calculateOffset(node, offset, element = this.block.element) {
        if (!element) return 0;
        const range = document.createRange();
        range.setStart(element, 0);
        range.setEnd(node, offset);
        return range.toString().length;
    }

    /**
     * {@link TextBehavior#calculateOffset} bounded by the MODEL text: an empty text renders a lone "\n" placeholder, and a caret
     * after it is still offset 0, not 1 (P-108). (Not during an IME composition: the browser's text is ahead of the model then.)
     * @param {Node} node @param {number} offset @param {HTMLElement?} [element]
     */
    modelOffset(node, offset, element = this.block.element) {
        const at = this.calculateOffset(node, offset, element);
        return this.nabu.composing ? at : Math.min(at, this.text.length);
    }

    /** The render of an EMPTY block when an IME composition started (Svelte's own child nodes and their text), to put back if it is canceled. @type {{ nodes: Node[], data: string[] } | null} */
    #emptySnapshot = null;

    /** Svelte's own nodes around a trailing render filler when an IME composition started: its text nodes and the filler with its place. @type {{ texts: Set<Node>, filler: Element, parent: Node, next: Node | null } | null} */
    #compositionSnapshot = null;

    /**
     * IME composition starts. With a trailing render filler (`<br data-nabu-filler>`, the empty last line after a "\n")
     * the browser puts the composed text in a NEW text node before the filler (and may swap the filler for a `<br>` of
     * its own) — nodes Svelte does not know, which would stay next to the ones it updates once the model catches up
     * (text shown twice). Remember Svelte's nodes so {@link TextBehavior#restoreAfterComposition} can undo the browser's
     * additions at the end. No filler: nothing to do.
     */
    snapshotForComposition() {
        const element = this.block.element;
        this.#compositionSnapshot = null;
        this.#emptySnapshot = null;
        // An EMPTY block renders a lone "\n" text node: a canceled composition makes the browser swap it for a <br> (caret lost).
        if (element && !this.text) {
            const nodes = [...element.childNodes];
            this.#emptySnapshot = { nodes, data: nodes.map((n) => n.nodeType === Node.TEXT_NODE ? /** @type {Text} */ (n).data : '') };
            return;
        }
        const filler = element?.querySelector('[data-nabu-filler]');
        if (!element || !filler?.parentNode) return;
        const texts = new Set();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.add(n);
        this.#compositionSnapshot = { texts, filler, parent: filler.parentNode, next: filler.nextSibling };
    }

    /**
     * End of a composition begun next to a filler, BEFORE the composed text reaches the model: remove the text nodes and
     * `<br>` the browser created meanwhile (the composed text is committed to the model, which the next render shows
     * through Svelte's own nodes); a canceled composition (`composedText` empty) gets its filler back.
     * @param {string} composedText
     */
    restoreAfterComposition(composedText) {
        const snap = this.#compositionSnapshot;
        this.#compositionSnapshot = null;
        const element = this.block.element;
        const empty = this.#emptySnapshot;
        this.#emptySnapshot = null;
        if (empty && element && !composedText) {
            // Canceled in an empty block: the render text node (not a browser <br>) with its text, as Svelte left it.
            element.replaceChildren(...empty.nodes);
            empty.nodes.forEach((n, i) => { if (n.nodeType === Node.TEXT_NODE && /** @type {Text} */ (n).data !== empty.data[i]) /** @type {Text} */ (n).data = empty.data[i]; });
            return;
        }
        if (!snap || !element) return;
        /** @type {Node[]} */
        const stray = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!snap.texts.has(n)) stray.push(n);
        for (const br of element.querySelectorAll('br')) if (br !== snap.filler) stray.push(br);
        for (const n of stray) n.parentNode?.removeChild(n);
        if (!composedText && !snap.filler.isConnected) {
            snap.parent.insertBefore(snap.filler, snap.next?.parentNode === snap.parent ? snap.next : null);
        }
    }

    /**
     * @param {InputEvent} event
     * @param {ReturnType<TextBehavior["getSelection"]>} [selection]
     * @public
     */
    handleBeforeInput(event, selection = this.selection) {
        // Hook system (Markdown shortcuts, de-transformation, structural guards…).
        // `transformsEnabled: false` (e.g. code blocks) only suppresses transforms,
        // which fire on insertions — deletion hooks (block exit, structural guards) still run.
        const isInsertion = event.inputType === "insertText"
            || event.inputType === "insertParagraph"
            || event.inputType === "insertLineBreak"
            || event.inputType === "insertSoftLineBreak";
        const hooks = (this.block.transformsEnabled === false && isInsertion)
            ? null
            : this.nabu.hooks.get("onBeforeInput");
        if (hooks) {
            for (const hook of hooks) {
                const result = hook(this.nabu, event, this.block);
                if (result === this.nabu.BREAK) {
                    event.preventDefault();
                    return true; 
                }
            }
        }

        switch (event.inputType) {
            case "insertText":
                return this.handleInsertText(event, selection);
            case "insertLineBreak":
            case "insertSoftLineBreak":
                return this.handleInsertLineBreak(event, selection);
            case "deleteContentBackward":
                return this.handleDeleteContentBackward(event, selection);
            case "deleteContentForward":
                return this.handleDeleteContentForward(event, selection);
            case "deleteWordBackward":
                return this.handleDeleteWordBackward(event, selection);
            case "deleteWordForward":
                return this.handleDeleteWordForward(event, selection);
            case "deleteSoftLineBackward":
            case "deleteHardLineBackward":
                return this.handleDeleteSoftLineBackward(event, selection);
            case "deleteSoftLineForward":
            case "deleteHardLineForward":
                return this.handleDeleteSoftLineForward(event, selection);
            case "deleteEntireSoftLine":
            case "deleteEntireHardLine":
                return this.handleDeleteEntireLine(event, selection);
            case "deleteContent":
                return this.handleDeleteContent(event, selection);
            case "insertReplacementText":
                return this.handleInsertReplacementText(event, selection);
            case "insertFromYank":
                return this.handleInsertFromYank(event, selection);
            case "insertTranspose":
                return this.handleInsertTranspose(event, selection);
            case "formatBold":
            case "formatItalic":
            case "formatUnderline":
            case "formatStrikeThrough":
            case "formatSubscript":
            case "formatSuperscript":
            case "formatRemove":
                // Formatting is the rich-text extension's business (its `onBeforeInput` hook already ran); without it: nothing.
                event.preventDefault();
                return true;
            case "insertParagraph":
                return this.handleInsertParagraph(event, selection);
            case "historyUndo":
            case "historyRedo":
                // Handled by the keydown handler (Ctrl+Z / Ctrl+Y) via UndoManager.
                event.preventDefault();
                return true;
            default:
                this.nabu.warn("Unhandled input type:", event.inputType);
                return;
        }
    }
    
    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [selection] */
    handleInsertText(event, selection = this.selection) {
        if (!selection) return;

        let textToInsert = event.data || "";

        // Declarative input rules (typography, markdown shortcuts…)
        if (selection.isCollapsed && this.block.transformsEnabled !== false) {
            const textBeforeCursor = this.text.slice(0, selection.from);
            for (const rule of this.nabu.inputRules) {
                if ((rule.inputType ?? "insertText") !== event.inputType) continue;
                const match = textBeforeCursor.match(rule.pattern);
                if (!match) continue;
                if (rule.handler(this.nabu, this.block, match, { ...selection, data: textToInsert }) === true) {
                    this.nabu.storedMarks = null;
                    this.block.commit();
                    // Clamp to the post-mutation text length: rules that shrink the text
                    // (e.g. markdown **bold** → bold) would otherwise restore the cursor
                    // past the end, hitting getDOMPoint's element fallback → the selection
                    // normalizer ejects the caret out of the block, losing all further input.
                    tick().then(() => this.nabu.selection.setCursor(this.block, Math.min(selection.from, this.text.length)));
                    return true;
                }
            }
        }

        if (!selection.isCollapsed) this.delete({index: selection.from, length: selection.to - selection.from}, selection);
        this.insert(selection.from, textToInsert);
        // Apply the cursor's pending stored marks to the inserted text.
        const stored = this.nabu.storedMarks;
        if (stored && textToInsert) {
            const range = { from: selection.from, to: selection.from + textToInsert.length, isCollapsed: false };
            for (const [name, on] of Object.entries(stored)) {
                if (on) this.applyMark(name, true, range);
                else this.removeMark(name, range);
            }
        }
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, selection.from + textToInsert.length));
    }
    
    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleInsertLineBreak(event, sel = this.selection) {
        if (!sel) return;
        if (!sel.isCollapsed) {
            this.delete({index: sel.from, length: sel.to - sel.from}, sel);
        }
        this.insert(sel.from, "\n");
        this.block.commit();
        
        tick().then(() => this.nabu.selection.setCursor(this.block, sel.from + 1));
    }
    
    /**
     * Whether an extension vetoes the merge of two text blocks that Backspace / Delete at a block boundary is about to do
     * (the `onBeforeMerge(nabu, survivor, victim)` hook; returning `nabu.BREAK` refuses: nothing is merged, nothing is
     * deleted). The engine names no reason: an extension may protect a structural boundary between the two blocks.
     * @param {Block} survivor @param {Block} victim
     */
    #mergeRefused(survivor, victim) {
        const hooks = this.nabu.hooks.get("onBeforeMerge");
        if (!hooks) return false;
        for (const hook of hooks) if (hook(this.nabu, survivor, victim) === this.nabu.BREAK) return true;
        return false;
    }

    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleDeleteContentBackward(event, sel = this.selection) {
        if (!sel) return;
        if (sel.isCollapsed && sel.from === 0) {
            const previousBlock = this.block.findBackward(b => b.behaviors.has("text") && b.behaviors.get("text") instanceof TextBehavior);
            if (!previousBlock) return;
            const previousBehavior = previousBlock?.behaviors.get("text");
            if (previousBehavior && previousBehavior instanceof TextBehavior) {
                event.preventDefault();
                if (this.#mergeRefused(previousBlock, this.block)) return true;
                const previousLength = previousBehavior.text.length;
                // previousBehavior.delta([
                //     { retain: previousLength },
                //     ...this.container.toDelta()
                // ])
                previousBlock.consume(this.block);
                this.block.destroy();
                this.block.commit();
                
                tick().then(() => this.nabu.selection.setCursor(previousBehavior.block, previousLength));
            }
        } else {
            event.preventDefault();
            // A collapsed caret deletes the PREVIOUS grapheme cluster (a ZWJ emoji, a flag, a letter + combining accent,
            // a surrogate pair — never half of one); a selection inside the block is deleted whole.
            const length = sel.isCollapsed ? prevGraphemeLength(this.text, sel.from) : sel.to - sel.from;
            const index = sel.isCollapsed ? sel.from - length : sel.from;
            if (length <= 0) return true;
            this.delete({index, length});
            this.block.commit();
            
            tick().then(() => this.nabu.selection.setCursor(this.block, index));
        }
    }


    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleDeleteContentForward(event, sel = this.selection) {
        if (!sel) return;
        if (sel.isCollapsed && sel.from === this.text.length) {
            const nextBlock = this.block.findForward(b => b.behaviors.has("text") && b.behaviors.get("text") instanceof TextBehavior);
            if (!nextBlock) return;
            const nextBehavior = nextBlock?.behaviors.get("text");
            if (nextBehavior && nextBehavior instanceof TextBehavior) {
                event.preventDefault();
                if (this.#mergeRefused(this.block, nextBlock)) return true;
                // this.delta([
                //     { retain: this.container.length },
                //     ...nextBehavior.container.toDelta()
                // ]);
                this.block.consume(nextBlock);


                nextBehavior.block.destroy();
                this.block.commit();
                
                tick().then(() => this.nabu.selection.setCursor(this.block, sel.from));
            }
            return;
        }
        // Everywhere else the native mutation is prevented, so the key must be handled here or it is swallowed:
        // a selection inside the block is deleted whole, a collapsed caret deletes the NEXT grapheme cluster
        // (a ZWJ emoji, a flag, a letter + combining accent, a surrogate pair — never half of one).
        event.preventDefault();
        const index = sel.from;
        const length = sel.isCollapsed ? nextGraphemeLength(this.text, sel.from) : sel.to - sel.from;
        if (length <= 0) return true;
        this.delete({ index, length });
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, index));
        return true;
    }

    /**
     * Deletes the word before the cursor (Ctrl+Backspace on Win/Linux,
     * Option+Delete on Mac), including the whitespace that precedes it
     * so no orphan space is left behind (issue #4).
     *
     * For a collapsed selection the range is always computed from the model
     * text, never from `event.getTargetRanges()`: browsers disagree on it
     * (Chromium stops right after the previous space, leaving "one two " from
     * "one two three"), so the behavior would differ per engine.
     * Rule: remove `\s* \S+ \s*` ending at the cursor ("one two three|" -> "one two").
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteWordBackward(event, sel = this.selection) {
        if (!sel) return;
        if (!sel.isCollapsed) {
            this.delete({ index: sel.from, length: sel.to - sel.from });
            this.block.commit();
            tick().then(() => this.nabu.selection.setCursor(this.block, sel.from));
            return true;
        }
        const textBefore = this.text.slice(0, sel.from);
        // \s* leading : l'espace qui précède le mot est supprimé aussi (comportement Mac)
        const wordMatch = textBefore.match(/(\s*\S+\s*)$/);
        const deleteFrom = wordMatch ? sel.from - wordMatch[0].length : 0;
        const len = sel.from - deleteFrom;
        if (len > 0) this.delete({ index: deleteFrom, length: len });
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, deleteFrom));
        return true;
    }

    /**
     * Deletes the word after the cursor (Ctrl+Delete / Option+Fn+Delete).
     *
     * Like backward deletion, a collapsed selection is resolved from the model
     * text only (`getTargetRanges()` is ignored: it is engine-dependent).
     * Rule, so that the result never has a double space nor glued words:
     *  - the cursor is right before the word ("one |two three") -> remove the
     *    word and its trailing whitespace -> "one three";
     *  - whitespace sits between the cursor and the word ("one| two three")
     *    -> remove that leading whitespace and the word, keep the trailing
     *    whitespace -> "one three";
     *  - last word of the text -> remove it with its leading whitespace
     *    ("one two| three" -> "one two").
     * If only whitespace remains after the cursor, it is all removed.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteWordForward(event, sel = this.selection) {
        if (!sel) return;
        if (!sel.isCollapsed) {
            this.delete({ index: sel.from, length: sel.to - sel.from });
            this.block.commit();
            tick().then(() => this.nabu.selection.setCursor(this.block, sel.from));
            return true;
        }
        const textAfter = this.text.slice(sel.from);
        const wordMatch = textAfter.match(/^(\s*)(\S+)(\s*)/);
        let len;
        if (!wordMatch) len = textAfter.length;
        else {
            const [, leading, word, trailing] = wordMatch;
            // Leading whitespace present: keep the trailing one as the separator.
            len = leading ? leading.length + word.length : word.length + trailing.length;
        }
        if (len > 0) this.delete({ index: sel.from, length: len });
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, sel.from));
        return true;
    }

    /**
     * Start of the line holding `index` (after the previous "\n", or 0). A model line is a "\n"-delimited run: soft and
     * hard lines are the same thing here (the model knows no visual wrapping).
     * @param {number} index
     */
    #lineStart(index) {
        return index <= 0 ? 0 : this.text.lastIndexOf('\n', index - 1) + 1;
    }

    /** End of the line holding `index` (the next "\n", or the end of the text). @param {number} index */
    #lineEnd(index) {
        const nl = this.text.indexOf('\n', index);
        return nl === -1 ? this.text.length : nl;
    }

    /**
     * Deletes `[from, to)` as ONE edit (one commit), caret at `from`. Always returns true (the event is handled).
     * @param {number} from @param {number} to
     */
    #deleteSpan(from, to) {
        if (to > from) {
            this.delete({ index: from, length: to - from });
            this.block.commit();
            tick().then(() => this.nabu.selection.setCursor(this.block, from));
        }
        return true;
    }

    /**
     * Deletes from the start of the current line to the cursor (Cmd+Backspace on Mac; `deleteHardLineBackward`).
     * A selection inside the block is deleted whole.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteSoftLineBackward(event, sel = this.selection) {
        if (!sel) return;
        if (!sel.isCollapsed) return this.#deleteSpan(sel.from, sel.to);
        return this.#deleteSpan(this.#lineStart(sel.from), sel.from);
    }

    /**
     * Deletes from the cursor to the end of the current line (Cmd+Fn+Delete, Ctrl+K style; `deleteHardLineForward`).
     * At the end of a line (before a "\n") or of the block nothing is deleted. A selection is deleted whole.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteSoftLineForward(event, sel = this.selection) {
        if (!sel) return;
        if (!sel.isCollapsed) return this.#deleteSpan(sel.from, sel.to);
        return this.#deleteSpan(sel.from, this.#lineEnd(sel.from));
    }

    /**
     * Deletes the whole line(s) touched by the selection (`deleteEntireSoftLine`): the text between the surrounding "\n"
     * (or block edges), the line breaks themselves are kept. Caret at the start of the emptied line.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteEntireLine(event, sel = this.selection) {
        if (!sel) return;
        return this.#deleteSpan(this.#lineStart(sel.from), this.#lineEnd(sel.to));
    }

    /**
     * `deleteContent`: delete the selection (no direction). A collapsed caret deletes nothing.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteContent(event, sel = this.selection) {
        if (!sel) return;
        return this.#deleteSpan(sel.from, sel.to);
    }

    /**
     * The attributes (marks) of the run holding the character at `index`, or null.
     * @param {number} index
     * @returns {Record<string, any> | null}
     */
    #marksAt(index) {
        let offset = 0;
        for (const op of this.container.toDelta()) {
            if (typeof op.insert !== 'string') continue;
            const end = offset + op.insert.length;
            if (index >= offset && index < end) return op.attributes ? { ...op.attributes } : null;
            offset = end;
        }
        return null;
    }

    /**
     * Inserts `text` at `index` carrying `marks` (the inserted run only; marks are exact, they never leak to neighbours).
     * @param {number} index @param {string} text @param {Record<string, any> | null} marks
     */
    #insertWithMarks(index, text, marks) {
        if (!text) return;
        this.insert(index, text);
        if (!marks) return;
        const range = { from: index, to: index + text.length, isCollapsed: false, direction: /** @type {const} */ ('none') };
        for (const [name, value] of Object.entries(marks)) if (value) this.applyMark(name, value, range);
    }

    /**
     * `insertReplacementText`: a spellcheck / autocorrect replacement. The replacement text comes in
     * `dataTransfer` (`text/plain`) or `data`; the range to replace in `getTargetRanges()` (mapped to model offsets), else
     * the selection. The replaced run's marks are kept on the new text. One edit (one undo step), caret after it.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleInsertReplacementText(event, sel = this.selection) {
        const text = event.dataTransfer?.getData?.('text/plain') || event.data || '';
        const element = this.block.element;
        const target = typeof event.getTargetRanges === 'function' ? event.getTargetRanges()[0] : null;
        let from;
        let to;
        if (target && element && element.contains(target.startContainer) && element.contains(target.endContainer)) {
            from = this.calculateOffset(target.startContainer, target.startOffset);
            to = this.calculateOffset(target.endContainer, target.endOffset);
        } else if (sel) {
            from = sel.from;
            to = sel.to;
        } else {
            return true;
        }
        if (to < from) [from, to] = [to, from];
        from = Math.max(0, Math.min(from, this.text.length));
        to = Math.max(from, Math.min(to, this.text.length));
        if (from === to && !text) return true;
        const marks = from < to ? this.#marksAt(from) : null;
        if (to > from) this.delete({ index: from, length: to - from });
        this.#insertWithMarks(from, text, marks);
        this.nabu.storedMarks = null;
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, from + text.length));
        return true;
    }

    /**
     * `insertFromYank` (Emacs-style yank on macOS): the text is inserted as plain text at the caret, replacing the selection.
     * No input rule runs (it is a paste, not typing).
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleInsertFromYank(event, sel = this.selection) {
        if (!sel) return;
        const text = event.data || event.dataTransfer?.getData?.('text/plain') || '';
        if (!text) return true;
        if (!sel.isCollapsed) this.delete({ index: sel.from, length: sel.to - sel.from });
        this.insert(sel.from, text);
        this.nabu.storedMarks = null;
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, sel.from + text.length));
        return true;
    }

    /**
     * `insertTranspose` (macOS Ctrl+T): swaps the two graphemes around the caret; at the end of the text, the last two.
     * Marks travel with their character. No-op with a selection, at the start, with a single character or across a line break.
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleInsertTranspose(event, sel = this.selection) {
        if (!sel || !sel.isCollapsed) return true;
        const text = this.text;
        const end = sel.from >= text.length ? text.length : sel.from + nextGraphemeLength(text, sel.from);
        const middle = end - prevGraphemeLength(text, end); // boundary between the two graphemes
        const start = middle - prevGraphemeLength(text, middle);
        if (middle <= start || end <= middle) return true;
        const left = text.slice(start, middle);
        const right = text.slice(middle, end);
        if (left === '\n' || right === '\n') return true;
        const leftMarks = this.#marksAt(start);
        const rightMarks = this.#marksAt(middle);
        this.delete({ index: start, length: end - start });
        this.#insertWithMarks(start, right, rightMarks);
        this.#insertWithMarks(start + right.length, left, leftMarks);
        this.block.commit();
        tick().then(() => this.nabu.selection.setCursor(this.block, end));
        return true;
    }

    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleInsertParagraph(event, sel = this.selection) {
        if (!sel) return;
        // Blocks that don't split on Enter (e.g. code) insert a literal newline instead.
        if (this.block.splitsOnEnter === false) {
            if (!sel.isCollapsed) this.delete({ index: sel.from, length: sel.to - sel.from });
            this.insert(sel.from, "\n");
            this.block.commit();
            tick().then(() => this.nabu.selection.setCursor(this.block, sel.from + 1));
            return true;
        }
        const from = sel.from;
        const to = sel.isCollapsed ? this.text.length : sel.to ;
        const newBlock = this.block.ascend("onSplit", event, { offset: from, delta: this.container.sliceDelta(from, to)});    
        return newBlock;
    }
    
    /**
    * Retrouve le nœud texte et l'offset DOM pour un offset Modèle donné
    * @param {number} targetOffset 
    * @param {HTMLElement?} [element]
     * @public
    */
    getDOMPoint(targetOffset, element = this.block.element) {
        if (!element) return null;
        
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let currentOffset = 0;
        let node = walker.nextNode();
        
        while (node) {
            const length = node.textContent?.length || 0;
            if (currentOffset + length >= targetOffset) {
                return { node, offset: targetOffset - currentOffset };
            }
            currentOffset += length;
            node = walker.nextNode();
        }
        
        // Fallback : fin du bloc ou élément lui-même si vide
        return { node: element, offset: element.childNodes.length };
    }
    
    /**
     * @param {number} index
     * @param {string} text
     * @public
     */
    insert(index, text) {
        // Never past the end of the text, whatever the caller computed (a stale DOM offset would panic Loro).
        this.container.insert(Math.max(0, Math.min(index, this.container.length)), text);
    }
    
    /**
     * @param {Parameters<Block["delete"]>[0]} [deletion]
     * @param {ReturnType<TextBehavior["getSelection"]>} [selection]
     * @public
     */
    delete(deletion, selection = this.selection) {
        const l = this.container.length;
        let from = deletion?.from ?? selection?.from ?? 0;
        if (from < 0) from = l + from + 1;
        let to = deletion?.to ?? selection?.to ?? l;
        if (to < 0) to = l + (to + 1) ;
        const index = deletion?.index ?? from;
        const length = deletion?.length ?? (to - from);
        this.container.delete(index, length);
    }
    
    /**
     * @param {import('loro-crdt').Delta<string>[]} data
     * @public
     */
    applyDelta(data = []) {
        this.container.applyDelta(data);
    }
    
    /** 
    * @param {Parameters<Block["split"]>[0]} [options] 
    * @param {ReturnType<TextBehavior["getSelection"]>} [selection] 
    * @returns {ReturnType<Block["split"]>} 
     * @public
    */
    split(options, selection = this.selection) {
        const sel = selection;
        if (!sel) return null;
        const offset = options?.index ?? options?.offset ?? options?.from;
        const from = options?.from ?? offset ?? sel.from;
        const to = options?.to ?? (options?.length ? from + options.length : (offset ?? sel.to));
        return this.block.ascend("onSplit", null, { offset: from, delta: this.container.sliceDelta(from, to)});
    }
    
    /**
     * @param {string} markName
     * @param {any} value
     * @param {Pick<NonNullable<ReturnType<TextBehavior["getSelection"]>>, 'from' | 'to' | 'isCollapsed'> | null} sel
     * @public
     */
    applyMark(markName, value, sel) {
        if (!sel || sel.isCollapsed) return;
        // Model guard: an unsafe link (javascript:…) never enters the document through any mark API.
        if (markName === 'link' && sanitizeUrl(value, { kind: 'link' }) === null) {
            this.nabu.warn('applyMark: refused unsafe link href', value);
            return;
        }
        this.container.mark({ start: sel.from, end: sel.to }, markName, value);
    }

    /**
     * @param {string} markName
     * @param {Pick<NonNullable<ReturnType<TextBehavior["getSelection"]>>, 'from' | 'to' | 'isCollapsed'> | null} sel
     * @public
     */
    removeMark(markName, sel) {
        if (!sel || sel.isCollapsed) return;
        this.container.unmark({ start: sel.from, end: sel.to }, markName);
    }

    /**
     * @param {string} markName
     * @param {Pick<NonNullable<ReturnType<TextBehavior["getSelection"]>>, 'from' | 'to' | 'isCollapsed'> | null} sel
     * @public
     */
    isMarkActive(markName, sel) {
        if (!sel || sel.isCollapsed) return false;
        const delta = this.container.toDelta();
        let offset = 0;
        for (const op of delta) {
            if (typeof op.insert !== 'string') continue;
            const opEnd = offset + op.insert.length;
            if (opEnd <= sel.from) { offset = opEnd; continue; }
            if (offset >= sel.to) break;
            if (!op.attributes?.[markName]) return false;
            offset = opEnd;
        }
        return true;
    }

    /**
     * @param {string} markName
     * @param {any} value
     * @param {Pick<NonNullable<ReturnType<TextBehavior["getSelection"]>>, 'from' | 'to' | 'isCollapsed'> | null} sel
     * @public
     */
    toggleMark(markName, value, sel) {
        if (!sel || sel.isCollapsed) return;
        if (this.isMarkActive(markName, sel)) {
            this.removeMark(markName, sel);
        } else {
            this.applyMark(markName, value, sel);
        }
    }

    /** @param {{ rawBreaks?: boolean }} [options]  see {@link deltaToMarkdown}
     * @public
     * @returns {string} */
    toMarkdown(options) {
        return deltaToMarkdown(this.delta, options);
    }

    /**
     * Converts the text delta to a Slate-like JSON format.
     * @returns {{text: string, [mark: string]: any}[]}
     * @public
     */
    toJSON() {
        return this.delta
            .filter(op => typeof op.insert === 'string')
            .map(op => {
                const run = { text: /** @type {string} */ (op.insert) };
                if (op.attributes) Object.assign(run, op.attributes);
                return run;
            });
    }

    /**
     * Serializes a (partial) range of this block's text as a PasteBlock.
     * @param {{ from?: number, to?: number | null, partial?: 'start'|'end'|'both'|false, props?: Record<string,any> }} [context]
     * @returns {import('../../utils/extensions.js').PasteBlock}
     * @public
     */
    toClipboardBlock({ from = 0, to = null, partial = false, props = {} } = {}) {
        const end = to ?? this.container.length;
        return {
            type: this.block.type,
            partial,
            delta: this.container.sliceDelta(from, end),
            props
        };
    }

    /**
     * @param {Block} other
     * @public
     */
    absorbs(other) {
        const otherBehavior = other.behaviors.get("text");
        if (!otherBehavior || !(otherBehavior instanceof TextBehavior)) return false;
        this.applyDelta([
            { retain: this.container.length },
            ...otherBehavior.container.toDelta()
        ]);
        // other.destroy();
        return true;
    }
    
}