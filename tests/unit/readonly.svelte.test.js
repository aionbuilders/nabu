// @ts-nocheck
/**
 * Read-only mode (P-122, owner decision): `nabu.readonly` / the `readonly` option / `<NabuEditor readonly>`.
 * The USER'S channels are closed (input, paste, cut, drop, keys, commands, the clicks that edit); the host's own code
 * (`insert`, `importJSON`...) is not restricted: that is how a viewer loads its document.
 */
import { describe, it, expect, vi } from 'vitest';
// The unit environment resolves `svelte` to its server build (no `mount`): the client runtime is imported by path.
import { mount, unmount, tick } from '../../node_modules/svelte/src/index-client.js';
import { createFullEditor, createDocumentEditor } from '#lib/presets.js';
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import NabuEditor from '#lib/blocks/Nabu.svelte';
import { SlashMenuController } from '#lib/ui/slash-menu.svelte.js';

const text = (engine) => engine.children.map((b) => b.text ?? '').join('|');
const transfer = (data = {}) => ({ files: [], items: [], types: Object.keys(data), effectAllowed: 'all', dropEffect: 'copy', getData: (k) => data[k] ?? '' });

async function editor(options = {}) {
  const engine = createFullEditor({ platform: 'other', ...options });
  await engine.importMarkdown('first\n\nsecond');
  engine.undoManager.clear();
  return engine;
}

describe('the readonly property', () => {
  it('is false by default, read from the init option, and assignable (coerced to a boolean)', () => {
    expect(new Nabu().readonly).toBe(false);
    expect(new Nabu({ readonly: true }).readonly).toBe(true);
    expect(createDocumentEditor({ readonly: true }).readonly).toBe(true);
    const engine = new Nabu();
    engine.readonly = 1;
    expect(engine.readonly).toBe(true);
    engine.readonly = '';
    expect(engine.readonly).toBe(false);
  });

  it('the Tab hint is not announced (nothing to leave)', () => {
    const engine = createDocumentEditor();
    expect(engine.tabDescription).toBeTruthy();
    engine.readonly = true;
    expect(engine.tabDescription).toBeUndefined();
  });
});

