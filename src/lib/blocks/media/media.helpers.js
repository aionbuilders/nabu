import { Files, FileRejectedError } from "../../files/files.svelte.js";
import { reasonOf } from "../../files/status.js";

/**
 * Insert a media block of `type` from a local File. The block appears at once (`pending`, with a local preview), the bytes
 * are hashed and written to the local store (ADR 014), then the block gets its `nabu-asset:sha256-…` ref: `ready`, or — with a
 * host (`files.onBeforePersist`) — still `pending` while the background upload runs (`block.progress`, `block.retry()`,
 * `block.cancel()`); the ref never changes afterwards. A file over `files.maxFileSize` is refused: the block is created
 * `rejected`, with no ref and a readable `reason`.
 * @param {import('../nabu.svelte.js').Nabu} nabu @param {string} type @param {File} file
 */
export async function insertMediaFromFile(nabu, type, file) {
    const BlockClass = /** @type {any} */ (nabu.registry.get(type));
    if (!BlockClass) return;
    const files = Files.get(nabu);
    const anchor = nabu.selection.anchorBlock;
    const parentId = anchor?.node.parent()?.id.toString() ?? null;
    const idx = (anchor?.node.index() ?? -1) + 1;
    const rejection = files.checkSize(file.size);
    if (rejection) {
        nabu.warn(`file "${file.name}" refused: ${rejection.message}`);
        BlockClass.create(nabu, type, { status: 'rejected', name: file.name, reason: rejection }, parentId, idx >= 0 ? idx : null);
        await nabu.commit();
        return;
    }
    const block = BlockClass.create(nabu, type, { status: 'pending', name: file.name }, parentId, idx >= 0 ? idx : null);
    block.previewUrl = URL.createObjectURL(file);
    await nabu.commit();
    const id = block.id;
    try {
        // lot 3: drag and drop calls this same path.
        const { id: hash, ref } = await files.ingest(file);
        const fresh = nabu.blocks.get(id);
        if (fresh) {
            const d = /** @type {any} */ (fresh.node.data);
            d.set('ref', ref);
            d.set('status', files.initialStatus(hash)); // with a host: stays pending, the upload queue takes over
            await nabu.commit();
        }
    } catch (error) {
        const fresh = nabu.blocks.get(id);
        if (fresh) {
            const d = /** @type {any} */ (fresh.node.data);
            if (error instanceof FileRejectedError) { d.set('status', 'rejected'); d.set('reason', error.reason); } else { d.set('status', 'error'); d.set('reason', reasonOf('upload-failed')); }
            await nabu.commit();
        }
    }
}

/**
 * Open a file picker (accept filter) and insert the chosen media as `type`.
 * @param {import('../nabu.svelte.js').Nabu} nabu @param {string} type @param {string} accept
 */
export function pickMedia(nabu, type, accept) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => { const f = input.files?.[0]; if (f) insertMediaFromFile(nabu, type, f); };
    input.click();
}

/**
 * Insert a media block of `type` from an external URL ref.
 * @param {import('../nabu.svelte.js').Nabu} nabu @param {string} type @param {{ref:string, alt?:string, name?:string}} data
 */
export function insertMediaUrl(nabu, type, data) {
    if (!data?.ref) return;
    const BlockClass = /** @type {any} */ (nabu.registry.get(type));
    if (!BlockClass) return;
    const anchor = nabu.selection.anchorBlock;
    const parentId = anchor?.node.parent()?.id.toString() ?? null;
    const idx = (anchor?.node.index() ?? -1) + 1;
    BlockClass.create(nabu, type, { ref: data.ref, alt: data.alt || '', name: data.name || '', status: 'ready' }, parentId, idx >= 0 ? idx : null);
    return nabu.commit();
}

/**
 * The paste-file handler of a media block (`Extension.pasteFileHandlers`): a pasted file the block recognises becomes a
 * block of `type` named after the file; the engine stores the bytes and sets the `ref`.
 * @param {string} type  block type
 * @param {(file: File) => boolean} accepts
 * @param {number} [priority]  higher is asked first: the specific kinds (image, video) before the catch-all file
 * @returns {import('../../utils/extensions.js').PasteFileHandler}
 */
export const mediaFileHandler = (type, accepts, priority = 0) => ({
    priority,
    accepts: (file) => accepts(file),
    block: (file) => ({ type, partial: false, props: { name: file.name || '', alt: '' } }),
});
