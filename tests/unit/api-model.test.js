/**
 * The API reference model (scripts/api-model.js: JSDoc -> TypeDoc -> model.json, rendered by src/routes/(site)/api).
 *
 * The model is built here in memory, from the sources, exactly as `bun run api:model` does. It must agree with what the
 * package really exports (the pinned lists of public-api.test.js are the same runtime exports) and it must list every member
 * tagged `@public` (the stable contract pinned by extend-contract.test.js).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel, validAnchors } from '../../scripts/api-model.js';
import { CONTRACT_CLASSES } from '../../scripts/api-config.js';

const TIMEOUT = 120000;
const read = (/** @type {string} */ path) => readFileSync(`${process.cwd()}/${path}`, 'utf8');

/** @type {any} */
let model;
beforeAll(async () => { model = await buildModel(); }, TIMEOUT);

/** Runtime export names of an entry, as the model lists them (types are not runtime values). */
const runtimeNames = (/** @type {string} */ entry) =>
  Object.values(model.items)
    .filter((/** @type {any} */ i) => i.entry === entry && i.kind !== 'type' && !i.reachedThrough)
    .map((/** @type {any} */ i) => i.name)
    .sort();

describe('export names per entry point', () => {
  it('@aionbuilders/nabu', async () => {
    expect(runtimeNames('root')).toEqual(Object.keys(await import('#lib/index.js')).sort());
  }, TIMEOUT);

  it('@aionbuilders/nabu/ui', async () => {
    expect(runtimeNames('ui')).toEqual(Object.keys(await import('#lib/ui/index.js')).sort());
  }, TIMEOUT);

  it('@aionbuilders/nabu/extend', async () => {
    expect(runtimeNames('extend')).toEqual(Object.keys(await import('#lib/extend.js')).sort());
  }, TIMEOUT);

  it('lists the types too, each with a stable id', () => {
    const types = Object.values(model.items).filter((/** @type {any} */ i) => i.kind === 'type');
    expect(types.length).toBeGreaterThan(40);
    for (const item of /** @type {any[]} */ (Object.values(model.items))) expect(item.id).toBe(`${item.entry}/${item.name}`);
  });

  it('page names differ by more than their case, but for the known pair (a case-insensitive disk would merge two prerendered pages)', () => {
    // `extension()` and `Extension` (src/lib/extend.js) are both pages; the build runs on Linux (case-sensitive). A NEW pair fails here.
    const KNOWN = ['extend/extension'];
    const seen = new Map();
    const clashes = [];
    for (const item of /** @type {any[]} */ (Object.values(model.items))) {
      const key = `${item.entry}/${item.name.toLowerCase()}`;
      if (seen.has(key)) clashes.push(key);
      seen.set(key, item.id);
    }
    expect(clashes).toEqual(KNOWN);
  });

  it('every entry group lists existing items, once', () => {
    const listed = new Set();
    for (const entry of model.entries) {
      for (const group of entry.groups) {
        for (const name of group.items) {
          expect(model.items[`${entry.id}/${name}`], `${entry.id}/${name}`).toBeDefined();
          expect(listed.has(`${entry.id}/${name}`)).toBe(false);
          listed.add(`${entry.id}/${name}`);
        }
      }
    }
    expect(listed.size).toBe(Object.keys(model.items).length);
  });
});

