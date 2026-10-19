/**
 * Pure helpers for moving `nabu-asset:` media through the clipboard (P-51): walking the PasteBlocks that reference
 * an asset, and base64 for the bytes carried in `application/x-nabu+json`. No document access here — `Files`
 * (files.svelte.js) does that.
 */

/** Scheme of the refs that point into the document's own `assets` map. */
export const ASSET_PREFIX = 'nabu-asset:';
/** Scheme of a ref whose bytes are being re-created in this document (local, transient — see Files#adopt). */
export const PENDING_PREFIX = 'nabu-pending:';

/**
 * Asset id of a `nabu-asset:` ref, or `null` for any other value.
 * @param {unknown} ref
 * @returns {string | null}
 */
export function assetIdOf(ref) {
    return typeof ref === 'string' && ref.startsWith(ASSET_PREFIX) && ref.length > ASSET_PREFIX.length ? ref.slice(ASSET_PREFIX.length) : null;
}

/**
 * Walk PasteBlocks (children included) and call `fn(block, assetId)` for every block whose `props.ref` is a
 * `nabu-asset:` ref. `fn` returns a props PATCH (merged into a COPY of the block) or nothing. Never mutates the input;
 * returns the same array when nothing changed.
 * @template {{ props?: Record<string, any>, children?: any[] }} B
 * @param {B[]} blocks
 * @param {(block: B, id: string) => Record<string, any> | null | undefined | void} fn
 * @returns {B[]}
 */
export function mapAssetBlocks(blocks, fn) {
    if (!Array.isArray(blocks)) return blocks;
    let changed = false;
    const out = blocks.map((pb) => {
        if (!pb || typeof pb !== 'object') return pb;
        let next = pb;
        const id = assetIdOf(pb.props?.ref);
        if (id !== null) {
            const patch = fn(pb, id);
            if (patch) next = { ...next, props: { ...pb.props, ...patch } };
        }
        if (Array.isArray(pb.children) && pb.children.length) {
            const children = mapAssetBlocks(pb.children, fn);
            if (children !== pb.children) next = { ...next, children };
        }
        if (next !== pb) changed = true;
        return next;
    });
    return changed ? out : blocks;
}

/**
 * Ids of the assets referenced by PasteBlocks (children included), in order of appearance, deduplicated.
 * @param {any[]} blocks
 * @returns {string[]}
 */
export function collectAssetIds(blocks) {
    /** @type {Set<string>} */
    const ids = new Set();
    mapAssetBlocks(blocks, (_pb, id) => { ids.add(id); });
    return [...ids];
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

/**
 * @param {string} b64
 * @returns {Uint8Array | null} `null` when the string is not valid base64
 */
export function base64ToBytes(b64) {
    try {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}
