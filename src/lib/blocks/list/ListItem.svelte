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
    class:todo={block.isTodo}
>{#if block.isTodo}<button
        class="nabu-todo-check"
        data-nabu-ui
        contenteditable="false"
        type="button"
        aria-pressed={block.checked}
        aria-disabled={block.nabu.readonly ? 'true' : undefined}
        onmousedown={(e) => { e.preventDefault(); block.toggleChecked(); }}
    >{block.checked ? '☑' : '☐'}</button>{/if}<div bind:this={block.element} class="item-content" class:checked={block.checked}><RichText delta={block.delta} /></div><!--
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

        &.todo {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
            gap: 0.2em 0.4em;
        }
        /* Checkbox + content share line 1; a nested sublist wraps to its own
           full-width line below (without flex-wrap it would sit to the right). */
        &.todo > .item-content { flex: 1; min-width: 0; }
        &.todo > .item-children { flex-basis: 100%; }
    }

    .item-content {
        outline: none;
        white-space: pre-wrap;
        min-height: 1.5em; /* Permet de cliquer dans un item vide */

        &.checked {
            text-decoration: line-through;
            opacity: 0.55;
        }
    }

    .item-children {
        /* Pas de margin-left ici, c'est le <ul> imbriqué qui gèrera l'indentation */
    }

    .nabu-todo-check {
        flex-shrink: 0;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        user-select: none;
        font-size: 1em;
        line-height: 1.5;
        outline: none;
        vertical-align: top;
    }
</style>
