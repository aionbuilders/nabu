import { Extension } from '../utils/extensions.js';

export const NabuPasteExtension = new Extension('nabu-paste', {
    pasteInterpreters: [
        {
            format: 'application/x-nabu+json',
            priority: 100,
            /** @param {string} raw */
            interpret(raw) {
                try {
                    const fragment = JSON.parse(raw);
                    if (!fragment?.blocks?.length) return null;
                    return fragment;
                } catch {
                    return null;
                }
            }
        }
    ]
});
