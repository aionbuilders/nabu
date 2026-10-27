import { tick } from "svelte";
import { TextBehavior } from "../../behaviors/text";
import { extension } from "../../utils/extensions";
import { Heading } from "./heading.svelte.js";
import HeadingComponent from "./Heading.svelte";
import { onBeforeInput } from "./hooks/onBeforeInput.hook";

/**
 * @import { Nabu } from "../nabu.svelte.js";
 */

/** Total length of the text inserted by a Loro delta. @param {import('loro-crdt').Delta<string>[]} [delta] */
const deltaLength = (delta) => (delta || []).reduce((n, op) => n + (typeof op.insert === 'string' ? op.insert.length : 0), 0);

const HeadingExtension = extension("heading", {
    block: Heading,
    component: HeadingComponent,
    actions: {
        'heading:1': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 1 } }),
        'heading:2': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 2 } }),
        'heading:3': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 3 } }),
        'heading:4': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 4 } }),
        'heading:5': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 5 } }),
        'heading:6': (nabu) => nabu.exec('block:transform', { type: 'heading', props: { level: 6 } }),
    },
    hooks: {
        /** @param {Nabu} nabu @param {Heading} block @param {Event | null} event @param {import('../../utils/extensions.js').SplitData} data */
        onSplit: (nabu, block, event, data) => {
            const { offset, delta } = data;
            const length = block.text.length;

            const currentIndex = block.node.index() ?? 0;
            const parent = block.node.parent();
            const parentId = parent?.id.toString() || null;

            // START of a non-empty heading → an empty PARAGRAPH is inserted above; the heading keeps its text,
            // its level and the caret (at the start of its text). Only when the tail is the WHOLE text (a
            // collapsed caret): with a range selection the generic split below applies, nothing is dropped.
            if (offset === 0 && length > 0 && deltaLength(delta) === length) {
                nabu.insert("paragraph", {}, parentId, currentIndex);
                block.commit().then(() => nabu.selection.setCursor(block, 0));
                return { block };
            }

            block.delete({from: offset, to: -1});

            // END of the heading (or an EMPTY one) → a paragraph below. MIDDLE → both halves are headings of the
            // same level.
            const atEnd = offset >= length;
            const newBlock = atEnd
                ? nabu.insert("paragraph", /** @type {any} */ ({ delta }), parentId, currentIndex + 1)
                : nabu.insert("heading", /** @type {any} */ ({ delta, level: block.level }), parentId, currentIndex + 1);

            block.commit().then(() => nabu.selection.setCursor(newBlock, 0));

            return { block: newBlock };
        },
        onBeforeInput,
    }
})

export { HeadingExtension, HeadingComponent, Heading };