// The same scan as tests/unit/extend-contract.test.js: a JSDoc comment holding `@public` and the declaration after it.
function publicMembers(/** @type {string} */ path) {
  const source = read(path);
  /** @type {Set<string>} */
  const instance = new Set();
  /** @type {Set<string>} */
  const statics = new Set();
  const comment = /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/[ \t]*\n[ \t]*([^\n]+)/g;
  for (const [, body, line] of source.matchAll(comment)) {
    if (!/@public\b/.test(body)) continue;
    const member = /^static\s+(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)/.exec(line);
    if (member) { statics.add(member[1]); continue; }
    const plain = /^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:\(|=|;)/.exec(line) ?? /^this\.([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (plain) instance.add(plain[1]);
  }
  return { instance: [...instance].sort(), statics: [...statics].sort() };
}

describe('the stable contract: every @public member appears', () => {
  const files = /** @type {Record<string, string>} */ ({
    Nabu: 'src/lib/blocks/nabu.svelte.js',
    Block: 'src/lib/blocks/block.svelte.js',
    TextBlock: 'src/lib/blocks/text-block.svelte.js',
    MegaBlock: 'src/lib/blocks/megablock.svelte.js',
    TextBehavior: 'src/lib/behaviors/text/text.behavior.svelte.js',
    NabuSelection: 'src/lib/blocks/selection.svelte.js',
    SvelteSelection: 'src/lib/utils/selection.svelte.js',
    CommandRegistry: 'src/lib/utils/commands.js',
  });

  it('covers the eight classes of the contract', () => {
    expect(Object.keys(files).sort()).toEqual([...CONTRACT_CLASSES].sort());
  });

  for (const name of CONTRACT_CLASSES) {
    it(`${name}: own @public members are documented, instance and static`, () => {
      const item = /** @type {any} */ (Object.values(model.items)).find((/** @type {any} */ i) => i.name === name && i.kind === 'class');
      expect(item, name).toBeDefined();
      const own = item.members.filter((/** @type {any} */ m) => !m.inheritedFrom);
      const pinned = publicMembers(files[name]);
      expect([...new Set(own.filter((/** @type {any} */ m) => !m.static).map((/** @type {any} */ m) => m.name))].sort()).toEqual(pinned.instance);
      expect([...new Set(own.filter((/** @type {any} */ m) => m.static).map((/** @type {any} */ m) => m.name))].sort()).toEqual(pinned.statics);
    });
  }

  it('documents as many members as there are @public tags (195 today: Nabu counts BREAK and CONTINUE once each, static and instance)', () => {
    const total = CONTRACT_CLASSES.reduce((sum, name) => {
      const item = /** @type {any} */ (Object.values(model.items)).find((/** @type {any} */ i) => i.name === name && i.kind === 'class');
      // instance + static, the same member counted once per side as extend-contract.test.js counts it
      const own = item.members.filter((/** @type {any} */ m) => !m.inheritedFrom);
      return sum + own.length;
    }, 0);
    const pinned = Object.entries(files).reduce((sum, [, path]) => {
      const { instance, statics } = publicMembers(path);
      return sum + instance.length + statics.length;
    }, 0);
    expect(total).toBe(pinned);
  });

  it('only @public members are listed for a class of the contract', () => {
    const nabu = model.items['root/Nabu'];
    const names = nabu.members.map((/** @type {any} */ m) => m.name);
    expect(names).not.toContain('handleKeydown');
    expect(names).toContain('exec');
  });
});

describe('nabu.internals (unstable)', () => {
  it('lists exactly the keys of the frozen object', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    expect(model.internals.keys.slice().sort()).toEqual(Object.keys(createTextEditor().internals).sort());
  }, TIMEOUT);

  it('is flagged unstable, on the type and on the member', () => {
    expect(model.items[model.internals.id].stability).toBe('unstable');
    const member = model.items['root/Nabu'].members.find((/** @type {any} */ m) => m.name === 'internals');
    expect(member.unstable).toBe(true);
  });

  it('the rest of the API is stable', () => {
    const others = /** @type {any[]} */ (Object.values(model.items)).filter((i) => i.id !== model.internals.id);
    expect(others.every((i) => i.stability === 'stable')).toBe(true);
  });
});

describe('what a page needs', () => {
  it('a function has a signature and its parameters', () => {
    const fn = model.items['root/createPersistedEditor'];
    expect(fn.kind).toBe('function');
    expect(fn.signatures[0].code).toMatch(/^function createPersistedEditor\(/);
    expect(fn.signatures[0].params.map((/** @type {any} */ p) => p.name)).toContain('options.docId');
    expect(fn.guide.href).toBe('/docs/guides/persistence-and-sync');
  });

  it('a link target is an item, and its anchor is drawn on that item\'s page', () => {
    /** @type {string[]} */
    const bad = [];
    const visit = (/** @type {any} */ node) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      if (typeof node.to === 'string' && typeof node.t === 'string') {
        const [id, anchor] = node.to.split('#');
        if (!model.items[id] || (anchor && !validAnchors(model.items[id]).has(anchor))) bad.push(node.to);
      }
      for (const v of Object.values(node)) {
        // Markdown links of the prose: [label](api:<id>[#anchor])
        if (typeof v === 'string') for (const [, target] of v.matchAll(/\]\(api:([^)]+)\)/g)) {
          const [id, anchor] = target.split('#');
          if (!model.items[id] || (anchor && !validAnchors(model.items[id]).has(anchor))) bad.push(target);
        }
        visit(v);
      }
    };
    visit(model.items);
    expect(bad).toEqual([]);
  });

  it('components come from the .svelte source with their props', () => {
    const toolbar = model.items['ui/FloatingToolbar'];
    expect(toolbar.kind).toBe('component');
    expect(toolbar.props.map((/** @type {any} */ p) => p.name)).toEqual(['engine']);
    const editor = model.items['root/NabuEditor'];
    expect(editor.props.map((/** @type {any} */ p) => p.name)).toEqual(['engine', 'label', 'labelledby', 'readonly']);
    expect(editor.props.find((/** @type {any} */ p) => p.name === 'label').description).toMatch(/accessible name/);
  });
});
