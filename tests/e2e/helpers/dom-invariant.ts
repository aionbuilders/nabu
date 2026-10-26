/**
 * DOM / selection invariant of the editor, checked automatically at the end of EVERY e2e test (see helpers/test.ts).
 *
 * Why: the editor preserves whitespace (`white-space: pre-wrap`), so a whitespace-only text node sitting between two tags of a
 * block's markup (typically a Svelte template indented over several lines) becomes a real, selectable line — a "phantom" blue bar
 * on Ctrl+A that also adds vertical space. Components must glue their tags (`><`).
 *
 * Two complementary rules, evaluated in ONE `page.evaluate`, read-only (the selection, the focus and the DOM are never touched —
 * the geometry comes from detached `Range` objects, which do not need a selection):
 *
 *  (a) WHITESPACE NODES — no non-empty whitespace-only text node in the editor root outside a legitimate text container
 *      (`OWN_TEXT`: a block's OWN text — text block elements, inline marks, code, list item content, region title, callout body,
 *      toggle header). Empty text nodes ("") are Svelte anchors and are fine.
 *
 *  (b) PHANTOM SELECTION — every "selectable box" of the root must belong to a block's OWN content. The selectable boxes are the
 *      client rects (width > 1 and height > 1) of each text node, each `<br>` and each childless element (image, divider, empty
 *      stray element ...) that is actually selectable (computed `user-select` is not `none`, so decorative UI such as
 *      `[data-nabu-ui]` is out). A box is accepted iff
 *        1. its owner element (the text node's parent / the leaf element's parent) is inside a `[data-block-id]` element, the NEAREST block
 *           B — a box outside every block element, e.g. in the gap between two root blocks or in a toggle body, is rejected;
 *        2. that owner does not itself contain child blocks: a container (list, toggle, region, list item holding a sublist ...)
 *           owns no line of its own, only its children and its title/header element do — a box sitting directly in a container
 *           is container padding / the gap between its children;
 *        3. the rect lies within B's bounding rect: vertically within it (1.5 px tolerance), horizontally it must not lie entirely beside it (the
 *           space hanging at the end of a wrapped `pre-wrap` line overflows on the right by design).
 *      Note the two rules overlap on purpose: (a) is the sharp tool for whitespace inside a leaf block (a gap between the tags of
 *      the image block), (b) is the one that sees the gap BETWEEN blocks and boxes of stray elements / `<br>`.
 */

import type { Page } from '@playwright/test';

/** Selector of the elements whose text is a block's OWN text (a whitespace-only text node is legitimate there). */
export const OWN_TEXT_SELECTOR =
  '.nabu-bold, .nabu-italic, .nabu-underline, .nabu-strikethrough, .nabu-code, a.nabu-link, pre, code, ' +
  '.item-content, .nabu-region-title, .nabu-callout-body, .nabu-toggle-header, ' +
  '[data-block-type="paragraph"], [data-block-type="heading"], [data-block-type="blockquote"], [data-block-type="dialogue"]';

export interface DomInvariantReport {
  /** Rule (a): whitespace-only text nodes outside a legitimate text container, as readable paths. */
  whitespace: string[];
  /** Rule (b): selectable boxes that belong to no block's own content. */
  phantoms: string[];
}

