/**
 * Key chords (ADR 017): parse `"Mod-Shift-Enter"`, normalize a `KeyboardEvent` to the same canonical form, format for display.
 * Pure: no DOM access besides the (injectable) platform detection.
 *
 * ## Chord syntax
 * `[Modifier-]*Key`, modifiers joined by `-`, case-insensitive:
 *  - `Mod`: Cmd (Meta) on macOS, Ctrl elsewhere. Use it for the "main" shortcut modifier.
 *  - `Ctrl` / `Control`, `Alt` / `Option`, `Shift`, `Meta` / `Cmd` / `Command`: the explicit keys.
 *  - `Key`: a `KeyboardEvent.key` name (`Enter`, `Backspace`, `ArrowUp`, `F2`…, aliases `Esc`, `Return`, `Del`, `Space`,
 *    `Up`/`Down`/`Left`/`Right`), or one printable character (`k`, `/`, `-`, `?`).
 *
 * ## Canonical form
 * `Ctrl-Alt-Shift-Meta-<key>` (fixed modifier order, `Mod` already resolved for the platform), e.g. `Ctrl-Shift-Enter`.
 * Normalization rules (applied identically to chord strings and keyboard events):
 *  - **Letters** are lower-cased: the key is the letter, Shift is a separate modifier (`Mod-Shift-x` -> `Ctrl-Shift-x`).
 *    Caps Lock therefore never changes a match.
 *  - **Other printable characters** (digits, symbols) are matched by the character the keystroke PRODUCES (`event.key`), and
 *    Shift is NOT part of the chord (it is already in the character: Shift+1 is `!` on a US layout). A chord string with
 *    `Shift` on such a key (`Mod-Shift-1`) is invalid: write the character (`Mod-!`).
 *  - **Named keys** (`Enter`, `Tab`, `ArrowUp`, `F2`…) keep Shift, which is a real modifier for them.
 *  - **Non-Latin layouts / dead keys**: when `event.key` is not an ASCII character (a Cyrillic letter, the `∫` produced by
 *    Option+B on macOS, `Dead`), `event.code` is used instead (`KeyB` -> `b`, `Digit1` -> `1`), so `Mod-b` works on any layout.
 *  - Pure modifier presses (`Shift`, `Control`, `Alt`, `Meta`) and AltGraph keystrokes (they type a character) have no chord.
 *
 * @typedef {'mac' | 'other'} Platform
 * The platform whose conventions `Mod` and the displayed shortcuts follow: `'mac'` (Cmd) or `'other'` (Ctrl).
 * @typedef {{ key: string, ctrl: boolean, alt: boolean, shift: boolean, meta: boolean }} Chord
 * A parsed key chord: a key and its four modifiers (`Mod` is resolved to `ctrl` or `meta` for the platform).
 */

/**
 * Detect the platform whose conventions `Mod` and the displayed shortcuts follow: Cmd on macOS and iOS, Ctrl everywhere else.
 * @returns {Platform} `'mac'` on macOS / iOS (Cmd is the main modifier), `'other'` everywhere else (and server-side). */
export function detectPlatform() {
    if (typeof navigator === 'undefined') return 'other';
    const nav = /** @type {any} */ (navigator);
    const id = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
    return /mac|iphone|ipad|ipod/i.test(id) ? 'mac' : 'other';
}

/** Named keys a chord may use (the `KeyboardEvent.key` values), lower-cased -> canonical. */
const NAMED_KEYS = new Map([
    'Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'ContextMenu',
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
].map((name) => [name.toLowerCase(), name]));

/** Accepted spellings -> canonical name. */
const KEY_ALIASES = new Map([
    ['esc', 'Escape'], ['return', 'Enter'], ['del', 'Delete'], ['space', ' '], ['spacebar', ' '],
    ['up', 'ArrowUp'], ['down', 'ArrowDown'], ['left', 'ArrowLeft'], ['right', 'ArrowRight'],
    ['pgup', 'PageUp'], ['pgdn', 'PageDown'],
]);

const MODIFIER_NAMES = new Map([
    ['mod', 'mod'], ['ctrl', 'ctrl'], ['control', 'ctrl'], ['alt', 'alt'], ['option', 'alt'], ['opt', 'alt'],
    ['shift', 'shift'], ['meta', 'meta'], ['cmd', 'meta'], ['command', 'meta'],
]);

