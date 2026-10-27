<script>
    import Block from "./Block.svelte";
    import { chunkBlocks, supportsChunking, CHUNK_ON, CHUNK_OFF } from "./chunks.js";

    /**
     * A list of sibling blocks: the root of the editor, the body of a region. Short lists are rendered as they are, one block
     * after the other, with no markup of their own. A long one (`CHUNK_ON` blocks and more) is rendered in chunks of ~64 blocks, each
     * in a wrapper that the browser may skip while it is off screen (`content-visibility: auto`), which is what keeps a keystroke
     * in a 10,000-block document within a frame (see chunks.js for the why and the how).
     * @type {{ blocks: import('./block.svelte.js').Block[] }}
     */
    let { blocks } = $props();

    // Hysteresis: switches on at CHUNK_ON blocks, off under CHUNK_OFF. (Plain variable on purpose: it is only read back by this derived.)
    let was = false;
    const chunked = $derived.by(() => {
        was = blocks.length >= (was ? CHUNK_OFF : CHUNK_ON);
        return was && supportsChunking();
    });

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

    @media print {
        .nabu-chunk { content-visibility: visible; }
    }
</style>
