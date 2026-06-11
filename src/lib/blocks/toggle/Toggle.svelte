<script>
    import Block from "../Block.svelte";
    import RichText from '../../behaviors/text/RichText.svelte';
    import { getPlaceholder } from '../../utils/placeholders.js';
    /** @type {{ block: import('./toggle.svelte.js').ToggleBlock }} */
    let { block } = $props();
</script>

<div class="nabu-toggle" class:collapsed={block.collapsed}>
    <div class="nabu-toggle-head">
        <button
            class="nabu-toggle-arrow"
            data-nabu-ui
            contenteditable="false"
            type="button"
            aria-expanded={!block.collapsed}
            onmousedown={(e) => { e.preventDefault(); block.toggleCollapsed(); }}
        >{block.collapsed ? '▸' : '▾'}</button>
        <div
            bind:this={block.element}
            class="nabu-toggle-header"
            data-block-id={block.id}
            data-block-type="toggle"
            data-placeholder={block.text ? '' : getPlaceholder('toggle')}
        ><RichText delta={block.delta} /></div>
    </div>
    {#if !block.collapsed}
    <div class="nabu-toggle-body">
        {#each block.children as child (child.id)}<Block block={child} />{/each}
    </div>
    {/if}
</div>

<style>
    .nabu-toggle {
        margin: 0.25em 0;
    }

    .nabu-toggle-head {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 0.25em;
    }

    .nabu-toggle-arrow {
        flex-shrink: 0;
        width: 1.4em;
        height: 1.5em;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        user-select: none;
        font-size: 0.85em;
        line-height: 1.6;
        outline: none;
        color: var(--nb-text-secondary, rgba(255, 255, 255, 0.45));
        transition: color 0.15s ease;
    }

    .nabu-toggle-arrow:hover {
        color: var(--nb-text-primary, rgba(255, 255, 255, 0.85));
    }

    .nabu-toggle-header {
        flex: 1;
        outline: none;
        white-space: pre-wrap;
        min-height: 1.5em;
        line-height: 1.6;
        color: var(--nb-text-primary, rgba(255, 255, 255, 0.85));
    }

    .nabu-toggle-body {
        margin-left: 1.4em;
        padding-left: 0.25em;
        border-left: 2px solid var(--nb-border, rgba(255, 255, 255, 0.1));
    }
</style>
