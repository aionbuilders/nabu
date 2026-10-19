/**
* @import {NabuNode, Block, NabuSelection} from "../../blocks";
*/

import { LoroText } from "loro-crdt";
import { tick } from "svelte";
import { escapeHtml, escapeAttr, sanitizeUrl } from "../../utils/html.js";
import { escapeMarkdownText, escapeBlockStart } from "./markdown-syntax.js";

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

export class TextBehavior {
    /** @param {Block} block @param {LoroText} [container] */
    constructor(block, container) {
        this.block = block;
        this.nabu = block.nabu;
        const node = /** @type {TextNode} */ (block.node);
        /** @type {LoroText} */
        this.container = container ?? node.data.get("text") ?? node.data.setContainer("text", new LoroText());
        this.text = $state(this.container.toString());
        this.delta = $state(this.container.toDelta());
        this.container.subscribe(() => {
            this.text = this.container.toString();
            this.delta = this.container.toDelta();
        });
    }
    
    selection = $derived(this.block.element && this.block.nabu.selection && this.getSelection(this.block.element, this.block.nabu.selection));

    positions = $derived(this.text.length + 1);

    /**
     * Number of whitespace-separated words in this text.
     * @returns {number}
     */
    get wordCount() {
        return this.text.trim().split(/\s+/).filter(Boolean).length;
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
            from = this.calculateOffset(globalRange.startContainer, globalRange.startOffset);
        }
        
        if (containsEnd) {
            to = this.calculateOffset(globalRange.endContainer, globalRange.endOffset);
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

    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [selection] */
    handleBeforeInput(event, selection = this.selection) {
        // Hook system (Markdown shortcuts, de-transformation, structural guards…).
        // `transformsEnabled: false` (e.g. code blocks) only suppresses transforms,
        // which fire on insertions — deletion hooks (block exit, zone guards) still run.
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
                return this.handleDeleteSoftLineBackward(event, selection);
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
    
    /** @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel] */
    handleDeleteContentBackward(event, sel = this.selection) {
        if (!sel) return;
        if (sel.isCollapsed && sel.from === 0) {
            const previousBlock = this.block.findBackward(b => b.behaviors.has("text") && b.behaviors.get("text") instanceof TextBehavior);
            if (!previousBlock) return;
            const previousBehavior = previousBlock?.behaviors.get("text");
            if (previousBehavior && previousBehavior instanceof TextBehavior) {
                event.preventDefault();
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
            const length = sel.isCollapsed ? 1 : sel.to - sel.from;
            const index = sel.isCollapsed ? sel.from - 1 : sel.from;
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
                // this.delta([
                //     { retain: this.container.length },
                //     ...nextBehavior.container.toDelta()
                // ]);
                this.block.consume(nextBlock);


                nextBehavior.block.destroy();
                this.block.commit();
                
                tick().then(() => this.nabu.selection.setCursor(this.block, sel.from));
            }
        }
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
     * Deletes from the start of the current soft line to the cursor
     * (Cmd+Backspace on Mac).
     * @param {InputEvent} event @param {ReturnType<TextBehavior["getSelection"]>} [sel]
     */
    handleDeleteSoftLineBackward(event, sel = this.selection) {
        if (!sel) return;
        const lastNL = this.text.lastIndexOf('\n', sel.from - 1);
        const deleteFrom = lastNL === -1 ? 0 : lastNL + 1;
        if (deleteFrom < sel.from) {
            this.delete({ index: deleteFrom, length: sel.from - deleteFrom });
            this.block.commit();
            tick().then(() => this.nabu.selection.setCursor(this.block, deleteFrom));
        }
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
    
    /** @param {number} index @param {string} text */
    insert(index, text) {
        this.container.insert(index, text);
    }
    
    /** @param {Parameters<Block["delete"]>[0]} [deletion] @param {ReturnType<TextBehavior["getSelection"]>} [selection] */
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
    
    /** @param {import('loro-crdt').Delta<string>[]} data */
    applyDelta(data = []) {
        this.container.applyDelta(data);
    }
    
    /** 
    * @param {Parameters<Block["split"]>[0]} [options] 
    * @param {ReturnType<TextBehavior["getSelection"]>} [selection] 
    * @returns {ReturnType<Block["split"]>} 
    */
    split(options, selection = this.selection) {
        const sel = selection;
        if (!sel) return null;
        const offset = options?.index ?? options?.offset ?? options?.from;
        const from = options?.from ?? offset ?? sel.from;
        const to = options?.to ?? (options?.length ? from + options.length : (offset ?? sel.to));
        return this.block.ascend("onSplit", null, { offset: from, delta: this.container.sliceDelta(from, to)});
    }
    
    /** @param {string} markName @param {any} value @param {ReturnType<TextBehavior["getSelection"]>} sel */
    applyMark(markName, value, sel) {
        if (!sel || sel.isCollapsed) return;
        // Model guard: an unsafe link (javascript:…) never enters the document through any mark API.
        if (markName === 'link' && sanitizeUrl(value, { kind: 'link' }) === null) {
            this.nabu.warn('applyMark: refused unsafe link href', value);
            return;
        }
        this.container.mark({ start: sel.from, end: sel.to }, markName, value);
    }

    /** @param {string} markName @param {ReturnType<TextBehavior["getSelection"]>} sel */
    removeMark(markName, sel) {
        if (!sel || sel.isCollapsed) return;
        this.container.unmark({ start: sel.from, end: sel.to }, markName);
    }

    /** @param {string} markName @param {ReturnType<TextBehavior["getSelection"]>} sel */
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

    /** @param {string} markName @param {any} value @param {ReturnType<TextBehavior["getSelection"]>} sel */
    toggleMark(markName, value, sel) {
        if (!sel || sel.isCollapsed) return;
        if (this.isMarkActive(markName, sel)) {
            this.removeMark(markName, sel);
        } else {
            this.applyMark(markName, value, sel);
        }
    }

    /** @param {{ rawBreaks?: boolean }} [options]  see {@link deltaToMarkdown}
     * @returns {string} */
    toMarkdown(options) {
        return deltaToMarkdown(this.delta, options);
    }

    /**
     * Converts the text delta to a Slate-like JSON format.
     * @returns {{text: string, [mark: string]: any}[]}
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
     * @param {{ from?: number, to?: number, partial?: 'start'|'end'|'both'|false, props?: Record<string,any> }} [context]
     * @returns {import('../utils/extensions.js').PasteBlock}
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

    /** @param {Block} other */
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