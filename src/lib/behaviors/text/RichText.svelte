<script>
    /** @type {{ delta: import('loro-crdt').Delta<string>[] }} */
    let { delta } = $props();

    /** @param {Record<string, any>} attrs */
    function getClasses(attrs) {
        return [
            attrs.bold && 'nabu-bold',
            attrs.italic && 'nabu-italic',
            attrs.underline && 'nabu-underline',
            attrs.code && 'nabu-code',
            attrs.strikethrough && 'nabu-strikethrough',
        ].filter(Boolean).join(' ');
    }

    const segments = $derived(delta.length ? delta : [{ insert: '\n' }]);
</script>

{#each segments as op}
    {#if op.attributes && Object.values(op.attributes).some(Boolean)}
        <span class={getClasses(op.attributes)}>{op.insert}</span>
    {:else}
        {op.insert}
    {/if}
{/each}

<style>
    :global(.nabu-bold)          { font-weight: bold; }
    :global(.nabu-italic)        { font-style: italic; }
    :global(.nabu-underline)     { text-decoration: underline; }
    :global(.nabu-strikethrough) { text-decoration: line-through; }
    :global(.nabu-code)          { font-family: monospace; background: rgba(135, 131, 120, 0.15); border-radius: 3px; padding: 0.1em 0.3em; }
</style>
