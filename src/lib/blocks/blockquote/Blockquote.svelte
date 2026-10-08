<script>
    import RichText from '../../behaviors/text/RichText.svelte';
    /** @type {{block: import('./blockquote.svelte.js').BlockquoteBlock}}*/
    let {block} = $props();
</script>

<blockquote
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="blockquote"
    data-placeholder={block.placeholder}
    class="nabu-blockquote"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
    class:first={block.isSelectionStart}
    class:last={block.isSelectionEnd}
><RichText delta={block.delta} /></blockquote>

<style>
    .nabu-blockquote {
        white-space: pre-wrap;
        margin: 0 0 0.5em 0;
        padding: 0.25em 0 0.25em 0.875em;
        border-left: 3px solid var(--nb-border, rgba(255, 255, 255, 0.25));
        color: var(--nb-text-secondary, inherit);

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
