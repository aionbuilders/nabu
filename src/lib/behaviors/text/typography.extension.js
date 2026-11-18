import { Extension } from '../../utils/extensions.js';
import { TextBehavior } from './text.behavior.svelte.js';
import { charBeforeMatch } from '../../utils/input-rules.js';

/**
 * Smart typography input rules.
 * Currently: `-- ` → `— ` (em-dash substitution while typing). A longer run of dashes (`--- `,
 * a divider-like `-----`) is left alone: the `--` must not be preceded by another `-`.
 */
export const TypographyExtension = new Extension('typography', {
    inputRules: [
        {
            // No lookbehind (Safari < 16.4, macOS 12's WebKit): the "not preceded by `-`" check is in the handler.
            pattern: /--$/,
            handler(nabu, block, match, sel) {
                // Only convert when the trailing space is typed, so sequences
                // like `--help` keep their double dash.
                if (sel.data !== ' ') return;
                if (charBeforeMatch(match) === '-') return;
                const behavior = block.behaviors.get('text');
                if (!(behavior instanceof TextBehavior)) return;
                behavior.delete({ index: sel.from - 2, length: 2 });
                behavior.insert(sel.from - 2, '— ');
                return true;
            }
        }
    ]
});
