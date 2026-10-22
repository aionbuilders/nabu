<script>
    import { Nabu } from "./nabu.svelte.js";
    import Block from "./Block.svelte";
    import { commandTargetElement } from "../utils/command-confirm.svelte.js";

    /** @type {{ engine: Nabu }} */
    let { engine = new Nabu() } = $props();

    $effect(() => {
        engine.systems.forEach(system => system.start?.());
        return () => engine.systems.forEach(system => system.stop?.());
    });

    // The target of a pending confirmation (ADR 017 §3.4a) is marked so that it can draw the progress: `data-command-target`
    // (the strategy) and `--nb-command-progress` (0 → 1). A block that draws its own may read `engine.pendingCommandOn(block)`.
    $effect(() => {
        const pending = engine.pendingCommand;
        const el = pending ? commandTargetElement(pending.target) : null;
        if (!pending || !el) return;
        el.setAttribute('data-command-target', pending.strategy);
        $effect(() => { el.style.setProperty('--nb-command-progress', String(pending.progress)); });
        return () => { el.removeAttribute('data-command-target'); el.style.removeProperty('--nb-command-progress'); };
    });
</script>

<!-- With spellcheck off, the data-gramm* attributes are the documented opt-out hints of the Grammarly extension (it would
     otherwise inject its own DOM into the editor, which Nabu does not support). Code blocks set spellcheck="false" themselves. -->
<div
    contenteditable="true"
    class="nabu-editor"
    spellcheck={engine.spellcheck ? 'true' : 'false'}
    lang={engine.lang}
    data-gramm={engine.spellcheck ? undefined : 'false'}
    data-gramm_editor={engine.spellcheck ? undefined : 'false'}
    data-enable-grammarly={engine.spellcheck ? undefined : 'false'}
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

<!-- One polite live region per editor: prompts and outcomes of command confirmations (hold, invite, choose). Visually hidden. -->
<div class="nabu-live" role="status" aria-live="polite" aria-atomic="true" data-nabu-ui data-nabu-live>{engine.commandAnnouncement}</div>

<style>
    .nabu-live {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }

    .nabu-editor {
        outline: none;
        min-height: 100px;
        padding: 1rem;
        white-space: pre-wrap; /* Important pour le comportement éditeur */
        word-break: break-word;
    }

    /* Target of a pending confirmation (ADR 017): a neutral default, a thin outline + a fill that follows --nb-command-progress
       (0 → 1). Override --nb-command-* freely, or draw your own from [data-command-target] / engine.pendingCommandOn(block). */
    .nabu-editor :global([data-command-target]) {
        outline: 2px solid var(--nb-command-accent, currentColor);
        outline-offset: 2px;
        border-radius: var(--nb-command-radius, 3px);
        background-image: linear-gradient(to right, var(--nb-command-fill, color-mix(in srgb, currentColor 12%, transparent)) calc(var(--nb-command-progress, 0) * 100%), transparent 0);
    }
    .nabu-editor :global([data-command-target='invite']) {
        background-image: none;
    }
    @media (prefers-reduced-motion: no-preference) {
        .nabu-editor :global([data-command-target]) { transition: outline-color 0.1s; }
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
