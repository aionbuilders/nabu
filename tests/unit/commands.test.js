// @ts-nocheck
/**
 * Commands, keymap and key resolution (utils/commands.js + Nabu#handleKeydown, ADR 017 lot 1).
 * Real Nabu over the Loro tree; the DOM selection is replaced by a stub (the block holding the caret).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { Extension } from '#lib/utils/extensions.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { ListExtension, ListItemExtension, List, ListItem } from '#lib/blocks/list/index.js';
import { RichTextExtension } from '#lib/behaviors/text/index.js';
import { createEditor } from '#lib/presets.js';

let warn;
afterEach(() => { warn?.mockRestore(); warn = undefined; });
const watchWarnings = () => { warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {}); return warn; };
const warned = (pattern) => warn.mock.calls.some((call) => pattern.test(call.join(' ')));

/** A command extension; `commands` is the whole declaration. */
const ext = (name, commands, extra = {}) => new Extension(name, { commands, ...extra });
const cmd = (init = {}) => ({ label: 'Test', run: vi.fn(), ...init });

async function make({ extensions = [], keymap, platform = 'other', caret = null } = {}) {
  const engine = new Nabu({ extensions: [ParagraphExtension, ...extensions], keymap, platform });
  engine.insert('paragraph', {});
  await engine.commit();
  engine.selection = {
    anchorBlock: caret ?? engine.children[0], focusBlock: caret ?? engine.children[0], blocks: new Set(),
    isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn(),
  };
  return engine;
}

const key = (k, init = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), ...init });
const press = (engine, k, init) => { const event = key(k, init); engine.handleKeydown(event); return event; };

describe('registration', () => {
  it('a command is an action of the bus: nabu.exec(id, data) runs it with a context', async () => {
    const run = vi.fn(() => 'done');
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run }) })] });
    await engine.exec('x:go', { n: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    const [nabu, ctx, data] = run.mock.calls[0];
    expect(nabu).toBe(engine);
    expect(ctx.nabu).toBe(engine);
    expect(ctx.event).toBeNull();
    expect(data).toEqual({ n: 1 });
  });

  it('exec runs a command even when it has no keys and its `when` is false', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run, when: () => false }) })] });
    await engine.exec('x:go');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('commands.run(id) is exec(id); an unknown id warns', async () => {
    watchWarnings();
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run }) })] });
    await engine.commands.run('x:go', 7);
    expect(run.mock.calls[0][2]).toBe(7);
    expect(engine.commands.run('nope')).toBeUndefined();
    expect(warned(/unknown command "nope"/)).toBe(true);
  });

  it('a command without run, and a duplicate id, are refused with a warning', async () => {
    watchWarnings();
    const first = vi.fn(); const second = vi.fn();
    const engine = await make({ extensions: [ext('a', { 'dup': cmd({ run: first }), 'broken': { label: 'x' } }), ext('b', { 'dup': cmd({ run: second }) })] });
    await engine.exec('dup');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(engine.commands.has('broken')).toBe(false);
    expect(warned(/"broken".*no run/)).toBe(true);
    expect(warned(/duplicate id "dup"/)).toBe(true);
  });

  it('undo / redo are engine commands and still work through exec', async () => {
    const engine = await make();
    const undo = vi.spyOn(engine, 'undo'); const redo = vi.spyOn(engine, 'redo');
    await engine.exec('undo');
    await engine.exec('redo');
    expect(undo).toHaveBeenCalledTimes(1); // once: not registered twice on the bus
    expect(redo).toHaveBeenCalledTimes(1);
  });
});

