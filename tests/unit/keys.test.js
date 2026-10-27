// @ts-nocheck
/**
 * Key chords (utils/keys.js, ADR 017): parsing, normalization of keyboard events, per-platform display, reserved chords.
 */

import { describe, it, expect } from 'vitest';
import {
  parseChord, canonicalChord, chordId, eventChord, eventChordId, formatChord, hasCommandModifier,
  isReservedChord, reservedChords, detectPlatform,
} from '#lib/utils/keys.js';

const mac = { platform: 'mac' };
const other = { platform: 'other' };
const ev = (key, init = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });

describe('parseChord', () => {
  it('reads modifiers and a key, case-insensitively', () => {
    expect(parseChord('Ctrl-Alt-ArrowUp', other)).toEqual({ key: 'ArrowUp', ctrl: true, alt: true, shift: false, meta: false });
    expect(parseChord('ctrl-alt-arrowup', other)).toEqual(parseChord('Ctrl-Alt-ArrowUp', other));
    expect(parseChord('Backspace', other)).toEqual({ key: 'Backspace', ctrl: false, alt: false, shift: false, meta: false });
    expect(parseChord('Mod-Shift-Enter', other)).toEqual({ key: 'Enter', ctrl: true, alt: false, shift: true, meta: false });
  });

  it('Mod is Meta on macOS and Ctrl elsewhere', () => {
    expect(canonicalChord('Mod-k', mac)).toBe('Meta-k');
    expect(canonicalChord('Mod-k', other)).toBe('Ctrl-k');
    expect(canonicalChord('Ctrl-k', mac)).toBe('Ctrl-k'); // an explicit Ctrl stays Ctrl
    expect(canonicalChord('Cmd-k', other)).toBe('Meta-k');
  });

  it('canonical modifier order is Ctrl, Alt, Shift, Meta whatever the written order', () => {
    expect(canonicalChord('Shift-Alt-Ctrl-Enter', other)).toBe('Ctrl-Alt-Shift-Enter');
    expect(canonicalChord('Meta-Shift-z', other)).toBe('Shift-Meta-z');
  });

  it('letters are lower-cased; Shift on a letter is kept', () => {
    expect(canonicalChord('Mod-K', other)).toBe('Ctrl-k');
    expect(canonicalChord('Mod-Shift-X', other)).toBe('Ctrl-Shift-x');
  });

  it('aliases and the minus / plus keys', () => {
    expect(canonicalChord('Esc', other)).toBe('Escape');
    expect(canonicalChord('Mod-Return', other)).toBe('Ctrl-Enter');
    expect(canonicalChord('Alt-Up', other)).toBe('Alt-ArrowUp');
    expect(canonicalChord('Mod-Space', other)).toBe('Ctrl- ');
    expect(canonicalChord('Mod--', other)).toBe('Ctrl--');
    expect(canonicalChord('Mod-+', other)).toBe('Ctrl-+');
    expect(canonicalChord('-', other)).toBe('-');
    expect(canonicalChord('Mod-F2', other)).toBe('Ctrl-F2');
  });

  it('refuses what is not a chord', () => {
    for (const bad of ['', '   ', 'Mod-', 'Shift', 'Mod-Shift', 'Hyper-k', 'Mod-Nope', 'Mod-Mod-k', 'Ctrl-Mod-k', 'Shift-Shift-k', 'Mod-Shift-1', 'Mod-Shift-/', 42, null, undefined]) {
      expect(parseChord(bad, other), String(bad)).toBeNull();
    }
    expect(parseChord('Mod-Shift-Space', other)).not.toBeNull(); // Space is a named key
  });
});

