<script>
    import { Regions } from "./regions.svelte.js";

    /** @type {{block: import('./region.svelte.js').RegionBlock}}*/
    let {block} = $props();

    const region = $derived(Regions.get(block.nabu).of(block));
    const level = $derived(Math.min(6, Math.max(1, region?.level ?? 1)));
    // An empty label (untitled, unnumbered) still announces the division by its type.
    const text = $derived(region?.label || block.regionType);
</script>

<!--
    The default rendering of a region marker (ADR 016 §3.5): a discreet seam, the computed label and a hairline. Announced
    as a heading of the region's level so that screen readers navigate by division. No editing UI here: the integrator
    brings its own. Theming: --nb-region-color, --nb-region-rule-color, --nb-region-label-size, --nb-region-label-weight,
    --nb-region-gap, --nb-region-margin (they default to the host's text colour, so light and dark pages both work).
-->
<div
    bind:this={block.element}
    data-block-id={block.id}
    data-block-type="region"
    data-region-type={block.regionType}
    data-region-level={level}
    data-nabu-inert
    contenteditable="false"
    role="heading"
    aria-level={level}
    class="nabu-region"
    class:debug={block.nabu.debugging}
    class:selected={block.selected}
>
    <span class="nabu-region-label">{text}</span>
    <span class="nabu-region-rule" aria-hidden="true"></span>
</div>

<style>
    .nabu-region {
        display: flex;
        align-items: center;
        gap: var(--nb-region-gap, 0.75em);
        margin: var(--nb-region-margin, 1.75em 0 0.75em);
        color: var(--nb-region-color, color-mix(in srgb, currentColor 55%, transparent));
        font-size: var(--nb-region-label-size, 0.75em);
        font-weight: var(--nb-region-label-weight, 500);
        line-height: 1.2;
        letter-spacing: 0.02em;
        user-select: none;

        &.debug.selected {
            background-color: rgba(59, 130, 246, 0.25);
        }
    }

    .nabu-region-label {
        flex: none;
        max-width: 70%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .nabu-region-rule {
        flex: 1;
        border-top: 1px solid var(--nb-region-rule-color, color-mix(in srgb, currentColor 18%, transparent));
    }
</style>
