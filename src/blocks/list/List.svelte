<script>
    import Block from "../Block.svelte";
    
    /** @type {{block: import('./list.svelte.js').List}}*/
    let {block} = $props();
</script>

<svelte:element 
    this={block.listType === 'ordered' ? 'ol' : 'ul'} 
    data-block-id={block.id}
    data-block-type="list"
    class="nabu-list"
>
    {#each block.children as child (child.id)}
        <Block block={child} />
    {/each}
</svelte:element>

<style>
    .nabu-list {
        margin-top: 0.5rem;
        margin-bottom: 0.5rem;
        padding-left: 1.5rem;
    }
</style>
