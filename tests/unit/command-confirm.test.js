// @ts-nocheck
/**
 * Confirmation strategies of commands (utils/command-confirm.svelte.js + utils/commands.js, ADR 017 lot 2):
 * `hold`, `invite`, `choose`, `nabu.pendingCommand`, the live region texts. A fake clock drives time and animation frames.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { Extension } from '$lib/utils/extensions.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';

let warn;
afterEach(() => { warn?.mockRestore(); warn = undefined; vi.restoreAllMocks(); });

/** Time and frames the test advances by hand (`frame` = 16 ms). */
function fakeClock() {
  let t = 0; let id = 0;
  const jobs = new Map();
  return {
    now: () => t,
    timeout(fn, ms) { const k = id++; jobs.set(k, { at: t + ms, fn }); return () => jobs.delete(k); },
    frame(fn) { const k = id++; jobs.set(k, { at: t + 16, fn }); return () => jobs.delete(k); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [k, job] of jobs) if (job.at <= end && (!next || job.at < next.job.at)) next = { k, job };
        if (!next) break;
        t = next.job.at; jobs.delete(next.k); next.job.fn();
      }
      t = end;
    },
    pending: () => jobs.size,
  };
}

const ext = (name, commands, extra = {}) => new Extension(name, { commands, ...extra });
const cmd = (init = {}) => ({ label: 'Test', run: vi.fn(), ...init });

async function make({ extensions = [], clock = fakeClock(), confirm, keymap } = {}) {
  const engine = new Nabu({ extensions: [ParagraphExtension, ...extensions], platform: 'other', commandConfirm: { clock, ...confirm }, keymap });
  engine.insert('paragraph', {});
  await engine.commit();
  engine.selection = {
    anchorBlock: engine.children[0], focusBlock: engine.children[0], blocks: new Set(),
    isCollapsed: true, sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn(),
  };
  return Object.assign(engine, { clock });
}

const key = (k, init = {}) => ({ key: k, code: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...init });
const press = (engine, k, init) => { const event = key(k, init); engine.handleKeydown(event); return event; };
const up = (engine, k, init) => engine.commandConfirm.onKeyup(key(k, init));
const CTRL = { ctrlKey: true };

const holdCmd = (init = {}) => cmd({ label: 'Merge it', keys: ['Mod-m'], confirm: { strategy: 'hold' }, ...init });
const pressM = (engine, init = {}) => press(engine, 'm', { ctrlKey: true, code: 'KeyM', ...init });