/** @param {string} key a single character @returns {boolean} */
const isLetter = (key) => key.length === 1 && key.toLowerCase() !== key.toUpperCase();

/**
 * Parse a chord string. Returns `null` for anything invalid: empty, unknown key name, unknown/duplicated modifier, or
 * `Shift` on a digit/symbol (see the module doc).
 * @param {string} text
 * @param {{ platform?: Platform }} [options]
 * @returns {Chord | null}
 */
export function parseChord(text, { platform = detectPlatform() } = {}) {
    if (typeof text !== 'string' || !text.trim()) return null;
    let rest = text.trim();
    /** @type {Set<string>} */
    const mods = new Set();
    // Modifiers are read greedily from the left, so a trailing "-" (the minus key) stays a key: "Mod--".
    for (;;) {
        const m = /^([A-Za-z]+)-(?=.)/.exec(rest);
        if (!m) break;
        const mod = MODIFIER_NAMES.get(m[1].toLowerCase());
        if (!mod) return null;
        const resolved = mod === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : mod;
        if (mods.has(resolved)) return null; // "Ctrl-Mod-…" on a non-mac platform, "Shift-Shift-…"
        mods.add(resolved);
        rest = rest.slice(m[0].length);
    }
    /** @type {string} */
    let key;
    if (rest.length === 1) {
        key = isLetter(rest) ? rest.toLowerCase() : rest;
    } else {
        const lower = rest.toLowerCase();
        const named = NAMED_KEYS.get(lower) ?? KEY_ALIASES.get(lower);
        if (!named) return null;
        key = named;
    }
    const shift = mods.has('shift');
    if (shift && key.length === 1 && !isLetter(key) && key !== ' ') return null;
    return { key, ctrl: mods.has('ctrl'), alt: mods.has('alt'), shift, meta: mods.has('meta') };
}

/**
 * The canonical string of a chord: `Ctrl-Alt-Shift-Meta-<key>`.
 * @param {Chord} chord
 * @returns {string}
 */
export function chordId(chord) {
    return (chord.ctrl ? 'Ctrl-' : '') + (chord.alt ? 'Alt-' : '') + (chord.shift ? 'Shift-' : '') + (chord.meta ? 'Meta-' : '') + chord.key;
}

/**
 * Parse then canonicalize a chord string.
 * @param {string} text
 * @param {{ platform?: Platform }} [options]
 * @returns {string | null} null when invalid
 */
export function canonicalChord(text, options) {
    const chord = parseChord(text, options);
    return chord ? chordId(chord) : null;
}

/**
 * Normalize a keyboard event to a chord, with the rules of the module doc.
 * @param {Pick<KeyboardEvent, 'key'> & Partial<KeyboardEvent>} event
 * @returns {Chord | null} null for a pure modifier press, an AltGraph keystroke, or an event with no usable key
 */
export function eventChord(event) {
    let key = event?.key;
    if (typeof key !== 'string' || !key) return null;
    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'AltGraph' || key === 'OS') return null;
    if (event.getModifierState?.('AltGraph')) return null; // AltGr+x TYPES a character: never a shortcut
    // Non-ASCII character or dead key: fall back on the physical key (Latin letter / digit) so shortcuts survive any layout.
    if ((key === 'Dead' || (key.length === 1 && key.charCodeAt(0) > 127) || key === 'Unidentified') && typeof event.code === 'string') {
        const letter = /^Key([A-Z])$/.exec(event.code);
        const digit = /^Digit([0-9])$/.exec(event.code);
        if (letter) key = letter[1].toLowerCase();
        else if (digit) key = digit[1];
        else if (key === 'Dead' || key === 'Unidentified') return null;
    } else if (key === 'Dead' || key === 'Unidentified') {
        return null;
    }
    if (key.length === 1) {
        if (isLetter(key)) key = key.toLowerCase();
    } else {
        const lower = key.toLowerCase();
        key = NAMED_KEYS.get(lower) ?? KEY_ALIASES.get(lower) ?? key;
    }
    const printableSymbol = key.length === 1 && !isLetter(key) && key !== ' ';
    return {
        key,
        ctrl: !!event.ctrlKey,
        alt: !!event.altKey,
        shift: !!event.shiftKey && !printableSymbol,
        meta: !!event.metaKey,
    };
}

