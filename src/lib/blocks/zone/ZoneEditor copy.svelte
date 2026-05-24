<script>
    import { getMenuContext } from '../../overlays/context/context.svelte.js';
    import ZoneTemplatesList from './ZoneTemplatesList.svelte';

    /** @type {{ block: import('./zone.svelte.js').ZoneBlock }} */
    let { block } = $props();

    const context = getMenuContext();
    const templates = $derived(block.zones.templates);
    const template = $derived(block.template ? templates.get(block.template) : null);

    function openTemplatesList() {
        context.push({
            id: 'zone-templates',
            title: 'Templates',
            sections: [{ key: 'templates-list', component: ZoneTemplatesList, props: { block } }],
        });
    }
</script>

<div class="ze">
    <span class="ze-label">Template</span>
    <div class="ze-pill">
        <button class="ze-pill-main" onclick={openTemplatesList}>
            {#if template}
                <span class="ze-pill-name">
                    <span class="ze-pill-id">:::{template.id}</span>
                    <span class="ze-pill-label">{template.label}</span>
                </span>
            {:else}
                <span class="ze-pill-empty">No template</span>
            {/if}
        </button>
        <button class="ze-pill-switch" aria-label="Switch template" onclick={openTemplatesList}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M9 6l6 6l-6 6"/>
            </svg>
        </button>
    </div>
</div>

<style>
    .ze {
        padding: 3px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .ze-label {
        font-size: 11px;
        font-weight: 500;
        color: hsla(0, 0%, 100%, 0.3);
        margin-left: 3px;
        display: block;
    }

    .ze-pill {
        display: flex;
        align-items: stretch;
        background: hsla(0, 0%, 100%, 0.05);
        border-radius: 5px;
        overflow: hidden;
        transition: background 0.1s;

        &:hover { background: hsla(0, 0%, 100%, 0.08); }
    }

    .ze-pill-main {
        display: flex;
        align-items: center;
        flex: 1;
        padding: 5px 7px;
        border: none;
        background: transparent;
        cursor: pointer;
        text-align: left;
    }

    .ze-pill-name {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .ze-pill-id {
        font-size: 10px;
        color: #555;
    }

    .ze-pill-label {
        font-size: 13px;
        font-weight: 500;
        color: #eee;
    }

    .ze-pill-empty {
        font-size: 13px;
        font-style: italic;
        color: #444;
    }

    .ze-pill-switch {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        flex-shrink: 0;
        border: none;
        background: transparent;
        color: #555;
        cursor: pointer;
        border-left: 1px solid hsla(0, 0%, 100%, 0.06);
        transition: color 0.1s, background 0.1s;
        &:hover { color: #9ca3af; background: hsla(0, 0%, 100%, 0.05); }
    }
</style>
