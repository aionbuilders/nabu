import { extension } from "../../utils/extensions";
import { VideoBlock } from "./video.svelte.js";
import VideoComponent from "./Video.svelte";
import { pickMedia, insertMediaUrl } from "../media/media.helpers.js";

export const VideoExtension = extension("video", {
    // @ts-ignore — static-side variance on create()
    block: VideoBlock,
    component: VideoComponent,
    actions: {
        'video:pick': (nabu) => pickMedia(nabu, 'video', 'video/*'),
        /**
         * Insert from a URL (external ref). data: { ref, alt?, name? }
         * @param {import('../nabu.svelte.js').Nabu} nabu
         * @param {{ ref: string, alt?: string, name?: string }} data
         */
        'video:insert': (nabu, data) => insertMediaUrl(nabu, 'video', data),
    },
});
