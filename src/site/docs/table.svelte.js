/**
 * A read-only GFM table block, for the documentation site only. Nabu has no table block yet: its markdown importer turns a table
 * into one tab-separated paragraph per row (see `src/lib/blocks/paragraph/table.markdown.js`, which says a future table block "declares
 * its own rule at a higher priority and takes over"). This block is that declaration, kept on the site because it cannot be edited:
 * the cells are plain JSON (`head`, `rows`: arrays of Loro deltas, so the inline marks and links of a cell survive) stored in the
 * block's node data, and drawn by `DocTable.svelte`. Public `/extend` API only.
 */
import { Block } from '#lib/extend.js';
import DocTableComponent from './DocTable.svelte';

/** @typedef {import('loro-crdt').Delta<string>[]} Cell */
/** @typedef {'left' | 'center' | 'right' | null} Align */

const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/**
 * The cells of a row: split on the pipes that are not escaped, the edge pipes dropped, each cell trimmed (`\|` stays escaped).
 * @param {string} line
 * @returns {string[]}
 */
export function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  /** @type {string[]} */
  const cells = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && i + 1 < row.length) { cell += row[i] + row[i + 1]; i++; continue; }
    if (row[i] === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += row[i];
  }
  cells.push(cell.trim());
  return cells;
}

/** @param {string[]} lines @param {number} i */
const isTableStart = (lines, i) => {
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!header.includes('|') || !delimiter.includes('|') || !DELIMITER_ROW.test(delimiter)) return false;
  return splitRow(header).length === splitRow(delimiter).length;
};

/** @param {string} spec @returns {Align} */
const alignOf = (spec) => {
  const s = spec.trim();
  const l = s.startsWith(':');
  const r = s.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
};

/** @param {Cell} cell */
const cellText = (cell) => cell.map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');

/** @param {string} s */
const escapeCell = (s) => s.replace(/\|/g, '\\|');

// @ts-ignore — static-side variance on create(), as for every built-in block
export class DocTableBlock extends Block {
  /** @param {import('#lib').Nabu} nabu @param {any} node */
  constructor(nabu, node) {
    super(nabu, node);
    this.head = /** @type {Cell[]} */ (node.data.get('head') ?? []);
    this.rows = /** @type {Cell[][]} */ (node.data.get('rows') ?? []);
    this.align = /** @type {Align[]} */ (node.data.get('align') ?? []);

    const props = () => ({ head: this.head, rows: this.rows, align: this.align });
    this.serializers.set('markdown', () => DocTableBlock.toMarkdown({ type: 'table', props: props() }));
    this.serializers.set('json', () => ({ id: this.id, type: 'table', props: props() }));
    this.serializers.set('application/x-nabu+json', () => ({ type: 'table', props: props(), partial: false }));
  }

  component = $derived(this.nabu.components.get('table') || DocTableComponent);

  // A void block: one cursor position, no text of its own (like the divider).
  positions = $derived(1);
  /** @param {number} offset */
  getDOMPoint(offset) { return null; }
  /** @param {InputEvent} event */
  beforeinput(event) { return false; }

  /** @param {{ props?: Record<string, any> }} pb */
  static toMarkdown(pb) {
    const { head = [], rows = [], align = [] } = pb.props ?? {};
    const line = (/** @type {Cell[]} */ cells) => `| ${cells.map((c) => escapeCell(cellText(c))).join(' | ')} |`;
    const rule = head.map((_, i) => ({ left: ':---', center: ':---:', right: '---:' })[/** @type {'left'} */ (align[i])] ?? '---');
    return [line(head), `| ${rule.join(' | ')} |`, ...rows.map(line)].join('\n');
  }

  /** @param {{ props?: Record<string, any> }} pb */
  static toHtml(pb) {
    const { head = [], rows = [], align = [] } = pb.props ?? {};
    const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cell = (/** @type {string} */ tag, /** @type {Cell} */ c, /** @type {number} */ i) =>
      `<${tag}${align[i] ? ` style="text-align:${align[i]}"` : ''}>${esc(cellText(c))}</${tag}>`;
    const tr = (/** @type {string} */ tag, /** @type {Cell[]} */ cells) => `<tr>${cells.map((c, i) => cell(tag, c, i)).join('')}</tr>`;
    return `<table><thead>${tr('th', head)}</thead><tbody>${rows.map((r) => tr('td', r)).join('')}</tbody></table>`;
  }

  /** A GFM pipe table: a header row, a delimiter row of the same width, then the rows up to a blank line or the next block. */
  static markdownRules = [
    {
      priority: 30,
      detect: (/** @type {string} */ line, /** @type {string[]} */ lines, /** @type {number} */ i) => isTableStart(lines, i),
      consume: (/** @type {string[]} */ lines, /** @type {number} */ i, /** @type {any} */ helpers) => {
        let j = i + 2;
        while (j < lines.length && lines[j].trim() && lines[j].includes('|') && !helpers?.interrupts?.(lines, j)) j++;
        return j - i;
      },
    },
  ];

  /**
   * @param {string[]} lines header, delimiter, rows
   * @param {{ parseInline: (text: string) => Cell }} helpers
   */
  static fromMarkdown(lines, { parseInline }) {
    if (!isTableStart(lines, 0)) return null;
    const width = splitRow(lines[0]).length;
    const row = (/** @type {string} */ line) => {
      const cells = splitRow(line).slice(0, width);
      while (cells.length < width) cells.push('');
      return cells.map((c) => parseInline(c));
    };
    return {
      type: 'table',
      props: { head: row(lines[0]), rows: lines.slice(2).map(row), align: splitRow(lines[1]).map(alignOf) },
      partial: false,
    };
  }

  /**
   * @param {import('#lib').Nabu} nabu @param {string} type @param {Record<string, any>} [props] @param {string | null} [parentId] @param {number | null} [index]
   */
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(/** @type {any} */ (parentId || undefined), index ?? undefined);
    const data = /** @type {any} */ (node.data);
    data.set('type', 'table');
    data.set('head', props.head ?? []);
    data.set('rows', props.rows ?? []);
    data.set('align', props.align ?? []);
    return new DocTableBlock(nabu, node);
  }
}
