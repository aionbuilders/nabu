/**
 * The `@aionbuilders/nabu/extend` contract (audit P-119, "wide access, clear promise").
 *
 * Two doors for a third-party block or extension:
 *
 *   1. The STABLE contract: every member tagged `@public` in the JSDoc of `Nabu`, `Block`, `TextBlock`, `MegaBlock`, `TextBehavior`,
 *      `NabuSelection` / `SvelteSelection` and `CommandRegistry`. It follows semver: a change is a breaking change.
 *   2. `nabu.internals`: references to the engine machinery, explicitly UNSTABLE (any minor version may change it).
 *
 * This file pins both lists. A new `@public` tag, a removed one, or a new key of `internals` fails here: the change must be made
 * on purpose, here, in `docs/guides/extensions.md` ("Stability") and in CHANGELOG.md. It also forces every member of `Nabu` /
 * `Block` / `TextBlock` / `MegaBlock` to be classified: stable, or listed as not promised.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (/** @type {string} */ path) => readFileSync(`${process.cwd()}/${path}`, 'utf8');
const sorted = (/** @type {Iterable<string>} */ names) => [...names].sort();

// ---------------------------------------------------------------------------------------------------------------------
// The pinned lists
// ---------------------------------------------------------------------------------------------------------------------

/** `@public` members of `Nabu`: instance members, then statics. Methods are listed in METHODS to check their kind too. */
const NABU = {
  instance: [
    'BREAK', 'CONTINUE', 'blocks', 'blocksByType', 'cancelPendingCommand', 'children',
    'commandAnnouncement', 'commands', 'commit', 'components', 'composing', 'composingBlock',
    'createPasteBlock', 'debugging', 'defaultBlockType', 'delete', 'doc', 'exec', 'extensions',
    'focus', 'importFragment', 'importJSON', 'importMarkdown', 'importRemote', 'insert',
    'insertPasteBlock', 'internals', 'isEmpty', 'isMarkActive', 'isolateUndoStep', 'lang', 'lastVisibleBlock',
    'openTrailingCaret', 'pendingCommand', 'pendingCommandOn', 'placeholders', 'positions', 'redo',
    'registry', 'resolveDocumentOffset', 'selection', 'serialize', 'serializers', 'shortcut',
    'slashCommands', 'spellcheck', 'systems', 'tab', 'tabHint', 'transact', 'tree', 'trigger',
    'undo', 'warn',
  ],
  static: [
    'BREAK', 'CONTINUE',
  ],
};

/** @type {string[]} */
const NABU_METHODS = [
  'cancelPendingCommand', 'commit', 'createPasteBlock', 'delete', 'exec', 'focus',
  'importFragment', 'importJSON', 'importMarkdown', 'importRemote', 'insert', 'insertPasteBlock',
  'isMarkActive', 'isolateUndoStep', 'openTrailingCaret', 'pendingCommandOn', 'redo',
  'resolveDocumentOffset', 'serialize', 'shortcut', 'transact', 'trigger', 'undo', 'warn',
];

/** Members of a `Nabu` instance that are NOT part of the stable contract (reachable, but no promise; most are in `internals`). */
const NABU_NOT_PROMISED = [
  'beforeinput', 'captureUndoSelection', 'clearStoredMarks', 'commandConfirm', 'content',
  'deleteNode', 'dispatchEventToSelection', 'dropAt', 'dropTarget', 'fileConfig',
  'handleBeforeinput', 'handleCompositionEnd', 'handleCompositionStart', 'handleCompositionUpdate',
  'handleCopy', 'handleCut', 'handleDragEnd', 'handleDragLeave', 'handleDragOver',
  'handleDragStart', 'handleDrop', 'handleKeydown', 'handleMousedown', 'handlePaste', 'hookOwners',
  'hooks', 'init', 'inputRules', 'insertFragment', 'noteTextChange', 'rearmTab',
  'sealUndoEnd', 'storedMarks', 'tabDescription', 'toggleStoredMark', 'undoManager', 'updateRoots',
];