describe('hold', () => {
  it('a fresh press runs the command once holdMs have passed (default 700), with progress 0 → 1', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) })] });
    expect(engine.pendingCommand).toBeNull();
    const event = pressM(engine);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).toMatchObject({ id: 'x:m', strategy: 'hold', label: 'Merge it', progress: 0 });
    engine.clock.advance(352);
    expect(engine.pendingCommand.progress).toBeGreaterThan(0.45);
    expect(engine.pendingCommand.progress).toBeLessThan(0.6);
    engine.clock.advance(200);
    expect(engine.pendingCommand.progress).toBeGreaterThan(0.75);
    expect(run).not.toHaveBeenCalled();
    engine.clock.advance(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1].block).toBe(engine.children[0]);
    expect(engine.pendingCommand).toBeNull();
    engine.clock.advance(5000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(engine.clock.pending()).toBe(0);
  });

  it('holdMs: per command, or globally (commandConfirm.holdMs)', async () => {
    const run = vi.fn();
    const engine = await make({
      extensions: [ext('x', { 'x:m': holdCmd({ run, confirm: { strategy: 'hold', holdMs: 200 } }) })],
    });
    pressM(engine);
    engine.clock.advance(180);
    expect(run).not.toHaveBeenCalled();
    engine.clock.advance(40);
    expect(run).toHaveBeenCalledTimes(1);

    const run2 = vi.fn();
    const global = await make({ confirm: { holdMs: 1500 }, extensions: [ext('x', { 'x:m': holdCmd({ run: run2 }) })] });
    pressM(global);
    global.clock.advance(1400);
    expect(run2).not.toHaveBeenCalled();
    global.clock.advance(150);
    expect(run2).toHaveBeenCalledTimes(1);
  });

  it('releasing the key before the end cancels (nothing runs, nothing pending); releasing a modifier of the chord too', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) })] });
    pressM(engine);
    engine.clock.advance(300);
    up(engine, 'm', { code: 'KeyM' });
    expect(engine.pendingCommand).toBeNull();
    engine.clock.advance(2000);
    expect(run).not.toHaveBeenCalled();

    pressM(engine);
    engine.clock.advance(300);
    up(engine, 'Control', { code: 'ControlLeft' });
    expect(engine.pendingCommand).toBeNull();
    engine.clock.advance(2000);
    expect(run).not.toHaveBeenCalled();

    pressM(engine);
    up(engine, 'a', { code: 'KeyA' }); // an unrelated key going up changes nothing
    expect(engine.pendingCommand).not.toBeNull();
  });

  it('repeats alone never start it, and they are swallowed (the key was held before the context)', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) })] });
    for (let i = 0; i < 5; i++) {
      const event = pressM(engine, { repeat: true });
      expect(event.preventDefault).toHaveBeenCalled();
      engine.clock.advance(300);
    }
    expect(engine.pendingCommand).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('a key held into the context is stopped there: repeats pass while `when` is false, are swallowed once it is true', async () => {
    const run = vi.fn();
    let inContext = false;
    const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run, when: () => inContext }) }, { hooks: { onKeyDown: hook } })] });
    const outside = pressM(engine); // fresh, but outside the context: the key does its normal thing
    expect(outside.preventDefault).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    const repeats = [pressM(engine, { repeat: true }), pressM(engine, { repeat: true })];
    expect(repeats.every((e) => !e.preventDefault.mock.calls.length)).toBe(true);
    expect(hook).toHaveBeenCalledTimes(3);

    inContext = true; // the caret reached the boundary while the key stayed down
    const stopped = pressM(engine, { repeat: true });
    expect(stopped.preventDefault).toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(3);
    expect(engine.pendingCommand).toBeNull();
    for (let i = 0; i < 4; i++) { pressM(engine, { repeat: true }); engine.clock.advance(400); }
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull();

    up(engine, 'm', { code: 'KeyM' }); // release, then press again: this one counts
    pressM(engine);
    expect(engine.pendingCommand?.strategy).toBe('hold');
    engine.clock.advance(800);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('another key cancels AND does its normal thing (legacy hooks see it)', async () => {
    const run = vi.fn(); const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) }, { hooks: { onKeyDown: hook } })] });
    pressM(engine);
    engine.clock.advance(300);
    const other = press(engine, 'a', { code: 'KeyA' });
    expect(engine.pendingCommand).toBeNull();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    engine.clock.advance(2000);
    expect(run).not.toHaveBeenCalled();
  });

  it('Escape is "another key" for a hold: it cancels and passes through; a lone modifier press changes nothing', async () => {
    const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd() }, { hooks: { onKeyDown: hook } })] });
    pressM(engine);
    press(engine, 'Shift', { shiftKey: true });
    expect(engine.pendingCommand).not.toBeNull();
    const esc = press(engine, 'Escape');
    expect(engine.pendingCommand).toBeNull();
    expect(esc.preventDefault).not.toHaveBeenCalled();
  });

  it('the repeats of the key are ignored while the hold runs, and after completion until the key is released', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run, confirm: { strategy: 'hold', holdMs: 100 } }) })] });
    pressM(engine);
    for (let t = 0; t < 10; t++) { engine.clock.advance(50); expect(pressM(engine, { repeat: true }).preventDefault).toHaveBeenCalled(); }
    expect(run).toHaveBeenCalledTimes(1); // completed once, the key is still down
    expect(engine.pendingCommand).toBeNull();
    engine.clock.advance(1000);
    expect(pressM(engine, { repeat: true }).preventDefault).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    up(engine, 'm', { code: 'KeyM' });
    const after = pressM(engine, { repeat: true }); // no longer swallowed by the spent hold; a repeat never starts one either (it IS swallowed as such)
    expect(engine.pendingCommand).toBeNull();
    expect(after.preventDefault).toHaveBeenCalled();
    pressM(engine); // a fresh press
    engine.clock.advance(150);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a selection change away, a blur, a click and cancelPendingCommand() cancel', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) })] });
    const node = document.createTextNode('abc');
    document.body.append(node);
    let sel = { anchorNode: node, anchorOffset: 1, focusNode: node, focusOffset: 1 };
    vi.spyOn(window, 'getSelection').mockImplementation(() => sel);

    pressM(engine);
    engine.commandConfirm.onSelectionChange(); // same selection: nothing
    expect(engine.pendingCommand).not.toBeNull();
    sel = { ...sel, anchorOffset: 2, focusOffset: 2 };
    engine.commandConfirm.onSelectionChange();
    expect(engine.pendingCommand).toBeNull();

    pressM(engine);
    engine.commandConfirm.onBlur();
    expect(engine.pendingCommand).toBeNull();

    pressM(engine);
    engine.commandConfirm.onPointerDown({ target: document.body });
    expect(engine.pendingCommand).toBeNull();

    pressM(engine);
    engine.cancelPendingCommand();
    expect(engine.pendingCommand).toBeNull();
    engine.clock.advance(2000);
    expect(run).not.toHaveBeenCalled();
    node.remove();
  });

  it('the command must still apply at the end: a `when` turned false in between skips the run', async () => {
    const run = vi.fn();
    let ok = true;
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run, when: () => ok }) })] });
    pressM(engine);
    ok = false;
    engine.clock.advance(900);
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull();
  });

  it('resolves the target (confirm.target(ctx)); pendingCommandOn(target) finds it, other targets do not', async () => {
    const target = { id: 'marker' };
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ confirm: { strategy: 'hold', target: (ctx) => (ctx.block ? target : null) } }) })] });
    expect(engine.pendingCommandOn(target)).toBeNull();
    pressM(engine);
    expect(engine.pendingCommand.target).toBe(target);
    expect(engine.pendingCommandOn(target)).toBe(engine.pendingCommand);
    expect(engine.pendingCommandOn(engine.children[0])).toBeNull();
    expect(engine.pendingCommandOn(undefined)).toBeNull();
  });

  it('nabu.exec runs a confirm command directly (the accessible path)', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) })] });
    await engine.exec('x:m');
    expect(run).toHaveBeenCalledTimes(1);
    expect(engine.pendingCommand).toBeNull();
  });

  it('IME composition: events are ignored (nothing starts, a pending hold is not cancelled)', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ run }) })] });
    pressM(engine, { isComposing: true });
    pressM(engine, { keyCode: 229 });
    expect(engine.pendingCommand).toBeNull();
    pressM(engine);
    press(engine, 'a', { isComposing: true });
    press(engine, 'Process', { keyCode: 229 });
    expect(engine.pendingCommand).not.toBeNull();
  });
});

