// @ts-nocheck — mocks intentionally implement only the surface TextBehavior uses
/**
 * Unit tests for TextBehavior word/line deletion inputTypes
 * (deleteWordBackward, deleteWordForward, deleteSoftLineBackward — issue #4)
 * and the declarative input rules system (TÂCHE 2).
 */

import { describe, it, expect, vi } from 'vitest';
import { TextBehavior } from '#lib/behaviors/text/text.behavior.svelte.js';
import { wordDeleteRange } from '#lib/utils/words.js';
import { TypographyExtension } from '#lib/behaviors/text/typography.extension.js';

// ── Mock LoroText container ────────────────────────────────────────────────

function makeContainer(text = '') {
  return {
    toString: () => text,
    get length() { return text.length; },
    toDelta: () => (text ? [{ insert: text }] : []),
    insert: vi.fn(),
    delete: vi.fn(),
    mark: vi.fn(),
    unmark: vi.fn(),
    subscribe: vi.fn(),
    applyDelta: vi.fn(),
    sliceDelta: vi.fn(() => []),
  };
}

/** Build a TextBehavior over a mock block, using the real constructor. */
function makeBehavior(text = '', { inputRules = [] } = {}) {
  const container = makeContainer(text);
  const block = {
    nabu: {
      hooks: new Map(),
      warn: vi.fn(),
      selection: { setCursor: vi.fn() },
      BREAK: Symbol('break'),
      inputRules,
    },
    node: { data: { get: (k) => k === 'text' ? container : null, setContainer: () => container } },
    element: null,
    behaviors: new Map(),
    selected: false,
    commit: vi.fn(),
    ascend: vi.fn(),
    findBackward: vi.fn(),
    findForward: vi.fn(),
    destroy: vi.fn(),
    type: 'paragraph',
  };
  const behavior = new TextBehavior(block, container);
  block.behaviors.set('text', behavior);
  return behavior;
}

function makeSel(from, to = from) {
  return { from, to, isCollapsed: from === to };
}

function makeEvent(inputType, data = null) {
  return {
    inputType,
    data,
    preventDefault: vi.fn(),
    getTargetRanges: () => [],
  };
}

/** Run an event on `before|after`-style text: returns the text after the deletion and the span deleted. */
function run(inputType, marked, selFn) {
  const caret = marked.indexOf('|');
  const text = marked.replace('|', '');
  const b = makeBehavior(text);
  b.handleBeforeInput(makeEvent(inputType), makeSel(caret));
  const call = b.container.delete.mock.calls[0];
  if (!call) return { result: marked, calls: 0 };
  const [index, length] = call;
  return { result: text.slice(0, index) + '|' + text.slice(index + length), calls: b.container.delete.mock.calls.length };
}
const back = (marked) => run('deleteWordBackward', marked).result;
const fwd = (marked) => run('deleteWordForward', marked).result;

// ── deleteWordBackward ─────────────────────────────────────────────────────
// Reference: Chromium contenteditable / <textarea> (same on macOS and Windows): the whitespace between the caret and the word
// is deleted with the word, the caret lands at the start of the word.

