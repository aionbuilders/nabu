<script>
    import Block from "../Block.svelte";
    import RichText from "../../behaviors/text/RichText.svelte";
    import { Regions } from "./regions.svelte.js";

    /** @type {{block: import('./region.svelte.js').RegionBlock}}*/
    let {block} = $props();

    const region = $derived(Regions.get(block.nabu).of(block));
    const level = $derived(Math.min(6, Math.max(1, region?.level ?? 1)));
    // The label template applied with an EMPTY title ("1.", "1.1", "Chapter 2"): the editable title follows it.
    const prefix = $derived(region?.prefix ?? '');

    // A protected merge asks to be HELD on this seam (ADR 017 `hold`, ADR 016 lot 2): the command's prompt shows above the
    // seam and the hairline drains in the warning tint while the key is down. Nothing remains once the region is gone.
    const pending = $derived.by(() => {
        const p = block.nabu.pendingCommandOn(block);
        return p?.strategy === 'hold' ? p : null;
    });
</script>

<!--
    The default rendering of a region (ADR 018 §3.6): a container whose HEADER is the seam (the label prefix, the editable
    TITLE, a hairline) and whose BODY is its children. Announced as a heading of the region's level so that screen readers
    navigate by division. No editing UI here: the integrator brings its own. The body has no border, indent, background or
    margin: the text flows from a region into the next.

    Theming: --nb-region-color, --nb-region-title-color, --nb-region-rule-color, --nb-region-label-size,
    --nb-region-label-weight, --nb-region-gap, --nb-region-margin (they default to the host's text colour, so light and dark
    pages both work) and --nb-region-warning (the tint of a pending merge: amber; nabu-theme.css gives it a darker amber for
    light pages and a lighter one for dark pages, so the hint keeps a 4.5:1 contrast on both — the #b45309 fallback assumes
    a light page).

    The hold hint (neutral version of the design of the "8b" board): left-aligned above the seam, no bubble, no background,
    no border, in the warning tint; the hairline drains with the progress (0 → 1). It is positioned ABSOLUTELY in the top
    margin of the seam, so showing it shifts nothing; it needs `--nb-region-margin` to leave about one line above the seam
    (the default does).
-->
<div
    class="nabu-region"
    data-region-type={block.regionType}
    data-region-level={level}
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
    class:pending={!!pending}
    data-region-pending={pending ? 'hold' : undefined}
    style:--nb-region-progress={pending ? pending.progress : undefined}
>
    <div class="nabu-region-seam" role="heading" aria-level={level}>
        {#if pending}
            <!-- Not read as part of the heading (the live region announces the prompt): decorative here. -->
            <span class="nabu-region-hint" data-region-hint data-nabu-ui contenteditable="false" aria-hidden="true">{pending.message}</span>
        {/if}
        {#if prefix}
            <span class="nabu-region-label" data-nabu-ui contenteditable="false" title={prefix}>{prefix}</span>
        {/if}
        <div
            bind:this={block.element}
            class="nabu-region-title"
            class:empty={!block.text}
            data-block-id={block.id}
            data-block-type="region"
            data-placeholder={block.placeholder}
        ><RichText delta={block.delta} /></div>
        <span class="nabu-region-rule" data-nabu-ui contenteditable="false" aria-hidden="true">
            {#if pending}<span class="nabu-region-drain"></span>{/if}
        </span>
    </div>
    <div class="nabu-region-body">
        {#each block.children as child (child.id)}<Block block={child} />{/each}
    </div>
</div>

<style>
    .nabu-region-seam {
        display: flex;
        align-items: center;
        gap: var(--nb-region-gap, 0.75em);
        margin: var(--nb-region-margin, 1.75em 0 0.75em);
        color: var(--nb-region-color, color-mix(in srgb, currentColor 62%, transparent));
        font-size: var(--nb-region-label-size, 0.75em);
        font-weight: var(--nb-region-label-weight, 500);
        line-height: 1.2;
        letter-spacing: 0.02em;
        position: relative;
    }

    .nabu-region.debug.selected > .nabu-region-seam {
        background-color: rgba(59, 130, 246, 0.25);
    }

    /* The pending hold is drawn by the hint and the draining hairline only: not by the engine's default target outline
       (the extra attribute outranks it: its rule is as specific as a single attribute + the editor's scoped classes). */
    .nabu-region :global([data-command-target][data-block-type='region']) {
        outline: none;
        background-image: none;
        border-radius: 0;
    }

    .nabu-region-hint {
        position: absolute;
        left: 0;
        bottom: 100%;
        max-width: 100%;
        padding-bottom: 0.25em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--nb-region-warning, #b45309);
        font-weight: var(--nb-region-label-weight, 500);
        pointer-events: none;
        user-select: none;
    }

    .nabu-region-label {
        flex: none;
        max-width: 40%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: none;
    }

    /* The title is the editable text of the seam (the header of the container). */
    .nabu-region-title {
        flex: 0 1 auto;
        min-width: 1ch;
        max-width: 100%;
        outline: none;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--nb-region-title-color, color-mix(in srgb, currentColor 88%, transparent));
    }

    /* An empty title keeps room for its placeholder, so that focusing it does not move the hairline. */
    .nabu-region-title.empty {
        min-width: 8ch;
    }

    .nabu-region-rule {
        flex: 1 1 2em;
        min-width: 2em;
        position: relative;
        border-top: 1px solid var(--nb-region-rule-color, color-mix(in srgb, currentColor 18%, transparent));
        user-select: none;
    }

    /* The hairline in the warning tint, emptying from the right as the hold progresses. */
    .nabu-region-drain {
        position: absolute;
        left: 0;
        right: 0;
        top: -1px;
        height: 1px;
        background: var(--nb-region-warning, #b45309);
        transform: scaleX(calc(1 - var(--nb-region-progress, 0)));
        transform-origin: left center;
        pointer-events: none;
    }
</style>