const INTERNALS = [
  'beforeinput', 'captureUndoSelection', 'clearStoredMarks', 'commandConfirm', 'content',
  'deleteNode', 'dispatchEventToSelection', 'dropAt', 'dropTarget', 'fileConfig',
  'handleBeforeinput', 'handleCompositionEnd', 'handleCompositionStart', 'handleCompositionUpdate',
  'handleCopy', 'handleCut', 'handleDragEnd', 'handleDragLeave', 'handleDragOver',
  'handleDragStart', 'handleDrop', 'handleKeydown', 'handleMousedown', 'handlePaste', 'hookOwners',
  'hooks', 'inputRules', 'insertFragment', 'noteTextChange', 'pasteFileHandlers',
  'pasteInterpreters', 'pulse', 'rearmTab', 'sealUndoEnd', 'selection', 'storedMarks',
  'tabDescription', 'toggleStoredMark', 'undoManager', 'updateRoots',
];

const BLOCK = {
  instance: [
    'absorbs', 'acceptPaste', 'adoptsPastedTypes', 'ascend', 'beforeinput', 'behaviors',
    'clearSelection', 'commit', 'component', 'consume', 'delete', 'destroy', 'dragRange',
    'element', 'findBackward', 'findForward', 'findLastDescendant', 'focus', 'getAdjacentSiblings',
    'getDOMPoint', 'hidesChildren', 'id', 'index', 'insert', 'isIntermediate', 'isSelectionEnd',
    'isSelectionStart', 'isolatesSelection', 'keydown', 'marksEnabled', 'mergeWith', 'nabu',
    'next', 'node', 'parent', 'parents', 'pastesAsPlainText', 'placeholder', 'positions',
    'previous', 'requiredParent', 'resolveOffset', 'retype', 'selected', 'selection', 'serialize',
    'serializers', 'split', 'splitsOnEnter', 'transformTo', 'transformsEnabled', 'type',
    'wordCount',
  ],
  static: [
    'create', 'fromHTML', 'fromMarkdown', 'htmlRules', 'htmlSiblings', 'load', 'markdownRules',
    'toHtml', 'toMarkdown',
  ],
};
const BLOCK_METHODS = [
  'absorbs', 'acceptPaste', 'ascend', 'beforeinput', 'clearSelection', 'commit', 'consume',
  'delete', 'destroy', 'dragRange', 'findBackward', 'findForward', 'findLastDescendant', 'focus',
  'getAdjacentSiblings', 'getDOMPoint', 'insert', 'keydown', 'mergeWith', 'resolveOffset',
  'retype', 'serialize', 'split', 'transformTo',
];
/** Members of a block that are NOT part of the stable contract: none. Anything a block exposes is meant to be overridden or read. */
/** @type {string[]} */
const BLOCK_NOT_PROMISED = [];

const TEXT_BLOCK = {
  instance: [
    'absorbs', 'applyDelta', 'beforeinput', 'behavior', 'container', 'delete', 'delta',
    'getDOMPoint', 'insert', 'positions', 'selection', 'split', 'text', 'wordCount',
  ],
  static: [

  ],
};
const MEGA_BLOCK = {
  instance: [
    'adoptChildren', 'beforeinput', 'children', 'clipboardProps', 'clipboardPropsFrom',
    'positions', 'resolveOffset', 'serializeForClipboard', 'updateChildren', 'wordCount',
  ],
  static: [

  ],
};
const TEXT_BEHAVIOR = {
  instance: [
    'absorbs', 'applyDelta', 'applyMark', 'block', 'container', 'delete', 'delta', 'getDOMPoint',
    'handleBeforeInput', 'insert', 'isMarkActive', 'positions', 'removeMark', 'selection', 'split',
    'text', 'toClipboardBlock', 'toJSON', 'toMarkdown', 'toggleMark', 'wordCount',
  ],
  static: [

  ],
};
const NABU_SELECTION = {
  instance: [
    'anchorBlock', 'blocks', 'end', 'endBlock', 'focusBlock', 'isRange', 'selectBetween',
    'selectBlockText', 'setCursor', 'start', 'startBlock',
  ],
  static: [

  ],
};
const SVELTE_SELECTION = {
  instance: [
    'anchorNode', 'anchorOffset', 'endOffset', 'focusNode', 'focusOffset', 'is', 'isCollapsed',
    'range', 'setBaseAndExtent', 'startOffset', 'sync', 'text',
  ],
  static: [

  ],
};
const COMMAND_REGISTRY = {
  instance: [
    'context', 'get', 'has', 'invoke', 'list', 'offer', 'platform', 'run',
  ],
  static: [

  ],
};

