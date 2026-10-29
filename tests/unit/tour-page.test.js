// @ts-nocheck — the helpers mock the little of the editor they need
/**
 * Guard of the visual "Tour of the blocks" (src/site/tour, the page src/routes/(site)/docs/getting-started/tour-of-the-blocks).
 *
 * The cards are generated from the real extensions (`FullPreset`: name, slash menu, actions, keys, presets, API export), and joined to a small curated file
 * (tour-content.js) for what code cannot say. This test makes the curated part answer to the editor and to the Blocks reference
 * (docs/guides/blocks-reference.md, guarded by blocks-reference.test.js), as that page answers to the code:
 *
 *  1. Exhaustive: every extension of `FullPreset` has a card (a block), a "typing" case (a text behaviour), a "paste" case (a reader), or is the transform.
 *  2. True: a slash chip is a slash entry that the menu finds; a typed shortcut makes the block it says (the method of the reference's test); a Markdown chip is in
 *     the Markdown the example writes, an HTML chip in the HTML; a key and a prop are named by the reference, in the section of the block; a before / after of
 *     typing and pasting is what the reader, the rules and the command really do; the media are files that exist.
 *  3. Consistent: every link of a card goes to a heading of the reference and to a page of the API.
 *  4. The story holds every block that can be drawn read-only; the state of a card (JSON, Markdown, HTML) is what the editor serializes.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as lib from '#lib/index.js';
import { FullPreset, MinimalPreset, TextPreset, DocumentPreset, createFullEditor, createMinimalEditor } from '#lib/index.js';
import { filterSlashCommands } from '#lib/ui/slash-menu.svelte.js';
import { buildDoc } from '../../src/site/docs/doc.server.js';
import { parseFrontmatter } from '../../src/site/docs/content.js';
import { STORY, CARDS, TYPING, PASTE, TRANSFORM, TEXT_BEHAVIOURS } from '../../src/site/tour/tour-content.js';
import { buildTour, referenceIndex, REFERENCE_PATH } from '../../src/site/tour/tour-data.js';
import { fillEngine, loadTour } from '../../src/site/tour/tour.server.js';
import { createTourEngine, loadTourEngine, tourPreset } from '../../src/site/tour/tour-preset.js';
import { jsonOf, markdownOf, htmlOf, stateOf, changedRange, pieces } from '../../src/site/tour/state.js';
import { typeBlockShortcut, typeInline, marksOf, flush } from './helpers/typing.js';

const ROOT = process.cwd();
const REFERENCE_FILE = 'docs/guides/blocks-reference.md';
const reference = readFileSync(join(ROOT, REFERENCE_FILE), 'utf8');
const { body: referenceBody } = parseFrontmatter(reference);
const refIndex = referenceIndex(referenceBody);
const tour = buildTour({ lib, reference: refIndex });
const byName = new Map(FullPreset.map((e) => [e.name, e]));

// ─── reading the reference: for each section, its bullets and the code spans of each ─────────────────────────

/** The inline code spans of a text (single or multiple backticks). */
function codeSpans(text) {
  return [...text.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)].map((m) => m[2].replace(/^ (.*) $/, '$1'));
}

/** `{ [extension name]: { bullets: { Label: text }, spans: { Label: string[] }, text } }` of the sections `### Title · \`name\`` of the reference. */
function readSections(md) {
  const lines = md.split('\n');
  const out = {};
  let current = null;
  let fence = '';
  let prev = '';
  for (const line of lines) {
    const before = prev;
    prev = line;
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = '';
      if (current) current.text += `${line}\n`;
      continue;
    }
    if (!fence) {
      // (the title of a live region example follows a region comment: it is not a heading of the page; a `####` is a live example too)
      const h = before.startsWith('<!-- region:') ? null : /^(#{2,3}) (.+?)\s*$/.exec(line);
      if (h) {
        const named = /^(.+) · `([a-z][a-z-]*)`$/.exec(h[2]);
        current = named ? (out[named[2]] = { title: named[1], bullets: {}, spans: {}, text: '' }) : null;
        continue;
      }
      const b = /^- \*\*([^*]+?)\.\*\* (.*)$/.exec(line);
      if (b && current) {
        current.bullets[b[1]] = b[2];
        current.spans[b[1]] = codeSpans(b[2]);
      }
    }
    if (current) current.text += `${line}\n`;
  }
  return out;
}
const sections = readSections(referenceBody);
const sectionOf = (name) => sections[name];
/** What the reference says in a bullet of any of the sections of a card. */
const referenceSpans = (card, label) => card.names.flatMap((n) => sectionOf(n)?.spans[label] ?? []);

