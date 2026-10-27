/**
 * The tiny inline markup of the data files' texts: `code` and *emphasis*. Pages draw the segments with Inline.svelte (no `{@html}`).
 * @param {string} text
 * @returns {Array<{ text: string, kind: 'text' | 'code' | 'em' }>}
 */
export function inlineParts(text) {
  /** @type {Array<{ text: string, kind: 'text' | 'code' | 'em' }>} */
  const out = [];
  const re = /`([^`]+)`|\*([^*]+)\*/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: 'text' });
    out.push(m[1] !== undefined ? { text: m[1], kind: 'code' } : { text: m[2], kind: 'em' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'text' });
  return out;
}
