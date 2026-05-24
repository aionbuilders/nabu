<script>
    import { formatTemplateLabel } from './zone.svelte.js';

    /** @type {{ template: import('./zone.svelte.js').Template }} */
    let { template } = $props();

    let labelDraft = $state(template.label);
    /** @type {HTMLInputElement} */
    let inputEl;

    function commitLabel() {
        const trimmed = labelDraft.trim();
        if (trimmed && trimmed !== template.label) {
            template.label = trimmed;
        } else {
            labelDraft = template.label;
        }
    }

    /** @param {KeyboardEvent} e */
    function onLabelKeydown(e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitLabel(); }
        if (e.key === 'Escape') { labelDraft = template.label; }
    }

    /** @param {string} tag */
    function insertTag(tag) {
        if (!inputEl) return;
        const start = inputEl.selectionStart || labelDraft.length;
        const end = inputEl.selectionEnd || labelDraft.length;
        const before = labelDraft.substring(0, start);
        const after = labelDraft.substring(end);
        
        labelDraft = before + tag + after;
        
        // Restore focus and cursor position
        setTimeout(() => {
            inputEl.focus();
            inputEl.setSelectionRange(start + tag.length, start + tag.length);
            commitLabel();
        }, 0);
    }

    /** @param {'none'|'parent'|'root'} scope */
    function setCounter(scope) {
        if (scope === 'none') template.counter = null;
        else template.counter = { scope };
    }
</script>

<div class="te">
    <div class="te-head">
        <span class="te-title">Template Format</span>
        <span class="te-id">:::{template.id}</span>
    </div>

    <div class="te-body">
        <!-- Display Format Field with Smart Tags -->
        <div class="te-field">
            <input
                bind:this={inputEl}
                class="te-input"
                bind:value={labelDraft}
                onblur={commitLabel}
                onkeydown={onLabelKeydown}
                onbeforeinput={(e) => e.stopPropagation()}
                placeholder={'e.g. Chapter {{I}} - {{title}}'}
            />
            
            <div class="te-tags">
                <button class="te-tag" aria-label="Decimal Index" onclick={() => insertTag('{{1}}')}>1, 2</button>
                <button class="te-tag" aria-label="Roman Uppercase" onclick={() => insertTag('{{I}}')}>I, II</button>
                <button class="te-tag" aria-label="Alpha Uppercase" onclick={() => insertTag('{{A}}')}>A, B</button>
                <button class="te-tag" aria-label="Zone Title" onclick={() => insertTag('{{title}}')}>title</button>
            </div>

            <!-- Live Preview -->
            <div class="te-preview">
                <span class="te-preview-label">Live Preview</span>
                <div class="te-preview-list">
                    <span class="te-preview-item">{formatTemplateLabel(labelDraft, 1, 'Introduction')}</span>
                    <span class="te-preview-item te-preview-dim">{formatTemplateLabel(labelDraft, 2, 'Methods')}</span>
                </div>
            </div>
        </div>

        <!-- Numbering Scope -->
        <div class="te-field">
            <span class="te-label">Numbering Rules</span>
            <div class="te-segmented">
                <button 
                    class="te-seg-btn" 
                    class:active={template.counter == null} 
                    onclick={() => setCounter('none')}>
                    None
                </button>
                <button 
                    class="te-seg-btn" 
                    class:active={template.counter?.scope === 'parent'} 
                    onclick={() => setCounter('parent')}>
                    Parent
                </button>
                <button 
                    class="te-seg-btn" 
                    class:active={template.counter?.scope === 'root'} 
                    onclick={() => setCounter('root')}>
                    Global
                </button>
            </div>
            <span class="te-hint">
                {#if template.counter == null}
                    This template will not increment a counter.
                {:else if template.counter.scope === 'parent'}
                    Restarts numbering inside each parent zone.
                {:else}
                    Continuous numbering across the entire document.
                {/if}
            </span>
        </div>
    </div>
</div>

<style>
    .te {
        display: flex;
        flex-direction: column;
        padding: 6px;
        gap: 8px;
        background: hsla(0, 0%, 12%, 0.75);
        padding: 4px;
        gap: 12px;
    }

    .te-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 0 4px;
    }

    .te-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
    }

    .te-id {
        font-size: 10px;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.3));
        font-family: ui-monospace, monospace;
    }

    .te-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 8px;
        background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.02));
        border-radius: 12px;
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.03));
    }

    .te-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .te-label {
        font-size: 11px;
        font-weight: 500;
        color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.6));
        margin-left: 2px;
    }

    .te-hint {
        font-size: 10px;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        margin-left: 2px;
        margin-top: 2px;
        font-style: italic;
    }

    .te-input {
        width: 100%;
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.2));
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.05));
        border-radius: 8px;
        padding: 8px 10px;
        color: var(--nb-text-primary, #eee);
        font-size: 13px;
        font-family: inherit;
        outline: none;
        box-shadow: var(--nb-shadow-inset, inset 0 2px 4px rgba(0,0,0,0.1));
        transition: all 0.2s ease;
    }

    .te-input:focus {
        border-color: var(--nb-border-focus, hsla(0, 0%, 100%, 0.2));
        box-shadow: var(--nb-shadow-inset, inset 0 2px 4px rgba(0,0,0,0.1)), var(--nb-shadow-glow, 0 0 0 2px hsla(0, 0%, 100%, 0.05));
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.3));
    }

    .te-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 2px;
    }

    .te-tag {
        background: var(--nb-bg-surface-hover, hsla(0, 0%, 100%, 0.05));
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.05));
        border-radius: 6px;
        padding: 4px 8px;
        color: var(--nb-text-secondary, hsla(0, 0%, 100%, 0.6));
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.1s ease;
    }

    .te-tag:hover {
        background: var(--nb-bg-surface-active, hsla(0, 0%, 100%, 0.1));
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        border-color: var(--nb-border, hsla(0, 0%, 100%, 0.15));
    }
    
    .te-tag:active {
        transform: scale(0.95);
    }

    .te-preview {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 6px;
        padding: 8px 10px;
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.15));
        border-radius: 8px;
        border: 1px dashed var(--nb-border-subtle, hsla(0, 0%, 100%, 0.06));
    }

    .te-preview-label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.3));
    }

    .te-preview-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .te-preview-item {
        font-size: 12px;
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .te-preview-dim {
        opacity: 0.4;
    }

    .te-segmented {
        display: flex;
        background: var(--nb-bg-surface-sunken, hsla(0, 0%, 0%, 0.2));
        border: 1px solid var(--nb-border-subtle, hsla(0, 0%, 100%, 0.05));
        border-radius: 8px;
        padding: 2px;
        box-shadow: var(--nb-shadow-inset, inset 0 2px 4px rgba(0,0,0,0.1));
    }

    .te-seg-btn {
        flex: 1;
        padding: 6px 8px;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: var(--nb-text-muted, hsla(0, 0%, 100%, 0.4));
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .te-seg-btn:hover:not(.active) {
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.8));
    }

    .te-seg-btn.active {
        color: var(--nb-text-primary, hsla(0, 0%, 100%, 0.9));
        background: var(--nb-bg-surface-active, hsla(0, 0%, 100%, 0.1));
        box-shadow: 0 2px 4px rgba(0,0,0,0.1), inset 0 1px 0 var(--nb-border-subtle, hsla(0,0%,100%,0.05));
    }
    
    .te-seg-btn:active:not(.active) {
        transform: scale(0.96);
    }
</style>
