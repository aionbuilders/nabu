import { TextBehavior } from '../../../behaviors/text';

/**
 * @import { Nabu } from '../../nabu.svelte.js';
 * @import { Block } from '../../block.svelte.js';
 */

/** @param {Nabu} nabu @param {InputEvent} event @param {Block} block */
export const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    if (event.data !== ' ') return CONTINUE;

    const behavior = block.behaviors?.get('text');
    if (!behavior || !(behavior instanceof TextBehavior)) return CONTINUE;

    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    const textBeforeCursor = behavior.text.slice(0, sel.from);
    const match = textBeforeCursor.match(/^:::([\w-]*)$/);
    if (!match) return CONTINUE;

    const templateId = match[1] || null;

    behavior.delete({ index: 0, length: textBeforeCursor.length });
    nabu.exec('zone:wrap', { props: { template: templateId }, focusTitle: true });

    return BREAK;
};
