<script>
    /** @type {{ block: import('./zone.svelte.js').ZoneBlock }} */
    let { block } = $props();

    const templates = $derived(block.zones.templates);
    const currentTemplate = $derived(block.template ? templates.get(block.template) : null);

    /** @param {'off' | 'root' | 'parent'} scope */
    function setCounterScope(scope) {
        if (!currentTemplate) return;
        currentTemplate.counter = scope === 'off' ? null : { scope };
    }

    const counterScope = $derived.by(() => {
        const c = currentTemplate?.counter;
        if (!c) return 'off';
        return c.scope;
    });

    // ── Template creation ───────────────────────────────────────────────────
    let creatingTemplate = $state(false);
    let newTemplateName = $state('');
    /** @type {HTMLInputElement | null} */
    let newTemplateInput = $state(null);

    $effect(() => {
        if (creatingTemplate && newTemplateInput) newTemplateInput.focus();
    });

    function createTemplate() {
        const name = newTemplateName.trim();
        if (!name) { creatingTemplate = false; return; }
        const id = name.toLowerCase().replace(/\s+/g, '-');
        templates.new(id, { id, label: name });
        block.template = id;
        creatingTemplate = false;
        newTemplateName = '';
    }

    /** @param {KeyboardEvent} e */
    function onNewTemplateKeydown(e) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); createTemplate(); }
        if (e.key === 'Escape') { creatingTemplate = false; newTemplateName = ''; }
    }
</script>

