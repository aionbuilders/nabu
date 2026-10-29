import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { CodeBlock, LANGUAGE_CHARS } from "./code.svelte.js";
import CodeComponent from "./Code.svelte";

/**
 * @import { Nabu, Block } from "..";
 */

/**
 * onBeforeInput hook for CodeBlock:
 * - Inside a code block: Backspace on empty → transform back to paragraph; Backspace at offset 0 of a
 *   non-empty one → paragraph too (same text, language dropped, caret stays at 0).
 * - Inside a non-code text block: ``` + Enter or ``` + Space (with an optional language) → transform to code block.
 *
 * @param {Nabu} nabu @param {InputEvent} event @param {Block} block
 */
const onBeforeInput = (nabu, event, block) => {
    const { BREAK, CONTINUE } = nabu;

    const behavior = block.behaviors.get('text');
    if (!(behavior instanceof TextBehavior)) return CONTINUE;
    const sel = behavior.selection;
    if (!sel || !sel.isCollapsed) return CONTINUE;

    if (block instanceof CodeBlock) {
        // Backspace at position 0 in an empty code block → back to paragraph
        if (event.inputType === 'deleteContentBackward' && sel.from === 0 && behavior.text.length === 0) {
            const blockId = block.node.id.toString();
            block.transformTo('paragraph');
            tick().then(() => {
                const fresh = nabu.blocks.get(blockId);
                if (fresh) fresh.focus({ start: 0, end: 0 });
            });
            return BREAK;
        }
        // Backspace at position 0 in a NON-empty code block (collapsed caret) → it becomes a paragraph with the
        // same text (the language is dropped), caret stays at 0. A second Backspace then merges normally.
        if (event.inputType === 'deleteContentBackward' && sel.from === 0 && behavior.text.length > 0) {
            const blockId = block.node.id.toString();
            /** @type {any} */ (block.node.data).delete('language');
            block.transformTo('paragraph');
            tick().then(() => {
                const fresh = nabu.blocks.get(blockId);
                if (fresh) fresh.focus({ start: 0, end: 0 });
            });
            return BREAK;
        }
        return CONTINUE;
    }

    // ``` + Enter, or ``` + Space like every other markdown shortcut (`#`, `>`, `-`), in a non-code text block → transform to code.
    // Space only counts with the caret at the end of the fence (it would otherwise be a space typed inside the text).
    const enter = event.inputType === 'insertParagraph';
    const space = event.inputType === 'insertText' && event.data === ' ';
    if (enter || space) {
        const m = behavior.text.match(new RegExp('^```(' + LANGUAGE_CHARS + '*)$'));
        if (!m) return CONTINUE;
        if (space && sel.from !== behavior.text.length) return CONTINUE;
        const language = m[1] || null;
        const blockId = block.node.id.toString();
        const toCode = () => block.transformTo('code', language ? { language } : {});
        if (enter) {
            behavior.delete({ index: 0, length: behavior.text.length });
            toCode();
        } else {
            // Undo gives back "``` " (trigger space included): see Nabu.shortcut()
            nabu.shortcut(block, ' ', (b) => {
                b.delete({ index: 0, length: b.text.length });
                toCode();
            });
        }
        tick().then(() => {
            const fresh = nabu.blocks.get(blockId);
            if (fresh) fresh.focus({ start: 0, end: 0 });
        });
        return BREAK;
    }

    return CONTINUE;
};

/**
 * The code block: plain monospace text with a language, the ``` shortcut, the `code:block` action and the "Code" slash entry.
 */
export const CodeExtension = extension("code", {
    // @ts-ignore — static-side variance on create() (same pattern as Paragraph/Heading)
    block: CodeBlock,
    component: CodeComponent,
    slashCommands: [
        { title: 'Code', icon: '<>', aliases: ['code', 'snippet'], group: 'blocks', order: 0, run: (e) => e.exec('code:block') },
    ],
    actions: {
        // `code` alone is the inline mark of RichTextExtension (like `bold`, `italic`...): the block is `code:block`.
        'code:block': (nabu) => nabu.exec('block:transform', { type: 'code' }),
    },
    hooks: {
        onBeforeInput,
    }
});
