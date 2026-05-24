<script>
    import { getMenuContext } from '../../overlays/context';
    import TemplateEditor from './TemplateEditor.svelte';

    /** @type {{ block: import('./zone.svelte.js').ZoneBlock }} */
    let { block } = $props();

    const context = getMenuContext();
    const templates = $derived(block.zones.templates);

    /** @param {string | null} id */
    function assignTemplate(id) {
        block.template = id;
        // On ne ferme plus le menu ! C'est plus agréable de voir le "check" vert apparaître
        // et de voir le layout se mettre à jour en direct en arrière-plan.
    }

    function createTemplate() {
        const n = templates.size + 1;
        const id = `template-${n}`;
        templates.new(id, { id, label: `Template ${n}` });
        block.template = id;
        // Pareil, on garde le menu ouvert. On pourrait même faire un context.push() 
        // vers l'édition de ce nouveau template si on le souhaite plus tard !
    }

    /** @param {import('./zone.svelte.js').Template} template */
    function editTemplate(template) {
        context.push({
            id: `zone-template-edit-${template.id}`,
            title: template.label,
            sections: [{ key: 'template-edit', component: TemplateEditor, props: { template } }],
        });
    }
</script>

<div class="ztl">
    <button class="ztl-item ztl-item--none" onclick={() => assignTemplate(null)}>
        <span class="ztl-none-label">No template</span>
    </button>
    <div class="ztl-sep"></div>
    {#each templates as [id, t]}
        <div class="ztl-row" class:active={block.template === id}>
            <button class="ztl-item" onclick={() => assignTemplate(id)}>
                <span class="ztl-name">
                    <span class="ztl-id">:::{id}</span>
                    <span class="ztl-label">{t.renderLabel(1, 'Untitled')}</span>
                </span>
                {#if block.template === id}
                    <span class="ztl-check">✓</span>
                {/if}
            </button>
            <button class="ztl-edit" aria-label="Edit template" onclick={() => editTemplate(t)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                </svg>
            </button>
        </div>
    {/each}
    <div class="ztl-sep"></div>
    <button class="ztl-item ztl-item--new" onclick={createTemplate}>
        <span class="ztl-new-label">+ New template</span>
    </button>
</div>

<style>
    .ztl {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        background: var(--nb-bg-surface, hsla(0, 0%, 12%, 0.75));
        backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        -webkit-backdrop-filter: var(--nb-glass-blur, blur(24px) saturate(180%));
        border: 1px solid var(--nb-border, hsla(0, 0%, 100%, 0.1));
        border-radius: 16px;
        box-shadow: 
            var(--nb-shadow-lg, 0 16px 32px -12px rgba(0,0,0,0.5)), 
            inset 0 1px 0 var(--nb-border, hsla(0, 0%, 100%, 0.1));
    }

    .ztl-sep {
        height: 1px;
        background: var(--nb-border-subtle, hsla(0, 0%, 100%, 0.08));
        margin: 4px 0;
    }

    .ztl-row {
        display: flex;
        align-items: stretch;
        border-radius: 8px;
        transition: background 0.15s;

        &:hover { background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.06)); }
        &.active { background: var(--nb-bg-surface-active, hsla(0, 0%, 100%, 0.08)); }
    }

    .ztl-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex: 1;
        padding: 8px 10px;
        border: none;
        background: transparent;
        border-radius: 8px;
        cursor: pointer;
        text-align: left;

        .ztl-name {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .ztl-id {
            font-size: 10px;
            font-family: monospace;
            color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        }
        .ztl-label {
            font-size: 13px;
            font-weight: 500;
            color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        }
        .ztl-check {
            font-size: 14px;
            color: var(--nb-success, #10b981);
            flex-shrink: 0;
        }

        &:active {
            transform: scale(0.98);
        }
    }

    .ztl-row .ztl-item:hover { background: transparent; }

    .ztl-edit {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        flex-shrink: 0;
        border: none;
        background: transparent;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        cursor: pointer;
        border-radius: 8px;
        transition: all 0.15s;
        
        &:hover { 
            color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9)); 
            background: var(--nb-bg-surface-active, hsla(0, 0%, 100%, 0.1)); 
        }
        &:active {
            transform: scale(0.92);
        }
    }

    .ztl-item--none {
        padding: 8px 10px;
        border-radius: 8px;
        transition: background 0.15s;
        
        .ztl-none-label {
            font-size: 12px;
            font-style: italic;
            color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.5));
        }
        &:hover { background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.06)); }
        &:hover .ztl-none-label { color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.8)); }
    }

    .ztl-item--new {
        padding: 8px 10px;
        border-radius: 8px;
        transition: background 0.15s;

        .ztl-new-label {
            font-size: 13px;
            font-weight: 500;
            color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.6));
        }
        &:hover { background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.06)); }
        &:hover .ztl-new-label { color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9)); }
    }
</style>
