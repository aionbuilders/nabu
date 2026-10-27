/**
 * Builds the tour at build time (server only): the data of tour-data.js, and for each example (the story, the example of each card, the "after" of each
 * typing and paste case) a Nabu document, as a snapshot the browser rebuilds the same engine from (the pipeline of the docs pages, doc.server.js),
 * with the Shiki tokens of its code blocks. The engine runs in Node (Loro's WebAssembly loads there too), no DOM is involved.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as lib from '#lib';
import { parseFrontmatter } from '../docs/content.js';
import { exportSnapshot } from '../docs/doc-preset.js';
import { getHighlighter } from '../docs/highlight.server.js';
import { tokensOf } from '../docs/doc.server.js';
import { STORY } from './tour-content.js';
import { buildTour, referenceIndex } from './tour-data.js';
import { createTourEngine } from './tour-preset.js';

/** The stand-ins of the two blocks Markdown cannot write: `[[video url | name | alt]]`, `[[file url | name]]`, alone in a paragraph. */
const MEDIA = /^\[\[(video|file) (\S+?)(?: \| ([^|\]]+?))?(?: \| ([^\]]+?))?\]\]$/;

/** @param {any[]} blocks the blocks of a JSON export @returns {any[]} */
function expandMedia(blocks) {
  return blocks.map((block) => {
    const text = typeof block.content === 'string' ? '' : (block.content ?? []).map((/** @type {any} */ r) => r.text).join('');
    const m = block.type === 'paragraph' ? MEDIA.exec(text) : null;
    if (m) {
      const [, type, ref, name, alt] = m;
      return { type, props: { ref, name: name ?? '', ...(type === 'video' ? { alt: alt ?? '' } : {}) } };
    }
    return block.children ? { ...block, children: expandMedia(block.children) } : block;
  });
}

/**
 * Fills an engine with an example (Markdown, or the JSON of its blocks, the two media stand-ins turned into their blocks).
 * @param {import('#lib').Nabu} engine
 * @param {import('./tour-content.js').Example} example
 */
export async function fillEngine(engine, example) {
  if (example.json) {
    await engine.importJSON({ version: '1', blocks: example.json });
  } else {
    await engine.importMarkdown(/** @type {string} */ (example.md));
    const json = engine.serialize('json');
    const expanded = expandMedia(json.blocks);
    if (JSON.stringify(expanded) !== JSON.stringify(json.blocks)) await engine.importJSON({ version: json.version, blocks: expanded });
  }
}

/**
 * One example as a document: its snapshot and the colours of its code.
 * @param {import('./tour-content.js').Example} example
 * @param {import('shiki').HighlighterGeneric<any, any>} highlighter
 * @param {number} peer the id of the author of this document, different for each example of the page
 * @param {boolean} [withJson] also hand over its JSON export
 */
async function buildExample(example, highlighter, peer, withJson = false) {
  const engine = createTourEngine();
  // One author, one peer: the block ids (`counter@peer`) are the same at every build, so is the prerendered markup. And a peer for each example: the page holds
  // twenty editors at once, and a block id that two of them share would be found in the wrong one by the selection (a caret put in a card would land elsewhere).
  engine.doc.setPeerId(peer);
  await fillEngine(engine, example);
  /** @type {Record<string, Array<[string, string?]>>} */
  const code = {};
  /** @param {any[]} blocks */
  const walk = (blocks) => {
    for (const block of blocks) {
      if (block.type === 'code') {
        const tokens = tokensOf(highlighter, block.text, block.language);
        if (tokens) code[block.id] = tokens;
      }
      if (block.children?.length) walk(block.children);
    }
  };
  walk(engine.children);
  // `json`: what the browser makes the engine of an open card from (a card is opened with ids of its own, see TourCardOpen)
  return { snapshot: exportSnapshot(engine), code, ...(withJson ? { json: engine.serialize('json') } : {}) };
}

/** Everything the page needs. */
export async function loadTour() {
  const reference = referenceIndex(parseFrontmatter(readFileSync(resolve(process.cwd(), 'docs/guides/blocks-reference.md'), 'utf8')).body);
  const tour = buildTour({ lib, reference });
  const h = await getHighlighter();
  const build = (/** @type {import('./tour-content.js').Example} */ e, /** @type {number} */ peer, json = false) => buildExample(e, h, peer, json);

  const [story, cards, typing, paste] = await Promise.all([
    build({ md: STORY.md }, 1),
    Promise.all(tour.cards.map(async (card, i) => ({ ...card, doc: await build(/** @type {import("./tour-content.js").Example} */ (card.example), 100 + i, true) }))),
    Promise.all(tour.typing.map(async (m, i) => ({ ...m, doc: await build({ md: m.after }, 200 + i) }))),
    Promise.all(tour.paste.map(async (m, i) => ({ ...m, doc: await build({ md: m.after }, 300 + i) }))),
  ]);

  // `example` (the source of the card's document) stays on the server: the page only needs the document.
  return {
    legend: tour.legend,
    cardOf: tour.cardOf,
    story: { label: STORY.label, doc: story },
    cards: cards.map(({ example: _example, ...card }) => card),
    typing,
    paste,
    transform: tour.transform,
  };
}
