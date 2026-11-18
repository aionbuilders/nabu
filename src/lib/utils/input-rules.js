/**
 * Helpers for input rules (`Extension` `inputRules`).
 *
 * Nabu's patterns never use RegExp lookbehind (`(?<=…)` / `(?<!…)`): Safari before 16.4 (the WebKit of
 * macOS 12) does not parse it, and one lookbehind literal makes the whole bundle fail to load. A rule that
 * needs "not preceded by X" matches without it and checks the character before the match with this helper.
 */

/**
 * The character (a whole code point) right before a match, or `''` at the start of the text.
 * @param {RegExpMatchArray} match  a match of `String.prototype.match` (non-global), so `index` and `input` are set
 * @returns {string}
 */
export function charBeforeMatch(match) {
    const { index = 0, input = '' } = match;
    if (index <= 0) return '';
    const low = input.charCodeAt(index - 1);
    const high = index >= 2 ? input.charCodeAt(index - 2) : 0;
    const paired = low >= 0xDC00 && low <= 0xDFFF && high >= 0xD800 && high <= 0xDBFF;
    return input.slice(paired ? index - 2 : index - 1, index);
}
