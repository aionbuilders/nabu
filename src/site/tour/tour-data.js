/**
 * The data of the "Tour of the blocks", assembled: what the extensions of `FullPreset` say about themselves (their name, their slash menu entries, their
 * actions and the keys of their commands, the presets that hold them, the export that is their API) joined to what the code cannot say
 * (tour-content.js: the sentence, the example, the typed shortcuts, the facts of the card).
 *
 * Pure and dependency-free (the library is a parameter, as in `site/preset.js`), so that the unit test builds the very same data and holds it to
 * the editor and to the Blocks reference. The result is plain JSON: it travels in the page data.
 */
import { CARDS, TYPING, PASTE, TRANSFORM, TEXT_BEHAVIOURS } from './tour-content.js';
import { slugify } from '../docs/content.js';

/** Where the exhaustive reference lives. */
export const REFERENCE_PATH = '/docs/guides/blocks-reference';

/**
 * The sections of the Blocks reference: `### Title · \`name\`` -> `{ title, anchor }` by extension name. The anchor is the one the site gives the heading
 * (GitHub style slug), so a link built from it cannot drift from the page.
 * @param {string} markdown the body of docs/guides/blocks-reference.md
 * @returns {Record<string, { title: string, anchor: string }>}
 */
export function referenceIndex(markdown) {
  /** @type {Record<string, { title: string, anchor: string }>} */
  const out = {};
  let fence = '';
  for (const line of markdown.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.replace(/^ {0,3}[`~]+/, '').trim()) fence = '';
      continue;
    }
    if (fence) continue;
    const h = /^#{2,4} (.+?) · `([a-z][a-z-]*)`\s*$/.exec(line);
    if (h) out[h[2]] = { title: h[1], anchor: slugify(`${h[1]} · ${h[2]}`) };
  }
  return out;
}

/** @param {{ typed: string, then: string }} attempt */
const typedPhrase = (attempt) => `type ${attempt.typed} then ${attempt.then === 'enter' ? 'Enter' : 'Space'}`;

/**
 * @typedef {Object} TourCard
 * @property {string} id
 * @property {string[]} names                     the registered types, `extension.name`
 * @property {string} title
 * @property {string[]} groups
 * @property {string} sentence
 * @property {string} about
 * @property {import('./tour-content.js').Example} [example]   the source of the card's document: build time only (tour.server.js drops it)
 * @property {string[]} typed                     what the reader types, as shown (`> ␣`)
 * @property {string[]} slash                     the slash menu entries, `/quote`
 * @property {string[]} md                        the Markdown forms
 * @property {string[]} html                      the HTML forms
 * @property {string[]} files                     `paste`, `drop`: what a file does here
 * @property {string[]} shortcuts                 the keys of the commands of the extensions
 * @property {string[]} wall                      the chips the wall shows
 * @property {string} contains
 * @property {import('./tour-content.js').KeyFact[]} keys
 * @property {string} [keysNote]
 * @property {Record<string, string>} xray       the label of the X-ray for each type of the card: `blockquote · type > then Space · /quote`
 * @property {string[]} presets                   the presets that hold every extension of the card
 * @property {Array<{ name: string, title: string, href: string }>} reference  where each extension is documented
 * @property {Array<{ name: string, href: string }>} api
 */

/**
 * @param {{ lib: Record<string, any>, reference: Record<string, { title: string, anchor: string }> }} input
 */
export function buildTour({ lib, reference }) {
  /** @type {Array<any>} */
  const full = lib.FullPreset;
  /** @type {Map<string, any>} */
  const byName = new Map(full.map((/** @type {any} */ e) => [e.name, e]));
  /** @type {Record<string, any[]>} */
  const presets = { Minimal: lib.MinimalPreset, Text: lib.TextPreset, Document: lib.DocumentPreset, Full: lib.FullPreset };

  /** @param {string} name */
  const ext = (name) => {
    const e = byName.get(name);
    if (!e) throw new Error(`Tour: no extension "${name}" in FullPreset`);
    return e;
  };
  /** @param {string} name */
  const refOf = (name) => {
    const r = reference[name];
    if (!r) throw new Error(`Tour: the Blocks reference has no section for "${name}"`);
    return { name, title: r.title, href: `${REFERENCE_PATH}#${r.anchor}` };
  };
  /** The exports of the library that ARE this extension; the factory of the regions has none (its extension is made by calling it). @param {string} name */
  const apiOf = (name) => {
    const e = ext(name);
    const exported = Object.entries(lib).filter(([, v]) => v === e).map(([n]) => n);
    const names = exported.length ? exported : name === 'region' ? ['RegionsExtension'] : [];
    return names.map((n) => ({ name: n, href: `/api/root/${n}` }));
  };
  /** @param {string[]} names */
  const presetsOf = (names) => Object.entries(presets).filter(([, p]) => names.every((n) => p.some((x) => x.name === n))).map(([label]) => label);
  /** @param {string[]} names */
  const shortcutsOf = (names) => [...new Set(names.flatMap((n) => Object.values(ext(n).commands).flatMap((/** @type {any} */ c) => c.keys ?? [])))];

  /** @type {TourCard[]} */
  const cards = CARDS.map((c) => {
    // the query of an entry: its first alias (what the slash menu finds it by), unless the card says another one that works (`Text`: `/text`)
    const slash = c.names.flatMap((n) => ext(n).slashCommands.map((/** @type {any} */ s) => `/${c.slashQueries?.[s.title] ?? s.aliases[0]}`));
    const typed = c.type.map((t) => t.label);
    const shortcuts = shortcutsOf(c.names);
    const first = c.type[0]?.tries[0];
    const xray = Object.fromEntries(c.names.map((n) => {
      const own = ext(n).slashCommands[0];
      const query = own ? `/${c.slashQueries?.[own.title] ?? own.aliases[0]}` : '';
      return [n, [n, n === c.names[0] && first ? typedPhrase(first) : '', query].filter(Boolean).join(' · ')];
    }));
    return {
      id: c.id,
      names: c.names,
      title: c.title,
      groups: c.groups,
      sentence: c.sentence,
      about: c.about,
      example: c.example,
      typed,
      slash,
      md: c.md.map((m) => m.label),
      html: c.html.map((m) => m.label),
      files: c.files ?? [],
      shortcuts,
      wall: [...typed, ...slash, ...(c.wallKey && shortcuts[0] ? [shortcuts[0]] : []), ...(c.files ?? [])],
      contains: c.contains,
      keys: c.keys,
      ...(c.keysNote ? { keysNote: c.keysNote } : {}),
      xray,
      presets: presetsOf(c.names),
      reference: c.names.map(refOf),
      api: [...new Map(c.names.flatMap(apiOf).map((a) => [a.name, a])).values()],
    };
  });

  /** @param {import('./tour-content.js').MoreContent} m */
  const more = (m) => ({
    name: m.name,
    title: m.title,
    sentence: m.sentence,
    before: m.before,
    beforeKind: m.beforeKind,
    after: m.after,
    shortcuts: shortcutsOf([m.name]),
    presets: presetsOf([m.name]),
    reference: refOf(m.name),
  });

  const blockNames = full.filter((/** @type {any} */ e) => e.block).map((/** @type {any} */ e) => e.name);
  const pasteNames = full.filter((/** @type {any} */ e) => e.pasteInterpreters.length).map((/** @type {any} */ e) => e.name);

  return {
    legend: {
      blocks: blockNames.length,
      behaviours: TEXT_BEHAVIOURS.length,
      paste: pasteNames.length,
      transform: byName.has(TRANSFORM.name) ? 1 : 0,
    },
    cards,
    typing: TYPING.map(more),
    paste: PASTE.map(more),
    transform: { ...TRANSFORM, presets: presetsOf([TRANSFORM.name]), reference: refOf(TRANSFORM.name), api: apiOf(TRANSFORM.name) },
    /** the type of a block of the story -> the card that tells about it */
    cardOf: Object.fromEntries(cards.flatMap((c) => c.names.map((n) => [n, c.id]))),
  };
}
