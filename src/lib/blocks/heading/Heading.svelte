<script>
    import RichText from '../../behaviors/text/RichText.svelte';
    /** @type {{block: import('./heading.svelte.js').Heading}}*/
    let {block} = $props();
</script>

<svelte:element
    this={"h" + block.level}
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="heading"
    class="nabu-heading"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
    class:first={block.isSelectionStart}
    class:last={block.isSelectionEnd}
><RichText delta={block.delta} /></svelte:element>

<style>
    .nabu-heading {
        margin-top: 1.5rem;
        margin-bottom: 0.5rem;
        white-space: pre-wrap;
        outline: none;
        

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

    h1 { font-size: 2.25rem; font-weight: 800; }
    h2 { font-size: 1.875rem; font-weight: 700; }
    h3 { font-size: 1.5rem; font-weight: 700; }
    h4 { font-size: 1.25rem; font-weight: 600; }
    h5 { font-size: 1.125rem; font-weight: 600; }
    h6 { font-size: 1rem; font-weight: 600; }
</style>
