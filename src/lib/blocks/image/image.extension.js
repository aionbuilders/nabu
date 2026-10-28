import { extension } from "../../utils/extensions";
import { ImageBlock } from "./image.svelte.js";
import ImageComponent from "./Image.svelte";
import { insertMediaFromFile, pickMedia, insertMediaUrl, mediaFileHandler } from "../media/media.helpers.js";

/**
 * Insert an image block from a local File: optimistic preview → persist → ref.
 * Re-exported for back-compat.
 * @param {import('../nabu.svelte.js').Nabu} nabu @param {File} file
 */
export const insertImageFromFile = (nabu, file) => insertMediaFromFile(nabu, 'image', file);

/**
 * The image block: stored through the `files` option, with the `image:insert` and `image:pick` actions, image file paste and the "Image" slash entry.
 */
export const ImageExtension = extension("image", {
    // @ts-ignore — static-side variance on create()
    block: ImageBlock,
    component: ImageComponent,
    // A file pasted from the clipboard becomes this block.
    pasteFileHandlers: [mediaFileHandler('image', (file) => /^image\//i.test(file.type), 20)],
    slashCommands: [
        { title: 'Image', icon: '▢', aliases: ['image', 'img', 'photo', 'picture'], group: 'media', order: 0, run: (e) => e.exec('image:pick') },
    ],
    actions: {
        'image:pick': (nabu) => pickMedia(nabu, 'image', 'image/*'),
        /**
         * Insert from a URL (external ref). data: { ref, alt? }
         * @param {import('../nabu.svelte.js').Nabu} nabu
         * @param {{ ref: string, alt?: string }} data
         */
        'image:insert': (nabu, data) => insertMediaUrl(nabu, 'image', data),
    },
});