describe('the engine ignores the user\'s input', () => {
  it('beforeinput: cancelled, never routed to a block or a hook', async () => {
    const engine = await editor({ readonly: true });
    const dispatch = vi.spyOn(engine, 'dispatchEventToSelection');
    const event = { inputType: 'insertText', data: 'x', preventDefault: vi.fn() };
    engine.handleBeforeinput(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(text(engine)).toBe('first|second');

    // the same event reaches the pipeline once the editor is editable again
    engine.readonly = false;
    engine.handleBeforeinput({ ...event, preventDefault: vi.fn() });
    expect(dispatch).toHaveBeenCalled();
  });

  it('keydown: no command, hook or block sees the key (undo, bold, Enter...)', async () => {
    const engine = await editor({ readonly: true });
    const commands = vi.spyOn(engine.commands, 'handleKeydown');
    const dispatch = vi.spyOn(engine, 'dispatchEventToSelection');
    const event = { key: 'z', code: 'KeyZ', ctrlKey: true, preventDefault: vi.fn(), defaultPrevented: false };
    engine.handleKeydown(event);
    expect(commands).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled(); // the browser keeps its own keys: select, copy, scroll
  });

  it('paste: swallowed, the clipboard is not even read', async () => {
    const engine = await editor({ readonly: true });
    const getData = vi.fn(() => 'pasted');
    const event = { preventDefault: vi.fn(), clipboardData: { getData, files: [], items: [], types: ['text/plain'] } };
    engine.handlePaste(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(getData).not.toHaveBeenCalled();
    expect(text(engine)).toBe('first|second');
  });

  it('cut: copies and removes nothing', async () => {
    const engine = await editor({ readonly: true });
    engine.selection = { sync() {}, isCollapsed: false };
    const copy = vi.spyOn(engine, 'handleCopy').mockImplementation(() => {});
    const event = { preventDefault: vi.fn(), clipboardData: { setData() {} } };
    engine.handleCut(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(copy).toHaveBeenCalledOnce();
    expect(text(engine)).toBe('first|second');
  });

  it('copy keeps working', async () => {
    const engine = await editor({ readonly: true });
    engine.selection = { sync() {}, isCollapsed: true };
    const event = { preventDefault: vi.fn(), clipboardData: { setData: vi.fn() } };
    engine.handleCopy(event); // collapsed: the browser's own copy (nothing to serialize); the handler is not disabled
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('drop: nothing lands, nothing is accepted (dragover is not cancelled)', async () => {
    const engine = await editor({ readonly: true });
    const first = engine.children[0];
    const dt = transfer({ 'text/plain': 'DROPPED' });
    engine.dropAt(dt, { block: first, offset: 0, side: 'inside' });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(text(engine)).toBe('first|second');

    const over = { dataTransfer: transfer({ 'text/plain': 'x' }), preventDefault: vi.fn() };
    engine.handleDragOver(over);
    expect(over.preventDefault).not.toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('none');

    // control: the same drop lands in an editable editor
    engine.readonly = false;
    engine.dropAt(dt, { block: first, offset: 0, side: 'inside' });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(text(engine)).toContain('DROPPED');
  });

  it('a mousedown below the last block does not open a trailing caret', async () => {
    const engine = await editor({ readonly: true });
    const open = vi.spyOn(engine, 'openTrailingCaret');
    const root = document.createElement('div');
    engine.handleMousedown({ button: 0, defaultPrevented: false, target: root, currentTarget: root, clientY: 99999 });
    expect(open).not.toHaveBeenCalled();
  });

  it('a pending confirmation is cancelled when the editor becomes read-only', async () => {
    const engine = await editor();
    const cancel = vi.spyOn(engine.commandConfirm, 'cancel');
    engine.readonly = true;
    expect(cancel).toHaveBeenCalled();
  });
});

describe('commands and actions do nothing', () => {
  it('commands.run / exec / offer / invoke, undo and redo included', async () => {
    const engine = await editor();
    engine.insert('paragraph', { text: 'third' });
    await engine.commit();
    expect(text(engine)).toBe('first|second|third');
    engine.readonly = true;

    await engine.commands.run('undo'); // would remove "third"
    await engine.exec('undo');
    expect(text(engine)).toBe('first|second|third');
    expect(engine.commands.offer('undo')).toBe(false);
    const entry = [...engine.commands.entries.values()][0];
    expect(engine.commands.invoke(entry)).toBeUndefined();

    // an action of an extension (the toolbar's, a menu's...)
    const run = vi.fn();
    engine.internals.pulse.on('x-custom', run); // the host's own bus topics are the host's business
    await engine.exec('x-custom');
    expect(run).toHaveBeenCalled();
    const before = JSON.stringify(engine.serialize('json'));
    await engine.exec('mark:toggle', { mark: 'bold' });
    await engine.exec('heading:set', { level: 1 });
    expect(JSON.stringify(engine.serialize('json'))).toBe(before);

    // and they work again when the editor is editable
    engine.readonly = false;
    await engine.commands.run('undo');
    expect(text(engine)).toBe('first|second');
  });

  it('the host\'s own code is not restricted (a viewer loads its document this way)', async () => {
    const engine = await editor({ readonly: true });
    await engine.importMarkdown('# Title\n\nbody');
    expect(engine.children.map((b) => b.type)).toEqual(['heading', 'paragraph']);
    engine.insert('paragraph', { text: 'added by code' });
    await engine.commit();
    expect(text(engine)).toContain('added by code');
    expect(engine.serialize('markdown')).toContain('# Title');
    await engine.importJSON(engine.serialize('json'));
    expect(engine.children.length).toBeGreaterThan(0);
  });
});

describe('blocks with their own clicks', () => {
  it('a to-do box and a callout icon do not change in a read-only editor', async () => {
    const engine = await editor();
    await engine.importMarkdown('- [ ] task\n\n> [!NOTE]\n> note');
    const item = [...engine.blocks.values()].find((b) => b.type === 'list-item' && b.isTodo);
    const callout = [...engine.blocks.values()].find((b) => b.type === 'callout');
    expect(item).toBeTruthy();
    expect(callout).toBeTruthy();
    engine.readonly = true;
    item.toggleChecked();
    callout.cycleVariant();
    expect(item.checked).toBe(false);
    expect(callout.variant).toBe('note');
    engine.readonly = false;
    item.toggleChecked();
    callout.cycleVariant();
    expect(item.checked).toBe(true);
    expect(callout.variant).not.toBe('note');
  });

  it('a toggle can be opened to read it: view state only, never written to the document', async () => {
    const engine = await editor();
    await engine.importMarkdown('<details>\n<summary>Head</summary>\n\nHidden body\n\n</details>');
    const toggle = [...engine.blocks.values()].find((b) => b.type === 'toggle');
    expect(toggle.collapsed).toBe(true);
    engine.readonly = true;
    engine.undoManager.clear();
    const version = engine.doc.version();

    toggle.toggleCollapsed();
    expect(toggle.collapsed).toBe(false); // what the reader sees
    expect(toggle.node.data.get('collapsed')).toBe(true); // the document
    expect(engine.doc.version().compare(version)).toBe(0); // no Loro write, no commit
    expect(engine.undoManager.canUndo()).toBe(false); // no undo step
    expect(toggle.serialize('json').props.collapsed).toBe(true); // exports report the document's state
    expect(JSON.stringify(engine.serialize('markdown'))).toContain('<details>');
    expect(JSON.stringify(engine.serialize('markdown'))).not.toContain('<details open>');

    toggle.toggleCollapsed();
    expect(toggle.collapsed).toBe(true);
    toggle.toggleCollapsed();
    engine.readonly = false; // editable again: the document's own state is the one that counts
    expect(toggle.collapsed).toBe(true);
  });

  it('an editable editor still persists the toggle (control)', async () => {
    const engine = await editor();
    await engine.importMarkdown('<details>\n<summary>Head</summary>\n\nbody\n\n</details>');
    const toggle = [...engine.blocks.values()].find((b) => b.type === 'toggle');
    toggle.toggleCollapsed();
    expect(toggle.node.data.get('collapsed')).toBe(false);
  });
});

describe('the floating UI hides itself', () => {
  it('the slash menu does not open', () => {
    const block = {
      behaviors: new Map([['text', { text: '/', selection: { from: 1, isCollapsed: true } }]]),
    };
    const make = (readonly) => new SlashMenuController(
      { readonly, selection: { anchorBlock: block }, slashCommands: [{ title: 'Text', run() {} }] },
      [],
    );
    expect(make(false).open).toBe(true);
    expect(make(true).open).toBe(false);
  });
});

describe('<NabuEditor label labelledby readonly>', () => {
  async function render(props) {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const state = $state(props);
    const app = mount(NabuEditor, { target, props: state });
    await tick();
    return { state, root: () => target.querySelector('[data-nabu-root]'), destroy: () => { unmount(app); target.remove(); } };
  }

  it('label and labelledby name the editable root, without a role', async () => {
    const view = await render({ engine: createDocumentEditor(), label: 'Chapter text', labelledby: 'heading-id' });
    const root = view.root();
    expect(root.getAttribute('aria-label')).toBe('Chapter text');
    expect(root.getAttribute('aria-labelledby')).toBe('heading-id');
    expect(root.getAttribute('contenteditable')).toBe('true');
    expect(root.hasAttribute('role')).toBe(false); // a role would flatten the headings inside
    expect(root.hasAttribute('data-nabu-readonly')).toBe(false);

    view.state.label = 'Other';
    await tick();
    expect(root.getAttribute('aria-label')).toBe('Other');
    view.destroy();
  });

  it('without them the root carries no name attribute', async () => {
    const view = await render({ engine: createDocumentEditor() });
    expect(view.root().hasAttribute('aria-label')).toBe(false);
    expect(view.root().hasAttribute('aria-labelledby')).toBe(false);
    view.destroy();
  });

  it('readonly: not editable, a document, and it can be toggled live (the prop drives the engine)', async () => {
    const engine = createDocumentEditor();
    const view = await render({ engine, label: 'Viewer', readonly: true });
    const root = view.root();
    expect(engine.readonly).toBe(true);
    expect(root.getAttribute('contenteditable')).toBe('false');
    expect(root.getAttribute('role')).toBe('document'); // aria-readonly is not allowed on a non-textbox
    expect(root.hasAttribute('aria-readonly')).toBe(false);
    expect(root.hasAttribute('data-nabu-readonly')).toBe(true);
    expect(root.getAttribute('aria-label')).toBe('Viewer');
    expect(root.hasAttribute('aria-description')).toBe(false); // no Tab trap to announce

    view.state.readonly = false;
    await tick();
    expect(engine.readonly).toBe(false);
    expect(root.getAttribute('contenteditable')).toBe('true');
    expect(root.hasAttribute('role')).toBe(false);
    expect(root.getAttribute('aria-description')).toBeTruthy();

    view.state.readonly = true;
    await tick();
    expect(root.getAttribute('contenteditable')).toBe('false');
    view.destroy();
  });

  it('without the prop the editor follows engine.readonly; an explicit readonly={false} wins', async () => {
    const engine = createDocumentEditor({ readonly: true });
    const view = await render({ engine });
    expect(view.root().getAttribute('contenteditable')).toBe('false');
    engine.readonly = false;
    await tick();
    expect(view.root().getAttribute('contenteditable')).toBe('true');
    view.destroy();

    const other = createDocumentEditor({ readonly: true });
    const explicit = await render({ engine: other, readonly: false });
    expect(explicit.root().getAttribute('contenteditable')).toBe('true');
    expect(other.readonly).toBe(false);
    explicit.destroy();
  });
});
