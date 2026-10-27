<script>
    import { Nabu } from "./nabu.svelte.js";
    import Block from "./Block.svelte";
    import { commandTargetElement } from "../utils/command-confirm.svelte.js";

    /**
     * - `label`: the accessible name of the editor (`aria-label` on the contenteditable root), e.g. "Chapter text".
     * - `labelledby`: the id of the element that names it (`aria-labelledby`), for a visible `<label>`. Wins over `label` for
     *   assistive technology when both are set. No `role` is ever set on an editable root: it would flatten the headings inside.
     * - `readonly`: show the document without letting anyone edit it. Reactive (toggle it live). When omitted, the editor follows
     *   `engine.readonly` (the `readonly` option of the engine); when given, it sets `engine.readonly`.
     * @type {{ engine: Nabu, label?: string, labelledby?: string, readonly?: boolean }}
     */
    let { engine = new Nabu(), label = undefined, labelledby = undefined, readonly = undefined } = $props();

    // The prop drives the engine (set now, so that the first render and the server render already agree, then kept in sync live):
    // the engine is where every guard reads it. `isReadonly` is what this component draws.
    function syncReadonly() { if (readonly !== undefined) engine.readonly = !!readonly; }
    syncReadonly();
    $effect.pre(syncReadonly);
    const isReadonly = $derived(readonly !== undefined ? !!readonly : engine.readonly);

    // The engine learns which element is its own root (an attachment: set when the root mounts, cleared when it goes away, and re-run
    // if `engine` changes). Everything the engine does with the page-wide DOM selection or a document-level event is limited to
    // this element, so that several editors can share a page without ever acting on each other's caret (see NabuSelection).
    /** @type {import('svelte/attachments').Attachment<HTMLElement>} */
    const claimRoot = (node) => engine.internals.selection.attachRoot(node);

    // An event that bubbles from a NESTED editor (one mounted in a UI island of this editor) reaches the root of this editor too:
    // only the editor whose root is the nearest one handles it.
    /** @param {Event} e */
    function mine(e) {
        const target = e.target;
        const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
        return !el || el.closest('[data-nabu-root]') === e.currentTarget;
    }

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
    contenteditable={isReadonly ? 'false' : 'true'}
    class="nabu-editor"
    aria-label={label}
    aria-labelledby={labelledby}
    role={isReadonly ? 'document' : undefined}
    data-nabu-readonly={isReadonly ? '' : undefined}
    spellcheck={engine.spellcheck ? 'true' : 'false'}
    lang={engine.lang}
    {...(engine.tabDescription ? { 'aria-description': engine.tabDescription } : {})}
    data-gramm={engine.spellcheck ? undefined : 'false'}
    data-gramm_editor={engine.spellcheck ? undefined : 'false'}
    data-enable-grammarly={engine.spellcheck ? undefined : 'false'}
    translate="no"
    data-nabu-root="true"
    {@attach claimRoot}
    data-nabu-range={engine.selection?.isRange ? '' : undefined}
    onbeforeinput={(e) => mine(e) && engine.handleBeforeinput(e)}
    onkeydown={(e) => mine(e) && engine.handleKeydown(e)}
    onmousedown={(e) => mine(e) && engine.handleMousedown(e)}
    onfocusout={() => engine.rearmTab()}
    oncopy={(e) => mine(e) && engine.handleCopy(e)}
    oncut={(e) => mine(e) && engine.handleCut(e)}
    onpaste={(e) => mine(e) && engine.handlePaste(e)}
    ondragstart={(e) => engine.handleDragStart(e)}
    ondragenter={(e) => engine.handleDragOver(e)}
    ondragover={(e) => engine.handleDragOver(e)}
    ondragleave={(e) => engine.handleDragLeave(e)}
    ondragend={(e) => engine.handleDragEnd(e)}
    ondrop={(e) => engine.handleDrop(e)}
    oncompositionstart={(e) => mine(e) && engine.handleCompositionStart(e)}
    oncompositionupdate={(e) => mine(e) && engine.handleCompositionUpdate(e)}
    oncompositionend={(e) => mine(e) && engine.handleCompositionEnd(e)}
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
        outline: none; /* replaced by the focus ring below */
        min-height: 100px;
        padding: 1rem;
        white-space: pre-wrap; /* Important pour le comportement éditeur */
        word-break: break-word;
    }

    /* Focus indicator (WCAG 2.4.7 / 1.4.11): a 2px ring in --nb-focus-ring, defined by the base theme (nabu-theme.css: #0b57d0, 6.4:1 on white,
       and #8ab4f8, 7.9:1 on #1e1e1e). Without the theme the fallbacks below are the same two colours, picked by prefers-color-scheme.
       Drawn INSIDE the box (negative offset) so that an `overflow: hidden` ancestor never clips it. A theme that draws its own
       indicator (Atelier: the border of the pane) overrides this with a more specific rule and sets `outline: none`. */
    .nabu-editor:focus-visible {
        outline: var(--nb-focus-ring-width, 2px) solid var(--nb-focus-ring, #0b57d0);
        outline-offset: calc(var(--nb-focus-ring-width, 2px) * -1);
    }
    @media (prefers-color-scheme: dark) {
        .nabu-editor:focus-visible { outline-color: var(--nb-focus-ring, #8ab4f8); }
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

    /* Paragraph indent (the French "alinéa") is LAYOUT, not content: --nb-paragraph-indent (default 0, so nothing changes until a
       host sets it, e.g. `--nb-paragraph-indent: 1.5em`) becomes the text-indent of every paragraph, EXCEPT by the classic
       typographic rule the first one of a text: the first block of the document, of a region body, of any container (:first-child),
       and the one right after a heading or a divider. (A region seam is not a sibling of its body: the body's first block is
       :first-child.) Sibling selectors on the existing markup only, no class, no model. */
    .nabu-editor :global([data-block-type='paragraph']) {
        text-indent: var(--nb-paragraph-indent, 0);
    }
    .nabu-editor :global([data-block-type='paragraph']:first-child),
    .nabu-editor :global(:is([data-block-type='heading'], [data-block-type='divider']) + [data-block-type='paragraph']) {
        text-indent: 0;
    }

    /* A selection across several blocks leaves out the blocks that isolate their text (a region title, ADR 018 §3.9): the model
       does not touch them, and they are not drawn as selected. Only the highlight changes (the DOM of the block stays as it is,
       so a drag in progress is not disturbed). */
    .nabu-editor[data-nabu-range] :global([data-nabu-isolated]::selection),
    .nabu-editor[data-nabu-range] :global([data-nabu-isolated] *::selection) {
        background: transparent;
        color: inherit;
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
        color: var(--nb-text-placeholder, color-mix(in srgb, currentColor 60%, transparent));
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
