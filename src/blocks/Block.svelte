<script>
    /** @type {{ block: import('./block.svelte.js').Block }} */
    let { block } = $props();

    // Récupération dynamique du composant via le Registry de Nabu
    // block.nabu.components est la Map<string, Component>
    let Component = $derived(block.component || block.nabu.components.get(block.type));
</script>

{#if Component}
    <!-- On passe l'instance du bloc au composant spécifique -->
    <Component {block} />
{:else}
    <!-- Fallback pour les types inconnus (utile en dev) -->
    <div style="color: red; border: 1px dashed red; padding: 0.5rem; margin: 0.5rem 0;" contenteditable="false">
        ⚠️ Unknown block type: <strong>{block.type}</strong>
    </div>
{/if}
