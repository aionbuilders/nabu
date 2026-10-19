/**
 * Lists in the HTML of Google Docs and Microsoft Word: nesting is not expressed by `<ul>` inside `<li>` but by a LEVEL
 * attached to flat items. This module reads those levels and rebuilds real nested lists (PasteBlocks).
 *
 *  - Google Docs: `<li aria-level="N" style="list-style-type:…">` (the level), items of one list in a single `<ul>`, or a
 *    `<ul>` nested straight inside the `<ul>` (invalid HTML the parser keeps), or one `<ul>` per level as siblings;
 *    `<ol start>` is kept; `aria-checked` items are to-do items.
 *  - Word: consecutive `<p class=MsoListParagraph… style="mso-list:l0 level2 lfo1">`: the list is `l0 lfo1`, the level is
 *    `level2`, and the kind (bullet / numbered) comes from the marker Word writes in a `mso-list:Ignore` span (`·`, `o`, `§`
 *    for bullets; `1.`, `a)`, `i.` for numbers).
 *
 * Pure DOM / PasteBlock functions, no editor access. Used by `List.fromHTML` / `List.htmlSiblings`.
 *
 * @import { PasteBlock } from "../../utils/extensions.js";
 */

/**
 * @typedef {'bullet' | 'ordered' | 'todo'} ListKind
 * @typedef {Object} RawEntry an item of a flat list, before its content is parsed
 * @property {Element} el  the `<li>` (Docs) or `<p>` (Word)
 * @property {number} level  1-based, as written by the source
 * @property {ListKind} listType
 * @property {number | null} start  first number of an ordered list, when this item opens a list element that says so
 */

/** The value of one CSS property of the `style` attribute (lower-cased, `!important` dropped), or ''. @param {Element} el @param {string} prop */
function styleValue(el, prop) {
    const style = el.getAttribute('style');
    if (!style) return '';
    let value = '';
    for (const decl of style.split(';')) {
        const i = decl.indexOf(':');
        if (i > 0 && decl.slice(0, i).trim().toLowerCase() === prop) value = decl.slice(i + 1).replace(/!\s*important/i, '').trim().toLowerCase();
    }
    return value;
}

const ORDERED_STYLE = /^(decimal|lower-|upper-|armenian|georgian|hebrew|cjk-|hiragana|katakana|arabic-indic|persian|devanagari|bengali|gujarati|gurmukhi|kannada|khmer|lao|malayalam|myanmar|oriya|tamil|telugu|thai|tibetan)/;

/**
 * The kind of list an item belongs to, from its `list-style-type` (`disc` / `circle` / `square` → bullet, `decimal` /
 * `lower-alpha` / `upper-roman`… → ordered); no (or `none`) style: the kind of the list tag.
 * @param {string} styleType @param {ListKind} fallback @returns {ListKind}
 */
function kindFromStyle(styleType, fallback) {
    if (!styleType || styleType === 'none') return fallback;
    return ORDERED_STYLE.test(styleType) ? 'ordered' : 'bullet';
}

/** @param {unknown} start @returns {number | null} */
const startNumber = (start) => {
    if (start === null || start === undefined || start === '') return null;
    const n = Number(start);
    return Number.isInteger(n) && n >= 0 ? n : null;
};

/** The ul / ol elements are the list tags. @param {Element | null | undefined} el */
const isListTag = (el) => !!el && (el.localName === 'ul' || el.localName === 'ol');

/** The next sibling ELEMENT, over blank text and comments only; `null` when something else (text, an element) is met first. @param {Element} el */
function nextSiblingElement(el) {
    for (let n = el.nextSibling; n; n = n.nextSibling) {
        if (n.nodeType === 1) return /** @type {Element} */ (n);
        if (n.nodeType === 8 || (n.nodeType === 3 && !/\S/.test(n.textContent ?? ''))) continue;
        return null;
    }
    return null;
}

// ── Google Docs ──────────────────────────────────────────────────────────────

