/**
 * The state of a Nabu document, as text, for the cards of the tour: `serialize('json')`, `serialize('markdown')` and an HTML export; and what the cards
 * do with it (a colouring of the JSON, the stretch that just changed). Pure functions on an engine or on strings, no Svelte, no DOM: unit tested.
 *
 * Public API only. The library has no whole-document HTML serializer, so the HTML is built the way a COPY builds it: each root block gives its
 * fragment (`serializeForClipboard()` for a container, `serialize('application/x-nabu+json')` for the others: the same calls the copy makes) and the
 * block class of its type writes it (`engine.registry.get(type).toHtml`, recursing into the children). Nothing is invented here; what a block cannot
 * write, the library cannot.
 */

/** @param {any} value the JSON export, minus the block ids (`4@1`: the position of the block in the history, not content) */
const withoutIds = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'id' ? undefined : v)));

/**
 * `serialize('json')`, as the card shows it: the blocks (one block is shown alone), pretty-printed, ids left out.
 * @param {import('#lib').Nabu} engine
 */
export function jsonOf(engine) {
  const blocks = withoutIds(engine.serialize('json')).blocks;
  return JSON.stringify(blocks.length === 1 ? blocks[0] : blocks, null, 2);
}

/** @param {import('#lib').Nabu} engine */
export const markdownOf = (engine) => String(engine.serialize('markdown') ?? '');

/**
 * The HTML of the document: one fragment per root block, as a copy writes it.
 * @param {import('#lib').Nabu} engine
 */
export function htmlOf(engine) {
  /** @param {any} pb @param {Record<string, any>} [ctx] @returns {string} */
  const write = (pb, ctx = {}) => {
    const BlockClass = /** @type {any} */ (engine.registry.get(pb.type));
    if (BlockClass?.toHtml) return BlockClass.toHtml(pb, { ...ctx, recurse: (/** @type {any} */ child, /** @type {any} */ childCtx) => write(child, { ...ctx, ...childCtx }) });
    return '';
  };
  return engine.children
    .flatMap((/** @type {any} */ block) => {
      const pb = typeof block.serializeForClipboard === 'function'
        ? block.serializeForClipboard()
        : block.serialize('application/x-nabu+json', { from: 0, to: null, partial: false });
      return [pb].flat().filter(Boolean);
    })
    .map((/** @type {any} */ pb) => write(pb))
    .filter(Boolean)
    .join('\n');
}

/**
 * The three texts of a card for an engine.
 * @param {import('#lib').Nabu} engine
 * @returns {{ json: string, markdown: string, html: string }}
 */
export const stateOf = (engine) => ({ json: jsonOf(engine), markdown: markdownOf(engine), html: htmlOf(engine) });

/**
 * The stretch of `next` that is not in `prev`: what the last edit wrote. The common beginning and the common ending are left out; `null`
 * when nothing was added (an identical text, or a pure deletion).
 * @param {string} prev @param {string} next
 * @returns {[number, number] | null} `[from, to)` in `next`
 */
export function changedRange(prev, next) {
  if (prev === next) return null;
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev[start] === next[start]) start++;
  let end = 0;
  while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  const to = next.length - end;
  return to > start ? [start, to] : null;
}

/**
 * @typedef {{ text: string, tone: '' | 'key' | 'string' | 'literal' | 'punct', hot: boolean }} Piece
 */

/**
 * Cuts a text into the pieces a `<pre>` draws, each with its tone (JSON only: keys, strings, numbers and literals, punctuation) and whether it lies in
 * `hot` (the changed range). The texts of the pieces add up to `text`.
 * @param {string} text
 * @param {{ json?: boolean, hot?: [number, number] | null }} [options]
 * @returns {Piece[]}
 */
export function pieces(text, { json = false, hot = null } = {}) {
  /** @type {Array<[number, number, Piece['tone']]>} */
  const runs = [];
  if (json) {
    const re = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > last) runs.push([last, m.index, '']);
      if (m[1]) {
        const keyEnd = m.index + m[1].length;
        if (m[2]) { runs.push([m.index, keyEnd, 'key']); runs.push([keyEnd, m.index + m[0].length, 'punct']); } else runs.push([m.index, keyEnd, 'string']);
      } else runs.push([m.index, m.index + m[0].length, m[5] ? 'punct' : 'literal']);
      last = m.index + m[0].length;
    }
    if (last < text.length) runs.push([last, text.length, '']);
  } else runs.push([0, text.length, '']);

  /** @type {Piece[]} */
  const out = [];
  for (const [from, to, tone] of runs) {
    // split at the edges of the hot range
    const cuts = [from, ...(hot ? [hot[0], hot[1]].filter((n) => n > from && n < to) : []), to];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b > a) out.push({ text: text.slice(a, b), tone, hot: !!hot && a >= hot[0] && b <= hot[1] });
    }
  }
  return out;
}
