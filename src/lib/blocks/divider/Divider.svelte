<script>
    /** @type {{block: import('./divider.svelte.js').DividerBlock}}*/
    let {block} = $props();
</script>

<hr
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="divider"
    data-nabu-inert
    contenteditable="false"
    class="nabu-divider"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
/>

<style>
    .nabu-divider {
        border: none;
        border-top: 1px solid var(--nb-border, rgba(255, 255, 255, 0.15));
        margin: 1em 0;
        user-select: none;

        &.debug.selected {
            background-color: rgba(59, 130, 246, 0.25);
        }
    }
</style>