/** Runs in the page. Self-contained (serialised by `page.evaluate`). Returns null when there is no editor root. */
function probe(ownText: string): DomInvariantReport | null {
  const root = document.querySelector('[data-nabu-root]');
  if (!root) return null;

  const label = (el: Element) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const pathOf = (el: Element) => {
    const path: string[] = [];
    for (let e: Element | null = el; e && e !== root; e = e.parentElement) path.unshift(label(e));
    return path.length ? path.join(' > ') : '(root)';
  };
  const blockOf = (el: Element) => el.closest('[data-block-id]');
  const blockLabel = (el: Element | null) => (el ? `${el.getAttribute('data-block-type') ?? '?'}#${el.getAttribute('data-block-id')}` : 'none (directly under the root)');
  /** Ids of the blocks around a node: its nearest block, and the previous / next block siblings in document order. */
  const around = (el: Element, node: Node) => {
    const blocks = [...root.querySelectorAll('[data-block-id]')];
    const before = [...blocks].reverse().find((b) => (b.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) && !b.contains(node));
    const after = blocks.find((b) => (b.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) && !b.contains(node));
    return `nearest block: ${blockLabel(blockOf(el))}; previous block: ${blockLabel(before ?? null)}; next block: ${blockLabel(after ?? null)}`;
  };
  const fmt = (r: DOMRect) => `[x=${r.left.toFixed(0)} y=${r.top.toFixed(0)} w=${r.width.toFixed(0)} h=${r.height.toFixed(0)}]`;
  const selectable = (el: Element) => getComputedStyle(el).userSelect !== 'none';

  // ── (a) whitespace-only text nodes outside a block's own text ──
  const whitespace: string[] = [];
  // ── (b) selectable boxes ──
  const phantoms: string[] = [];

  const checkBox = (owner: Element, node: Node, rects: DOMRectList | DOMRect[], what: string) => {
    for (const r of rects) {
      if (!(r.height > 1 && (r.width > 1 || node.nodeName === 'BR'))) continue; // a <br> is a zero-width box that still makes a line
      const block = blockOf(owner);
      let why: string | null = null;
      if (!block) why = 'outside the own element of every block (gap between blocks / padding of a container such as a toggle body)';
      else if (owner.querySelector('[data-block-id]')) why = `directly in the container ${blockLabel(block)} that holds child blocks: container padding / gap between its children`;
      else {
        const b = block.getBoundingClientRect();
        const T = 1.5;
        // horizontally only a box that starts OUTSIDE is wrong: the space hanging at the end of a wrapped line (pre-wrap) overflows by design
        if (r.left > b.right + T || r.right < b.left - T || r.top < b.top - T || r.bottom > b.bottom + T) why = `outside the bounding rect ${fmt(b)} of ${blockLabel(block)}`;
      }
      if (why) phantoms.push(`${what} ${fmt(r)} in ${pathOf(owner)}: ${why}. ${around(owner, node)}`);
    }
  };

  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = textWalker.nextNode(); n; n = textWalker.nextNode()) {
    const data = (n as Text).data;
    const parent = n.parentElement!;
    if (data === '') continue; // Svelte anchor
    const whitespaceOnly = data.trim() === '';
    if (whitespaceOnly && !parent.closest(ownText)) whitespace.push(`${JSON.stringify(data)} in ${pathOf(parent)}. ${around(parent, n)}`);
    if (!selectable(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    checkBox(parent, n, range.getClientRects(), `${whitespaceOnly ? 'whitespace' : 'text'} node ${JSON.stringify(data.length > 24 ? data.slice(0, 24) + '…' : data)}`);
  }

  for (const el of root.querySelectorAll('*')) {
    const isBr = el.tagName === 'BR';
    if (!isBr && el.childNodes.length > 0) continue; // only br + childless elements: leaf boxes (parents are covered via their text nodes)
    if (!selectable(el)) continue;
    // the OWNER of a leaf box is its parent: a stray empty element in a container is judged by the container
    checkBox(el.parentElement!, el, el.getClientRects(), `<${label(el)}>`);
  }

  return { whitespace, phantoms };
}

/** The raw report of the current page (null when there is no `[data-nabu-root]`). Read-only. */
export function domInvariantReport(page: Page): Promise<DomInvariantReport | null> {
  return page.evaluate(probe, OWN_TEXT_SELECTOR);
}

/** All the invariant violations of the current page, as readable strings (empty = fine; also empty without an editor root). */
export async function checkDomInvariant(page: Page): Promise<string[]> {
  const report = await domInvariantReport(page);
  if (!report) return [];
  return [
    ...report.whitespace.map((w) => `whitespace-only text node: ${w}`),
    ...report.phantoms.map((p) => `phantom selectable box: ${p}`),
  ];
}

/** Rule (a) alone, as a list of readable paths (used by the dedicated dom-whitespace spec). */
export async function findPhantoms(page: Page): Promise<string[]> {
  return (await domInvariantReport(page))?.whitespace ?? [];
}
