<script>
    /** 
     * @typedef {import('./context.svelte.js').ContextMenuSection} ContextMenuSection 
     * @typedef {import('./context.svelte.js').Context} Context
     */
    import { untrack } from 'svelte';
    import { fly } from 'svelte/transition';
    import { setMenuContext } from './context.svelte.js';

    /** @type {{ x: number, y: number, context: Context }} */
    let { x, y, context } = $props();

    setMenuContext(untrack(() => context));

    // Clamp to viewport so the menu never goes off-screen
    const menuWidth = 220;
    const menuMaxHeight = 400;
    const left = $derived(Math.min(x, window.innerWidth  - menuWidth)     + 'px');
    const top  = $derived(Math.min(y, window.innerHeight - menuMaxHeight)  + 'px');
</script>

<div class="nabu-context-menu" style:left style:top role="menu">
    {#if context.history.length > 1}
        <div class="nabu-context-header">
            <button class="nabu-context-back" onclick={() => context.pop()}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m15 18-6-6 6-6"/>
                </svg>
            </button>
            <span class="nabu-context-title">{context.currentView.title || 'Retour'}</span>
        </div>
    {/if}

    <div class="nabu-context-viewport">
        {#key context.currentView.id}
            <div 
                class="nabu-context-view"
                in:fly={{ x: context.direction === 1 ? 50 : -50, duration: 200 }}
                out:fly={{ x: context.direction === 1 ? -50 : 50, duration: 200 }}
            >
                {#each context.currentView.sections as section, i (section.key)}
                    {#if i > 0}
                        <div class="nabu-context-sep" role="separator"></div>
                    {/if}

                    {#if section.component}
                        <section.component {...(section.props ?? {})} />
                    {:else if section.items}
                        <!-- {#each section.items as item}
                            <button
                                class="nabu-context-item"
                                class:disabled={item.disabled}
                                disabled={item.disabled}
                                role="menuitem"
                                onclick={item.action}
                            >
                                {#if item.icon}
                                    <span class="nabu-context-icon">{item.icon}</span>
                                {/if}
                                <span class="nabu-context-label">{item.label}</span>
                            </button>
                        {/each} -->
                    {/if}
                {/each}
            </div>
        {/key}
    </div>
</div>

<style>
    .nabu-context-menu {
        position: fixed;
        z-index: 9999;
        min-width: 240px;
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 13px;
        color: var(--nb-text-primary, #eee);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .nabu-context-header {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        gap: 8px;
        font-weight: 500;
        background: var(--nb-bg-surface, hsla(0, 0%, 12%, 0.75));
        backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        -webkit-backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        border: 1px solid var(--nb-border, hsla(0, 0%, 100%, 0.1));
        border-radius: 12px;
        box-shadow: var(--nb-shadow-lg, 0 8px 24px -8px rgba(0,0,0,0.5));
    }

    .nabu-context-back {
        background: transparent;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: 6px;
        color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.6));
        transition: background 0.15s, color 0.15s;
    }

    .nabu-context-back:hover {
        background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.1));
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 1));
    }

    .nabu-context-title {
        flex: 1;
        text-align: left;
        font-size: 13px;
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        letter-spacing: 0.2px;
    }

    .nabu-context-viewport {
        position: relative;
        display: grid;
    }

    .nabu-context-view {
        grid-area: 1 / 1;
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .nabu-context-sep {
        display: none;
    }

    .nabu-context-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 10px;
        border: none;
        background: var(--nb-bg-surface, hsla(0, 0%, 12%, 0.75));
        backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        -webkit-backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        border: 1px solid var(--nb-border, hsla(0, 0%, 100%, 0.1));
        border-radius: 12px;
        box-shadow: var(--nb-shadow-lg, 0 8px 24px -8px rgba(0,0,0,0.5));
        cursor: pointer;
        text-align: left;
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.8));
        transition: transform 0.1s, background 0.1s;
    }

    .nabu-context-item:hover:not(.disabled) {
        background: var(--nb-bg-surface-active, hsla(0, 0%, 100%, 0.15));
    }
    
    .nabu-context-item:active:not(.disabled) {
        transform: scale(0.98);
    }

    .nabu-context-item.disabled {
        opacity: 0.4;
        cursor: default;
    }

    .nabu-context-icon {
        width: 16px;
        text-align: center;
        flex-shrink: 0;
        opacity: 0.6;
    }

    .nabu-context-label {
        flex: 1;
    }
</style>
