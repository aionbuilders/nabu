<script>
    import { Nabu } from "./nabu.svelte.js";
    import Block from "./Block.svelte";

    /** @type {{ engine: Nabu }} */
    let { engine = new Nabu() } = $props();
</script>

<div
    contenteditable="true"
    class="nabu-editor"
    spellcheck="false"
    translate="no"
    data-nabu-root="true"
    onbeforeinput={(e) => engine.handleBeforeinput(e)}
    onkeydown={(e) => engine.handleKeydown(e)}
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
</style>
