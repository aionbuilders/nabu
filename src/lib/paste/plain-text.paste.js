import { Extension } from '../utils/extensions.js';

/**
 * Interprète text/plain comme du texte pur.
 * - Double saut de ligne (\n\n) → blocs séparés
 * - Saut simple (\n) → soft break dans le même bloc
 * Priorité 0 (fallback de dernier recours).
 */
export const PlainTextPasteExtension = new Extension('plain-text-paste', {
    pasteInterpreters: [
        {
            format: 'text/plain',
            priority: 0,
            /** @param {string} raw */
            interpret(raw) {
                if (!raw) return null;

                const paragraphs = raw.split(/\n\n+/).filter(Boolean);
                if (paragraphs.length === 0) return null;

                if (paragraphs.length === 1) {
                    return {
                        blocks: [{
                            type: 'paragraph',
                            partial: 'both',
                            delta: [{ insert: paragraphs[0] }]
                        }]
                    };
                }

                return {
                    blocks: paragraphs.map((text, i) => ({
                        type: 'paragraph',
                        partial: i === 0 ? 'start' : i === paragraphs.length - 1 ? 'end' : false,
                        delta: [{ insert: text }]
                    }))
                };
            }
        }
    ]
});