/**
 * Whether a list element expresses its nesting by level (Docs) rather than by `<li>` containing sublists: an `<li
 * aria-level>`, or a list nested straight in a list.
 * @param {Element} listEl @returns {boolean}
 */
export function hasLeveledItems(listEl) {
    return [...listEl.children].some((c) => (c.localName === 'li' && c.hasAttribute('aria-level')) || isListTag(c));
}

/**
 * The items of a Docs list element, in document order, with their level and kind.
 * @param {Element} listEl
 * @param {number} [depth]  level of the items that carry no `aria-level` (their nesting depth)
 * @param {RawEntry[]} [out]
 * @returns {RawEntry[]}
 */
export function docsEntries(listEl, depth = 1, out = []) {
    const tagKind = /** @type {ListKind} */ (listEl.localName === 'ol' ? 'ordered' : 'bullet');
    const start = listEl.localName === 'ol' ? startNumber(listEl.getAttribute('start')) : null;
    let first = true;
    for (const child of listEl.children) {
        if (child.localName === 'li') {
            const aria = parseInt(child.getAttribute('aria-level') ?? '', 10);
            out.push({ el: child, level: aria > 0 ? aria : depth, listType: kindFromStyle(styleValue(child, 'list-style-type'), tagKind), start: first ? start : null });
            first = false;
        } else if (isListTag(child)) {
            docsEntries(child, depth + 1, out);
        }
    }
    return out;
}

/**
 * The `<ul>` / `<ol>` siblings that continue a Docs list: Docs sometimes writes each nesting level as its own list element.
 * A following list element belongs to the same list when it goes DEEPER than where the list started, or when it comes back
 * to that level after going deeper (same tag, no `start` of its own).
 * @param {Element} el
 * @returns {Element[]}
 */
export function docsSiblings(el) {
    if (!isListTag(el) || !hasLeveledItems(el)) return [];
    const own = docsEntries(el);
    if (!own.length) return [];
    const base = own[0].level;
    let last = own[own.length - 1].level;
    /** @type {Element[]} */
    const out = [];
    for (let n = nextSiblingElement(el); isListTag(n) && hasLeveledItems(/** @type {Element} */ (n)); n = nextSiblingElement(/** @type {Element} */ (n))) {
        const list = /** @type {Element} */ (n);
        const entries = docsEntries(list);
        if (!entries.length) break;
        const deeper = entries[0].level > base;
        const back = entries[0].level === base && last > base && list.localName === el.localName && !list.hasAttribute('start');
        if (!deeper && !back) break;
        out.push(list);
        last = entries[entries.length - 1].level;
    }
    return out;
}

// ── Microsoft Word ───────────────────────────────────────────────────────────

const WORD_LIST = /mso-list\s*:\s*(l\d+)\s+level(\d+)(?:\s+(lfo\d+))?/i;

/** @param {Element} el @returns {{ key: string, level: number } | null} */
function wordInfo(el) {
    const m = WORD_LIST.exec(el.getAttribute('style') ?? '');
    return m ? { key: m[1].toLowerCase() + (m[3] ? ' ' + m[3].toLowerCase() : ''), level: Number(m[2]) } : null;
}

/** Whether an element is a Word list paragraph (`mso-list:l0 level1 lfo1`). @param {Element} el @returns {boolean} */
export const isWordListParagraph = (el) => wordInfo(el) !== null;

/**
 * The marker Word writes before the text of a list paragraph (the content of its `mso-list:Ignore` span), or `null`.
 * @param {Element} p @returns {string | null}
 */
function wordMarker(p) {
    for (const span of p.querySelectorAll('[style]')) {
        if (/mso-list\s*:\s*ignore/i.test(span.getAttribute('style') ?? '')) return (span.textContent ?? '').replace(/[\s ]+/g, ' ').trim();
    }
    return null;
}

/**
 * Bullet or numbered, and the number when the marker is one (`3.`).
 * @param {string | null} marker
 * @returns {{ listType: ListKind, start: number | null }}
 */
