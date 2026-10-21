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
    spellcheck="true"
    translate="no"
    data-nabu-root="true"
    onbeforeinput={(e) => engine.handleBeforeinput(e)}
    onkeydown={(e) => engine.handleKeydown(e)}
    onmousedown={(e) => engine.handleMousedown(e)}
    oncopy={(e) => engine.handleCopy(e)}
    oncut={(e) => engine.handleCut(e)}
    onpaste={(e) => engine.handlePaste(e)}
    ondragstart={(e) => engine.handleDragStart(e)}
    ondragenter={(e) => engine.handleDragOver(e)}
    ondragover={(e) => engine.handleDragOver(e)}
    ondragleave={(e) => engine.handleDragLeave(e)}
    ondragend={(e) => engine.handleDragEnd(e)}
    ondrop={(e) => engine.handleDrop(e)}
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

    /* Placeholders — blocks expose data-placeholder when it must be shown
       (empty, and holding the cursor by default; see the `placeholders` option).
       Uses ::after (not ::before) so blocks that decorate themselves with
       ::before (e.g. dialogue's dash) keep working. Absolutely positioned so it
       never takes part in the layout, the caret placement or the text. It is
       pinned to the top-left and inherits the block's padding (the empty block
       holds a "\n", which would push an auto-positioned box onto a 2nd line). */
    .nabu-editor :global([data-block-id][data-placeholder]) {
        position: relative; /* containing block of the absolute ::after */
    }
    .nabu-editor :global([data-block-id][data-placeholder]:not([data-placeholder=''])::after) {
        content: attr(data-placeholder);
        color: var(--nb-text-placeholder, color-mix(in srgb, currentColor 35%, transparent));
        pointer-events: none;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        box-sizing: border-box;
        padding: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
        user-select: none;
        white-space: nowrap;
    }
</style>
