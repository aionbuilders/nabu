<script>
    /** @type {{block: import('./paragraph.svelte').Paragraph}}*/
    let {block} = $props();
</script>

<div
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="paragraph"
    class="nabu-paragraph"
    class:selected={block.selected}
>{block.text || "\n"}</div>

<style>
    .nabu-paragraph {
        white-space: pre-wrap;
        &.selected {
            background-color: rgba(59, 130, 246, 0.25);
        }

        /* &::before {
            content: " ";
            display: inline-block;
            width: 0;
        } */
    }
</style>