<script>
    import { untrack } from 'svelte';
    import Block from '../Block.svelte';
    import { collect } from '../../overlays/context/collect.js';
    import ZoneEditor from './ZoneEditor.svelte';

    /** @type {{ block: import('./zone.svelte.js').ZoneBlock }} */
    let { block } = $props();

    let editing = $state(false);
    let titleDraft = $state('');
    /** @type {HTMLInputElement | null} */
    let inputEl = $state(null);

    const template = $derived(block.template ? block.zones.templates.get(block.template) : null);
    const formattedTemplate = $derived(template ? template.renderLabel(block.count || 1, block.title) : null);
    
    const displayLabel = $derived.by(() => {
        if (!formattedTemplate) return block.title;
        if (template?.label.includes('{{title}}')) return formattedTemplate;
        if (block.title) return `${formattedTemplate} · ${block.title}`;
        return formattedTemplate;
    });

    const progress = $derived(
        block.wordCountTarget 
        ? Math.min(100, Math.round((block.wordCount / block.wordCountTarget) * 100)) 
        : 0
    );

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

    $effect(() => {
        const tick = block._focusTitleTick;
        if (tick === 0) return;
        untrack(() => startEdit());
    });
</script>

<div
    class="nabu-zone"
    data-block-id={block.id}
    data-block-type="zone"
    data-zone-id={block.id}
    data-zone-status={block.status}
    use:collect={() => [
        {
            key: `zone-editor-${block.id}`,
            component: ZoneEditor,
            props: { block },
        },
        {
            key: `zone-actions-${block.id}`,
            items: [
                { label: 'Renommer', action: () => block.focusTitle() },
                { label: 'Unwrap',   action: () => block.nabu.exec('zone:unwrap', { zoneId: block.id }) },
            ],
        },
    ]}
>
    {#each block.children as child (child.id)}
        <Block block={child} />
    {/each}<!--
     Zone UI overlay: boundaries + title (contenteditable=false = hors-flux éditeur) 
     CRITICAL: DO NOT REMOVE contenteditable="false" OR pointer-events: none.
    --><div class="nabu-zone-ui" contenteditable="false" aria-hidden="true" style="user-select: none;">

        <!-- Lignes horizontales minimalistes (section breaks) -->
        <div class="nabu-zone-boundary nabu-zone-boundary--top" data-nabu-inert></div>
        <div class="nabu-zone-boundary nabu-zone-boundary--bottom" data-nabu-inert></div>

        <!-- Le Badge Flottant en haut à gauche -->
        <div class="nabu-zone-title" data-nabu-ui>
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
                    {displayLabel || 'Nouvelle Zone'}
                </span>
            {/if}

            {#if block.wordCountTarget || block.wordCount > 0}
                <span 
                    class="nabu-zone-wc"
                    class:has-target={block.wordCountTarget != null}
                    class:is-done={block.wordCountTarget && block.wordCount >= block.wordCountTarget}
                    style={block.wordCountTarget ? `--progress: ${progress}%` : ''}
                >
                    {#if block.wordCountTarget}
                        {block.wordCount} / {block.wordCountTarget}
                    {:else}
                        {block.wordCount} mots
                    {/if}
                </span>
            {/if}
        </div>

    </div>
</div>

<style>
    .nabu-zone {
        /* On augmente un peu la marge externe pour que les badges ne se touchent jamais */
        margin: 1.5rem 0;
        /* Plus d'espace en haut (1.5rem) pour laisser respirer le texte sous la pilule */
        padding: 1.5rem 0 0.75rem 0;
        position: relative;
    }

    .nabu-zone-ui {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    /* Les "fences" (lignes) sont devenues horizontales et s'effacent doucement en dégradé */
    .nabu-zone-boundary {
        position: absolute;
        left: 0;
        width: 100%;
        max-width: 250px; /* La ligne disparait dans le vide, très littéraire */
        height: 1px;
        pointer-events: none;
    }

    .nabu-zone-boundary--top {
        top: 0;
        background: linear-gradient(to right, var(--nb-border, hsla(0, 0%, 100%, 0.1)), transparent);
    }

    .nabu-zone-boundary--bottom {
        bottom: 0;
        background: linear-gradient(to right, var(--nb-border-subtle, hsla(0, 0%, 100%, 0.05)), transparent);
    }

    /* Couleurs de statut appliquées à la ligne du haut */
    [data-zone-status="revised"] > .nabu-zone-ui > .nabu-zone-boundary--top { background: linear-gradient(to right, var(--nb-warning, rgba(245, 158, 11, 0.4)), transparent); }
    [data-zone-status="done"]    > .nabu-zone-ui > .nabu-zone-boundary--top { background: linear-gradient(to right, var(--nb-success-bg, rgba(16, 185, 129, 0.4)), transparent); }

    /* Badge Titre Flottant */
    .nabu-zone-title {
        position: absolute;
        top: 0;
        left: 0;
        transform: translateY(-50%);
        pointer-events: all; /* Important pour rendre le badge cliquable */
        display: flex;
        align-items: center;
        gap: 6px;
        z-index: 10;
    }

    .nabu-zone-title-label {
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.03em;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        background: var(--nb-bg-surface, hsla(0, 0%, 15%, 0.6));
        backdrop-filter: var(--nb-glass-blur-sm, blur(12px));
        -webkit-backdrop-filter: var(--nb-glass-blur-sm, blur(12px));
        padding: 2px 8px;
        border-radius: 12px;
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.05));
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        white-space: nowrap;
    }

    .nabu-zone-title-label:hover {
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.8));
        background: var(--nb-bg-surface-active, hsla(0, 0%, 20%, 0.8));
        border-color: var(--nb-border, hsla(0, 0%, 100%, 0.1));
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }

    .nabu-zone-title-input {
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.03em;
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.6));
        backdrop-filter: var(--nb-glass-blur-sm, blur(12px));
        -webkit-backdrop-filter: var(--nb-glass-blur-sm, blur(12px));
        padding: 2px 8px;
        border-radius: 12px;
        border: 1px solid var(--nb-border-focus, hsla(0, 0%, 100%, 0.2));
        outline: none;
        width: 140px;
        box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
        font-family: inherit;
    }

    .nabu-zone-wc {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 100%, 0.03));
        padding: 2px 6px;
        border-radius: 8px;
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.02));
        user-select: none;
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;
        z-index: 1; /* Keep text above the pseudo-element */
    }

    .nabu-zone-wc.has-target {
        color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.7));
        border-color: var(--nb-border, hsla(0, 0%, 100%, 0.05));
    }

    .nabu-zone-wc.has-target::before {
        content: '';
        position: absolute;
        top: 0; left: 0; bottom: 0;
        width: var(--progress, 0%);
        background: var(--nb-accent, hsla(210, 100%, 60%, 0.25)); /* Progress blue fill */
        z-index: -1;
        transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .nabu-zone-wc.is-done {
        color: var(--nb-success, hsla(150, 100%, 60%, 0.9));
        border-color: var(--nb-success-bg, hsla(150, 100%, 60%, 0.2));
    }

    .nabu-zone-wc.is-done::before {
        background: var(--nb-success-bg, hsla(150, 100%, 60%, 0.15)); /* Done green fill */
    }
</style>
