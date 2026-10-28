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

/**
 * Word deletion (`deleteWordBackward` / `deleteWordForward`: Ctrl+Backspace / Ctrl+Delete, Option+Backspace / Option+Delete).
 *
 * The text is cut into tokens: a word (`Intl.Segmenter` word granularity, so CJK and accented words are cut as the reader would),
 * a run of punctuation (`...`, `?!`), a run of horizontal whitespace, a line break (`\n`), or any other single
 * segment (an emoji, a symbol). The rules follow what Chromium does in a native `contenteditable` / `<textarea>`:
 *
 * - Backward (same on macOS and Windows): the whitespace before the caret goes with the token before it, and the caret lands at
 *   the start of that token: `"this is a sentence |"` -> `"this is a |"`, `"hello world|"` -> `"hello |"`, `"word, |"` -> `"word|"`,
 *   `"end.|"` -> `"end|"`. Only whitespace before the caret: all of it, and the token before it.
 * - Forward on macOS (and Linux): up to the END of the next token, whitespace in between included: `"hello| world"` -> `"hello|"`,
 *   `"one |two three"` -> `"one | three"`.
 * - Forward on Windows: the next token and the whitespace after it, up to the START of the following one (Chromium's
 *   `ShouldSkipSpaceWhenMovingRight`): `"one |two three"` -> `"one |three"`. At whitespace, that whitespace only.
 * - A caret inside a token deletes to the token's edge (`"th|ree"` backward -> `"|ree"`). A line break is deleted by itself, and
 *   whitespace never reaches across one. Nothing at the start (backward) or the end (forward) of the text.
 *
 * @param {string} text
 * @param {number} caret offset in `text`
 * @param {'backward' | 'forward'} direction
 * @param {{ platform?: 'mac' | 'other', lang?: string }} [options] `platform`: `'mac'` for the macOS forward rule, anything else is Windows / Linux-as-Windows
 * @returns {{ from: number, to: number }} the span to delete (empty when there is nothing to delete)
 */
export function wordDeleteRange(text, caret, direction, { platform = 'other', lang } = {}) {
    const empty = { from: caret, to: caret };
    if (direction === 'backward' ? caret <= 0 : caret >= text.length) return empty;
    const tokens = wordTokens(text, lang);
    const i = tokens.findIndex((t) => direction === 'backward' ? t.start < caret && caret <= t.end : t.start <= caret && caret < t.end);
    if (i === -1) return empty;
    const token = tokens[i];
    if (direction === 'backward') {
        let from = token.start;
        if (token.kind === 'space' && i > 0 && tokens[i - 1].kind !== 'break') from = tokens[i - 1].start;
        return { from, to: caret };
    }
    let to = token.end;
    const next = tokens[i + 1];
    if (next && next.kind !== 'break') {
        // macOS: whitespace then the word after it; Windows: the word then the whitespace after it.
        if (platform === 'mac' ? token.kind === 'space' : token.kind !== 'space' && token.kind !== 'break' && next.kind === 'space') to = next.end;
    }
    return { from: caret, to };
}

/** @typedef {{ start: number, end: number, kind: 'word' | 'punct' | 'space' | 'break' | 'other' }} WordToken */

const PUNCT = /^\p{P}+$/u;
const WORDISH = /^[\p{L}\p{N}\p{M}_]+$/u;

/**
 * @param {string} text @param {string | undefined} lang
 * @returns {WordToken[]}
 */
function wordTokens(text, lang) {
    /** @type {WordToken[]} */
    const tokens = [];
    /** @param {number} start @param {string} piece @param {boolean | undefined} wordLike */
    const push = (start, piece, wordLike) => {
        /** @type {WordToken['kind']} */
        let kind;
        if (piece === '\n') kind = 'break';
        else if (/^[^\S\n]+$/.test(piece)) kind = 'space';
        else if (wordLike ?? WORDISH.test(piece)) kind = 'word';
        else if (PUNCT.test(piece)) kind = 'punct';
        else kind = 'other';
        const last = tokens[tokens.length - 1];
        // Runs of punctuation (`...`, `?!`) and of whitespace are one token; words are not merged (the segmenter decided).
        if (last && last.end === start && last.kind === kind && (kind === 'punct' || kind === 'space')) last.end = start + piece.length;
        else tokens.push({ start, end: start + piece.length, kind });
    };
    const segmenter = segmenterFor(lang);
    if (segmenter) {
        for (const part of segmenter.segment(text)) {
            // UAX #29 keeps `foo.bar` whole (a dot between letters); an editor stops at the dot, as Chromium does.
            if (part.isWordLike && part.segment.includes('.')) {
                let at = part.index;
                for (const piece of part.segment.split(/(?<=\p{L})(\.)(?=\p{L})/u)) { push(at, piece, piece !== '.'); at += piece.length; }
            } else push(part.index, part.segment, part.isWordLike);
        }
    } else {
        for (const m of text.matchAll(/[\p{L}\p{N}\p{M}_]+|\p{P}+|[^\S\n]+|\n|[\s\S]/gu)) push(m.index, m[0], undefined);
    }
    return tokens;
}