// ─── 1. exhaustive ────────────────────────────────────────────────────────────

describe('the tour covers every extension of FullPreset', () => {
  const cardNames = CARDS.flatMap((c) => c.names);
  const typingNames = TYPING.map((m) => m.name);
  const pasteNames = PASTE.map((m) => m.name);

  it.each(FullPreset.map((e) => [e.name]))('%s has its card or its case, once', (name) => {
    const homes = [
      cardNames.includes(name) && 'a card',
      typingNames.includes(name) && 'typing',
      pasteNames.includes(name) && 'paste',
      TRANSFORM.name === name && 'transform',
    ].filter(Boolean);
    expect(homes, `"${name}" must have exactly one place in the tour`).toHaveLength(1);
  });

  it('names no extension that FullPreset does not have, and no card twice', () => {
    const all = [...cardNames, ...typingNames, ...pasteNames, TRANSFORM.name];
    expect(all.filter((n) => !byName.has(n))).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(FullPreset.length);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });

  it('the cards are the blocks, the cases are the behaviours and the readers', () => {
    for (const name of cardNames) expect(byName.get(name).block, `${name} registers a block`).toBeTruthy();
    for (const name of typingNames) expect(TEXT_BEHAVIOURS).toContain(name);
    expect(typingNames.slice().sort()).toEqual(TEXT_BEHAVIOURS.slice().sort());
    for (const name of pasteNames) expect(byName.get(name).pasteInterpreters.length, name).toBeGreaterThan(0);
    // and nothing else registers a block or a reader
    expect(FullPreset.filter((e) => e.block).map((e) => e.name).sort()).toEqual(cardNames.slice().sort());
    expect(FullPreset.filter((e) => e.pasteInterpreters.length).map((e) => e.name).sort()).toEqual(pasteNames.slice().sort());
    expect(TRANSFORM.topic in byName.get(TRANSFORM.name).actions).toBe(true);
  });

  it('the legend counts what the code says: 14 blocks, 3 text behaviours, 4 paste handlers, 1 transform', () => {
    expect(tour.legend).toEqual({ blocks: FullPreset.filter((e) => e.block).length, behaviours: 3, paste: FullPreset.filter((e) => e.pasteInterpreters.length).length, transform: 1 });
    expect(tour.legend).toEqual({ blocks: 14, behaviours: 3, paste: 4, transform: 1 });
  });

  it('the filters partition the cards the way the page says, and every card is in one', () => {
    for (const c of CARDS) {
      expect(c.groups.length, c.id).toBeGreaterThan(0);
      for (const g of c.groups) expect(['text', 'containers', 'structure', 'media']).toContain(g);
    }
    for (const g of ['text', 'containers', 'structure', 'media']) expect(CARDS.filter((c) => c.groups.includes(g)).length, g).toBeGreaterThan(0);
  });
});

// ─── the reference, as the cards link to it ──────────────────────────────────

