<script>
    import Block from '../Block.svelte';
    /** @type {{ block: import('./zone.svelte.js').ZoneBlock }} */
    let { block } = $props();

    let editing = $state(false);
    let titleDraft = $state('');
    /** @type {HTMLInputElement | null} */
    let inputEl = $state(null);

    // Ancestor zones, ordered from outermost to nearest parent
    const ancestors = $derived.by(() => {
        /** @type {import('./zone.svelte.js').ZoneBlock[]} */
        const crumbs = [];
        let p = block.parent;
        while (p) {
            if (p.type === 'zone') crumbs.unshift(/** @type {any} */ (p));
            p = p.parent;
        }
        return crumbs;
    });

    function startEdit() {
        titleDraft = block.title;
        editing = true;
    }

    function commitTitle() {
        block.title = titleDraft.trim();
        editing = false;
    }

    /** @param {KeyboardEvent} e */
    function onKeydown(e) {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            commitTitle();
        }
    }

    /** @param {InputEvent} e */
    function onBeforeInput(e) {
        e.stopPropagation();
    }

    $effect(() => {
        if (editing && inputEl) {
            inputEl.focus();
            inputEl.select();
        }
    });
</script>

<div
    class="nabu-zone"
    data-block-id={block.id}
    data-block-type="zone"
    data-zone-id={block.id}
    data-zone-status={block.status}
>
    {#each block.children as child (child.id)}
        <Block block={child} />
    {/each}<!--
     Zone UI overlay: boundaries + title (contenteditable=false = hors-flux éditeur) 
    --><div class="nabu-zone-ui" contenteditable="false" aria-hidden="true" style="user-select: none;">

    <!-- <div class="nabu-zone-boundary nabu-zone-boundary--top" data-nabu-inert></div> -->
    <div class="nabu-zone-boundary nabu-zone-boundary--bottom" data-nabu-inert style="user-select: none;">
        <div class="nabu-zone-close">
            {#each ancestors as anc}
                <span class="nabu-zone-close-sep">‹</span>
                <span class="nabu-zone-close-crumb">{anc.title || '…'}</span>
            {/each}
            <span class="nabu-zone-close-sep">‹</span>
            <span class="nabu-zone-close-current">{block.title || '…'}</span>
        </div>
    </div>

    <div
        class="nabu-zone-title"
        data-nabu-ui
        
    >
        <span class="nabu-zone-crumb-sep">›</span>
        {#if ancestors.length > 0}
            <!-- Breadcrumb for nested zones -->
            {#each ancestors as anc}
                <span class="nabu-zone-crumb">{anc.title || '…'}</span>
                <span class="nabu-zone-crumb-sep">›</span>
            {/each}
        {/if}

        {#if editing}
            <input
                bind:this={inputEl}
                bind:value={titleDraft}
                class="nabu-zone-title-input"
                placeholder="Titre de la zone…"
                onblur={commitTitle}
                onkeydown={onKeydown}
                onbeforeinput={onBeforeInput}
            />
        {:else}
            <span class="nabu-zone-title-label" onclick={startEdit}>
                {block.title || '+ Titre'}
            </span>
        {/if}

        <span class="nabu-zone-meta">
            <!-- <span class="nabu-zone-sep">·</span>
            <span class="nabu-zone-status">{block.status}</span> -->
            {#if block.wordCount > 0}
                <span class="nabu-zone-sep">·</span>
                <span class="nabu-zone-wc">{block.wordCount} mots</span>
            {/if}
        </span>
    </div>

    </div>
</div>

<style>
    .nabu-zone {
        margin: 1rem 0;
        padding: 0.75rem 0;
        position: relative;
    }

    .nabu-zone-ui {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    .nabu-zone-boundary {
        position: absolute;
        left: 0;
        right: 0;
        opacity: 0.6;
    }


    .nabu-zone-boundary--bottom { 
        bottom: 0; display: flex; justify-content: flex-start; align-items: center; 
    }

    .nabu-zone-close {
        transform: translateY(50%);
        display: flex;
        align-items: center;
        gap: 0;
        line-height: 1;
    }

    .nabu-zone-close-sep {
        font-size: 0.6rem;
        color: #ccc;
        margin: 0 0.8em;
        &:first-child {
            margin-left: 0;
        }
    }

    .nabu-zone-close-crumb {
        font-size: 0.6rem;
        color: #bbb;
        letter-spacing: 0.04em;
        &:first-child {
            margin-left: 0;
        }
    }

    .nabu-zone-close-current {
        font-size: 0.6rem;
        color: #aaa;
        letter-spacing: 0.04em;
    }

    [data-zone-status="revised"] .nabu-zone-boundary { background: #f59e0b; opacity: 0.35; }
    [data-zone-status="done"]    .nabu-zone-boundary { background: #10b981; opacity: 0.35; }

    /* Title — flotte sur la boundary top */
    .nabu-zone-title {
        position: absolute;
        top: 0;
        transform: translateY(-50%);
        pointer-events: all;
        line-height: 1;
        display: flex;
        align-items: center;
    }

    .nabu-zone-title-label {
        font-size: 0.6rem;
        font-weight: 400;
        letter-spacing: 0.04em;
        color: #aaa;
        cursor: pointer;
        user-select: none;
        transition: color 0.15s;
    }

    .nabu-zone-title-label:hover {
        color: #666;
    }

    .nabu-zone-title-input {
        font-size: 0.7rem;
        font-weight: 400;
        letter-spacing: 0.04em;
        color: #666;
        border: none;
        outline: none;
        background: transparent;
        padding: 0;
        width: 14rem;
        max-width: 40vw;
    }

    .nabu-zone-crumb {
        font-size: 0.6rem;
        font-weight: 400;
        letter-spacing: 0.04em;
        color: #bbb;
    }

    .nabu-zone-crumb-sep {
        font-size: 0.6rem;
        color: #ccc;
        margin: 0 0.8em;
        &:first-child {
            margin-left: 0;
        }
    }

    .nabu-zone-meta {
        display: contents;
    }

    .nabu-zone-sep {
        font-size: 0.6rem;
        color: #ccc;
        margin: 0 0.8em;
    }

    .nabu-zone-status {
        font-size: 0.6rem;
        color: #bbb;
        letter-spacing: 0.04em;
    }

    .nabu-zone-wc {
        font-size: 0.6rem;
        color: #bbb;
        letter-spacing: 0.04em;
    }
</style>