describe('eventChord / eventChordId', () => {
  it('matches the chord string it was written from', () => {
    expect(eventChordId(ev('b', { ctrlKey: true }))).toBe(canonicalChord('Mod-b', other));
    expect(eventChordId(ev('b', { metaKey: true }))).toBe(canonicalChord('Mod-b', mac));
    expect(eventChordId(ev('Enter', { ctrlKey: true, shiftKey: true }))).toBe(canonicalChord('Mod-Shift-Enter', other));
    expect(eventChordId(ev('ArrowUp', { ctrlKey: true, altKey: true }))).toBe(canonicalChord('Ctrl-Alt-ArrowUp', other));
    expect(eventChordId(ev('Backspace'))).toBe('Backspace');
  });

  it('letters: case-insensitive (Caps Lock, Shift), Shift stays a modifier', () => {
    expect(eventChordId(ev('B', { ctrlKey: true }))).toBe('Ctrl-b'); // Caps Lock
    expect(eventChordId(ev('X', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl-Shift-x');
    expect(eventChordId(ev('x', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl-Shift-x');
  });

  it('digits and symbols: the produced character counts, Shift does not', () => {
    expect(eventChordId(ev('!', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl-!');
    expect(eventChordId(ev('?', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl-?');
    expect(eventChordId(ev('1', { ctrlKey: true }))).toBe('Ctrl-1');
    expect(canonicalChord('Mod-!', other)).toBe('Ctrl-!');
  });

  it('named keys keep Shift', () => {
    expect(eventChordId(ev('Tab', { shiftKey: true }))).toBe('Shift-Tab');
    expect(eventChordId(ev('Enter', { shiftKey: true }))).toBe('Shift-Enter');
    expect(eventChordId(ev(' ', { ctrlKey: true }))).toBe('Ctrl- ');
  });

  it('pure modifier presses, AltGraph and unidentified keys have no chord', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'Dead', 'Unidentified', '']) {
      expect(eventChord(ev(key)), key).toBeNull();
    }
    expect(eventChord({ ...ev('@', { ctrlKey: true, altKey: true }), getModifierState: (m) => m === 'AltGraph' })).toBeNull();
    expect(eventChord({})).toBeNull();
    expect(eventChord(null)).toBeNull();
  });

  it('non-Latin layouts and dead keys fall back on event.code', () => {
    expect(eventChordId(ev('и', { ctrlKey: true, code: 'KeyB' }))).toBe('Ctrl-b'); // Cyrillic layout
    expect(eventChordId(ev('∫', { metaKey: true, altKey: true, code: 'KeyB' }))).toBe('Alt-Meta-b'); // Option+B on macOS
    expect(eventChordId(ev('Dead', { ctrlKey: true, code: 'KeyE' }))).toBe('Ctrl-e');
    expect(eventChordId(ev('é', { ctrlKey: true, code: 'Digit2' }))).toBe('Ctrl-2');
    expect(eventChordId(ev('Dead', { ctrlKey: true, code: 'Quote' }))).toBeNull();
    // a Latin key is never replaced by its code (Dvorak, AZERTY keep their letters)
    expect(eventChordId(ev('a', { ctrlKey: true, code: 'KeyQ' }))).toBe('Ctrl-a');
  });
});

describe('hasCommandModifier', () => {
  it('Ctrl, Alt and Meta make a shortcut; Shift alone does not', () => {
    expect(hasCommandModifier(parseChord('Mod-k', other))).toBe(true);
    expect(hasCommandModifier(parseChord('Alt-k', other))).toBe(true);
    expect(hasCommandModifier(parseChord('Meta-k', other))).toBe(true);
    expect(hasCommandModifier(parseChord('Shift-Tab', other))).toBe(false);
    expect(hasCommandModifier(parseChord('Backspace', other))).toBe(false);
  });
});

describe('formatChord', () => {
  it('macOS: symbols, no separator, Apple order', () => {
    expect(formatChord('Mod-b', mac)).toBe('⌘B');
    expect(formatChord('Mod-Shift-z', mac)).toBe('⇧⌘Z');
    expect(formatChord('Ctrl-Alt-ArrowUp', mac)).toBe('⌃⌥↑');
    expect(formatChord('Mod-Enter', mac)).toBe('⌘↩');
    expect(formatChord('Backspace', mac)).toBe('⌫');
    expect(formatChord('Mod-Shift-Space', mac)).toBe('⇧⌘Space');
    expect(formatChord('F2', mac)).toBe('F2');
  });

  it('elsewhere: names joined with +', () => {
    expect(formatChord('Mod-b', other)).toBe('Ctrl+B');
    expect(formatChord('Mod-Shift-z', other)).toBe('Ctrl+Shift+Z');
    expect(formatChord('Ctrl-Alt-ArrowUp', other)).toBe('Ctrl+Alt+Up');
    expect(formatChord('Mod-Enter', other)).toBe('Ctrl+Enter');
    expect(formatChord('Escape', other)).toBe('Esc');
    expect(formatChord('Meta-k', other)).toBe('Meta+K');
  });

  it('formats a parsed chord, and gives "" for an invalid string', () => {
    expect(formatChord(parseChord('Mod-k', other), other)).toBe('Ctrl+K');
    expect(formatChord('Nope-k', other)).toBe('');
  });
});

describe('reserved chords', () => {
  it('browser / OS chords, per platform', () => {
    for (const text of ['Mod-w', 'Mod-t', 'Mod-n', 'Mod-q', 'Mod-Shift-t', 'Mod-Tab', 'Alt-F4', 'F5', 'Mod-r', 'Mod-l', 'Mod-PageUp', 'Mod-PageDown', 'Mod-1', 'Mod-9']) {
      expect(isReservedChord(parseChord(text, mac), 'mac'), `mac ${text}`).toBe(true);
      expect(isReservedChord(parseChord(text, other), 'other'), `other ${text}`).toBe(true);
    }
    expect(isReservedChord(parseChord('Mod-b', other), 'other')).toBe(false);
    expect(isReservedChord(parseChord('Mod-Alt-1', other), 'other')).toBe(false);
    // Mod is resolved: Ctrl-w is the reserved one elsewhere, Cmd-w on macOS
    expect(reservedChords('mac').has('Meta-w')).toBe(true);
    expect(reservedChords('mac').has('Ctrl-w')).toBe(false);
    expect(reservedChords('other').has('Ctrl-w')).toBe(true);
  });
});

describe('detectPlatform', () => {
  it('is "other" in the test environment (Linux user agent)', () => {
    expect(detectPlatform()).toBe('other');
  });
});
