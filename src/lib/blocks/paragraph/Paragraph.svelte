<script>
    import RichText from '../../behaviors/text/RichText.svelte';
    /** @type {{block: import('./paragraph.svelte.js').Paragraph}}*/
    let {block} = $props();
</script>

<div
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="paragraph"
    class="nabu-paragraph"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
    class:first={block.isSelectionStart}
    class:last={block.isSelectionEnd}
><RichText delta={block.delta} /></div>

<style>
    .nabu-paragraph {
        white-space: pre-wrap;
        margin-bottom: 0.5em;
        &.debug{
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
    }
</style>