describe('the cards point into the Blocks reference', () => {
  let anchors;
  beforeAll(async () => {
    const doc = await buildDoc(referenceBody, { dir: 'docs/guides' });
    anchors = new Set(Object.values(doc.ids));
  }, 60000);

  it('every extension has its section, and the anchor is the one the site draws', () => {
    for (const e of FullPreset) {
      expect(refIndex[e.name], `the reference has no "### Title · \`${e.name}\`" for ${e.name}`).toBeTruthy();
      expect(anchors.has(refIndex[e.name].anchor), `#${refIndex[e.name].anchor}`).toBe(true);
    }
  });

  it('every link of every card, case and the transform goes to one of them', () => {
    const hrefs = [...tour.cards.flatMap((c) => c.reference), ...tour.typing.map((m) => m.reference), ...tour.paste.map((m) => m.reference), tour.transform.reference].map((r) => r.href);
    expect(hrefs.length).toBe(FullPreset.length); // one link for each extension (a card may hold two)
    for (const href of hrefs) {
      expect(href.startsWith(`${REFERENCE_PATH}#`)).toBe(true);
      expect(anchors.has(href.slice(REFERENCE_PATH.length + 1)), href).toBe(true);
    }
  });

  it('the Blocks reference is where the site says (route, file, title)', () => {
    expect(existsSync(join(ROOT, REFERENCE_FILE))).toBe(true);
    expect(parseFrontmatter(reference).data).toMatchObject({ title: 'Blocks reference', section: 'guides' });
    expect(REFERENCE_PATH).toBe('/docs/guides/blocks-reference');
  });

  it('the API links are the exports of the library, and pages of the API reference', () => {
    const model = JSON.parse(readFileSync(join(ROOT, 'src/site/api/model.json'), 'utf8'));
    for (const card of tour.cards) {
      expect(card.api.length, `${card.id} has an API link`).toBeGreaterThan(0);
      for (const a of card.api) {
        expect(typeof lib[a.name], a.name).not.toBe('undefined');
        expect(model.items[`root/${a.name}`], `no API page for ${a.name}`).toBeTruthy();
        expect(a.href).toBe(`/api/root/${a.name}`);
      }
    }
    expect(tour.transform.api.map((a) => a.name)).toEqual(['BlockExtension']);
  });
});

// ─── 2. true ──────────────────────────────────────────────────────────────────

