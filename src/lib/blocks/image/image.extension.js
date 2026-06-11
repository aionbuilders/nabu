import { extension } from "../../utils/extensions";
import { ImageBlock } from "./image.svelte.js";
import ImageComponent from "./Image.svelte";
import { insertMediaFromFile, pickMedia, insertMediaUrl } from "../media/media.helpers.js";

/**
 * Insert an image block from a local File: optimistic preview → persist → ref.
 * Re-exported for back-compat.
 * @param {import('../nabu.svelte.js').Nabu} nabu @param {File} file
 */
export const insertImageFromFile = (nabu, file) => insertMediaFromFile(nabu, 'image', file);

export const ImageExtension = extension("image", {
    // @ts-ignore — static-side variance on create()
    block: ImageBlock,
    component: ImageComponent,
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