// ---------------------------------------------------------------------------------------------------------------------
// Reading the `@public` tags from the source
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The members tagged `@public` in a source file: a JSDoc comment that holds the tag, and the declaration on the line after it
 * (`name = ...`, `get name()`, `async name()`, `static name`, or `this.name = ...` in a constructor).
 * @param {string} path
 * @returns {{ instance: string[], static: string[] }}
 */
function publicMembers(path) {
  const source = read(path);
  /** @type {string[]} */
  const instance = [];
  /** @type {string[]} */
  const statics = [];
  const comment = /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/[ \t]*\n[ \t]*([^\n]+)/g;
  for (const [, body, line] of source.matchAll(comment)) {
    if (!/@public\b/.test(body)) continue;
    const member = /^static\s+(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)/.exec(line);
    if (member) { statics.push(member[1]); continue; }
    const plain = /^(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:\(|=|;)/.exec(line) ?? /^this\.([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (!plain) throw new Error(`${path}: cannot read the member tagged @public before: ${line}`);
    instance.push(plain[1]);
  }
  return { instance: sorted(new Set(instance)), static: sorted(new Set(statics)) };
}

/** Every member name of an object: own properties and the whole prototype chain (below `Object.prototype`). */
function allMembers(/** @type {any} */ object) {
  const names = new Set();
  for (let o = object; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) if (name !== 'constructor' && !name.startsWith('#')) names.add(name);
  }
  return sorted(/** @type {Set<string>} */ (names));
}

const TIMEOUT = 60000;

describe('the @public tags are the pinned stable contract', () => {
  const cases = [
    ['Nabu', 'src/lib/blocks/nabu.svelte.js', NABU],
    ['Block', 'src/lib/blocks/block.svelte.js', BLOCK],
    ['TextBlock', 'src/lib/blocks/text-block.svelte.js', TEXT_BLOCK],
    ['MegaBlock', 'src/lib/blocks/megablock.svelte.js', MEGA_BLOCK],
    ['TextBehavior', 'src/lib/behaviors/text/text.behavior.svelte.js', TEXT_BEHAVIOR],
    ['NabuSelection', 'src/lib/blocks/selection.svelte.js', NABU_SELECTION],
    ['SvelteSelection', 'src/lib/utils/selection.svelte.js', SVELTE_SELECTION],
    ['CommandRegistry', 'src/lib/utils/commands.js', COMMAND_REGISTRY],
  ];
  for (const [name, path, pinned] of /** @type {Array<[string, string, { instance: string[], static: string[] }]>} */ (cases)) {
    it(`${name}: instance members`, () => expect(publicMembers(path).instance).toEqual(pinned.instance));
    it(`${name}: static members`, () => expect(publicMembers(path).static).toEqual(pinned.static));
  }
});

describe('the stable members exist on a real editor', () => {
  it('Nabu', async () => {
    const { Nabu } = await import('#lib/index.js');
    const nabu = new Nabu();
    for (const name of NABU.instance) expect(name in nabu, `nabu.${name}`).toBe(true);
    for (const name of NABU_METHODS) expect(typeof (/** @type {any} */ (nabu))[name], `nabu.${name}()`).toBe('function');
    for (const name of NABU.static) expect(typeof (/** @type {any} */ (Nabu))[name], `Nabu.${name}`).toBe('symbol');
    expect(nabu.BREAK).toBe(Nabu.BREAK);
    expect(nabu.CONTINUE).toBe(Nabu.CONTINUE);
    // the pieces a block reads from the editor have their documented shape
    expect(typeof nabu.commands.list).toBe('function');
    expect(nabu.tree.createNode).toBeTypeOf('function');
    expect(nabu.blocks).toBeInstanceOf(Map);
    expect(nabu.registry).toBeInstanceOf(Map);
  }, TIMEOUT);

  it('every member of Nabu is either stable or listed as not promised', async () => {
    const { Nabu } = await import('#lib/index.js');
    const rest = allMembers(new Nabu()).filter((name) => !NABU.instance.includes(name));
    expect(rest).toEqual(NABU_NOT_PROMISED);
  }, TIMEOUT);

  it('Block, TextBlock, MegaBlock, TextBehavior, the selection and the command registry', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    const { Block, TextBlock, MegaBlock, TextBehavior } = await import('#lib/extend.js');
    const { NabuSelection } = await import('#lib/blocks/selection.svelte.js');
    const { SvelteSelection } = await import('#lib/utils/selection.svelte.js');
    const { CommandRegistry } = await import('#lib/utils/commands.js');

    const nabu = createTextEditor();
    const paragraph = /** @type {any} */ (nabu.insert('paragraph', { text: 'x' }));
    expect(paragraph).toBeInstanceOf(TextBlock);

    const node = nabu.tree.createNode();
    node.data.set('type', 'container');
    const mega = new MegaBlock(nabu, node);

    for (const name of BLOCK.instance) expect(name in paragraph, `block.${name}`).toBe(true);
    for (const name of BLOCK_METHODS) expect(typeof (/** @type {any} */ (paragraph))[name], `block.${name}()`).toBe('function');
    for (const name of TEXT_BLOCK.instance) expect(name in paragraph, `textBlock.${name}`).toBe(true);
    for (const name of MEGA_BLOCK.instance) expect(name in mega, `megaBlock.${name}`).toBe(true);
    for (const name of TEXT_BEHAVIOR.instance) expect(name in paragraph.behavior, `behavior.${name}`).toBe(true);
    expect(paragraph.behavior).toBeInstanceOf(TextBehavior);
    expect(paragraph.behaviors.get('text')).toBe(paragraph.behavior);

    // the optional statics are DECLARED on Block (typed) and default to undefined: a block that declares none is unaffected
    for (const name of BLOCK.static) expect(name in Block, `Block.${name}`).toBe(true);
    for (const name of ['htmlRules', 'fromHTML', 'htmlSiblings', 'markdownRules', 'fromMarkdown', 'toMarkdown', 'toHtml']) {
      expect(BLOCK.static, name).toContain(name);
      expect(/** @type {any} */ (Block)[name], `Block.${name}`).toBeUndefined();
    }
    expect(typeof Block.load).toBe('function');
    expect(typeof Block.create).toBe('function');

    for (const name of NABU_SELECTION.instance) expect(name in nabu.selection, `selection.${name}`).toBe(true);
    for (const name of SVELTE_SELECTION.instance) expect(name in nabu.selection, `selection.${name}`).toBe(true);
    expect(nabu.selection).toBeInstanceOf(NabuSelection);
    expect(nabu.selection).toBeInstanceOf(SvelteSelection);
    for (const name of COMMAND_REGISTRY.instance) expect(name in nabu.commands, `commands.${name}`).toBe(true);
    expect(nabu.commands).toBeInstanceOf(CommandRegistry);
  }, TIMEOUT);

  it('every member of Block, TextBlock and MegaBlock is stable (a block has no private surface to subclass)', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    const { MegaBlock } = await import('#lib/extend.js');
    const nabu = createTextEditor();
    const paragraph = nabu.insert('paragraph', { text: 'x' });
    const node = nabu.tree.createNode();
    node.data.set('type', 'container');
    const stable = new Set([...BLOCK.instance, ...TEXT_BLOCK.instance, ...MEGA_BLOCK.instance]);
    const unlisted = [...allMembers(paragraph), ...allMembers(new MegaBlock(nabu, node))].filter((name) => !stable.has(name));
    expect(sorted(new Set(unlisted))).toEqual(BLOCK_NOT_PROMISED);
  }, TIMEOUT);
});