/**
 * The canonical string of a keyboard event (see {@link eventChord}), or `null`.
 * @param {Pick<KeyboardEvent, 'key'> & Partial<KeyboardEvent>} event
 * @returns {string | null}
 */
export function eventChordId(event) {
    const chord = eventChord(event);
    return chord ? chordId(chord) : null;
}

/**
 * Whether the chord carries a modifier that makes it a shortcut rather than typing: Ctrl, Alt or Meta. `Shift` alone does
 * not (Shift+letter is a capital letter).
 * @param {Chord} chord
 * @returns {boolean}
 */
export function hasCommandModifier(chord) {
    return chord.ctrl || chord.alt || chord.meta;
}

const MAC_KEYS = /** @type {Record<string, string>} */ ({
    Enter: '↩', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Escape: '⎋', ' ': 'Space',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘',
});
const OTHER_KEYS = /** @type {Record<string, string>} */ ({
    Escape: 'Esc', ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
});

/**
 * Format a chord for display, per platform. macOS: `⌃⌥⇧⌘` + key, no separator (`⌘⇧Z`, `⌘↩`). Elsewhere: `Ctrl+Alt+Shift+Meta+Key`
 * (`Ctrl+Shift+Z`, `Ctrl+Enter`).
 * @param {string | Chord} chord a chord string (parsed with `platform`) or a parsed chord
 * @param {{ platform?: Platform }} [options]
 * @returns {string} '' for an invalid chord string
 */
export function formatChord(chord, { platform = detectPlatform() } = {}) {
    const parsed = typeof chord === 'string' ? parseChord(chord, { platform }) : chord;
    if (!parsed) return '';
    if (platform === 'mac') {
        const key = MAC_KEYS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
        return (parsed.ctrl ? '⌃' : '') + (parsed.alt ? '⌥' : '') + (parsed.shift ? '⇧' : '') + (parsed.meta ? '⌘' : '') + key;
    }
    const key = OTHER_KEYS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
    return [parsed.ctrl && 'Ctrl', parsed.alt && 'Alt', parsed.shift && 'Shift', parsed.meta && 'Meta', key].filter(Boolean).join('+');
}

/**
 * Chords the browser or the OS keeps for itself (tabs, windows, quit, reload, address bar, devtools, zoom, tab switching):
 * a page often cannot intercept them, and stealing them would be hostile anyway. Commands cannot bind them (refused at
 * registration with a warning). Written with `Mod`, resolved per platform by {@link reservedChords}.
 */
export const RESERVED_CHORDS = [
    'Mod-w', 'Mod-t', 'Mod-n', 'Mod-q', 'Mod-Shift-w', 'Mod-Shift-t', 'Mod-Shift-n', // window / tab / quit
    'Mod-Tab', 'Mod-Shift-Tab', 'Ctrl-Tab', 'Ctrl-Shift-Tab', 'Alt-Tab', 'Alt-F4', // switching, closing
    'Mod-PageUp', 'Mod-PageDown', // tab switching
    ...Array.from({ length: 9 }, (_, i) => `Mod-${i + 1}`), // jump to tab N
    'F5', 'Mod-F5', 'Mod-r', 'Mod-Shift-r', // reload
    'Mod-l', 'F6', 'Mod-d', 'Mod-h', // address bar, bookmark, history
    'Mod-0', 'Mod-=', 'Mod-+', 'Mod--', // zoom
    'F11', 'F12', 'Mod-Shift-i', 'Mod-Shift-j', 'Mod-Alt-i', // fullscreen, devtools
];

/** @type {Map<Platform, Set<string>>} */
const reservedCache = new Map();

/**
 * The canonical ids of {@link RESERVED_CHORDS} on a platform.
 * @param {Platform} platform
 * @returns {Set<string>}
 */
export function reservedChords(platform) {
    let set = reservedCache.get(platform);
    if (!set) {
        set = new Set();
        for (const text of RESERVED_CHORDS) {
            const id = canonicalChord(text, { platform });
            if (id) set.add(id);
        }
        reservedCache.set(platform, set);
    }
    return set;
}

/**
 * Whether a chord is reserved by the browser or the OS (close tab, reload, quit...) and so refused when a command declares it.
 * @param {Chord} chord
 * @param {Platform} platform
 * @returns {boolean} whether the browser / OS owns this chord
 */
export function isReservedChord(chord, platform) {
    return reservedChords(platform).has(chordId(chord));
}
