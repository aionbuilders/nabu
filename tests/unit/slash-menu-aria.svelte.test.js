// @ts-nocheck
/**
 * P-121: the slash menu is a listbox. Focus never leaves the contenteditable host, so the menu is exposed three ways:
 * listbox / group / option roles with `aria-selected`; `aria-controls` + `aria-activedescendant` on the editor root while it is
 * open; and a polite live region that says the active entry.
 */
import { describe, it, expect } from 'vitest';
// The unit environment resolves `svelte` to its server build (no `mount`): the client runtime is imported by path.
import { mount, unmount, tick } from '../../node_modules/svelte/src/index-client.js';
import SlashMenu from '#lib/ui/SlashMenu.svelte';

const COMMANDS = [
  { title: 'Text', subtitle: 'Plain paragraph', icon: 'T', group: 'text', run() {} },
  { title: 'Heading 1', subtitle: 'Large heading', icon: 'H1', group: 'text', run() {} },
  { title: 'Bulleted list', icon: '•', group: 'lists', run() {} },
  { title: 'Divider', run() {} },
];

async function open({ text = '/', messages } = {}) {
  const root = document.createElement('div');
  root.setAttribute('data-nabu-root', 'true');
  const blockEl = document.createElement('p');
  // happy-dom has no layout: give the caret line a place inside a viewport, or the menu would think it is scrolled out of view
  blockEl.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 50, right: 300, width: 250, height: 20 });
  root.appendChild(blockEl);
  document.body.appendChild(root);
  const target = document.createElement('div');
  document.body.appendChild(target);

  const behavior = { text, selection: { from: text.length, isCollapsed: true } };
  const block = { element: blockEl, behaviors: new Map([['text', behavior]]) };
  const engine = $state({ readonly: false, selection: { anchorBlock: block, firstRange: null }, slashCommands: COMMANDS });
  const app = mount(SlashMenu, { target, props: { engine, ...(messages ? { messages } : {}) } });
  await tick();
  await tick();
  return {
    root, target, engine, behavior,
    menu: () => target.querySelector('[role="listbox"]'),
    options: () => [...target.querySelectorAll('[role="option"]')],
    live: () => target.querySelector('[role="status"]'),
    destroy: () => { unmount(app); root.remove(); target.remove(); },
  };
}

const viewport = [1024, 768];
Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, get: () => viewport[0] });
Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => viewport[1] });

describe('SlashMenu ARIA', () => {
  it('is a named listbox of options, grouped, with the first one selected', async () => {
    const view = await open();
    const menu = view.menu();
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('aria-label')).toBe('Insert block');
    const options = view.options();
    expect(options.map((o) => o.querySelector('.nabu-slash-title').textContent)).toEqual(['Text', 'Heading 1', 'Bulleted list', 'Divider']);
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(new Set(options.map((o) => o.id)).size).toBe(4);
    options.forEach((o) => expect(o.id).toBeTruthy());

    // grouped entries sit in a named group; an entry without a group is a direct child of the listbox
    const groups = [...menu.querySelectorAll('[role="group"]')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Text', 'Lists']);
    expect([...groups[0].querySelectorAll('[role="option"]')].length).toBe(2);
    expect(options[3].parentElement).toBe(menu);
    // the icon glyph is decoration
    expect(options[0].querySelector('.nabu-slash-icon').getAttribute('aria-hidden')).toBe('true');
    view.destroy();
  });

  it('the editor root controls the list and points at the active option; both are removed on close', async () => {
    const view = await open();
    expect(view.root.getAttribute('aria-controls')).toBe(view.menu().id);
    expect(view.root.getAttribute('aria-activedescendant')).toBe(view.options()[0].id);

    // the keyboard moves the highlight: hover does the same (the controller's selectedIndex)
    view.options()[2].dispatchEvent(new MouseEvent('mouseenter'));
    await tick();
    expect(view.options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
    expect(view.root.getAttribute('aria-activedescendant')).toBe(view.options()[2].id);

    // the "/" is deleted: the menu closes and the root is left clean
    view.behavior.text = '';
    view.engine.selection = { ...view.engine.selection, anchorBlock: { ...view.engine.selection.anchorBlock } };
    await tick();
    await tick();
    expect(view.menu()).toBeNull();
    expect(view.root.hasAttribute('aria-controls')).toBe(false);
    expect(view.root.hasAttribute('aria-activedescendant')).toBe(false);
    view.destroy();
  });

  it('a polite live region says the active entry and its position', async () => {
    const view = await open();
    const live = view.live();
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Text, Plain paragraph, 1 of 4');
    view.options()[1].dispatchEvent(new MouseEvent('mouseenter'));
    await tick();
    expect(live.textContent).toBe('Heading 1, Large heading, 2 of 4');
    view.destroy();
  });

  it('the name, the groups and the announcement are translatable', async () => {
    const view = await open({
      messages: {
        label: 'Insérer un bloc',
        groups: { text: 'Texte' },
        option: ({ title, index, count }) => `${title}, ${index} sur ${count}`,
      },
    });
    expect(view.menu().getAttribute('aria-label')).toBe('Insérer un bloc');
    expect([...view.menu().querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['Texte', 'Lists']);
    expect(view.live().textContent).toBe('Text, 1 sur 4');
    view.destroy();
  });

  it('nothing is exposed while the editor is read-only', async () => {
    const view = await open();
    view.engine.readonly = true;
    await tick();
    await tick();
    expect(view.menu()).toBeNull();
    expect(view.live().textContent).toBe('');
    expect(view.root.hasAttribute('aria-activedescendant')).toBe(false);
    view.destroy();
  });
});