export function classifyWordMarker(marker) {
    if (!marker) return { listType: 'bullet', start: null };
    const number = /^\(?(\d+)[.)]?$/.exec(marker);
    if (number) return { listType: 'ordered', start: startNumber(number[1]) };
    if (/^\(?[A-Za-z]+[.)]$/.test(marker)) return { listType: 'ordered', start: null }; // a. A) i. IV.
    if (marker.length === 1 && /[A-Za-z]/.test(marker) && marker !== 'o' && marker !== 'O') return { listType: 'ordered', start: null };
    return { listType: 'bullet', start: null }; // · • o § - ▪ and the private-use glyphs of the Symbol / Wingdings fonts
}

/**
 * The Word list paragraphs that continue the list of `p` (same list and override id), straight after it.
 * @param {Element} p
 * @returns {Element[]}
 */
export function wordSiblings(p) {
    const info = wordInfo(p);
    if (!info) return [];
    /** @type {Element[]} */
    const out = [];
    for (let n = nextSiblingElement(p); n && n.localName === 'p' && wordInfo(n)?.key === info.key; n = nextSiblingElement(n)) out.push(n);
    return out;
}

/**
 * @param {Element[]} paragraphs  the list paragraphs of ONE Word list, in order
 * @returns {RawEntry[]}
 */
export function wordEntries(paragraphs) {
    /** @type {RawEntry[]} */
    const out = [];
    paragraphs.forEach((el, i) => {
        const info = wordInfo(el);
        if (!info) return;
        const { listType, start } = classifyWordMarker(wordMarker(el));
        out.push({ el, level: info.level, listType, start: i === 0 ? start : null });
    });
    return out;
}

// ── Levels → nested lists ────────────────────────────────────────────────────

/**
 * Build the nested list of flat, leveled items. Depth is the level relative to the first item; an item can go at most ONE
 * level deeper than the previous one (a jump is clamped), and an item shallower than the first one sits at the top.
 * Each depth keeps the kind of its first item (a bullet sublist under a numbered item, and so on); a change of kind at the
 * same depth inside a sublist starts a sibling sublist. A list holding a checked / unchecked item is a to-do list.
 * @param {Array<{ level: number, listType: ListKind, start: number | null, item: PasteBlock }>} entries
 * @param {(listType: string, start: number | null) => Record<string, any>} propsOf  list props for a kind and a first number
 * @returns {PasteBlock | null}
 */
export function nestEntries(entries, propsOf) {
    if (!entries.length) return null;
    const base = entries[0].level;
    /** @param {{ listType: ListKind, start: number | null }} e @returns {PasteBlock} */
    const makeList = (e) => ({ type: 'list', props: propsOf(e.listType, e.listType === 'ordered' ? e.start : null), children: [], partial: false });
    const root = makeList(entries[0]);
    /** @type {PasteBlock[]} */
    const lists = [root];
    /** @type {PasteBlock[]} */
    const lastItem = [];
    let previous = -1;
    for (const e of entries) {
        const depth = Math.max(0, Math.min(e.level - base, previous + 1));
        lastItem.length = Math.min(lastItem.length, depth);
        if (depth > 0 && (!lists[depth] || lists[depth].props?.listType !== e.listType)) {
            const list = makeList(e);
            const parent = lastItem[depth - 1];
            (parent.children ??= []).push(list);
            lists[depth] = list;
        }
        lists.length = depth + 1;
        /** @type {PasteBlock[]} */ (lists[depth].children).push(e.item);
        lastItem[depth] = e.item;
        previous = depth;
    }
    /** @param {PasteBlock} list */
    const promote = (list) => {
        const items = list.children ?? [];
        if (items.some((item) => item.props?.checked !== undefined)) list.props = { ...list.props, listType: 'todo' };
        for (const item of items) for (const sub of item.children ?? []) promote(sub);
    };
    promote(root);
    return root;
}
