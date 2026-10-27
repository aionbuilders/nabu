// @ts-nocheck — mocks intentionally implement only the surface TextBehavior uses
/**
 * Unit tests for the native `beforeinput` types TextBehavior handles (P-72, P-73): grapheme-aware Backspace,
 * insertReplacementText, line deletions, insertTranspose, insertFromYank, format* (no-op without the rich-text extension
 * + the rich-text hook), and the multi-block routing of the container.
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior, prevGraphemeLength, nextGraphemeLength } from '#lib/behaviors/text/text.behavior.svelte.js';
import { RichTextExtension } from '#lib/behaviors/text/rich-text.extension.js';
import { handleContainerBeforeInput } from '#lib/blocks/container.utils.js';

/** Mock LoroText over per-character attributes: insert / delete / mark really edit it, so assertions read the result. */
function makeContainer(initial = '', marksPerChar = null) {
  const units = initial.split('').map((c, i) => ({ c, a: marksPerChar?.[i] ? { ...marksPerChar[i] } : null }));
  const c = {
    units,
    toString: () => c.units.map((u) => u.c).join(''),
    get length() { return c.units.length; },
    toDelta: () => {
      const out = [];
      for (const u of c.units) {
        const last = out[out.length - 1];
        const same = last && JSON.stringify(last.attributes ?? null) === JSON.stringify(u.a);
        if (same) last.insert += u.c;
        else out.push({ insert: u.c, ...(u.a ? { attributes: { ...u.a } } : {}) });
      }
      return out;
    },
    insert: vi.fn((index, text) => { c.units.splice(index, 0, ...text.split('').map((ch) => ({ c: ch, a: null }))); }),
    delete: vi.fn((index, length) => { c.units.splice(index, length); }),
    mark: vi.fn(({ start, end }, name, value) => { for (let i = start; i < end; i++) c.units[i].a = { ...(c.units[i].a ?? {}), [name]: value }; }),
    unmark: vi.fn(({ start, end }, name) => { for (let i = start; i < end; i++) if (c.units[i].a) delete c.units[i].a[name]; }),
    subscribe: vi.fn(), applyDelta: vi.fn(),
    sliceDelta: vi.fn(() => []),
  };
  return c;
}

function makeBehavior(text = '', { marks = null, previous = null, element = null } = {}) {
  const container = makeContainer(text, marks);
  const block = {
    nabu: {
      hooks: new Map(), warn: vi.fn(), selection: { setCursor: vi.fn() },
      BREAK: Symbol('break'), inputRules: [], storedMarks: { bold: true },
    },
    node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
    element, behaviors: new Map(), selected: false,
    commit: vi.fn(), ascend: vi.fn(), findBackward: vi.fn(() => previous),
    findForward: vi.fn(), consume: vi.fn(), destroy: vi.fn(), type: 'paragraph',
  };
  const behavior = new TextBehavior(block, container);
  block.behaviors.set('text', behavior);
  return { behavior, container, block };
}