describe('invite', () => {
  const inviteCmd = (init = {}) => cmd({ label: 'Delete it', keys: ['Mod-Alt-d'], confirm: { strategy: 'invite' }, ...init });
  const pressD = (engine, init = {}) => press(engine, 'd', { ctrlKey: true, altKey: true, code: 'KeyD', ...init });

  it('the first fresh press is pending (nothing runs), the same chord again runs it', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:d': inviteCmd({ run }) })] });
    const first = pressD(engine);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).toMatchObject({ id: 'x:d', strategy: 'invite', label: 'Delete it' });
    const second = pressD(engine);
    expect(second.preventDefault).toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    expect(engine.pendingCommand).toBeNull();
  });

  it('a repeat neither starts nor confirms', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:d': inviteCmd({ run }) })] });
    pressD(engine, { repeat: true });
    expect(engine.pendingCommand).toBeNull();
    pressD(engine);
    pressD(engine, { repeat: true });
    pressD(engine, { repeat: true });
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).not.toBeNull();
  });

  it('Escape cancels (and is consumed); another key cancels and does its normal thing', async () => {
    const run = vi.fn(); const hook = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:d': inviteCmd({ run }) }, { hooks: { onKeyDown: hook } })] });
    pressD(engine);
    const esc = press(engine, 'Escape');
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull();
    expect(hook).not.toHaveBeenCalled();
    pressD(engine);
    const other = press(engine, 'a');
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(engine.pendingCommand).toBeNull();
    pressD(engine); // and a new first press starts again: it did not run
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).not.toBeNull();
  });

  it('times out after 5 s by default (inviteMs / confirm.inviteMs to change), and a click outside cancels', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:d': inviteCmd({ run }) })] });
    pressD(engine);
    engine.clock.advance(4900);
    expect(engine.pendingCommand).not.toBeNull();
    engine.clock.advance(200);
    expect(engine.pendingCommand).toBeNull();
    pressD(engine); // a late second press is a first press again
    expect(run).not.toHaveBeenCalled();
    engine.cancelPendingCommand();

    const quick = await make({ extensions: [ext('x', { 'x:d': inviteCmd({ run, confirm: { strategy: 'invite', inviteMs: 1000 } }) })] });
    pressD(quick);
    quick.clock.advance(1100);
    expect(quick.pendingCommand).toBeNull();

    pressD(quick);
    quick.commandConfirm.onPointerDown({ target: { closest: (sel) => (sel === '[data-nabu-ui]' ? {} : null) } }); // inside the UI: kept
    expect(quick.pendingCommand).not.toBeNull();
    quick.commandConfirm.onPointerDown({ target: document.body });
    expect(quick.pendingCommand).toBeNull();
  });

  it('a `when` turned false before the second press skips the run', async () => {
    const run = vi.fn();
    let ok = true;
    const engine = await make({ extensions: [ext('x', { 'x:d': inviteCmd({ run, when: () => ok }) })] });
    pressD(engine);
    ok = false;
    pressD(engine);
    expect(run).not.toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull();
  });
});

