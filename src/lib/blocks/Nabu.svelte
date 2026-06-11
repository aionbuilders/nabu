<script>
    import { Nabu } from "./nabu.svelte.js";
    import Block from "./Block.svelte";

    /** @type {{ engine: Nabu }} */
    let { engine = new Nabu() } = $props();

    $effect(() => {
        engine.systems.forEach(system => system.start?.());
        return () => engine.systems.forEach(system => system.stop?.());
    });
</script>

<div
    contenteditable="true"
    class="nabu-editor"
    spellcheck="false"
    translate="no"
    data-nabu-root="true"
    onbeforeinput={(e) => engine.handleBeforeinput(e)}
    onkeydown={(e) => engine.handleKeydown(e)}
    oncopy={(e) => engine.handleCopy(e)}
    oncut={(e) => engine.handleCut(e)}
    onpaste={(e) => engine.handlePaste(e)}
    oncompositionstart={(e) => engine.handleCompositionStart(e)}
    oncompositionupdate={(e) => engine.handleCompositionUpdate(e)}
    oncompositionend={(e) => engine.handleCompositionEnd(e)}
>
    {#each engine.children as block (block.id)}
        <Block {block} />
    {/each}
</div>

<style>
    .nabu-editor {
        outline: none;
        min-height: 100px;
        padding: 1rem;
        white-space: pre-wrap; /* Important pour le comportement éditeur */
        word-break: break-word;
    }

    /* Placeholders — blocks expose data-placeholder when empty.
       Uses ::after (not ::before) so blocks that decorate themselves with
       ::before (e.g. dialogue's dash) keep working. */
    /* .nabu-editor :global([data-block-id][data-placeholder]) {
        position: relative; /* nécessaire pour le ::after absolu */
    /* } */
    /* .nabu-editor :global([data-block-id][data-placeholder]:not([data-placeholder=''])::after) {
        content: attr(data-placeholder);
        color: var(--nb-text-placeholder, rgba(255, 255, 255, 0.25));
        pointer-events: none;
        position: absolute;
        user-select: none;
    } */
</style>
