import { Extension } from '../../utils/extensions.js';
import { TextBehavior } from './text.behavior.svelte.js';

/**
 * Smart typography input rules.
 * Currently: `-- ` → `— ` (em-dash substitution while typing).
 */
export const TypographyExtension = new Extension('typography', {
    inputRules: [
        {
            pattern: /--$/,
            handler(nabu, block, match, sel) {
                // Only convert when the trailing space is typed, so sequences
                // like `--help` keep their double dash.
                if (sel.data !== ' ') return;
                const behavior = block.behaviors.get('text');
                if (!(behavior instanceof TextBehavior)) return;
                behavior.delete({ index: sel.from - 2, length: 2 });
                behavior.insert(sel.from - 2, '— ');
                return true;
            }
        }
    ]
});