describe('nabu.internals (unstable)', () => {
  it('exposes exactly the pinned keys', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    const nabu = createTextEditor();
    expect(Object.keys(nabu.internals).sort()).toEqual(INTERNALS);
  }, TIMEOUT);

  it('is the same frozen object every time, made of references to the engine, not copies', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    const nabu = createTextEditor();
    const internals = nabu.internals;
    expect(nabu.internals).toBe(internals);
    expect(Object.isFrozen(internals)).toBe(true);
    expect(internals.commandConfirm).toBe(nabu.commandConfirm);
    expect(internals.hooks).toBe(nabu.hooks);
    expect(internals.inputRules).toBe(nabu.inputRules);
    expect(internals.undoManager).toBe(nabu.undoManager);
    expect(typeof internals.pulse.on).toBe('function');
    expect(typeof internals.pulse.emit).toBe('function');
    for (const name of INTERNALS) {
      expect(name in internals, name).toBe(true); // (a few are legitimately null / undefined right now: `tabDescription`, `dropTarget`)
    }
  }, TIMEOUT);

  it('its functions work on the editor they come from (bound)', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    const nabu = createTextEditor();
    const { handleKeydown, updateRoots } = nabu.internals;
    // detached from the editor, they still act on it
    nabu.insert('paragraph', { text: 'a' });
    updateRoots();
    expect(nabu.children.length).toBeGreaterThan(0);
    expect(() => handleKeydown(new KeyboardEvent('keydown', { key: 'Shift' }))).not.toThrow();
  }, TIMEOUT);

  it('writes through to the reactive state it stands for', async () => {
    const { createTextEditor } = await import('#lib/index.js');
    const nabu = createTextEditor();
    nabu.internals.storedMarks = { bold: true };
    expect(nabu.storedMarks).toEqual({ bold: true });
    expect(nabu.internals.storedMarks).toEqual({ bold: true });
  }, TIMEOUT);

  it('nothing in internals is also in the stable list (one home per name)', async () => {
    const stable = new Set([...NABU.instance]);
    // `selection` is a key of `internals` (the repair machinery) AND a stable member of the editor, but they are different things:
    // the internals one is an object of functions, not the selection. Every other name must have one home.
    for (const name of INTERNALS) if (name !== 'selection') expect(stable.has(name), name).toBe(false);
  });
});

describe('docs/guides/extensions.md documents the contract', () => {
  const guide = read('docs/guides/extensions.md');
  const stability = guide.slice(guide.indexOf('## Stability'));

  it('has a Stability section', () => {
    expect(guide.indexOf('## Stability')).toBeGreaterThan(-1);
    expect(stability).toContain('nabu.internals');
    expect(stability).toMatch(/any minor version/i);
  });

  it('names every stable member of Nabu, Block, TextBlock and MegaBlock', () => {
    const missing = [
      ...NABU.instance.map((name) => `nabu.${name}`),
      ...BLOCK.instance, ...BLOCK.static, ...TEXT_BLOCK.instance, ...MEGA_BLOCK.instance,
    ].filter((name) => !stability.includes('`' + name.replace(/^nabu\./, '') + '`') && !stability.includes('`' + name + '`'));
    expect(missing).toEqual([]);
  });

  it('names every key of internals', () => {
    const missing = INTERNALS.filter((name) => !stability.includes('`' + name + '`'));
    expect(missing).toEqual([]);
  });
});
