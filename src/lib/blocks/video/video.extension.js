import { extension } from "../../utils/extensions";
import { VideoBlock } from "./video.svelte.js";
import VideoComponent from "./Video.svelte";
import { pickMedia, insertMediaUrl, mediaFileHandler } from "../media/media.helpers.js";

/**
 * The video block: stored through the `files` option, with the `video:insert` and `video:pick` actions, video file paste and the "Video" slash entry.
 */
export const VideoExtension = extension("video", {
    // @ts-ignore — static-side variance on create()
    block: VideoBlock,
    component: VideoComponent,
    // A file pasted from the clipboard becomes this block.
    pasteFileHandlers: [mediaFileHandler('video', (file) => /^video\//i.test(file.type), 20)],
    slashCommands: [
        { title: 'Video', icon: '▷', aliases: ['video', 'movie', 'mp4'], group: 'media', order: 10, run: (e) => e.exec('video:pick') },
    ],
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