<div class="ze">

    <!-- ── Template ── -->
    <div class="ze-group">
        <div class="ze-row">
            <span class="ze-key">Template</span>
            {#if creatingTemplate}
                <input
                    bind:this={newTemplateInput}
                    bind:value={newTemplateName}
                    class="ze-input ze-input--flex"
                    placeholder="Nom du template…"
                    onkeydown={onNewTemplateKeydown}
                    onblur={createTemplate}
                    onbeforeinput={(e) => e.stopPropagation()}
                />
            {:else}
                <div class="ze-select-wrap">
                    <select
                        class="ze-select"
                        value={block.template ?? ''}
                        onchange={(e) => { block.template = e.currentTarget.value || null; }}
                    >
                        <option value="">— aucun —</option>
                        {#each templates as [id, tpl] (id)}
                            <option value={id}>{tpl.label}</option>
                        {/each}
                    </select>
                    <button
                        class="ze-icon-btn"
                        onclick={() => creatingTemplate = true}
                        title="Nouveau template"
                    >+</button>
                </div>
            {/if}
        </div>

        {#if currentTemplate}
        <div class="ze-row">
            <span class="ze-key">Nom</span>
            <input
                class="ze-input ze-input--flex"
                value={currentTemplate.label}
                onchange={(e) => { currentTemplate.label = e.currentTarget.value.trim() || currentTemplate.label; }}
                onbeforeinput={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
            />
        </div>

        <div class="ze-row">
            <span class="ze-key">Compteur</span>
            <div class="ze-pills">
                {#each [['off', 'Aucun'], ['root', 'Global'], ['parent', 'Parent']] as [value, label] (value)}
                    <button
                        class="ze-pill"
                        class:active={counterScope === value}
                        onclick={() => setCounterScope(/** @type {any} */ (value))}
                    >{label}</button>
                {/each}
            </div>
        </div>

        {#if block.count > 0}
        <div class="ze-row ze-row--meta">
            <span class="ze-key"></span>
            <span class="ze-meta">Position actuelle : <strong>{block.count}</strong></span>
        </div>
        {/if}
        {/if}
    </div>

    <div class="ze-sep"></div>

    <!-- ── Statut ── -->
    <div class="ze-group">
        <div class="ze-row">
            <span class="ze-key">Statut</span>
            <div class="ze-pills">
                <button
                    class="ze-pill ze-pill--draft"
                    class:active={block.status === 'draft'}
                    onclick={() => { block.status = 'draft'; }}
                >Draft</button>
                <button
                    class="ze-pill ze-pill--revised"
                    class:active={block.status === 'revised'}
                    onclick={() => { block.status = 'revised'; }}
                >Révisé</button>
                <button
                    class="ze-pill ze-pill--done"
                    class:active={block.status === 'done'}
                    onclick={() => { block.status = 'done'; }}
                >Terminé</button>
            </div>
        </div>
    </div>

    <div class="ze-sep"></div>

    <!-- ── Objectif ── -->
    <div class="ze-group">
        <div class="ze-row">
            <span class="ze-key">Objectif</span>
            <div class="ze-number-row">
                <input
                    type="number"
                    class="ze-input ze-input--number"
                    min="0"
                    placeholder="—"
                    value={block.wordCountTarget ?? ''}
                    oninput={(e) => {
                        const v = parseInt(e.currentTarget.value);
                        block.wordCountTarget = isNaN(v) ? null : v;
                    }}
                    onbeforeinput={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                />
                <span class="ze-unit">mots</span>
            </div>
        </div>
    </div>

    <div class="ze-sep"></div>

    <!-- ── Synopsis ── -->
    <div class="ze-group">
        <span class="ze-key ze-key--block">Synopsis</span>
        <textarea
            class="ze-synopsis"
            placeholder="Résumé de la zone…"
            value={block.synopsisText}
            oninput={(e) => block.setSynopsis(e.currentTarget.value)}
            onbeforeinput={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        ></textarea>
    </div>

</div>

<style>
    .ze {
        display: flex;
        flex-direction: column;
        min-width: 240px;
    }

    /* ── Groups & separators ── */
    .ze-group {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 6px 4px;
    }

    .ze-sep {
        height: 1px;
        background: var(--color-border, rgba(0,0,0,0.07));
        margin: 0 4px;
    }

    /* ── Rows ── */
    .ze-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 26px;
        padding: 0 4px;
        border-radius: 5px;
    }

    .ze-row:hover {
        background: var(--color-bg-secondary, #f7f7f5);
    }

    .ze-row--meta {
        min-height: 18px;
    }
    .ze-row--meta:hover {
        background: transparent;
    }

    /* ── Key labels ── */
    .ze-key {
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-faint, #a0a09c);
        width: 58px;
        flex-shrink: 0;
        user-select: none;
    }

    .ze-key--block {
        width: auto;
        margin-bottom: 4px;
        padding: 0 4px;
    }

    /* ── Select ── */
    .ze-select-wrap {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        min-width: 0;
    }

    .ze-select {
        flex: 1;
        min-width: 0;
        font-size: 11px;
        color: var(--color-text, #1a1a1a);
        background: transparent;
        border: none;
        outline: none;
        cursor: pointer;
        padding: 0;
        appearance: none;
        -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23a0a09c' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 0 center;
        padding-right: 14px;
    }

    /* ── Inputs ── */
    .ze-input {
        font-size: 11px;
        color: var(--color-text, #1a1a1a);
        background: transparent;
        border: none;
        outline: none;
        padding: 0;
        font-family: inherit;
    }

    .ze-input--flex {
        flex: 1;
        min-width: 0;
    }

    .ze-input--number {
        width: 56px;
        text-align: right;
    }

    /* ── Add button ── */
    .ze-icon-btn {
        width: 18px;
        height: 18px;
        border: 1px solid var(--color-border, rgba(0,0,0,0.08));
        border-radius: 4px;
        background: transparent;
        color: var(--color-text-faint, #a0a09c);
        font-size: 14px;
        line-height: 1;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        flex-shrink: 0;
        transition: color 120ms, background 120ms, border-color 120ms;
    }

    .ze-icon-btn:hover {
        color: var(--color-text, #1a1a1a);
        background: var(--color-bg-tertiary, #efefec);
        border-color: var(--color-border, rgba(0,0,0,0.12));
    }

    /* ── Pills ── */
    .ze-pills {
        display: flex;
        gap: 3px;
    }

    .ze-pill {
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.02em;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--color-text-muted, #6b6b67);
        cursor: pointer;
        transition: background 120ms, color 120ms, border-color 120ms;
        user-select: none;
    }

    .ze-pill:hover {
        background: var(--color-bg-tertiary, #efefec);
        color: var(--color-text, #1a1a1a);
    }

    /* Default active (counter) */
    .ze-pill.active {
        background: var(--color-text, #1a1a1a);
        color: var(--color-bg, #fff);
        border-color: var(--color-text, #1a1a1a);
    }

    /* Semantic status pills */
    .ze-pill--draft.active {
        background: var(--color-bg-tertiary, #efefec);
        color: var(--color-text-muted, #6b6b67);
        border-color: var(--color-border, rgba(0,0,0,0.12));
    }

    .ze-pill--revised.active {
        background: rgba(217, 119, 6, 0.1);
        color: #b45309;
        border-color: rgba(217, 119, 6, 0.25);
    }

    .ze-pill--done.active {
        background: rgba(22, 163, 74, 0.1);
        color: #15803d;
        border-color: rgba(22, 163, 74, 0.25);
    }

    /* ── Number row ── */
    .ze-number-row {
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .ze-unit {
        font-size: 10px;
        color: var(--color-text-faint, #a0a09c);
        user-select: none;
    }

    /* ── Meta ── */
    .ze-meta {
        font-size: 10px;
        color: var(--color-text-faint, #a0a09c);
    }

    .ze-meta strong {
        color: var(--color-text-muted, #6b6b67);
        font-weight: 500;
    }

    /* ── Synopsis ── */
    .ze-synopsis {
        font-size: 11px;
        line-height: 1.5;
        color: var(--color-text, #1a1a1a);
        background: var(--color-bg-secondary, #f7f7f5);
        border: 1px solid transparent;
        border-radius: 5px;
        padding: 6px 8px;
        resize: vertical;
        min-height: 60px;
        outline: none;
        font-family: inherit;
        width: 100%;
        box-sizing: border-box;
        transition: border-color 120ms;
    }

    .ze-synopsis:focus {
        border-color: var(--color-border, rgba(0,0,0,0.12));
    }

    .ze-synopsis::placeholder {
        color: var(--color-text-faint, #a0a09c);
    }
</style>
