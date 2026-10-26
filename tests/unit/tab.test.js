// @ts-nocheck
/**
 * Unit tests for the `tab` option (P-41): option resolution, preset defaults, and the engine's key handling
 * (src/lib/utils/tab.js, Nabu#handleKeydown). Real keys in a real browser are in tests/e2e/tab-behavior.spec.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { Nabu } from '$lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '$lib/blocks/paragraph/index.js';
import { resolveTabMode, isTabMode, handleTabKey } from '$lib/utils/tab.js';
import { MinimalPreset, TextPreset, DocumentPreset, FullPreset, tabDefaultFor, createMinimalEditor, createTextEditor, createDocumentEditor, createFullEditor, createEditor } from '$lib/presets.js';

const key = (init = {}) => {
  let prevented = false;
  return {
    key: 'Tab', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 9,
    defaultPrevented: false,
    preventDefault() { prevented = true; this.defaultPrevented = true; },
    get prevented() { return prevented; },
    ...init,
  };
};

async function makeEditor(init = {}) {
  const engine = new Nabu({ extensions: [ParagraphExtension], ...init });
  await engine.commit();
  return engine;
}

describe('resolveTabMode', () => {
  it('keeps a valid mode, uses the fallback silently when unset', () => {
    const warn = vi.fn();
    expect(resolveTabMode('stay', 'focus', warn)).toBe('stay');
    expect(resolveTabMode('indent', 'focus', warn)).toBe('indent');
    expect(resolveTabMode(undefined, 'stay', warn)).toBe('stay');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and falls back on an unknown value; "nest" is not implemented', () => {
    const warn = vi.fn();
    expect(resolveTabMode('bogus', 'stay', warn)).toBe('stay');
    expect(resolveTabMode('nest', 'focus', warn)).toBe('focus');
    expect(resolveTabMode(3, 'focus', warn)).toBe('focus');
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[1][0]).toMatch(/nest/);
    expect(isTabMode('nest')).toBe(false);
  });
});

describe('preset defaults', () => {
  it('maps each preset', () => {
    expect(tabDefaultFor(MinimalPreset)).toBe('focus');
    expect(tabDefaultFor(TextPreset)).toBe('focus');
    expect(tabDefaultFor(DocumentPreset)).toBe('stay');
    expect(tabDefaultFor(FullPreset)).toBe('stay');
    expect(tabDefaultFor([ParagraphExtension])).toBe('focus');
  });

  it('the factories apply them; an explicit option wins; a bad one falls back to the preset default', () => {
    expect(createMinimalEditor().tab).toBe('focus');
    expect(createTextEditor().tab).toBe('focus');
    expect(createDocumentEditor().tab).toBe('stay');
    expect(createFullEditor().tab).toBe('stay');
    expect(createEditor().tab).toBe('stay'); // default preset = Full
    expect(createEditor({ preset: [ParagraphExtension] }).tab).toBe('focus');
    expect(createFullEditor({ tab: 'focus' }).tab).toBe('focus');
    expect(createMinimalEditor({ tab: 'indent' }).tab).toBe('indent');
    expect(createDocumentEditor({ tab: 'nest' }).tab).toBe('stay');
  });

  it('a bare Nabu is "focus"', () => {
    expect(new Nabu({ extensions: [ParagraphExtension] }).tab).toBe('focus');
  });
});

describe('aria description', () => {
  it('is the hint while the mode keeps the focus in, absent for "focus"', () => {
    expect(new Nabu({ extensions: [ParagraphExtension], tab: 'stay' }).tabDescription).toBe('Press Escape then Tab to leave the editor');
    expect(new Nabu({ extensions: [ParagraphExtension], tab: 'indent' }).tabDescription).toBeTruthy();
    expect(new Nabu({ extensions: [ParagraphExtension], tab: 'focus' }).tabDescription).toBeUndefined();
  });

  it('is overridable, and can be turned off', () => {
    expect(new Nabu({ extensions: [ParagraphExtension], tab: 'stay', tabHint: 'Échap puis Tab pour sortir' }).tabDescription).toBe('Échap puis Tab pour sortir');
    expect(new Nabu({ extensions: [ParagraphExtension], tab: 'stay', tabHint: false }).tabDescription).toBeUndefined();
  });
});

describe('handleTabKey', () => {
  it('focus: never prevents', async () => {
    const nabu = await makeEditor({ tab: 'focus' });
    const e = key();
    expect(handleTabKey(nabu, e, false)).toBe(false);
    expect(e.prevented).toBe(false);
  });

  it('stay: swallows Tab and Shift+Tab, except right after an unconsumed Escape', async () => {
    const nabu = await makeEditor({ tab: 'stay' });
    const a = key();
    const b = key({ shiftKey: true });
    expect(handleTabKey(nabu, a, false)).toBe(true);
    expect(handleTabKey(nabu, b, false)).toBe(true);
    expect(a.prevented && b.prevented).toBe(true);
    const out = key();
    expect(handleTabKey(nabu, out, true)).toBe(false);
    expect(out.prevented).toBe(false);
  });

  it('ignores other keys, modifier combos, composition and keys already handled', async () => {
    const nabu = await makeEditor({ tab: 'stay' });
    for (const e of [key({ key: 'a' }), key({ ctrlKey: true }), key({ altKey: true }), key({ metaKey: true }), key({ isComposing: true }), key({ defaultPrevented: true })]) {
      expect(handleTabKey(nabu, e, false)).toBe(false);
    }
  });

  it('is reactive at runtime', async () => {
    const nabu = await makeEditor({ tab: 'focus' });
    nabu.tab = 'stay';
    expect(handleTabKey(nabu, key(), false)).toBe(true);
    nabu.tab = 'bogus';
    expect(nabu.tab).toBe('focus');
  });
});

describe('Nabu#handleKeydown: the Escape-then-Tab way out', () => {
  async function editor() {
    const nabu = await makeEditor({ tab: 'stay' });
    nabu.selection = { anchorBlock: null, focusBlock: null, blocks: new Set(), sync: vi.fn(), normalize: vi.fn(), setCursor: vi.fn(), isCollapsed: true };
    return nabu;
  }

  it('Escape then Tab is not swallowed; the following Tab is again; another key re-arms', async () => {
    const nabu = await editor();
    nabu.handleKeydown(key({ key: 'Escape', keyCode: 27 }));
    const out = key();
    nabu.handleKeydown(out);
    expect(out.prevented).toBe(false);
    const again = key();
    nabu.handleKeydown(again);
    expect(again.prevented).toBe(true);

    nabu.handleKeydown(key({ key: 'Escape', keyCode: 27 }));
    nabu.handleKeydown(key({ key: 'a', keyCode: 65 }));
    const rearmed = key();
    nabu.handleKeydown(rearmed);
    expect(rearmed.prevented).toBe(true);
  });

  it('a lone Shift between Escape and Shift+Tab does not re-arm; a click does', async () => {
    const nabu = await editor();
    nabu.handleKeydown(key({ key: 'Escape', keyCode: 27 }));
    nabu.handleKeydown(key({ key: 'Shift', keyCode: 16, shiftKey: true }));
    const out = key({ shiftKey: true });
    nabu.handleKeydown(out);
    expect(out.prevented).toBe(false);

    nabu.handleKeydown(key({ key: 'Escape', keyCode: 27 }));
    nabu.handleMousedown({ button: 0, defaultPrevented: true, target: null, currentTarget: {} });
    const trapped = key();
    nabu.handleKeydown(trapped);
    expect(trapped.prevented).toBe(true);
  });

  it('an Escape that something consumed does not open the way out', async () => {
    const nabu = await editor();
    nabu.handleKeydown(key({ key: 'Escape', keyCode: 27, defaultPrevented: true }));
    const e = key();
    nabu.handleKeydown(e);
    expect(e.prevented).toBe(true);
  });
});
