<script>
    import RichText from '../../behaviors/text/RichText.svelte';
    /** @type {{block: import('./dialogue.svelte.js').Dialogue}}*/
    let {block} = $props();

    /** The configured dash as a CSS string (`"–"`): fed to the `::before` below. */
    const dashCss = $derived(JSON.stringify(String(block.dash).replace(/[\n\r]/g, ' ')));
</script>

<div
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="dialogue"
    data-placeholder={block.placeholder}
    class="nabu-dialogue"
    style:--nb-dialogue-dash-configured={dashCss}
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
        /* `--nb-dialogue-dash` is the host override (any ancestor / rule); the configured dash
           (createDialogueExtension({ dash })) is the fallback. */
        content: var(--nb-dialogue-dash, var(--nb-dialogue-dash-configured, "–"));
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
