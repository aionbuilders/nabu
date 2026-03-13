<script>
    import Block from "../Block.svelte";
    import RichText from '../../behaviors/text/RichText.svelte';

    /** @type {{block: import('./list-item.svelte.js').ListItem}}*/
    let {block} = $props();
</script>

<li 
    data-block-id={block.id}
    data-block-type="list-item"
    class="nabu-list-item"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
    class:first={block.isSelectionStart}
    class:last={block.isSelectionEnd}
>
    <div bind:this={block.element} class="item-content"><RichText delta={block.delta} /></div><!-- 
    -->{#if block.children && block.children.length > 0}
    <div class="item-children">
        {#each block.children as child (child.id)}
        <Block block={child} />
        {/each}
    </div>
    {/if}
</li>

<style>
    .nabu-list-item {
        margin: 0.25rem 0;
        
        &.debug{
            &.selected > .item-content {
                background-color: rgba(59, 130, 246, 0.25);
            }
        }
        
    }
    
    .item-content {
        outline: none;
        white-space: pre-wrap;
        min-height: 1.5em; /* Permet de cliquer dans un item vide */
    }
    
    .item-children {
        /* Pas de margin-left ici, c'est le <ul> imbriqué qui gèrera l'indentation */
    }
</style>
