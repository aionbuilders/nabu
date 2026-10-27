/**
 * Word counting for the text of a block (`wordCount`).
 *
 * Splitting on whitespace is wrong for the languages that write words without spaces (Chinese, Japanese, Thai, Khmer...): a whole
 * sentence would count as one word. When the platform has `Intl.Segmenter` the text is segmented with `granularity: 'word'` and
 * only the segments that are `isWordLike` (letters and digits, not spaces or punctuation) are counted, with the document
 * language as locale (`nabu.lang`, a BCP 47 tag; the Chinese / Japanese dictionaries need it to cut the same way as the
 * reader would). Without `Intl.Segmenter` it falls back to the whitespace split.
 *
 * Differences from a whitespace count, by design (they follow the Unicode word-break rules, UAX #29): punctuation and quotation
 * marks standing alone (`«`, `»`, `-`, an em dash) are not words, an apostrophe inside a word keeps it whole (`l'homme`,
 * `don't`), and a hyphenated compound is several words (`well-known` is two).
 *
 * Cost: typing re-counts only the block being edited (the count is a `$derived` of its text). To keep the first count of a big
 * document cheap, a plain Latin word is counted without the segmenter (whitespace tokens that are letters and digits only are
 * one word by the same rules).
 */

/** @type {Map<string, Intl.Segmenter | null>} */
const segmenters = new Map();

/**
 * The word segmenter for a locale, `null` when the platform has none. An unusable locale falls back to the default one.
 * @param {string | undefined} lang
 * @returns {Intl.Segmenter | null}
 */
function segmenterFor(lang) {
    const key = lang ?? '';
    const known = segmenters.get(key);
    if (known !== undefined) return known;
    /** @type {Intl.Segmenter | null} */
    let segmenter = null;
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        try { segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'word' }); }
        catch { segmenter = segmenterFor(undefined); } // a locale the platform rejects
    }
    segmenters.set(key, segmenter);
    return segmenter;
}

/** One word with certainty: Latin letters (with accents) and digits only. */
const LATIN_WORD = /^[0-9A-Za-zÀ-ÖØ-öø-ɏ]+$/;

/**
 * Number of words in a text.
 * @param {string} text
 * @param {string} [lang] BCP 47 tag of the text (the editor's `lang`); unset: the platform default
 * @returns {number}
 */
export function countWords(text, lang) {
    if (!text) return 0;
    const tokens = text.split(/\s+/);
    const segmenter = segmenterFor(lang);
    if (!segmenter) return tokens.reduce((n, token) => n + (token ? 1 : 0), 0);
    let count = 0;
    for (const token of tokens) {
        if (!token) continue;
        if (LATIN_WORD.test(token)) { count++; continue; }
        for (const part of segmenter.segment(token)) if (part.isWordLike) count++;
    }
    return count;
}