describe('TextBehavior deleteWordBackward', () => {
  it.each([
    // [before, after]
    ['this is a sentence |', 'this is a |'],      // issue #4: the space BEFORE the word stays
    ['hello world|', 'hello |'],                  // issue #4
    ['hello |', '|'],
    ['one two three|', 'one two |'],
    ['one two|', 'one |'],
    ['one two th|ree', 'one two |ree'],           // inside a word: back to its start
    ['one two |three', 'one |three'],             // right after a space: the space and the word before it
    ['one two   |', 'one |'],                     // several spaces
    ['one   two   |', 'one   |'],
    ['hello   |', '|'],
    ['   |', '|'],                                // whitespace only
    ['|hello', '|hello'],                         // start of the block: nothing
  ])('%j -> %j', (before, after) => {
    expect(back(before)).toBe(after);
  });

  it.each([
    ['end.|', 'end|'],                            // punctuation is its own stop
    ['end. |', 'end|'],
    ['word, |', 'word|'],
    ['say word, |', 'say word|'],
    ['wait...|', 'wait|'],                        // a run of punctuation is one unit
    ['wait... ok|', 'wait... |'],
    ['say (word)|', 'say (word|'],
    ['foo.bar|', 'foo.|'],
    ["don't stop|", "don't |"],                   // an inner apostrophe keeps the word whole
    ["don't|", '|'],
    ['well-known x|', 'well-known |'],
    ['well-known|', 'well-|'],
    ['a_b c|', 'a_b |'],
    ['x 12.5|', 'x |'],
  ])('punctuation: %j -> %j', (before, after) => {
    expect(back(before)).toBe(after);
  });

  it.each([
    ['你好世界很好|', '你好世界|'],                  // CJK words by Intl.Segmenter
    ['café olé|', 'café |'],
    ['café |olé', '|olé'],
    ['Привет мир|', 'Привет |'],
  ])('non-Latin: %j -> %j', (before, after) => {
    expect(back(before)).toBe(after);
  });

  it('line breaks: a break is deleted by itself, whitespace never reaches across one', () => {
    expect(back('line one\n|')).toBe('line one|');
    expect(back('a\nb|')).toBe('a\n|');
    expect(back('a\n   |')).toBe('a\n|');
    expect(back('a\n|b')).toBe('a|b');
  });

  it('deletes in ONE edit and puts the caret at the start of the word', () => {
    const b = makeBehavior('this is a sentence ');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(19));
    expect(b.container.delete).toHaveBeenCalledTimes(1);
    expect(b.container.delete).toHaveBeenCalledWith(10, 9); // "sentence "
    expect(b.block.commit).toHaveBeenCalledTimes(1);
  });

  it('ignores getTargetRanges() for a collapsed selection (Chromium leaves an orphan space otherwise)', () => {
    const b = makeBehavior('one two three');
    const event = makeEvent('deleteWordBackward');
    // Chromium reports a range starting right after "two "
    event.getTargetRanges = () => [{ startContainer: {}, startOffset: 8 }];
    b.calculateOffset = vi.fn(() => 8);
    b.handleBeforeInput(event, makeSel(13));
    expect(b.calculateOffset).not.toHaveBeenCalled();
    expect(b.container.delete).toHaveBeenCalledWith(8, 5); // "three"
  });

  it('does nothing at offset 0', () => {
    const b = makeBehavior('hello');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(0));
    expect(b.container.delete).not.toHaveBeenCalled();
  });

  it('deletes the selection when not collapsed', () => {
    const b = makeBehavior('hello world');
    b.handleBeforeInput(makeEvent('deleteWordBackward'), makeSel(2, 7));
    expect(b.container.delete).toHaveBeenCalledWith(2, 5);
  });
});

// ── deleteWordForward ──────────────────────────────────────────────────────
// The handler reads the platform: unit tests run in Node (no navigator) = 'other' = the Windows rule. The macOS rule is tested
// on wordDeleteRange itself.

describe('TextBehavior deleteWordForward (Windows / Linux rule)', () => {
  it.each([
    ['|one two three', '|two three'],             // the word and the whitespace after it, up to the next word
    ['one |two three', 'one |three'],
    ['one two |three', 'one two |'],
    ['one| two three', 'one|two three'],          // at whitespace: that whitespace only
    ['one|   two', 'one|two'],
    ['one |   ', 'one |'],
    ['on|e two', 'on|two'],                       // inside a word: to its end and the whitespace after
    ['end|. next', 'end|next'],                   // punctuation is its own stop
    ['a|, b', 'a|b'],
    ['|你好世界', '|世界'],                         // CJK
    ['|café olé', '|olé'],
    ['hello|', 'hello|'],                         // end of the block: nothing
    ['|', '|'],
  ])('%j -> %j', (before, after) => {
    expect(fwd(before)).toBe(after);
  });

  it('line breaks: a break is deleted by itself, whitespace never reaches across one', () => {
    expect(fwd('a|\nb')).toBe('a|b');
    expect(fwd('a |\nb')).toBe('a |b');
    expect(fwd('a|  \nb')).toBe('a|\nb');
  });

  it('ignores getTargetRanges() for a collapsed selection', () => {
    const b = makeBehavior('one two three');
    const event = makeEvent('deleteWordForward');
    event.getTargetRanges = () => [{ endContainer: {}, endOffset: 0 }];
    b.calculateOffset = vi.fn(() => 7);
    b.handleBeforeInput(event, makeSel(3));
    expect(b.calculateOffset).not.toHaveBeenCalled();
    expect(b.container.delete).toHaveBeenCalledWith(3, 1); // " "
  });

  it('does nothing at end of text', () => {
    const b = makeBehavior('hello');
    b.handleBeforeInput(makeEvent('deleteWordForward'), makeSel(5));
    expect(b.container.delete).not.toHaveBeenCalled();
  });

  it('deletes the selection when not collapsed', () => {
    const b = makeBehavior('hello world');
    b.handleBeforeInput(makeEvent('deleteWordForward'), makeSel(2, 7));
    expect(b.container.delete).toHaveBeenCalledWith(2, 5);
  });
});