describe('the chips each card shows are real', () => {
  const engine = createFullEditor();

  it('a slash chip is a slash entry of the extension, and typing it in the menu finds that entry', () => {
    for (const card of tour.cards) {
      const entries = card.names.flatMap((n) => byName.get(n).slashCommands);
      expect(card.slash.length, `${card.id}: every slash entry has its chip`).toBe(entries.length);
      card.slash.forEach((chip, i) => {
        expect(chip).toMatch(/^\/[\w-]+$/);
        const found = filterSlashCommands(engine.slashCommands, chip.slice(1));
        expect(found, `${chip} finds "${entries[i].title}"`).toContain(entries[i]);
      });
    }
    // the blocks that have no entry say none
    expect(tour.cards.filter((c) => !c.slash.length).map((c) => c.id)).toEqual(['dialogue']);
    expect(tour.cards.find((c) => c.id === 'list').slash).toEqual(['/bullet', '/numbered', '/todo']);
  });

  describe('a typed shortcut makes the block it says', () => {
    const tries = CARDS.flatMap((c) => c.type.flatMap((chip) => chip.tries.map((t) => [`${c.id}: ${t.typed} + ${t.then}`, t])));
    it('there are some', () => expect(tries.length).toBeGreaterThanOrEqual(12));

    it.each(tries)('%s', async (_name, t) => {
      const { engine: eng, took, blocks } = await typeBlockShortcut(t.typed, t.then);
      expect(took).toBe(true);
      if (Array.isArray(t.makes)) expect(blocks).toEqual(t.makes);
      else {
        expect(eng.pendingCommand?.id).toBe(t.makes.chooser); // `:::` opens the chooser of the region types
      }
    });

    it('and the reference says the same: each is in its cheat sheet', () => {
      const cheat = sectionOf('markdown-shortcuts').spans ? sectionOf('markdown-shortcuts') : null;
      const spans = codeSpans(cheat?.text ?? '');
      for (const c of CARDS) for (const chip of c.type) for (const t of chip.tries) {
        if (/^#{1,6}$/.test(t.typed)) expect(spans).toContain('#'); // the cheat sheet writes `#` to `######`
        else expect(spans, `the cheat sheet of the reference lacks ${t.typed} (${c.id})`).toContain(t.typed);
      }
    });

    it('a block with no typed shortcut says "Nothing" in the reference, and a block with one does not', () => {
      for (const c of CARDS) {
        const sayings = c.names.map((n) => sectionOf(n).bullets.Type ?? '');
        if (!c.type.length) for (const s of sayings.filter((x) => x)) expect(s, c.id).toMatch(/^(Nothing|The list's shortcuts)/);
        else expect(sayings[0], c.id).not.toMatch(/^Nothing/);
      }
    });
  });

  it('a Markdown chip is in the Markdown the example writes, an HTML chip in its HTML', async () => {
    for (const c of CARDS) {
      const eng = createFullEditor();
      await fillEngine(eng, c.example);
      const md = markdownOf(eng);
      const html = htmlOf(eng);
      for (const m of c.md) expect(md, `${c.id}: Markdown chip ${m.label}`).toContain(m.has);
      for (const h of c.html) expect(html, `${c.id}: HTML chip ${h.label}`).toContain(h.has);
    }
  });

  it('every chip of a card is in the Markdown and HTML bullet of the reference', () => {
    for (const c of CARDS) {
      const said = c.names.map((n) => sectionOf(n).bullets['Markdown and HTML'] ?? '').join(' ');
      expect(said.length, c.id).toBeGreaterThan(0);
      for (const h of c.html) {
        // `<h1> … <h6>`, `<ul> <ol> <li>`: each tag named is one the reference names
        for (const tag of h.label.match(/<[a-z][a-z0-9]*/g)) expect(said, `${c.id}: ${h.label}`).toContain(tag);
      }
    }
  });

  it('`paste` and `drop` are what the file handlers of the extension do, and the reference says so', () => {
    for (const c of CARDS.filter((x) => x.files?.length)) {
      for (const n of c.names) expect(byName.get(n).pasteFileHandlers.length, `${n} takes files`).toBeGreaterThan(0);
      const type = c.names.map((n) => sectionOf(n).bullets.Type).join(' ');
      for (const word of c.files) expect(type, c.id).toContain(word);
    }
    expect(CARDS.filter((c) => !c.files?.length).every((c) => c.names.every((n) => byName.get(n).pasteFileHandlers.length === 0))).toBe(true);
  });

  it('the presets of a card are the presets that hold every one of its extensions', () => {
    const real = (names) => Object.entries({ Minimal: MinimalPreset, Text: TextPreset, Document: DocumentPreset, Full: FullPreset }).filter(([, p]) => names.every((n) => p.some((x) => x.name === n))).map(([l]) => l);
    for (const card of tour.cards) expect(card.presets, card.id).toEqual(real(card.names));
    expect(tour.cards.find((c) => c.id === 'list').presets).toEqual(['Full']); // the reference: "Full only"
    expect(tour.cards.find((c) => c.id === 'toggle').presets).toEqual(['Document', 'Full']);
    // and it agrees with the Presets bullet of the reference
    for (const c of CARDS) for (const n of c.names) {
      const said = [...(sectionOf(n).bullets.Presets ?? '').matchAll(/\b(Minimal|Text|Document|Full)\b/g)].map((m) => m[1]);
      expect(said, `${n}: the reference's Presets`).toEqual(real([n]));
    }
  });
});

describe('the facts of a card are the ones of the Blocks reference', () => {
  it('every key a card names is a key the reference names for the block', () => {
    for (const c of CARDS) {
      const named = referenceSpans(c, 'Keys');
      for (const k of c.keys) for (const chord of k.keys) expect(named, `${c.id}: the reference's Keys bullet lacks ${chord}`).toContain(chord);
    }
  });

  it('a block with no keys of its own says so, as the reference does', () => {
    for (const c of CARDS.filter((x) => !x.keys.length)) {
      expect(c.keysNote, c.id).toBeTruthy();
      for (const n of c.names) expect(sectionOf(n).bullets.Keys, n).toMatch(/^None/);
    }
  });

  it('every prop a card names is named by the reference, for the block', () => {
    for (const c of CARDS) {
      const props = [...c.contains.matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1]);
      const contains = c.names.map((n) => sectionOf(n).bullets.Contains ?? '').join(' ');
      const named = codeSpans(contains);
      for (const p of props) expect(named, `${c.id}: the reference's Contains bullet lacks \`${p}\``).toContain(p);
    }
  });

  it('the keys of the commands (generated) are the keys the reference gives, so the card and the page agree', () => {
    for (const card of tour.cards) {
      const named = card.names.flatMap((n) => sectionOf(n).spans.Keys ?? []);
      for (const chord of card.shortcuts) expect(named, `${card.id}: the reference lacks the key ${chord}`).toContain(chord);
    }
    expect(tour.cards.find((c) => c.id === 'region').shortcuts).toEqual(['Mod-Enter', 'Backspace', 'Shift-Backspace', 'Delete', 'Mod-Shift-Enter', 'Tab', 'Shift-Tab']);
    expect(tour.cards.find((c) => c.id === 'list').shortcuts).toEqual(['Mod-Enter']);
  });

  it('the sentences are short, in English, and no URL stands in the prose', () => {
    const texts = [...CARDS.flatMap((c) => [c.sentence, c.about, c.contains, ...c.keys.map((k) => k.does)]), ...[...TYPING, ...PASTE].map((m) => m.sentence), TRANSFORM.sentence];
    for (const t of texts) {
      expect(t, t).not.toMatch(/https?:\/\//);
      for (const sentence of t.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(42);
    }
    expect(JSON.stringify([STORY, CARDS, TYPING, PASTE])).not.toMatch(/https?:\/\//);
  });
});

describe('the examples are real blocks', () => {
  it('each card example imports to the blocks of the card (and to nothing the card does not name)', async () => {
    for (const c of CARDS) {
      const eng = createTourEngine();
      await fillEngine(eng, c.example);
      const types = new Set();
      const walk = (blocks) => blocks.forEach((b) => { types.add(b.type); walk(b.children ?? []); });
      walk(eng.serialize('json').blocks);
      for (const n of c.names) expect(types.has(n), `${c.id} shows a ${n}`).toBe(true);
      // (what a block holds, a toggle's paragraph, is its own business: the blocks at the top are the card's)
      for (const b of eng.serialize('json').blocks) expect(c.names, `${c.id}: the example holds a ${b.type}`).toContain(b.type);
    }
  });

  it('the specific facts: the toggle is open, the callout a note, the to-do has a ticked item, the region has a body', async () => {
    const make = async (id) => { const eng = createTourEngine(); await fillEngine(eng, CARDS.find((c) => c.id === id).example); return eng.serialize('json').blocks; };
    expect((await make('toggle'))[0].props.collapsed).toBe(false);
    expect((await make('callout'))[0].props.variant).toBe('note');
    expect((await make('list'))[0].children.map((i) => i.props.checked)).toEqual([false, true]);
    expect((await make('region'))[0].children.length).toBe(1);
    expect((await make('code'))[0].props.language).toBe('js');
  });

  it('the story holds EVERY block of FullPreset that can be drawn read-only, in one document', async () => {
    const eng = createTourEngine();
    await fillEngine(eng, { md: STORY.md });
    const types = new Set();
    const walk = (blocks) => blocks.forEach((b) => { types.add(b.type); walk(b.children ?? []); });
    walk(eng.serialize('json').blocks);
    const blockNames = FullPreset.filter((e) => e.block).map((e) => e.name);
    for (const n of blockNames) expect(types.has(n), `the story lacks a ${n}`).toBe(true);
    // the characters of the story, and the two collapsed-or-open states a reader meets
    const md = markdownOf(eng);
    for (const word of ['ferryman', 'lantern', 'Nobody had crossed since noon.', 'the rope', 'the oar', 'What the ferryman knew', 'The river rises at night.']) expect(md).toContain(word);
    // no stand-in is left over in the document
    expect(md).not.toContain('[[');
    const toggle = eng.serialize('json').blocks[0].children.find((b) => b.type === 'toggle');
    expect(toggle.props.collapsed).toBe(true); // closed: "▸ What the ferryman knew"
  });

  it('the media are files that exist, a few KB, local', () => {
    const refs = new Set();
    const scan = (text) => { for (const m of text.matchAll(/(?:\]\(|\[\[(?:video|file) )(\/[^)\s|\]]+)/g)) refs.add(m[1]); };
    scan(STORY.md);
    for (const c of CARDS) { if (c.example.md) scan(c.example.md); }
    expect(refs.size).toBeGreaterThanOrEqual(3);
    for (const ref of refs) {
      expect(ref.startsWith('/tour/'), ref).toBe(true);
      const file = join(ROOT, 'static', ref);
      expect(existsSync(file), `static${ref} does not exist: it would 404`).toBe(true);
      expect(statSync(file).size, `${ref} is not tiny`).toBeLessThan(60 * 1024);
      expect(statSync(file).size, `${ref} is empty`).toBeGreaterThan(200);
    }
    expect([...refs].some((r) => r.endsWith('.mp4')) && [...refs].some((r) => r.endsWith('.pdf')) && [...refs].some((r) => r.endsWith('.svg'))).toBe(true);
    // a real mp4 and a real PDF, not a placeholder with the right name
    expect(readFileSync(join(ROOT, 'static/tour/river-at-dusk.mp4')).subarray(4, 8).toString()).toBe('ftyp');
    expect(readFileSync(join(ROOT, 'static/tour/crossing-ledger.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('what happens as you type, and when you paste, is what the editor does', () => {
  it('rich text: Mod-b is the key of bold, and the "after" is a bold word', () => {
    const m = TYPING.find((x) => x.name === 'rich-text');
    const command = byName.get('rich-text').commands[m.proof.command];
    expect(command.keys).toContain(m.proof.chord);
    expect(m.before.toLowerCase()).toContain(m.proof.chord.toLowerCase().replace('mod-', 'mod-'));
    expect(m.after).toBe('**ferryman**');
  });

  it('markdown shortcuts: typing **ferry** makes ferry bold', async () => {
    const m = TYPING.find((x) => x.name === 'markdown-shortcuts');
    const { delta } = await typeInline(m.proof.md, m.proof.typed, m.proof.data);
    expect(marksOf(delta)).toEqual([{ text: 'ferry', marks: ['bold'] }]);
    expect(m.before).toBe('**ferry**');
    expect(m.after).toBe('**ferry**');
  });

  it('typography: noon -- dusk becomes noon — dusk', async () => {
    const m = TYPING.find((x) => x.name === 'typography');
    const { text } = await typeInline(m.proof.md, m.proof.typed, m.proof.data);
    expect(text).toBe('x noon — ');
    expect(m.before).toBe('noon -- dusk');
    expect(m.after).toBe('noon — dusk');
  });

  describe.each(PASTE.map((m) => [m.name, m]))('%s', (name, m) => {
    it('the reader reads what the clipboard holds, and makes the blocks the "after" shows', async () => {
      const reader = byName.get(name).pasteInterpreters.find((i) => i.format === m.proof.format);
      expect(reader, `${name} reads ${m.proof.format}`).toBeTruthy();
      const eng = createFullEditor();
      const fragment = reader.interpret(m.proof.payload, eng);
      await eng.importFragment(fragment);
      expect(eng.serialize('markdown')).toBe(m.after);
    });

    it('"before" is the clipboard, as it is', () => {
      if (m.proof.format === 'application/x-nabu+json') expect(JSON.parse(m.proof.payload).blocks.length).toBeGreaterThan(0);
      else expect(m.before).toBe(m.proof.payload);
    });
  });

  it('the paste readers keep the order of the reference: Nabu, HTML, Markdown, plain text', () => {
    expect(PASTE.map((m) => m.name)).toEqual(['nabu-paste', 'html-paste', 'markdown-paste', 'plain-text-paste']);
    expect(PASTE.map((m) => byName.get(m.name).pasteInterpreters[0].priority)).toEqual([100, 50, 25, 0]);
  });

  it('block:transform turns a block into another, keeping its text and its id', async () => {
    const eng = createFullEditor();
    await eng.importMarkdown('The last ferry');
    const id = eng.children[0].id;
    eng.children[0].transformTo('heading', { level: 2 });
    await eng.commit();
    expect(eng.children[0].id).toBe(id);
    expect(markdownOf(eng)).toBe('## The last ferry');
    expect(TRANSFORM.call).toBe("nabu.exec('block:transform', { type, props })");
    expect(TRANSFORM.sentence).toMatch(/text/);
  });
});

// ─── 4. the state of a card ───────────────────────────────────────────────────

describe('the state a card shows: JSON, Markdown, HTML', () => {
  it('JSON is serialize("json") without the block ids; one block is shown alone', async () => {
    const eng = createFullEditor();
    await eng.importMarkdown('# Dusk');
    expect(JSON.parse(jsonOf(eng))).toEqual({ type: 'heading', props: { level: 1 }, content: [{ text: 'Dusk' }] });
    expect(jsonOf(eng)).not.toMatch(/"id"/);
    await eng.importMarkdown('# Dusk\n\nNight.');
    expect(JSON.parse(jsonOf(eng))).toHaveLength(2);
    expect(JSON.parse(jsonOf(eng))).toEqual(eng.serialize('json').blocks.map(({ id, ...b }) => b));
  });

  it('Markdown is serialize("markdown"); HTML is what each block writes on copy, joined', async () => {
    const eng = createFullEditor();
    await eng.importMarkdown('# Dusk\n\nThe **ferryman**.\n\n- [x] the oar\n\n<details open>\n<summary>S</summary>\n\nbody\n\n</details>');
    const s = stateOf(eng);
    expect(s.markdown).toBe(eng.serialize('markdown'));
    expect(s.html).toBe('<h1>Dusk</h1>\n<p>The <strong>ferryman</strong>.</p>\n<ul class="contains-task-list"><li><input type="checkbox" disabled checked> the oar</li></ul>\n<details open><summary>S</summary><p>body</p></details>');
  });

  it('the HTML is the HTML of a copy: the same writer, block by block', async () => {
    // the clipboard HTML of a selection of the whole document is `htmlOf` (the engine writes it with the same calls)
    const eng = createTourEngine();
    await fillEngine(eng, { md: STORY.md });
    const html = htmlOf(eng);
    for (const tag of ['<section data-nabu-region="section-1"', '<h3>', '<blockquote>', '<aside class="callout callout-note"', '<details>', '<hr>', '<pre><code', '<img src="/tour/quay-at-dusk.svg"', '<video src="/tour/river-at-dusk.mp4" controls>', '<a href="/tour/crossing-ledger.pdf" download="crossing-ledger.pdf">']) expect(html, tag).toContain(tag);
  });

  it('the state follows the document: the text a card shows changes with what is typed', async () => {
    const eng = loadTourEngine((await loadTour()).cards.find((c) => c.id === 'paragraph').doc.snapshot, false);
    const before = stateOf(eng);
    eng.children[0].insert(0, 'Hello. ');
    await eng.commit();
    await flush();
    const after = stateOf(eng);
    expect(after.markdown).toBe('Hello. The **ferryman** waited under the eaves.');
    expect(after.json).toContain('Hello. ');
    expect(after.html).toContain('Hello. ');
    const range = changedRange(before.markdown, after.markdown);
    expect(after.markdown.slice(...range)).toBe('Hello. ');
  });

  it('changedRange: what was added, nothing when nothing was', () => {
    expect(changedRange('abc', 'abc')).toBeNull();
    expect(changedRange('abc', 'abXc')).toEqual([2, 3]);
    expect(changedRange('abc', 'abcd')).toEqual([3, 4]);
    expect(changedRange('abcd', 'abc')).toBeNull(); // a deletion adds nothing
    expect(changedRange('', 'x')).toEqual([0, 1]);
    expect(changedRange('aa', 'aaa')).toEqual([2, 3]);
  });

  it('pieces: the texts add up, JSON is toned, the changed range is hot', () => {
    const text = '{\n  "type": "heading",\n  "props": { "level": 2 },\n  "ok": true\n}';
    const p = pieces(text, { json: true });
    expect(p.map((x) => x.text).join('')).toBe(text);
    expect(p.find((x) => x.text === '"type"').tone).toBe('key');
    expect(p.find((x) => x.text === '"heading"').tone).toBe('string');
    expect(p.find((x) => x.text === '2').tone).toBe('literal');
    expect(p.find((x) => x.text === 'true').tone).toBe('literal');
    const hot = pieces(text, { json: true, hot: [text.indexOf('heading') , text.indexOf('heading') + 3] });
    expect(hot.map((x) => x.text).join('')).toBe(text);
    expect(hot.filter((x) => x.hot).map((x) => x.text).join('')).toBe('hea');
    expect(pieces('plain <b>', { json: false }).map((x) => x.tone)).toEqual(['']);
  });
});

// ─── the build ────────────────────────────────────────────────────────────────

describe('the tour as the page receives it', () => {
  let page;
  beforeAll(async () => { page = await loadTour(); }, 60000);

  it('carries a document for the story, each card, and each "after"', () => {
    expect(page.story.doc.snapshot.length).toBeGreaterThan(100);
    expect(page.cards).toHaveLength(12);
    expect(page.cards.every((c) => c.doc.snapshot.length > 100 && !('example' in c))).toBe(true);
    expect(page.typing).toHaveLength(3);
    expect(page.paste).toHaveLength(4);
    expect(Object.keys(page.cardOf).sort()).toEqual(FullPreset.filter((e) => e.block).map((e) => e.name).sort());
  });

  it('is reproducible: the same input gives the same snapshots, so the same prerendered markup', async () => {
    // (a snapshot has timestamps in it: what has to agree is what the pages are drawn from, the ids and the content)
    const again = await loadTour();
    const ids = (snapshot) => { const out = []; const walk = (bs) => bs.forEach((x) => { out.push(x.id); walk(x.children ?? []); }); walk(loadTourEngine(snapshot).children); return out; };
    const md = (snapshot) => markdownOf(loadTourEngine(snapshot));
    expect(ids(again.story.doc.snapshot)).toEqual(ids(page.story.doc.snapshot));
    expect(md(again.story.doc.snapshot)).toBe(md(page.story.doc.snapshot));
    expect(again.cards.map((c) => ids(c.doc.snapshot))).toEqual(page.cards.map((c) => ids(c.doc.snapshot)));
    expect(again.paste.map((c) => ids(c.doc.snapshot))).toEqual(page.paste.map((c) => ids(c.doc.snapshot)));
    expect(again.cards.map((c) => c.doc.code)).toEqual(page.cards.map((c) => c.doc.code));
  });

  it('the browser rebuilds the same document from a snapshot, with the same block ids', () => {
    const a = loadTourEngine(page.story.doc.snapshot);
    const b = loadTourEngine(page.story.doc.snapshot);
    const ids = (e) => { const out = []; const walk = (bs) => bs.forEach((x) => { out.push(x.id); walk(x.children ?? []); }); walk(e.children); return out; };
    expect(ids(a).length).toBeGreaterThan(15);
    expect(ids(a)).toEqual(ids(b));
    expect(a.readonly).toBe(true);
    expect(markdownOf(a)).toContain('Nobody had crossed since noon.');
    // the engine of an open card can be made editable
    expect(loadTourEngine(page.story.doc.snapshot, false).readonly).toBe(false);
  });

  it('the code of the examples is highlighted at build time (the Shiki tokens add up to the code)', () => {
    const card = page.cards.find((c) => c.id === 'code');
    const tokens = Object.values(card.doc.code)[0];
    expect(tokens.map((t) => t[0]).join('')).toBe('const lantern = { lit: false };');
    expect(tokens.some((t) => t[1])).toBe(true);
    expect(Object.keys(page.story.doc.code)).toHaveLength(1);
  });

  it('the editors of the tour hold all of FullPreset', () => {
    expect([...new Set(tourPreset().map((e) => e.name))]).toEqual(FullPreset.map((e) => e.name)); // (`code` is there twice: its redrawn component)
    expect(tourPreset().filter((e) => e.name === 'code')).toHaveLength(2);
  });
});
