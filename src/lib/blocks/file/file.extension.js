import { extension } from "../../utils/extensions";
import { FileBlock } from "./file.svelte.js";
import FileComponent from "./File.svelte";
import { pickMedia, insertMediaUrl } from "../media/media.helpers.js";

export const FileExtension = extension("file", {
    // @ts-ignore — static-side variance on create()
    block: FileBlock,
    component: FileComponent,
    actions: {
        'file:pick': (nabu) => pickMedia(nabu, 'file', '*/*'),
        /**
         * Insert from a URL/ref. data: { ref, name? }
         * @param {import('../nabu.svelte.js').Nabu} nabu
         * @param {{ ref: string, name?: string }} data
         */
        'file:insert': (nabu, data) => insertMediaUrl(nabu, 'file', data),
    },
});
