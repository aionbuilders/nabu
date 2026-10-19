import { Files } from "../../files/files.svelte.js";

/**
 * Insert a media block of `type` from a local File: optimistic preview → persist → ref.
 * @param {import('../nabu.svelte.js').Nabu} nabu @param {string} type @param {File} file
 */
export async function insertMediaFromFile(nabu, type, file) {
    const BlockClass = /** @type {any} */ (nabu.registry.get(type));
    if (!BlockClass) return;
    const anchor = nabu.selection.anchorBlock;
    const parentId = anchor?.node.parent()?.id.toString() ?? null;
    const idx = (anchor?.node.index() ?? -1) + 1;
    const block = BlockClass.create(nabu, type, { status: 'pending', name: file.name }, parentId, idx >= 0 ? idx : null);
    block.previewUrl = URL.createObjectURL(file);
    await nabu.commit();
    const id = block.id;
    try {
        const ref = await Files.get(nabu).persist(file);
        const fresh = nabu.blocks.get(id);
        if (fresh) { const d = /** @type {any} */ (fresh.node.data); d.set('ref', ref); d.set('status', 'ready'); /** @type {any} */ (fresh).previewUrl = null; await nabu.commit(); }
    } catch {
        const fresh = nabu.blocks.get(id);
        if (fresh) { /** @type {any} */ (fresh.node.data).set('status', 'error'); await nabu.commit(); }
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
