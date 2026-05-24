<script>
    import { getMenuContext } from '../../overlays/context/context.svelte.js';
    import ZoneTemplatesList from './ZoneTemplatesList.svelte';
    import { fade, fly } from 'svelte/transition';
    
    /** @type {{ block: import('./zone.svelte.js').ZoneBlock }} */
    let { block } = $props();
    
    const context = getMenuContext();
    const templates = $derived(block.zones.templates);
    const template = $derived(block.template ? templates.get(block.template) : null);
    
    // On trouve la première zone parente qui a un objectif de mots défini
    const maxTarget = $derived.by(() => {
        let p = block.parent;
        while (p) {
            if (p.type === 'zone' && p.wordCountTarget > 0) {
                return p.wordCountTarget;
            }
            p = p.parent;
        }
        return null;
    });

    let wordCountTargetStr = $state(block.wordCountTarget ? String(block.wordCountTarget) : '');

    function commitWordCountTarget() {
        let parsed = parseInt(wordCountTargetStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
            // On limite à l'objectif du parent si défini
            if (maxTarget !== null && parsed > maxTarget) {
                parsed = maxTarget;
            }
            block.wordCountTarget = parsed;
            wordCountTargetStr = String(parsed);
        } else {
            block.wordCountTarget = null;
            wordCountTargetStr = '';
        }
    }

    function openTemplatesList() {
        context.push({
            id: 'zone-templates',
            title: 'Templates',
            sections: [{ key: 'templates-list', component: ZoneTemplatesList, props: { block } }],
        });
    }

    function switchTemplate(dir) {
        const tKeys = Array.from(templates.keys());
        if (tKeys.length === 0) return;
        
        let idx = tKeys.indexOf(block.template);
        if (idx === -1) idx = 0;
        
        let nextIdx = (idx + dir + tKeys.length) % tKeys.length;
        block.template = tKeys[nextIdx];
    }
</script>

<div class="ze">
    <!-- Header -->
    <div class="ze-head">
        <span class="ze-title">Zone Settings</span>
    </div>

    <!-- Body / Controls -->
    <div class="ze-body">
        
        <!-- Layout / Template Control -->
        <div class="ze-control-group">
            <span class="ze-label">Layout Template</span>
            
            <div class="ze-switcher">
                <button class="ze-btn-icon" aria-label="Previous template" onclick={() => switchTemplate(-1)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 18l-6-6 6-6"/>
                    </svg>
                </button>
                
                <button class="ze-t-display" onclick={openTemplatesList}>
                    {#key block.template}
                        <div class="ze-t-text" in:fly={{ y: 5, duration: 150 }} out:fade={{ duration: 100 }}>
                            {template ? template.renderLabel(block.count || 1, block.title || 'Untitled') : 'No template'}
                        </div>
                    {/key}
                </button>
                
                <button class="ze-btn-icon" aria-label="Next template" onclick={() => switchTemplate(1)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            </div>
        </div>

        <!-- Word Goal Control -->
        <div class="ze-control-group">
            <span class="ze-label">
                Word Goal
                {#if maxTarget}
                    <span style="opacity: 0.5; font-weight: 400; margin-left: 4px;">(Max: {maxTarget})</span>
                {/if}
            </span>
            <div class="ze-input-wrapper">
                <input
                    type="number"
                    min="0"
                    max={maxTarget || undefined}
                    placeholder={maxTarget ? `Max ${maxTarget}` : "e.g. 500"}
                    class="ze-input"
                    bind:value={wordCountTargetStr}
                    onblur={commitWordCountTarget}
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitWordCountTarget(); } }}
                    onbeforeinput={(e) => e.stopPropagation()}
                />
                <span class="ze-input-suffix">mots</span>
            </div>
        </div>

    </div>
</div>

<style>
    .ze {
        display: flex;
        flex-direction: column;
        padding: 6px;
        gap: 4px;
        
        background: var(--nb-bg-surface, hsla(0, 0%, 12%, 0.75));
        backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        -webkit-backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        border: 1px solid var(--nb-border, hsla(0, 0%, 100%, 0.1));
        border-radius: 16px;
        box-shadow: 
            var(--nb-shadow-lg, 0 16px 32px -12px rgba(0,0,0,0.5)), 
            inset 0 1px 0 var(--nb-border, hsla(0, 0%, 100%, 0.1));
    }

    .ze-head {
        display: flex;
        align-items: center;
        padding: 6px 8px;
    }

    .ze-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
    }

    .ze-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 4px;
        background: transparent;
        border: none;
    }

    .ze-control-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .ze-label {
        font-size: 11px;
        font-weight: 500;
        color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.6));
        margin-left: 2px;
    }

    .ze-switcher {
        display: flex;
        align-items: stretch;
        gap: 2px;
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.2));
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.06));
        border-radius: 8px;
        padding: 2px;
        box-shadow: var(--nb-shadow-inset, inset 0 2px 4px rgba(0,0,0,0.1));
    }

    .ze-btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.5));
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .ze-btn-icon:hover {
        background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.1));
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 1));
    }
    
    .ze-btn-icon:active {
        transform: scale(0.92);
        background: var(--nb-bg-surface-active, hsla(0, 0%, 100%, 0.15));
    }

    .ze-t-display {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s ease;
        position: relative;
        overflow: hidden;
    }

    .ze-t-display:hover {
        background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.08));
    }
    
    .ze-t-display:active {
        transform: scale(0.97);
    }

    .ze-t-text {
        position: absolute;
        width: 100%;
        text-align: center;
    }

    .ze-input-wrapper {
        display: flex;
        align-items: center;
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.2));
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.06));
        border-radius: 8px;
        padding: 0 10px;
        box-shadow: var(--nb-shadow-inset, inset 0 2px 4px rgba(0,0,0,0.1));
        transition: all 0.2s ease;
    }

    .ze-input-wrapper:focus-within {
        border-color: var(--nb-border-focus, hsla(0, 0%, 100%, 0.2));
        box-shadow: var(--nb-shadow-inset, inset 0 2px 4px rgba(0,0,0,0.1)), var(--nb-shadow-glow, 0 0 0 2px hsla(0, 0%, 100%, 0.05));
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.3));
    }

    .ze-input {
        flex: 1;
        background: transparent;
        border: none;
        color: var(--nb-text-primary, #eee);
        font-size: 13px;
        font-weight: 500;
        font-family: inherit;
        outline: none;
        padding: 8px 0;
        width: 100%;
        min-width: 0;
        -moz-appearance: textfield;
    }
    
    .ze-input::-webkit-outer-spin-button,
    .ze-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .ze-input-suffix {
        font-size: 11px;
        font-weight: 600;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        pointer-events: none;
        margin-left: 8px;
    }
</style>