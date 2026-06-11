<script>
    // BlockGap (the hover "+" between blocks) is intentionally disabled — it
    // injected an inert div between every block, causing cursor/selection edge
    // cases. The component + its `gap:click` handler remain, dormant, for a
    // possible future revisit. Re-enable by rendering <BlockGap {block} /> below.

    /** @type {{ block: import('./block.svelte.js').Block }} */
    let { block } = $props();

    // Récupération dynamique du composant via le Registry de Nabu
    // block.nabu.components est la Map<string, Component>
    let Component = $derived(block.component || block.nabu.components.get(block.type));
</script>

{#if Component}
    <Component {block} />
{:else}
    <div style="color: red; border: 1px dashed red; padding: 0.5rem; margin: 0.5rem 0;" contenteditable="false">
        ⚠️ Unknown block type: <strong>{block.type}</strong>
    </div>
{/if}
