import { Extension, CLIPBOARD_FORMAT_VERSION } from '../utils/extensions.js';

/**
 * The version of a fragment: the `version` field (a number, or its string form "1"); a fragment without one is
 * a version-1 fragment (the format shipped without it). NaN for anything else.
 * @param {any} fragment
 * @returns {number}
 */
const versionOf = (fragment) => {
    const v = fragment?.version;
    if (v === undefined || v === null) return 1;
    return typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
};

/**
 * Paste of `application/x-nabu+json`, the format Nabu writes on copy and cut: copying between Nabu editors keeps the block structure, marks and files.
 */
export const NabuPasteExtension = new Extension('nabu-paste', {
    pasteInterpreters: [
        {
            format: 'application/x-nabu+json',
            priority: 100,
            /**
             * Accepts format version 1 (written as `version: 1`, or without `version`). A fragment from a NEWER
             * format is not mis-parsed: the interpreter declines (`null` + `nabu.warn`), and the paste falls back
             * to the next interpreter (`text/html`, then `text/plain`) of the same clipboard.
             * @param {string} raw
             * @param {import('../blocks/nabu.svelte.js').Nabu} [nabu]
             */
            interpret(raw, nabu) {
                try {
                    const fragment = JSON.parse(raw);
                    if (!fragment?.blocks?.length) return null;
                    const version = versionOf(fragment);
                    if (version !== CLIPBOARD_FORMAT_VERSION) {
                        nabu?.warn(`paste: unsupported application/x-nabu+json version "${fragment.version}" (this editor reads version ${CLIPBOARD_FORMAT_VERSION}): falling back to the next format`);
                        return null;
                    }
                    return fragment;
                } catch {
                    return null;
                }
            }
        }
    ]
});