const sel = (from, to = from) => ({ from, to, isCollapsed: from === to });
const ev = (inputType, extra = {}) => ({ inputType, preventDefault: vi.fn(), ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('prevGraphemeLength / nextGraphemeLength', () => {
  it.each([
    ['plain', 'abc', 3, 1],
    ['surrogate pair', 'a𝒳', 3, 2],
    ['flag', 'x🇫🇷', 5, 4],
    ['ZWJ family', 'x👨‍👩‍👧', 9, 8],
    ['letter + combining accent', 'xé', 3, 2],
    ['start', 'abc', 0, 0],
  ])('%s', (_, text, index, expected) => {
    expect(prevGraphemeLength(text, index)).toBe(expected);
  });

  it('from INSIDE a cluster, back to the start of that cluster', () => {
    expect(prevGraphemeLength('a𝒳', 2)).toBe(1); // between the two halves of the surrogate pair
    expect(prevGraphemeLength('xé', 2)).toBe(1); // between "e" and U+0301? the cluster starts at "e"
  });

  it('out of range is 0', () => {
    expect(prevGraphemeLength('ab', 9)).toBe(0);
    expect(nextGraphemeLength('ab', 2)).toBe(0);
  });
});

describe('Backspace is grapheme-aware (P-72)', () => {
  it.each([
    ['ZWJ family', 'a👨‍👩‍👧'],
    ['flag', 'a🇫🇷'],
    ['surrogate pair', 'a𝒳'],
    ['e + combining accent', 'aé'],
  ])('%s: one press removes the whole character', async (_, text) => {
    const { behavior, container, block } = makeBehavior(text);
    const e = ev('deleteContentBackward');
    behavior.handleDeleteContentBackward(e, sel(text.length));
    expect(container.toString()).toBe('a');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(block.commit).toHaveBeenCalledTimes(1);
    await flush();
    expect(block.nabu.selection.setCursor).toHaveBeenCalledWith(block, 1);
  });

  it('mid-text deletes the previous cluster only', () => {
    const { behavior, container } = makeBehavior('a🇫🇷b');
    behavior.handleDeleteContentBackward(ev('deleteContentBackward'), sel(5));
    expect(container.toString()).toBe('ab');
  });

  it('a plain character is still one unit; a selection is deleted whole', () => {
    const { behavior, container } = makeBehavior('abcdef');
    behavior.handleDeleteContentBackward(ev('deleteContentBackward'), sel(3));
    expect(container.toString()).toBe('abdef');
    behavior.handleDeleteContentBackward(ev('deleteContentBackward'), sel(0, 2));
    expect(container.toString()).toBe('def');
  });

  it('at the start of the block it still merges into the previous text block', () => {
    const prev = makeBehavior('xy');
    const { behavior, block } = makeBehavior('abc', { previous: prev.block });
    prev.block.consume = vi.fn();
    const e = ev('deleteContentBackward');
    behavior.handleDeleteContentBackward(e, sel(0));
    expect(prev.block.consume).toHaveBeenCalledWith(block);
    expect(block.destroy).toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

describe('line deletions (P-73)', () => {
  const run = (type, text, s) => {
    const { behavior, container, block } = makeBehavior(text);
    const e = ev(type);
    behavior.handleBeforeInput(e, s);
    return { text: container.toString(), block, e };
  };

  it('deleteSoftLineBackward / deleteHardLineBackward: to the previous line break', () => {
    expect(run('deleteSoftLineBackward', 'one\ntwo three', sel(7)).text).toBe('one\n three');
    expect(run('deleteHardLineBackward', 'one\ntwo three', sel(7)).text).toBe('one\n three');
    expect(run('deleteHardLineBackward', 'abc', sel(2)).text).toBe('c');
    expect(run('deleteHardLineBackward', '\nabc', sel(0)).text).toBe('\nabc'); // start of text: nothing
  });

  it('deleteSoftLineForward / deleteHardLineForward: to the next line break or the end', () => {
    expect(run('deleteSoftLineForward', 'one two\nthree', sel(4)).text).toBe('one \nthree');
    expect(run('deleteHardLineForward', 'one two\nthree', sel(9)).text).toBe('one two\nt');
    expect(run('deleteHardLineForward', 'abc', sel(1)).text).toBe('a');
  });

  it('forward at the end of a line or of the block deletes nothing', () => {
    const r = run('deleteSoftLineForward', 'one\ntwo', sel(3));
    expect(r.text).toBe('one\ntwo');
    expect(r.block.commit).not.toHaveBeenCalled();
    expect(run('deleteSoftLineForward', 'abc', sel(3)).text).toBe('abc');
  });

  it('deleteEntireSoftLine empties the line, keeps the line breaks, caret at the line start', async () => {
    const r = run('deleteEntireSoftLine', 'one\ntwo three\nfour', sel(6));
    expect(r.text).toBe('one\n\nfour');
    await flush();
    expect(r.block.nabu.selection.setCursor).toHaveBeenCalledWith(r.block, 4);
    expect(run('deleteEntireSoftLine', 'abc', sel(1)).text).toBe('');
  });

  it('deleteEntireSoftLine with a selection spanning lines removes every touched line', () => {
    expect(run('deleteEntireSoftLine', 'aa\nbb\ncc\ndd', sel(4, 7)).text).toBe('aa\n\ndd');
  });

  it('a selection is deleted whole by the directional line deletions', () => {
    expect(run('deleteSoftLineBackward', 'abcdef', sel(1, 3)).text).toBe('adef');
    expect(run('deleteSoftLineForward', 'abcdef', sel(1, 3)).text).toBe('adef');
  });

  it('deleteContent deletes the selection; a collapsed caret deletes nothing', () => {
    expect(run('deleteContent', 'abcdef', sel(1, 4)).text).toBe('aef');
    const r = run('deleteContent', 'abc', sel(1));
    expect(r.text).toBe('abc');
    expect(r.block.commit).not.toHaveBeenCalled();
  });
});

describe('insertTranspose (Ctrl+T)', () => {
  const run = (text, at, opts) => {
    const { behavior, container, block } = makeBehavior(text, opts);
    behavior.handleBeforeInput(ev('insertTranspose'), sel(at));
    return { text: container.toString(), container, block };
  };

  it('swaps the characters around the caret, caret after the pair', async () => {
    const r = run('abcd', 2);
    expect(r.text).toBe('acbd');
    await flush();
    expect(r.block.nabu.selection.setCursor).toHaveBeenCalledWith(r.block, 3);
    expect(r.block.commit).toHaveBeenCalledTimes(1);
  });

  it('at the end of the text swaps the last two', async () => {
    const r = run('abc', 3);
    expect(r.text).toBe('acb');
    await flush();
    expect(r.block.nabu.selection.setCursor).toHaveBeenCalledWith(r.block, 3);
  });

  it('keeps graphemes whole (emoji, flag, accent)', () => {
    expect(run('a🇫🇷b', 1).text).toBe('🇫🇷ab');
    expect(run('a𝒳b', 3).text).toBe('ab𝒳');
    expect(run('aéb', 3).text).toBe('aBé'.replace('B', 'b'));
  });

  it('edges: start, single character, empty, selection, line break are no-ops', () => {
    expect(run('abc', 0).text).toBe('abc');
    expect(run('a', 1).text).toBe('a');
    expect(run('', 0).text).toBe('');
    expect(run('a\nb', 1).text).toBe('a\nb');
    const { behavior, container } = makeBehavior('abcd');
    behavior.handleBeforeInput(ev('insertTranspose'), sel(1, 3));
    expect(container.toString()).toBe('abcd');
  });

  it('marks travel with their characters', () => {
    const r = run('ab', 2, { marks: [{ bold: true }, null] });
    expect(r.text).toBe('ba');
    expect(r.container.toDelta()).toEqual([{ insert: 'b' }, { insert: 'a', attributes: { bold: true } }]);
  });
});

describe('insertReplacementText', () => {
  it('replaces the selection with the dataTransfer text, caret after it, one commit', async () => {
    const { behavior, container, block } = makeBehavior('helo world');
    const e = ev('insertReplacementText', { dataTransfer: { getData: (t) => t === 'text/plain' ? 'hello' : '' }, getTargetRanges: () => [] });
    behavior.handleBeforeInput(e, sel(0, 4));
    expect(container.toString()).toBe('hello world');
    expect(block.commit).toHaveBeenCalledTimes(1);
    expect(block.nabu.storedMarks).toBeNull();
    await flush();
    expect(block.nabu.selection.setCursor).toHaveBeenCalledWith(block, 5);
  });

  it('falls back to event.data', () => {
    const { behavior, container } = makeBehavior('teh cat');
    behavior.handleBeforeInput(ev('insertReplacementText', { data: 'the' }), sel(0, 3));
    expect(container.toString()).toBe('the cat');
  });

  it('uses the target range (mapped through calculateOffset), not the selection', () => {
    const element = { contains: () => true };
    const { behavior, container } = makeBehavior('helo world', { element });
    behavior.calculateOffset = vi.fn((node, offset) => offset);
    const range = { startContainer: {}, startOffset: 0, endContainer: {}, endOffset: 4 };
    behavior.handleBeforeInput(ev('insertReplacementText', { data: 'hello', getTargetRanges: () => [range] }), sel(8));
    expect(behavior.calculateOffset).toHaveBeenCalledTimes(2);
    expect(container.toString()).toBe('hello world');
  });

  it('a target range outside this block is ignored (selection used)', () => {
    const element = { contains: () => false };
    const { behavior, container } = makeBehavior('helo world', { element });
    behavior.calculateOffset = vi.fn(() => 0);
    behavior.handleBeforeInput(ev('insertReplacementText', { data: 'hello', getTargetRanges: () => [{ startContainer: {}, endContainer: {} }] }), sel(0, 4));
    expect(behavior.calculateOffset).not.toHaveBeenCalled();
    expect(container.toString()).toBe('hello world');
  });

  it('keeps the marks of the replaced run on the new text only', () => {
    const { behavior, container } = makeBehavior('helo world', { marks: [{ bold: true }, { bold: true }, { bold: true }, { bold: true }] });
    behavior.handleBeforeInput(ev('insertReplacementText', { data: 'hello' }), sel(0, 4));
    expect(container.toString()).toBe('hello world');
    expect(container.toDelta()).toEqual([{ insert: 'hello', attributes: { bold: true } }, { insert: ' world' }]);
  });

  it('nothing to insert and nothing to replace: no-op', () => {
    const { behavior, container, block } = makeBehavior('abc');
    behavior.handleBeforeInput(ev('insertReplacementText'), sel(1));
    expect(container.toString()).toBe('abc');
    expect(block.commit).not.toHaveBeenCalled();
  });
});

describe('insertFromYank', () => {
  it('inserts the text as plain text, replacing the selection, no input rule', async () => {
    const { behavior, container, block } = makeBehavior('abcdef');
    block.nabu.inputRules = [{ pattern: /./, handler: vi.fn(() => true) }];
    behavior.handleBeforeInput(ev('insertFromYank', { data: 'XY' }), sel(1, 3));
    expect(container.toString()).toBe('aXYdef');
    expect(block.nabu.inputRules[0].handler).not.toHaveBeenCalled();
    expect(block.commit).toHaveBeenCalledTimes(1);
    await flush();
    expect(block.nabu.selection.setCursor).toHaveBeenCalledWith(block, 3);
  });

  it('reads the dataTransfer when there is no data', () => {
    const { behavior, container } = makeBehavior('ab');
    behavior.handleBeforeInput(ev('insertFromYank', { dataTransfer: { getData: () => 'Z' } }), sel(2));
    expect(container.toString()).toBe('abZ');
  });
});

describe('format* types', () => {
  it('are silent no-ops in TextBehavior (the rich-text hook decides)', () => {
    for (const type of ['formatBold', 'formatItalic', 'formatUnderline', 'formatStrikeThrough', 'formatSubscript', 'formatSuperscript', 'formatRemove']) {
      const { behavior, container, block } = makeBehavior('abc');
      const e = ev(type);
      behavior.handleBeforeInput(e, sel(0, 3));
      expect(container.toString()).toBe('abc');
      expect(block.nabu.warn).not.toHaveBeenCalled();
      expect(e.preventDefault).toHaveBeenCalled();
    }
  });

  it('an unknown type keeps the warning', () => {
    const { behavior, block } = makeBehavior('abc');
    behavior.handleBeforeInput(ev('insertSomethingNew'), sel(1));
    expect(block.nabu.warn).toHaveBeenCalledWith('Unhandled input type:', 'insertSomethingNew');
  });
});

describe('rich-text onBeforeInput hook (format routing)', () => {
  const hook = RichTextExtension.hooks.onBeforeInput;
  const makeNabu = () => ({ exec: vi.fn(), BREAK: Symbol('break'), storedMarks: null, selection: { anchorBlock: null }, blocks: new Map(), transact: vi.fn() });

  it.each([
    ['formatBold', 'bold'], ['formatItalic', 'italic'], ['formatUnderline', 'underline'], ['formatStrikeThrough', 'strikethrough'],
  ])('%s -> mark:toggle %s', (type, mark) => {
    const nabu = makeNabu();
    const e = ev(type);
    expect(hook(nabu, e, null)).toBe(nabu.BREAK);
    expect(nabu.exec).toHaveBeenCalledWith('mark:toggle', { mark });
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('sub/superscript have no mark: swallowed without any action', () => {
    const nabu = makeNabu();
    expect(hook(nabu, ev('formatSubscript'), null)).toBe(nabu.BREAK);
    expect(hook(nabu, ev('formatSuperscript'), null)).toBe(nabu.BREAK);
    expect(nabu.exec).not.toHaveBeenCalled();
  });

  it('formatRemove removes the formatting marks of the selected text in one transaction', () => {
    const nabu = makeNabu();
    const { behavior, block } = makeBehavior('ab');
    const removeMark = vi.fn();
    behavior.removeMark = removeMark;
    Object.defineProperty(behavior, 'selection', { value: sel(0, 2), configurable: true });
    block.selected = true;
    nabu.blocks.set('a', block);
    nabu.transact = vi.fn((fn) => fn());
    expect(hook(nabu, ev('formatRemove'), null)).toBe(nabu.BREAK);
    expect(nabu.transact).toHaveBeenCalledTimes(1);
    expect(removeMark.mock.calls.map((c) => c[0])).toEqual(['bold', 'italic', 'underline', 'strikethrough', 'code']);
  });

  it('formatRemove at a collapsed caret switches the stored marks off', () => {
    const nabu = makeNabu();
    nabu.selection.anchorBlock = { behaviors: new Map([['text', {}]]) };
    hook(nabu, ev('formatRemove'), null);
    expect(nabu.storedMarks).toEqual({ bold: false, italic: false, underline: false, strikethrough: false, code: false });
  });

  it('other input types are left alone', () => {
    const nabu = makeNabu();
    expect(hook(nabu, ev('insertText'), null)).toBeUndefined();
  });
});

describe('multi-block selections (container routing)', () => {
  it('format / transpose are silent no-ops; unknown types still warn', () => {
    const nabu = {
      warn: vi.fn(),
      selection: { startBlock: null, endBlock: null },
      commit: vi.fn(() => Promise.resolve()),
      blocks: new Map(),
    };
    const a = { id: 'a', selection: { from: 1, to: 1 }, beforeinput: vi.fn() };
    const b = { id: 'b', selection: { from: 0, to: 2 } };
    nabu.selection.startBlock = a; nabu.selection.endBlock = b;
    for (const type of ['formatBold', 'formatRemove', 'insertTranspose']) {
      expect(handleContainerBeforeInput({}, nabu, ev(type))).toBe(true);
    }
    expect(nabu.warn).not.toHaveBeenCalled();
    nabu.warn.mockClear();
    // unknown types still warn
    expect(handleContainerBeforeInput({}, nabu, ev('insertNothingKnown'))).toBe(false);
    expect(nabu.warn).toHaveBeenCalled();
  });
});
