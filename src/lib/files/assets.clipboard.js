/**
 * Pure helpers for moving `nabu-asset:` media through the clipboard (P-51): walking the PasteBlocks that reference
 * an asset, content hashing (ADR 014) and base64 for the bytes carried in `application/x-nabu+json`. No document
 * access here — `Files` (files.svelte.js) does that.
 */

/** Scheme of the refs that point to a file held by the asset store: `nabu-asset:sha256-<hex>` (ADR 014), or `nabu-asset:<uuid>` (beta). */
export const ASSET_PREFIX = 'nabu-asset:';
/** An asset id that is a content hash (what follows `nabu-asset:`). Anything else after the scheme is a legacy beta uuid. */
export const HASH_ID_RE = /^sha256-[0-9a-f]{64}$/;
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
 * Whether `id` (the part after `nabu-asset:`) is a content hash.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isHashId(id) {
    return typeof id === 'string' && HASH_ID_RE.test(id);
}

/**
 * SHA-256 of `bytes` as an asset id: `sha256-<64 hex>` (ADR 014 §3.1).
 * @param {BufferSource} bytes
 * @returns {Promise<string>}
 */
export async function sha256Id(bytes) {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    return 'sha256-' + hex;
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
 * Walk PasteBlocks (children included) and call `fn(block, url)` for every block whose `props.ref` is an absolute
 * `http(s)` URL (a remote file). `fn` returns a props PATCH or nothing. Same contract as {@link mapAssetBlocks}.
 * @template {{ props?: Record<string, any>, children?: any[] }} B
 * @param {B[]} blocks
 * @param {(block: B, url: string) => Record<string, any> | null | undefined | void} fn
 * @returns {B[]}
 */
export function mapRemoteBlocks(blocks, fn) {
    if (!Array.isArray(blocks)) return blocks;
    let changed = false;
    const out = blocks.map((pb) => {
        if (!pb || typeof pb !== 'object') return pb;
        let next = pb;
        const ref = pb.props?.ref;
        if (typeof ref === 'string' && /^https?:\/\//i.test(ref.trim())) {
            const patch = fn(pb, ref.trim());
            if (patch) next = { ...next, props: { ...pb.props, ...patch } };
        }
        if (Array.isArray(pb.children) && pb.children.length) {
            const children = mapRemoteBlocks(pb.children, fn);
            if (children !== pb.children) next = { ...next, children };
        }
        if (next !== pb) changed = true;
        return next;
    });
    return changed ? out : blocks;
}

/**
 * A file name for a remote URL: the last segment of its path, or `file` + the extension of its type.
 * @param {string} url
 * @param {string} [mime]
 * @returns {string}
 */
export function remoteFileName(url, mime = '') {
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''); } catch { /* keep '' */ }
    if (name) return name;
    const ext = /^[a-z]+\/([a-z0-9.+-]+)/i.exec(mime)?.[1]?.replace('svg+xml', 'svg').replace('jpeg', 'jpg');
    return ext ? 'file.' + ext : 'file';
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
