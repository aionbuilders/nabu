<script>
    import RichText from '../../behaviors/text/RichText.svelte';
    /** @type {{block: import('./dialogue.svelte.js').Dialogue}}*/
    let {block} = $props();
</script>

<div
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="dialogue"
    class="nabu-dialogue"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
    class:first={block.isSelectionStart}
    class:last={block.isSelectionEnd}
><RichText delta={block.delta} /></div>

<style>
    .nabu-dialogue {
        white-space: pre-wrap;
        margin-bottom: 0.5em;
        padding-left: 1em;
        position: relative;
    }
    
    .nabu-dialogue::before {
        /* content: "—"; */
        content: "–";
        position: absolute;
        left: 0;
        user-select: none;
        pointer-events: none;
    }

    .nabu-dialogue.debug {
        &.selected {
            background-color: rgba(59, 130, 246, 0.25);
        }
        &.first {
            border-top: 1px solid rgba(59, 130, 246, 0.5);
        }
        &.last {
            border-bottom: 1px solid rgba(59, 130, 246, 0.5);
        }
    }
</style>
