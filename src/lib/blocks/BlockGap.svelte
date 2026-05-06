<script>
    /** @type {{ block: import('./block.svelte.js').Block }} */
    let { block } = $props();

    function onclick() {
        const parentId = block.parent?.node.id.toString() ?? null;
        const insertIndex = block.index + 1;
        block.nabu.exec('gap:click', { parentId, insertIndex });
    }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
    class="nabu-block-gap"
    contenteditable="false"
    data-nabu-inert
    aria-hidden="true"
    {onclick}
>
    <div class="nabu-block-gap-line"></div>
</div>

<style>
    .nabu-block-gap {
        position: relative;
        height: 0.75rem;
        cursor: pointer;
        user-select: none;
    }

    .nabu-block-gap-line {
        position: absolute;
        inset: 50% 0 auto 0;
        transform: translateY(-50%);
        height: 1px;
        background: color-mix(in srgb, currentColor 20%, transparent);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.15s;
    }

    .nabu-block-gap:hover .nabu-block-gap-line {
        opacity: 1;
    }

    .nabu-block-gap-plus {
        font-size: 0.6rem;
        line-height: 1;
        background: white;
        padding: 0 0.25rem;
        color: #aaa;
    }
</style>
