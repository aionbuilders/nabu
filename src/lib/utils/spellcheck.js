/**
 * Editor options `spellcheck` / `lang` (see NabuInit).
 */

/** Loose BCP 47 shape: primary language (2-3 letters) then subtags (e.g. `fr`, `en-GB`, `zh-Hant-TW`, `es-419`). */
const LANG_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/**
 * Normalizes the `lang` option. `undefined` / `null` / `''` mean "unset" (valid, no attribute).
 * @param {unknown} value
 * @returns {{ lang: string | undefined, valid: boolean }}
 */
export function normalizeLang(value) {
    if (value === undefined || value === null || value === '') return { lang: undefined, valid: true };
    if (typeof value === 'string' && LANG_PATTERN.test(value)) return { lang: value, valid: true };
    return { lang: undefined, valid: false };
}