// ── wordDeleteRange, per platform ──────────────────────────────────────────

describe('wordDeleteRange', () => {
  const del = (marked, direction, platform) => {
    const caret = marked.indexOf('|');
    const text = marked.replace('|', '');
    const { from, to } = wordDeleteRange(text, caret, direction, { platform });
    return text.slice(0, from) + '|' + text.slice(to);
  };

  it('backward is the same on macOS and Windows', () => {
    for (const platform of ['mac', 'other']) {
      expect(del('this is a sentence |', 'backward', platform)).toBe('this is a |');
      expect(del('hello world|', 'backward', platform)).toBe('hello |');
      expect(del('word, |', 'backward', platform)).toBe('word|');
    }
  });

  it.each([
    // [text, mac, windows]
    ['|one two three', '| two three', '|two three'],
    ['one |two three', 'one | three', 'one |three'],
    ['one| two three', 'one| three', 'one|two three'],
    ['one|   two', 'one|', 'one|two'],
    ['end|. next', 'end| next', 'end|next'],
    ['x| ... y', 'x| y', 'x|... y'],
    ['|你好世界', '|世界', '|世界'],
    ['hello|', 'hello|', 'hello|'],
  ])('forward %j: macOS %j, Windows %j', (marked, mac, windows) => {
    expect(del(marked, 'forward', 'mac')).toBe(mac);
    expect(del(marked, 'forward', 'other')).toBe(windows);
  });

  it('forward on macOS: whitespace, then the word after it', () => {
    expect(del('hello| world after', 'forward', 'mac')).toBe('hello| after');
  });
});

// ── deleteSoftLineBackward ─────────────────────────────────────────────────

describe('TextBehavior deleteSoftLineBackward', () => {
  it('deletes from the start of the current soft line to the cursor', () => {
    const b = makeBehavior('line1\nline2');
    b.handleBeforeInput(makeEvent('deleteSoftLineBackward'), makeSel(11));
    expect(b.container.delete).toHaveBeenCalledWith(6, 5); // "line2"
  });

  it('deletes from the start of the text when there is no newline', () => {
    const b = makeBehavior('hello');
    b.handleBeforeInput(makeEvent('deleteSoftLineBackward'), makeSel(3));
    expect(b.container.delete).toHaveBeenCalledWith(0, 3);
  });
});

// ── Input rules ────────────────────────────────────────────────────────────

describe('Input rules', () => {
  it('fires a matching rule and swallows the typed text', () => {
    const handler = vi.fn(() => true);
    const b = makeBehavior('abc', { inputRules: [{ pattern: /c$/, handler }] });
    const result = b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(3));
    expect(handler).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(b.container.insert).not.toHaveBeenCalled();
  });

  it('falls through to normal insertion when no rule matches', () => {
    const b = makeBehavior('abc', { inputRules: [{ pattern: /z$/, handler: vi.fn(() => true) }] });
    b.handleBeforeInput(makeEvent('insertText', 'x'), makeSel(3));
    expect(b.container.insert).toHaveBeenCalledWith(3, 'x');
  });

  it('typography rule converts "-- " into "— "', () => {
    const b = makeBehavior('a--', { inputRules: TypographyExtension.inputRules });
    b.handleBeforeInput(makeEvent('insertText', ' '), makeSel(3));
    expect(b.container.delete).toHaveBeenCalledWith(1, 2);
    expect(b.container.insert).toHaveBeenCalledWith(1, '— ');
  });

  it('typography rule does not fire for non-space characters', () => {
    const b = makeBehavior('a--', { inputRules: TypographyExtension.inputRules });
    b.handleBeforeInput(makeEvent('insertText', 'h'), makeSel(3));
    expect(b.container.delete).not.toHaveBeenCalled();
    expect(b.container.insert).toHaveBeenCalledWith(3, 'h');
  });
});
