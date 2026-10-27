/**
 * The X-ray's data: a readable view of the Nabu document, and a one-line description of each Loro operation.
 *
 * PUBLIC API ONLY. Everything here reads the Loro document the editor exposes as `editor.doc` (a `LoroDoc`): its `blocks` tree
 * (`doc.getTree('blocks')`, one node per block, a `data` map holding `type`, `text`, `regionType`…) and the event batches of
 * `doc.subscribe()`. No import from `src/lib`, no private field of the editor. Pure functions, no Svelte, no DOM: unit tested.
 *
 * @typedef {{ doc: import('loro-crdt').LoroDoc }} HasDoc
 *
 * @typedef {Object} ModelLine
 * @property {'block' | 'mark' | 'more'} kind
 * @property {number} depth     nesting depth (0 = a root block); a mark line sits one level below its block
 * @property {string} [type]    block type (`paragraph`, `region`, `list-item`…)
 * @property {string} [id]      short id (the counter of the tree id)
 * @property {string} [detail]  props shown before the text: the region type, the list type, `level=2`…
 * @property {string} [excerpt] the text, truncated, WITHOUT quotes (empty string: the block has no text or an empty one)
 * @property {boolean} [hasText] the block carries a text (an empty one shows as `""`)
 * @property {string} [mark]    mark name (`bold`)
 * @property {[number, number]} [range] `[from, to)` in the block's text
 *
 * @typedef {Object} Op
 * @property {'+' | '-' | '~'} sign
 * @property {string} text      `insert "u" @ 28`
 */

export const MAX_LINES = 60;
export const EXCERPT = 40;
export const OP_CONTENT = 12;

/** `12@7340…` -> `12`. @param {string} id */
export const shortId = (id) => String(id).split('@')[0];

/** Single-line, truncated, for display between quotes. @param {string} s @param {number} max */
export function clip(s, max) {
  const flat = s.replace(/\r?\n/g, '↵').replace(/\t/g, '→');
  return flat.length > max ? flat.slice(0, max) + '…' : flat;
}

/** @param {any} v @returns {boolean} a Loro container handler (text, map…) */
const isContainer = (v) => !!v && typeof v === 'object' && typeof v.kind === 'function';

/** @param {any} node @returns {string} */
function nodeType(node) {
  try {
    const t = node.data.get('type');
    return typeof t === 'string' && t ? t : 'block';
  } catch {
    return 'block';
  }
}

/**
 * The marks of a text as `[name, [from, to)]`: runs of adjacent characters carrying the same mark value are one range.
 * @param {Array<{ insert: any, attributes?: Record<string, any> }>} delta @returns {Array<[string, [number, number]]>}
 */
export function markRanges(delta) {
  /** @type {Array<[string, [number, number], any]>} */
  const out = [];
  /** @type {Map<string, [string, [number, number], any]>} */
  const open = new Map();
  let pos = 0;
  for (const op of delta) {
    if (typeof op.insert !== 'string') { pos += 1; continue; }
    const end = pos + op.insert.length;
    const attrs = op.attributes ?? {};
    for (const name of Object.keys(attrs)) {
      const value = attrs[name];
      if (value === null || value === undefined || value === false) continue;
      const prev = open.get(name);
      if (prev && prev[1][1] === pos && JSON.stringify(prev[2]) === JSON.stringify(value)) prev[1][1] = end;
      else {
        const entry = /** @type {[string, [number, number], any]} */ ([name, [pos, end], value]);
        open.set(name, entry);
        out.push(entry);
      }
    }
    pos = end;
  }
  return out.map(([name, range]) => [name, range]);
}

/**
 * The tree view: one line per block in document order (nested blocks one level deeper), then one line per mark under its block.
 * Capped at `max` lines, the last one being a `more` line. Also fills `types` (tree id -> block type) for {@link describeBatch}.
 * @param {HasDoc['doc']} doc
 * @param {{ max?: number, excerpt?: number, types?: Map<string, string> }} [options]
 * @returns {ModelLine[]}
 */
export function buildModel(doc, { max = MAX_LINES, excerpt = EXCERPT, types } = {}) {
  /** @type {ModelLine[]} */
  const lines = [];
  let truncated = false;

  /** @param {any[]} nodes @param {number} depth */
  const walk = (nodes, depth) => {
    for (const node of nodes) {
      if (lines.length >= max) { truncated = true; return; }
      const id = String(node.id);
      const type = nodeType(node);
      types?.set(id, type);
      const data = node.data;
      let text = null;
      try { const t = data.get('text'); if (isContainer(t) && typeof t.toDelta === 'function') text = t; } catch { /* no text */ }

      /** @type {string[]} */
      const details = [];
      try {
        for (const [key, value] of Object.entries(data.toJSON?.() ?? {})) {
          if (key === 'type' || key === 'text' || key === 'fields') continue;
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
          if (value === false || value === '') continue;
          details.push(key === 'regionType' || key === 'listType' ? String(value) : `${key}=${value}`);
        }
      } catch { /* no props */ }

      /** @type {ModelLine} */
      const line = { kind: 'block', depth, type, id: shortId(id), detail: details.join(' '), hasText: !!text, excerpt: '' };
      lines.push(line);

      if (text) {
        line.excerpt = clip(text.toString(), excerpt);
        for (const [name, range] of markRanges(text.toDelta())) {
          if (lines.length >= max) { truncated = true; break; }
          lines.push({ kind: 'mark', depth: depth + 1, mark: name, range });
        }
      }
      if (truncated) return;

      let kids = [];
      try { kids = node.children() ?? []; } catch { /* leaf */ }
      if (kids.length) walk(kids, depth + 1);
      if (truncated) return;
    }
  };

  walk(doc.getTree('blocks').roots(), 0);
  if (truncated) lines.push({ kind: 'more', depth: 0 });
  return lines;
}