describe('refused keys', () => {
  it('a reserved chord is refused (the command stays runnable)', async () => {
    watchWarnings();
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:close': cmd({ run, keys: ['Mod-w', 'Mod-Shift-t', 'Alt-F4', 'Mod-j'] }) })] });
    expect(engine.commands.get('x:close').keys).toEqual(['Mod-j']);
    expect(warned(/"Mod-w" is reserved/)).toBe(true);
    expect(warned(/"Alt-F4" is reserved/)).toBe(true);
    press(engine, 'w', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    await engine.exec('x:close');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a key without modifier and without `when` is refused; with a `when` it is accepted', async () => {
    watchWarnings();
    const engine = await make({ extensions: [ext('x', {
      'x:bare': cmd({ keys: ['Backspace', 'Enter', 'a', 'Shift-Tab'] }),
      'x:guarded': cmd({ keys: ['Backspace'], when: () => true }),
    })] });
    expect(engine.commands.get('x:bare').keys).toEqual([]);
    expect(engine.commands.get('x:guarded').keys).toEqual(['Backspace']);
    expect(warned(/"x:bare": chord "Backspace" has no modifier/)).toBe(true);
    expect(warned(/chord "Shift-Tab" has no modifier/)).toBe(true); // Shift alone is not a modifier
  });

  it('an invalid chord is ignored with a warning', async () => {
    watchWarnings();
    const engine = await make({ extensions: [ext('x', { 'x:odd': cmd({ keys: ['Mod-Nope', 'Mod-k'] }) })] });
    expect(engine.commands.get('x:odd').keys).toEqual(['Mod-k']);
    expect(warned(/invalid chord "Mod-Nope"/)).toBe(true);
  });

  it('a command with a known `confirm` strategy is bound; an unknown strategy (or `choose` without options) is not', async () => {
    watchWarnings();
    const run = vi.fn();
    const confirm = { strategy: 'hold', holdMs: 700 };
    const engine = await make({ extensions: [ext('x', {
      'x:merge': cmd({ run, keys: ['Mod-m'], confirm }),
      'x:odd': cmd({ run, keys: ['Mod-k'], confirm: { strategy: 'shout' } }),
      'x:pick': cmd({ run, keys: ['Mod-l'], confirm: { strategy: 'choose' } }),
    })] });
    expect(engine.commands.get('x:merge').keys).toEqual(['Mod-m']);
    expect(engine.commands.get('x:merge').confirm).toEqual(confirm);
    expect(engine.commands.get('x:odd').keys).toEqual([]);
    expect(engine.commands.get('x:pick').keys).toEqual([]);
    expect(warned(/unknown `confirm` strategy "shout"/)).toBe(true);
    const event = press(engine, 'k', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    await engine.exec('x:merge'); // exec runs a command directly, without its confirmation (the accessible path)
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('same chord + same scope (or both unscoped) warns, both are kept; different scopes do not warn', async () => {
    watchWarnings();
    await make({ extensions: [ext('x', { 'x:a': cmd({ keys: ['Mod-j'] }), 'x:b': cmd({ keys: ['Mod-j'] }) })] });
    expect(warned(/"x:b" and "x:a" both bind "Mod-j" with the same scope/)).toBe(true);

    warn.mockClear();
    const engine = await make({ extensions: [ext('y', {
      'y:a': cmd({ keys: ['Mod-j'], scope: 'list-item' }),
      'y:b': cmd({ keys: ['Mod-j'], scope: 'paragraph' }),
      'y:c': cmd({ keys: ['Mod-j'] }),
    })] });
    expect(warned(/both bind/)).toBe(false);
    expect(engine.commands.get('y:a').keys).toEqual(['Mod-j']);
    expect(engine.commands.get('y:b').keys).toEqual(['Mod-j']);
  });
});

describe('key resolution', () => {
  it('runs the matching command, calls preventDefault, and the legacy hooks do not see the key', async () => {
    const run = vi.fn();
    const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run, keys: ['Mod-j'] }) }, { hooks: { onKeyDown: hook } })] });
    const event = press(engine, 'j', { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(run.mock.calls[0][1].event).toBe(event);
  });

  it('no command: falls through to the legacy onKeyDown hooks', async () => {
    const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ keys: ['Mod-j'] }) }, { hooks: { onKeyDown: hook } })] });
    const event = press(engine, 'k', { ctrlKey: true });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('`when` false: not a candidate, the key falls through', async () => {
    const run = vi.fn(); const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run, keys: ['Mod-j'], when: () => false }) }, { hooks: { onKeyDown: hook } })] });
    press(engine, 'j', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('a throwing `when` counts as false (warning)', async () => {
    watchWarnings();
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run, keys: ['Mod-j'], when: () => { throw new Error('boom'); } }) })] });
    press(engine, 'j', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(warned(/when\(\) of "x:go" failed/)).toBe(true);
  });

  it('`run` returning false means "not handled": next candidate, then the legacy hooks', async () => {
    const declined = vi.fn(() => false); const accepted = vi.fn(); const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:a': cmd({ run: declined, keys: ['Mod-j'], scope: 'paragraph' }), 'x:b': cmd({ run: accepted, keys: ['Mod-j'] }) }, { hooks: { onKeyDown: hook } })] });
    const event = press(engine, 'j', { ctrlKey: true });
    expect(declined).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();

    const only = vi.fn(() => false);
    const lone = await make({ extensions: [ext('y', { 'y:a': cmd({ run: only, keys: ['Mod-j'] }) }, { hooks: { onKeyDown: hook } })] });
    const second = press(lone, 'j', { ctrlKey: true });
    expect(only).toHaveBeenCalled();
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('an async run (a promise) is handled, even if it resolves to false', async () => {
    const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:a': cmd({ run: async () => false, keys: ['Mod-j'] }) }, { hooks: { onKeyDown: hook } })] });
    const event = press(engine, 'j', { ctrlKey: true });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('a command that throws is reported and the key is still consumed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const engine = await make({ extensions: [ext('x', { 'x:a': cmd({ run: () => { throw new Error('boom'); }, keys: ['Mod-j'] }) })] });
    const event = press(engine, 'j', { ctrlKey: true });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('priority: the command scoped to the block type beats a generic one; the generic one is used elsewhere', async () => {
    const scoped = vi.fn(); const generic = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:generic': cmd({ run: generic, keys: ['Mod-j'] }), 'x:scoped': cmd({ run: scoped, keys: ['Mod-j'], scope: 'paragraph' }) })] });
    press(engine, 'j', { ctrlKey: true });
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(generic).not.toHaveBeenCalled();

    scoped.mockClear();
    engine.selection.anchorBlock = { ...engine.children[0], type: 'heading', parents: [], parent: null };
    press(engine, 'j', { ctrlKey: true });
    // Elsewhere neither is scoped to the block: they tie, and the user is asked (see command-confirm.test.js)
    expect(scoped).not.toHaveBeenCalled();
    expect(generic).not.toHaveBeenCalled();
    expect(engine.pendingCommand.strategy).toBe('choose');
    expect(engine.pendingCommand.options.map((o) => o.id)).toEqual(['x:generic', 'x:scoped']);
  });

  it('a real tie asks the user to choose (nothing runs) and warns about the ambiguity (once)', async () => {
    watchWarnings();
    const a = vi.fn(); const b = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:a': cmd({ run: a, keys: ['Mod-j'], scope: 'paragraph' }) }), ext('y', { 'y:b': cmd({ run: b, keys: ['Mod-j'], scope: 'paragraph' }) })] });
    warn.mockClear();
    press(engine, 'j', { ctrlKey: true });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(engine.pendingCommand.options.map((o) => o.id)).toEqual(['x:a', 'y:b']);
    engine.cancelPendingCommand();
    press(engine, 'j', { ctrlKey: true });
    expect(warn.mock.calls.filter((c) => /ambiguous key/.test(c.join(' ')))).toHaveLength(1);
  });

  it('an engine command and an extension command on the same chord tie too (undo vs x:undo)', async () => {
    watchWarnings();
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:undo': cmd({ run, keys: ['Mod-z'] }) })] });
    const undo = vi.spyOn(engine, 'undo').mockImplementation(() => {});
    press(engine, 'z', { ctrlKey: true });
    expect(engine.pendingCommand.options.map((o) => o.id)).toEqual(['undo', 'x:undo']); // registration order: the engine's first
    engine.commandConfirm.choose(0);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('ignores IME composition (isComposing, keyCode 229, nabu.composing) and prevented events', async () => {
    const run = vi.fn(); const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run, keys: ['Mod-j'] }) }, { hooks: { onKeyDown: hook } })] });
    press(engine, 'j', { ctrlKey: true, isComposing: true });
    press(engine, 'j', { ctrlKey: true, keyCode: 229 });
    press(engine, 'j', { ctrlKey: true, defaultPrevented: true });
    expect(run).not.toHaveBeenCalled();
    engine.handleCompositionStart({});
    press(engine, 'j', { ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    engine.handleCompositionEnd({ data: '' });
    press(engine, 'j', { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('Mod is Ctrl on "other" and Meta on "mac"', async () => {
    const run = vi.fn();
    const decl = ext('x', { 'x:go': cmd({ run, keys: ['Mod-j'] }) });
    const linux = await make({ extensions: [decl], platform: 'other' });
    press(linux, 'j', { metaKey: true });
    expect(run).not.toHaveBeenCalled();
    press(linux, 'j', { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    const apple = await make({ extensions: [decl], platform: 'mac' });
    press(apple, 'j', { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    press(apple, 'j', { metaKey: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a bare key bound with a `when` runs only where it applies', async () => {
    const run = vi.fn(); const hook = vi.fn();
    let applies = false;
    const engine = await make({ extensions: [ext('x', { 'x:bs': cmd({ run, keys: ['Backspace'], when: () => applies }) }, { hooks: { onKeyDown: hook } })] });
    press(engine, 'Backspace');
    expect(run).not.toHaveBeenCalled();
    applies = true;
    press(engine, 'Backspace');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('context', () => {
  it('has the core fields and the facts of the extensions (core fields cannot be replaced)', async () => {
    const seen = [];
    const engine = await make({ extensions: [ext('x', {
      'x:go': cmd({ keys: ['Mod-j'], when: (ctx) => { seen.push(ctx); return ctx.atStart === true; } }),
    }, { commandContext: (nabu, ctx) => ({ atStart: ctx.isCollapsed, block: 'hijacked', custom: 42 }) })] });
    press(engine, 'j', { ctrlKey: true });
    const ctx = seen[0];
    expect(ctx.nabu).toBe(engine);
    expect(ctx.block).toBe(engine.children[0]); // not 'hijacked'
    expect(ctx.selection).toBe(engine.selection);
    expect(ctx.isCollapsed).toBe(true);
    expect(ctx.ancestors).toEqual([]);
    expect(ctx.inRoot).toBe(true);
    expect(ctx.atStart).toBe(true);
    expect(ctx.custom).toBe(42);
  });

  it('is only built for a key some command is bound to, and a failing provider is ignored', async () => {
    watchWarnings();
    const provider = vi.fn(() => { throw new Error('nope'); });
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ keys: ['Mod-j'] }) }, { commandContext: provider })] });
    press(engine, 'k', { ctrlKey: true });
    press(engine, 'a');
    expect(provider).not.toHaveBeenCalled();
    press(engine, 'j', { ctrlKey: true });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(warned(/commandContext of "x" failed/)).toBe(true);
  });

  it('exec builds the context with event null', async () => {
    let seen;
    const engine = await make({ extensions: [ext('x', { 'x:go': cmd({ run: (n, ctx) => { seen = ctx; } }) }, { commandContext: () => ({ fact: 'yes' }) })] });
    await engine.exec('x:go');
    expect(seen.event).toBeNull();
    expect(seen.fact).toBe('yes');
  });
});

describe('keymap option', () => {
  const decl = () => ext('x', {
    'x:a': cmd({ keys: ['Mod-j'] }),
    'x:b': cmd({ keys: ['Mod-k'] }),
    'x:c': cmd({ keys: ['Mod-m'] }),
  });

  it('replaces the keys of a command, and [] disables them', async () => {
    const a = vi.fn(), b = vi.fn(), c = vi.fn();
    const engine = await make({
      extensions: [ext('x', { 'x:a': cmd({ run: a, keys: ['Mod-j'] }), 'x:b': cmd({ run: b, keys: ['Mod-k'] }), 'x:c': cmd({ run: c, keys: ['Mod-m'] }) })],
      keymap: { 'x:a': ['Mod-Alt-j'], 'x:b': [] },
    });
    press(engine, 'j', { ctrlKey: true });
    press(engine, 'k', { ctrlKey: true });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    press(engine, 'j', { ctrlKey: true, altKey: true });
    expect(a).toHaveBeenCalledTimes(1);
    press(engine, 'm', { ctrlKey: true });
    expect(c).toHaveBeenCalledTimes(1);
    expect(engine.commands.get('x:a').keys).toEqual(['Mod-Alt-j']);
    expect(engine.commands.get('x:b').keys).toEqual([]);
    await engine.exec('x:b'); // disabled keys do not disable the command
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('core commands can be rebound too', async () => {
    const engine = await make({ keymap: { undo: ['Mod-Alt-z'] } });
    const undo = vi.spyOn(engine, 'undo').mockImplementation(() => {});
    press(engine, 'z', { ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
    press(engine, 'z', { ctrlKey: true, altKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('is validated like a declared key (reserved, unmodified without `when`, invalid) and unknown ids warn', async () => {
    watchWarnings();
    const engine = await make({ extensions: [decl()], keymap: { 'x:a': ['Mod-w', 'Backspace', 'Mod-Nope'], 'ghost': ['Mod-g'], 'x:b': 'Mod-q' } });
    expect(engine.commands.get('x:a').keys).toEqual([]);
    expect(warned(/"x:a": chord "Mod-w" is reserved/)).toBe(true);
    expect(warned(/"x:a": chord "Backspace" has no modifier/)).toBe(true);
    expect(warned(/invalid chord "Mod-Nope"/)).toBe(true);
    expect(warned(/keymap\["ghost"\] names no registered command/)).toBe(true);
    expect(warned(/keymap\["x:b"\] must be an array/)).toBe(true);
    expect(engine.commands.get('x:b').keys).toEqual(['Mod-k']); // a malformed override leaves the default
  });

  it('a bare key is accepted in the keymap when the command has a `when`', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:a': cmd({ run, keys: ['Mod-j'], when: () => true }) })], keymap: { 'x:a': ['Escape'] } });
    press(engine, 'Escape');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is forwarded by the factories', async () => {
    const engine = createEditor({ preset: [ParagraphExtension, RichTextExtension], keymap: { 'mark:bold': ['Mod-Alt-b'] } });
    expect(engine.commands.get('mark:bold').keys).toEqual(['Mod-Alt-b']);
  });
});

describe('introspection', () => {
  it('list() gives id, label, keys, display, scope, extension, available — per platform', async () => {
    const decl = ext('x', {
      'x:plain': { label: 'Plain', keys: ['Mod-Shift-y'], scope: 'paragraph', run: () => {} },
      'x:dyn': { label: (ctx) => `Block is ${ctx.block?.type}`, keys: ['Mod-k'], when: () => false, run: () => {} },
      'x:nokeys': { label: 'No keys', run: () => {} },
    });
    const linux = await make({ extensions: [decl], platform: 'other' });
    const rows = linux.commands.list();
    const plain = rows.find((r) => r.id === 'x:plain');
    expect(plain).toEqual({ id: 'x:plain', label: 'Plain', keys: ['Mod-Shift-y'], display: ['Ctrl+Shift+Y'], scope: 'paragraph', extension: 'x', available: true, confirm: null });
    expect(rows.find((r) => r.id === 'x:dyn')).toMatchObject({ label: 'Block is paragraph', available: false, display: ['Ctrl+K'] });
    expect(rows.find((r) => r.id === 'x:nokeys')).toMatchObject({ keys: [], display: [] });
    expect(rows.find((r) => r.id === 'undo')).toMatchObject({ extension: 'core', display: ['Ctrl+Z'], label: 'Undo' });
    expect(rows.find((r) => r.id === 'redo').display).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);

    const apple = await make({ extensions: [decl], platform: 'mac' });
    expect(apple.commands.get('x:plain').display).toEqual(['⇧⌘Y']);
    expect(apple.commands.get('undo').display).toEqual(['⌘Z']);
  });

  it('list(ctx) resolves function labels with the given context; get() of an unknown id is null', async () => {
    const engine = await make({ extensions: [ext('x', { 'x:dyn': { label: (ctx) => `Hello ${ctx.who}`, run: () => {} } })] });
    expect(engine.commands.list({ who: 'you' }).find((r) => r.id === 'x:dyn').label).toBe('Hello you');
    expect(engine.commands.get('nope')).toBeNull();
  });

  it('is a plain snapshot: mutating a row does not touch the registry', async () => {
    const engine = await make({ extensions: [ext('x', { 'x:a': cmd({ keys: ['Mod-j'] }) })] });
    engine.commands.list().find((r) => r.id === 'x:a').keys.push('Mod-z');
    expect(engine.commands.get('x:a').keys).toEqual(['Mod-j']);
  });
});

describe('migrated shortcuts', () => {
  it('rich text: the mark shortcuts are mark:* commands with their default keys', async () => {
    const engine = await make({ extensions: [RichTextExtension] });
    const keys = Object.fromEntries(engine.commands.list().filter((r) => r.id.startsWith('mark:')).map((r) => [r.id, r.keys]));
    expect(keys).toEqual({
      'mark:bold': ['Mod-b'], 'mark:italic': ['Mod-i'], 'mark:underline': ['Mod-u'], 'mark:code': ['Mod-e'], 'mark:strikethrough': ['Mod-Shift-x'],
    });
  });

  it('Ctrl+B toggles through the command; with the key unbound, the legacy hook still swallows the native shortcut', async () => {
    const engine = await make({ extensions: [RichTextExtension] });
    const toggle = vi.spyOn(engine, 'toggleStoredMark').mockImplementation(() => {});
    const event = press(engine, 'b', { ctrlKey: true });
    await Promise.resolve();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledWith('bold');

    toggle.mockClear();
    const moved = await make({ extensions: [RichTextExtension], keymap: { 'mark:bold': ['Mod-Alt-b'] } });
    const toggle2 = vi.spyOn(moved, 'toggleStoredMark').mockImplementation(() => {});
    const old = press(moved, 'b', { ctrlKey: true });
    await Promise.resolve();
    expect(toggle2).not.toHaveBeenCalled();
    expect(old.preventDefault).toHaveBeenCalled(); // the browser's own bold is not let through
    press(moved, 'b', { ctrlKey: true, altKey: true });
    await Promise.resolve();
    expect(toggle2).toHaveBeenCalledWith('bold');
  });

  it('Mod-Enter coexistence: the todo toggle wins in a todo item, another Mod-Enter command applies elsewhere', async () => {
    const other = vi.fn();
    const splitHere = ext('splitter', {
      'dummy:split': { label: 'Split here', keys: ['Mod-Enter'], when: (ctx) => ctx.inRoot && ctx.block?.type === 'paragraph', run: other },
    });
    // The splitter is registered BEFORE the list: it must not win by order alone.
    const engine = new Nabu({ extensions: [ParagraphExtension, splitHere, ListExtension, ListItemExtension], platform: 'other' });
    engine.insert('paragraph', {});
    await engine.commit();
    const paragraph = engine.children[0];
    const list = List.create(engine, 'list', { listType: 'todo' }, null);
    const item = ListItem.create(engine, 'list-item', { text: 'task', checked: false }, list.node.id.toString());
    await engine.commit();
    const block = engine.blocks.get(item.node.id.toString());
    const at = (b) => { engine.selection = { anchorBlock: b, focusBlock: b, blocks: new Set([b]), isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn() }; };

    at(block);
    const inItem = press(engine, 'Enter', { ctrlKey: true });
    expect(inItem.preventDefault).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(item.node.data.get('checked')).toBe(true);

    at(paragraph);
    press(engine, 'Enter', { ctrlKey: true });
    expect(other).toHaveBeenCalledTimes(1);
    expect(item.node.data.get('checked')).toBe(true); // untouched

    // a bullet-list item: the todo toggle does not apply (when), the key falls through
    const bullets = List.create(engine, 'list', { listType: 'bullet' }, null);
    const bullet = ListItem.create(engine, 'list-item', { text: 'plain' }, bullets.node.id.toString());
    await engine.commit();
    at(engine.blocks.get(bullet.node.id.toString()));
    const none = press(engine, 'Enter', { ctrlKey: true });
    expect(none.preventDefault).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });
});
