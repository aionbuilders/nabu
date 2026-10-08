<script>
    import RichText from '../../behaviors/text/RichText.svelte';
    /** @type {{ block: import('./callout.svelte.js').CalloutBlock }} */
    let { block } = $props();
    /** @type {Record<string,string>} */
    const ICONS = { note: 'ℹ️', tip: '💡', important: '❗', warning: '⚠️', caution: '🛑' };
</script>

<aside class="nabu-callout callout-{block.variant}" data-callout={block.variant}>
    <button
        class="nabu-callout-icon"
        data-nabu-ui
        contenteditable="false"
        type="button"
        title="Change callout type ({block.variant})"
        onmousedown={(e) => { e.preventDefault(); block.cycleVariant(); }}
    >{ICONS[block.variant] ?? ICONS.note}</button>
    <div
        class="nabu-callout-body"
        bind:this={block.element}
        data-block-id={block.id}
        data-block-type="callout"
        data-placeholder={block.placeholder}
        class:selected={block.selected}
    ><RichText delta={block.delta} /></div>
</aside>

<style>
    .nabu-callout {
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 0.5em;
        margin: 0.5em 0;
        padding: 0.625em 0.875em;
        border-radius: 6px;
        border-left: 3px solid var(--callout-accent, var(--nb-border, rgba(255, 255, 255, 0.3)));
        background: color-mix(in srgb, var(--callout-accent, var(--nb-border, rgba(255, 255, 255, 0.3))) 8%, transparent);
    }

    .callout-note    { --callout-accent: #6b8cff; }
    .callout-tip     { --callout-accent: #3ecf8e; }
    .callout-important { --callout-accent: #a78bfa; }
    .callout-warning { --callout-accent: #f59e0b; }
    .callout-caution { --callout-accent: #ef4444; }

    .nabu-callout-icon {
        flex-shrink: 0;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        user-select: none;
        font-size: 1.1em;
        line-height: 1.5;
        outline: none;
    }

    .nabu-callout-body {
        flex: 1;
        white-space: pre-wrap;
        outline: none;
        line-height: 1.6;
        min-height: 1.6em;
        color: var(--nb-text-primary, rgba(255, 255, 255, 0.85));
    }
</style>