describe('choose', () => {
  const tie = async (extra = {}) => {
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn();
    const engine = await make({
      extensions: [ext('x', {
        'x:a': cmd({ label: 'Alpha', run: a, keys: ['Mod-j'] }),
        'x:b': cmd({ label: 'Beta', run: b, keys: ['Mod-j'] }),
        'x:c': cmd({ label: (ctx) => `Gamma ${ctx.block ? 'here' : ''}`, run: c, keys: ['Mod-j'] }),
      }, { hooks: { onKeyDown: extra.hook ?? vi.fn() } })],
    });
    return { engine, a, b, c };
  };
  const pressJ = (engine, init = {}) => press(engine, 'j', { ctrlKey: true, code: 'KeyJ', ...init });

  it('a tie produces options [{ id, label, display }] and runs nothing', async () => {
    watchWarn();
    const { engine, a, b, c } = await tie();
    const event = pressJ(engine);
    expect(event.preventDefault).toHaveBeenCalled();
    expect([a, b, c].every((fn) => !fn.mock.calls.length)).toBe(true);
    expect(engine.pendingCommand).toMatchObject({ strategy: 'choose', selectedIndex: 0 });
    expect(engine.pendingCommand.options).toEqual([
      { id: 'x:a', label: 'Alpha', display: 'Ctrl+J' },
      { id: 'x:b', label: 'Beta', display: 'Ctrl+J' },
      { id: 'x:c', label: 'Gamma here', display: 'Ctrl+J' },
    ]);
  });

  it('ArrowDown / ArrowUp move (wrapping), Enter runs the highlighted one', async () => {
    watchWarn();
    const { engine, a, b, c } = await tie();
    pressJ(engine);
    expect(press(engine, 'ArrowDown').preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand.selectedIndex).toBe(1);
    press(engine, 'ArrowUp'); press(engine, 'ArrowUp');
    expect(engine.pendingCommand.selectedIndex).toBe(2); // wrapped
    press(engine, 'ArrowDown'); press(engine, 'ArrowDown');
    expect(engine.pendingCommand.selectedIndex).toBe(1);
    const enter = press(engine, 'Enter');
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect([a, c].every((fn) => !fn.mock.calls.length)).toBe(true);
    expect(engine.pendingCommand).toBeNull();
    expect(b.mock.calls[0][1].block).toBe(engine.children[0]);
  });

  it('digits 1-9 run an option directly; a digit past the last option cancels like any other key', async () => {
    watchWarn();
    const { engine, a, b, c } = await tie();
    pressJ(engine);
    expect(press(engine, '3').preventDefault).toHaveBeenCalled();
    expect(c).toHaveBeenCalledTimes(1);
    expect(engine.pendingCommand).toBeNull();
    pressJ(engine);
    const past = press(engine, '4');
    expect(past.preventDefault).not.toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull();
    expect([a, b].every((fn) => !fn.mock.calls.length)).toBe(true);
  });

  it('a click (choose(i)) runs that option; hover highlights', async () => {
    watchWarn();
    const { engine, a } = await tie();
    pressJ(engine);
    engine.commandConfirm.highlight(2);
    expect(engine.pendingCommand.selectedIndex).toBe(2);
    expect(engine.commandConfirm.choose(0)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(engine.commandConfirm.choose(0)).toBe(false);
  });

  it('Escape cancels (consumed), any other key cancels and acts normally, a repeat starts nothing', async () => {
    watchWarn();
    const hook = vi.fn();
    const { engine, a } = await tie({ hook });
    pressJ(engine, { repeat: true });
    expect(engine.pendingCommand).toBeNull();
    pressJ(engine);
    const esc = press(engine, 'Escape');
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(engine.pendingCommand).toBeNull();
    pressJ(engine);
    const other = press(engine, 'x');
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(hook).toHaveBeenCalledTimes(1);
    expect(engine.pendingCommand).toBeNull();
    expect(a).not.toHaveBeenCalled();
  });

  it('scoped commands still win before any chooser: no tie, no options', async () => {
    watchWarn();
    const scoped = vi.fn(); const generic = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:g': cmd({ run: generic, keys: ['Mod-j'] }), 'x:s': cmd({ run: scoped, keys: ['Mod-j'], scope: 'paragraph' }) })] });
    press(engine, 'j', { ctrlKey: true });
    expect(scoped).toHaveBeenCalledTimes(1);
    expect(engine.pendingCommand).toBeNull();
  });

  it('a command can offer variants: options(ctx), and run(nabu, ctx, option) gets the chosen one', async () => {
    const run = vi.fn();
    const engine = await make({ extensions: [ext('x', { 'x:v': cmd({
      label: 'Paste as', keys: ['Mod-Alt-v'],
      confirm: { strategy: 'choose', options: () => [{ id: 'plain', label: 'Plain text', n: 1 }, { id: 'rich', label: 'Rich', display: 'R', n: 2 }] },
      run,
    }) })] });
    press(engine, 'v', { ctrlKey: true, altKey: true });
    expect(engine.pendingCommand).toMatchObject({ id: 'x:v', strategy: 'choose', label: 'Paste as' });
    expect(engine.pendingCommand.options).toEqual([{ id: 'plain', label: 'Plain text', display: '' }, { id: 'rich', label: 'Rich', display: 'R' }]);
    press(engine, '2');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][2]).toMatchObject({ id: 'rich', n: 2 });
  });

  it('options may carry a group and a detail, and the command a footer; nothing is added when they are absent', async () => {
    const engine = await make({ extensions: [ext('x', { 'x:v': cmd({
      label: 'Pick', keys: ['Mod-Alt-v'],
      confirm: { strategy: 'choose', footer: () => 'hint', options: () => [{ id: 'a', label: 'A', group: 'G1', detail: '1.1' }, { id: 'b', label: 'B', group: 'G2' }, { id: 'c', label: 'C', group: '', detail: 3 }] },
    }), 'x:w': cmd({ label: 'Plain', keys: ['Mod-Alt-w'], confirm: { strategy: 'choose', options: () => [{ id: 'p', label: 'P' }] } }) })] });
    press(engine, 'v', { ctrlKey: true, altKey: true });
    expect(engine.pendingCommand.options).toEqual([
      { id: 'a', label: 'A', display: '', group: 'G1', detail: '1.1' },
      { id: 'b', label: 'B', display: '', group: 'G2' },
      { id: 'c', label: 'C', display: '' }, // an empty group and a non-string detail are dropped
    ]);
    expect(engine.pendingCommand.footer).toBe('hint');
    press(engine, 'Escape');
    press(engine, 'w', { ctrlKey: true, altKey: true });
    expect(engine.pendingCommand.options).toEqual([{ id: 'p', label: 'P', display: '' }]);
    expect(engine.pendingCommand.footer).toBe('');
  });

  it('variants with no option: the key falls through', async () => {
    const engine = await make({ extensions: [ext('x', { 'x:v': cmd({ keys: ['Mod-Alt-v'], confirm: { strategy: 'choose', options: () => [] } }) })] });
    const event = press(engine, 'v', { ctrlKey: true, altKey: true });
    expect(engine.pendingCommand).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('live region texts (nabu.commandAnnouncement)', () => {
  const clean = (text) => text.replace(/​/g, '');

  it('announces the hold prompt, the outcome and a release', async () => {
    const engine = await make({ extensions: [ext('x', { 'x:m': holdCmd({ label: (ctx) => `Merge with "The bank"` }) })] });
    expect(engine.commandAnnouncement).toBe('');
    pressM(engine);
    expect(clean(engine.commandAnnouncement)).toBe('Hold Ctrl+M to confirm: Merge with "The bank"');
    engine.clock.advance(800);
    expect(clean(engine.commandAnnouncement)).toBe('Merge with "The bank": done');

    pressM(engine, { repeat: false });
    const prompt = engine.commandAnnouncement;
    up(engine, 'm', { code: 'KeyM' }); // (the first press after a completed hold: released before)
    expect(clean(engine.commandAnnouncement)).toBe('Cancelled');
    expect(prompt).not.toBe(engine.commandAnnouncement);
  });

  it('announces the invite prompt and a timeout; the chooser prompt and the highlighted option', async () => {
    watchWarn();
    const engine = await make({ extensions: [ext('x', {
      'x:d': cmd({ label: 'Delete it', keys: ['Mod-Alt-d'], confirm: { strategy: 'invite' } }),
      'x:a': cmd({ label: 'Alpha', keys: ['Mod-j'] }),
      'x:b': cmd({ label: 'Beta', keys: ['Mod-j'] }),
    })] });
    press(engine, 'd', { ctrlKey: true, altKey: true });
    expect(clean(engine.commandAnnouncement)).toBe('Press Ctrl+Alt+D again to confirm: Delete it. Escape cancels.');
    engine.clock.advance(6000);
    expect(clean(engine.commandAnnouncement)).toBe('Cancelled');

    press(engine, 'j', { ctrlKey: true });
    expect(clean(engine.commandAnnouncement)).toContain('2 actions apply here');
    expect(clean(engine.commandAnnouncement)).toContain('1 of 2: Alpha');
    press(engine, 'ArrowDown');
    expect(clean(engine.commandAnnouncement)).toBe('2 of 2: Beta');
    press(engine, 'Enter');
    expect(clean(engine.commandAnnouncement)).toBe('Beta: done');
  });

  it('messages are overridable: globally (strings or functions) and per command', async () => {
    const engine = await make({
      confirm: { messages: { hold: ({ keys, label }) => `Maintenez ${keys} pour ${label}`, done: ({ label }) => `${label} : fait` } },
      extensions: [ext('x', {
        'x:m': holdCmd({ label: 'fusionner' }),
        'x:n': cmd({ label: 'couper', keys: ['Mod-Alt-n'], confirm: { strategy: 'hold', holdMs: 50, messages: { hold: 'Tenez pour couper', done: 'Coupé' } } }),
      })],
    });
    pressM(engine);
    expect(clean(engine.commandAnnouncement)).toBe('Maintenez Ctrl+M pour fusionner');
    engine.clock.advance(800);
    expect(clean(engine.commandAnnouncement)).toBe('fusionner : fait');
    up(engine, 'm', { code: 'KeyM' });
    press(engine, 'n', { ctrlKey: true, altKey: true });
    expect(clean(engine.commandAnnouncement)).toBe('Tenez pour couper');
    expect(engine.pendingCommand.message).toBe('Tenez pour couper');
    engine.clock.advance(100);
    expect(clean(engine.commandAnnouncement)).toBe('Coupé');
  });
});

function watchWarn() { warn = vi.spyOn(Nabu.prototype, 'warn').mockImplementation(() => {}); }
