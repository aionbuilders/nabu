/**
 * Large documents: how a long list of sibling blocks is cut into CHUNKS.
 *
 * WHY. A keystroke costs the page more than the engine does: the browser lays out, paints and syncs the selection of the WHOLE
 * contenteditable on every edit, and that work grows with the number of elements it has to look at (measured: 1 ms of script and no DOM
 * node created per key at 10,000 blocks, but ~90 ms from key to next paint, almost all of it inside Chromium). `content-visibility: auto`
 * lets the browser skip the layout, paint and selection bookkeeping of everything that is off screen, but it is only cheap on a FEW
 * large boxes: one per block costs as much as it saves. So a long list of siblings is rendered as a few hundred chunk wrappers of
 * ~64 blocks, each one `content-visibility: auto` (see BlockList.svelte).
 *
 * HOW the cuts are chosen. By CONTENT, not by position: a block starts a chunk when a hash of its id says so (one in `CHUNK_AVG`
 * on average), whatever its index. Inserting or deleting a block then moves at most the one cut that block is, so a keyed render only
 * ever touches the chunk (or the two chunks) around the edit; cutting every 64 blocks by index would shift every chunk after an Enter.
 *
 * Nothing here knows a block type: any list of blocks can be chunked.
 */

/** A list of at least this many sibling blocks is rendered in chunks... */
export const CHUNK_ON = 500;
/** ...until it shrinks under this many (hysteresis: a list hovering around the threshold does not flip its markup on every key). */
export const CHUNK_OFF = 250;
/** Average number of blocks in a chunk (a cut every `CHUNK_AVG` blocks). */
export const CHUNK_AVG = 64;
/** A document of at least this many blocks (all levels) is "large" (`data-nabu-large` on the editor root): containers may skip their off-screen bodies. */
export const LARGE_DOC = 800;

/** @type {boolean | undefined} */
let supported;
/** Whether the browser can skip off-screen boxes (`content-visibility: auto`). Without it chunking would only add wrappers, so it is not done. */
export function supportsChunking() {
    if (supported === undefined) supported = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('content-visibility', 'auto');
    return supported;
}

/** FNV-1a (32 bit) of a string. @param {string} s */
function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Whether a chunk starts at the block with this id. @param {string} id */
export function startsChunk(id) {
    return fnv1a(id) % CHUNK_AVG === 0;
}

/**
 * @typedef {Object} Chunk
 * @property {string} key  the id of its first block (stable while that block exists)
 * @property {import('./block.svelte.js').Block[]} blocks
 */

/**
 * Cut `blocks` into chunks. A chunk starts at the first block and at every block for which {@link startsChunk} is true.
 * A chunk of `previous` (a Map by key) with the same blocks in the same order is returned as is, so that a keyed render sees an
 * unchanged object and does not look at it again.
 * @param {import('./block.svelte.js').Block[]} blocks
 * @param {Map<string, Chunk>} [previous]
 * @returns {Chunk[]}
 */
export function chunkBlocks(blocks, previous) {
    /** @type {Chunk[]} */
    const out = [];
    /** @type {import('./block.svelte.js').Block[]} */
    let current = [];
    const flush = () => {
        if (!current.length) return;
        const key = current[0].id;
        const old = previous?.get(key);
        out.push(old && sameBlocks(old.blocks, current) ? old : { key, blocks: current });
        current = [];
    };
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (current.length && startsChunk(block.id)) flush();
        current.push(block);
    }
    flush();
    return out;
}

/** @param {unknown[]} a @param {unknown[]} b */
function sameBlocks(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