/**
 * One line per Loro operation of an event batch (`doc.subscribe`), in the order they happened.
 *  - text: `insert "u" @ 28`, `delete 1 @ 27`, `mark bold [0, 5]`, `unmark bold [0, 5]` (offsets in the block's text);
 *  - tree: `block paragraph#12` created / deleted / moved;
 *  - map: `retype paragraph#12 → heading`, `retype region#9 → chapter`, `set listType=ordered`.
 * @param {{ events: Array<{ path: any[], diff: any }> }} batch
 * @param {Map<string, string>} types tree id -> block type, kept up to date here (a deleted node can no longer be asked)
 * @param {(id: string) => string | undefined} [lookup] the type of a node still in the tree
 * @returns {Op[]}
 */
export function describeBatch(batch, types, lookup) {
  /** @type {Op[]} */
  const ops = [];
  /** @type {Set<string>} */
  const created = new Set();
  /** @param {string} id */
  const typeOf = (id) => types.get(id) ?? lookup?.(id) ?? 'block';
  /** @param {string} id */
  const ref = (id) => `${typeOf(id)}#${shortId(id)}`;

  // Pass 1: nodes created in this batch (their `type` / props are creation, not a retype).
  for (const ev of batch.events) {
    if (ev.diff?.type !== 'tree') continue;
    for (const action of ev.diff.diff) if (action.action === 'create') {
      const id = String(action.target);
      created.add(id);
      const t = lookup?.(id);
      if (t) types.set(id, t);
    }
  }

  for (const ev of batch.events) {
    const diff = ev.diff;
    if (!diff) continue;
    if (diff.type === 'tree') {
      for (const action of diff.diff) {
        const id = String(action.target);
        if (action.action === 'create') ops.push({ sign: '+', text: `block ${ref(id)}` });
        else if (action.action === 'delete') { ops.push({ sign: '-', text: `block ${ref(id)}` }); types.delete(id); }
        else if (action.action === 'move') ops.push({ sign: '~', text: `move ${ref(id)}` });
      }
    } else if (diff.type === 'text') {
      let pos = 0;
      for (const op of diff.diff) {
        if (typeof op.insert === 'string') {
          ops.push({ sign: '+', text: `insert "${clip(op.insert, OP_CONTENT)}" @ ${pos}` });
          pos += op.insert.length;
        } else if (typeof op.delete === 'number') {
          ops.push({ sign: '-', text: `delete ${op.delete} @ ${pos}` });
        } else if (typeof op.retain === 'number') {
          for (const [name, value] of Object.entries(op.attributes ?? {})) {
            const off = value === null || value === false;
            ops.push({ sign: off ? '-' : '+', text: `${off ? 'unmark' : 'mark'} ${name} [${pos}, ${pos + op.retain}]` });
          }
          pos += op.retain;
        }
      }
    } else if (diff.type === 'map') {
      const id = ev.path?.length === 2 ? String(ev.path[1]) : null;
      if (id && created.has(id)) continue;
      for (const [key, value] of Object.entries(diff.updated ?? {})) {
        if (value === undefined || isContainer(value)) continue;
        if (id && key === 'type') {
          ops.push({ sign: '~', text: `retype ${ref(id)} → ${value}` });
          types.set(id, String(value));
        } else if (id && key === 'regionType') {
          ops.push({ sign: '~', text: `retype ${ref(id)} → ${value}` });
        } else {
          ops.push({ sign: '~', text: `set ${key}=${clip(String(value), OP_CONTENT)}` });
        }
      }
    }
  }
  return ops;
}

/** `lookup` for {@link describeBatch}: the type of a node that is still in the tree. @param {HasDoc['doc']} doc @returns {(id: string) => string | undefined} */
export function treeLookup(doc) {
  const tree = doc.getTree('blocks');
  return (id) => {
    try {
      const node = tree.getNodeByID(/** @type {any} */ (id));
      return node ? nodeType(node) : undefined;
    } catch {
      return undefined;
    }
  };
}

/** The time label of an operation: `2.9 ms`, or the kind (`paste`, `undo`…) when it did not come from a keystroke. @param {number | string} timing */
export function formatTiming(timing) {
  if (typeof timing === 'string') return timing;
  if (timing < 0.1) return '<0.1 ms';
  return `${timing < 100 ? timing.toFixed(1) : Math.round(timing)} ms`;
}
