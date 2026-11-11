<script>
    import Block from "./Block.svelte";
    import { chunkBlocks, supportsChunking, CHUNK_ON, CHUNK_OFF } from "./chunks.js";

    /**
     * A list of sibling blocks: the root of the editor, the body of a region. Short lists are rendered as they are, one block
     * after the other, with no markup of their own. A long one (`CHUNK_ON` blocks and more) is rendered in chunks of ~64 blocks, each
     * in a wrapper that the browser may skip while it is off screen (`content-visibility: auto`), which is what keeps a keystroke
     * in a 10,000-block document within a frame (see chunks.js for the why and the how).
     * `chunked` (bindable, read only for the parent) reports whether the list is rendered in chunks: a region body that is, leaves
     * the skipping to its chunks (Region.svelte).
     * @type {{ blocks: import('./block.svelte.js').Block[], chunked?: boolean }}
     */
    let { blocks, chunked: isChunked = $bindable(false) } = $props();

    // Hysteresis: switches on at CHUNK_ON blocks, off under CHUNK_OFF. (Plain variable on purpose: it is only read back by this derived.)
    let was = false;
    const chunked = $derived.by(() => {
        was = blocks.length >= (was ? CHUNK_OFF : CHUNK_ON);
        return was && supportsChunking();
    });

    $effect.pre(() => { isChunked = chunked; });

    // The chunks of the last render, to hand back the unchanged ones as they were.
    let memo = new Map();
    const chunks = $derived.by(() => {
        if (!chunked) return [];
        const next = chunkBlocks(blocks, memo);
        memo = new Map(next.map((c) => [c.key, c]));
        return next;
    });
</script>

<!-- No whitespace between the tags: the editor preserves whitespace, any text node here would render as a selectable line. -->
{#if chunked}{#each chunks as chunk (chunk.key)}<div class="nabu-chunk" style:--nb-chunk-blocks={chunk.blocks.length}>{#each chunk.blocks as block (block.id)}<Block {block} />{/each}</div>{/each}{:else}{#each blocks as block (block.id)}<Block {block} />{/each}{/if}

<style>
    /* Off screen, the browser skips the layout, paint and selection bookkeeping of a chunk. Its height is then an estimate (the number
       of blocks times --nb-block-estimate, which a theme may tune) until the chunk has been shown once: `auto` remembers the real one. */
    .nabu-chunk {
        content-visibility: auto;
        contain-intrinsic-block-size: auto calc(var(--nb-chunk-blocks, 64) * var(--nb-block-estimate, 72px));
        /* `content-visibility: auto` clips what hangs out of the box (paint containment): the margin rail of a region sits in the
           margin, left of its box. */
        overflow-clip-margin: var(--nb-clip-margin, 3rem);
    }

    /* Never nested (see the large documents note in region/Region.svelte: WebKit pays for it on every keystroke): a chunk inside a chunk
       (a region body of 500 blocks among the blocks of a chunk) is left visible, the outer one already skips what it holds. */
    .nabu-chunk :global(.nabu-chunk) {
        content-visibility: visible;
    }

    @media print {
        .nabu-chunk { content-visibility: visible; }
    }
</style>
