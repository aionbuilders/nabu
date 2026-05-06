<script>
    import { onMount } from 'svelte';
    import { createEditor } from '$lib/presets.js';
    import { NabuEditor } from '$lib/blocks/index.js';
    import { ZoneExtension } from '$lib/blocks/zone/zone.extension.js';
    import { Zones } from '$lib/blocks/zone/zone.svelte.js';

    /** @type {import('$lib/blocks/nabu.svelte.js').Nabu | null} */
    let engine = $state(null);

    /** @type {import('$lib/blocks/zone/zone.svelte.js').ZoneBlock | null} */
    let zone = $state(null);

    let synopsisInput = $state('');

    // Zones system — réactif dès qu'engine est prêt
    let zones = $derived(engine ? Zones.get(engine) : null);

    onMount(() => {
        engine = createEditor({ extensions: [ZoneExtension] });

        engine.insert('paragraph', { text: 'Paragraph before the first zone.' });

        zone = /** @type {import('$lib/blocks/zone/zone.svelte.js').ZoneBlock} */ (
            engine.insert('zone', { status: 'draft' })
        );
        const zoneId = zone.node.id.toString();
        engine.insert('paragraph', { text: 'First paragraph inside zone A.' }, zoneId, 0);
        engine.insert('paragraph', { text: 'Second paragraph inside zone A.' }, zoneId, 1);
        engine.insert('paragraph', { text: 'Third paragraph inside zone A.' }, zoneId, 2);

        engine.insert('paragraph', { text: 'Paragraph between the two zones.' });

        const zoneB = /** @type {import('$lib/blocks/zone/zone.svelte.js').ZoneBlock} */ (
            engine.insert('zone', { status: 'revised' })
        );
        zoneB.title = 'Zone B';
        const zoneBId = zoneB.node.id.toString();
        engine.insert('paragraph', { text: 'First paragraph inside zone B.' }, zoneBId, 0);
        engine.insert('paragraph', { text: 'Second paragraph inside zone B.' }, zoneBId, 1);

        engine.insert('paragraph', { text: 'Paragraph after the last zone.' });

        synopsisInput = zone.synopsisText;
    });

    function setStatus(/** @type {string} */ status) {
        if (!engine || !zone) return;
        engine.exec('zone:setStatus', { zoneId: zone.id, status });
    }

    function applySynopsis() {
        if (!engine || !zone) return;
        engine.exec('zone:setSynopsis', { zoneId: zone.id, text: synopsisInput });
    }

    function setTarget(/** @type {Event} */ e) {
        if (!engine || !zone) return;
        const val = /** @type {HTMLInputElement} */ (e.target).valueAsNumber;
        engine.exec('zone:setWordCountTarget', { zoneId: zone.id, target: isNaN(val) ? null : val });
    }

    function unwrap() {
        if (!engine || !zone) return;
        engine.exec('zone:unwrap', { zoneId: zone.id });
        zone = null;
    }

    function insertZone() {
        if (!engine) return;
        engine.exec('zone:insert');
    }

    function wrapBlock() {
        if (!engine) return;
        engine.exec('zone:wrap');
    }
</script>

<div class="demo">
    <h1>ZoneBlock demo</h1>
    <p class="hint">
        Navigue dans l'éditeur avec le clavier ou la souris — le panel "Zones System" suit le curseur en temps réel.
    </p>

    <div class="layout">
        <div class="editor-col">
            <div class="toolbar">
                <button onclick={insertZone} disabled={!engine}>+ Insérer zone</button>
                <button onclick={wrapBlock} disabled={!engine}>⊞ Wrapper bloc</button>
            </div>
            <div class="editor-wrap">
                {#if engine}
                    <NabuEditor {engine} />
                {/if}
            </div>
        </div>

        <div class="side-col">

            <!-- Zones System panel -->
            {#if zones}
                <div class="panel">
                    <h2>Zones System</h2>

                    <dl>
                        <dt>Total</dt>
                        <dd><strong>{zones.count}</strong> zone{zones.count !== 1 ? 's' : ''}</dd>

                        <dt>Curseur dans</dt>
                        <dd>
                            {#if zones.current}
                                <span class="badge badge--active">
                                    Zone {zones.currentIndex + 1} — {zones.current.title || zones.current.status}
                                </span>
                            {:else}
                                <span class="badge">hors zone</span>
                            {/if}
                        </dd>
                    </dl>

                    <div class="zone-list">
                        {#each zones.all as z, i}
                            <div class="zone-row" class:zone-row--active={zones.current === z}>
                                <span class="zone-num">{i + 1}</span>
                                <span class="zone-label">{z.title || '(sans titre)'}</span>
                                <span class="zone-status zone-status--{z.status}">{z.status}</span>
                                <span class="zone-wc">{z.wordCount} mots</span>
                            </div>
                        {/each}
                        {#if zones.count === 0}
                            <p class="empty">Aucune zone.</p>
                        {/if}
                    </div>

                    <div class="nav-btns">
                        <button onclick={() => zones?.goToPrevious()} disabled={zones.currentIndex <= 0}>
                            ← Précédente
                        </button>
                        <button onclick={() => zones?.goToNext()} disabled={zones.currentIndex >= zones.count - 1 && zones.currentIndex !== -1}>
                            Suivante →
                        </button>
                    </div>

                    <details class="tree-details">
                        <summary>Arbre hiérarchique</summary>
                        <pre class="tree-pre">{JSON.stringify(zones.tree.map(n => ({
                            title: n.zone.title || n.zone.id.slice(0,8),
                            status: n.zone.status,
                            children: n.children.length
                        })), null, 2)}</pre>
                    </details>
                </div>
            {/if}

            <!-- Zone A metadata -->
            {#if zone}
                <div class="panel">
                    <h2>Zone A — métadonnées</h2>

                    <dl>
                        <dt>Status</dt>
                        <dd>{zone.status}</dd>

                        <dt>Title</dt>
                        <dd>{zone.title || '(vide)'}</dd>

                        <dt>Mots</dt>
                        <dd>{zone.wordCount} / {zone.wordCountTarget ?? '∞'}</dd>

                        <dt>Synopsis</dt>
                        <dd>{zone.synopsisText || '(vide)'}</dd>
                    </dl>

                    <div class="actions">
                        <fieldset>
                            <legend>Status</legend>
                            <button onclick={() => setStatus('draft')}   class:active={zone.status === 'draft'}>Draft</button>
                            <button onclick={() => setStatus('revised')} class:active={zone.status === 'revised'}>Revised</button>
                            <button onclick={() => setStatus('done')}    class:active={zone.status === 'done'}>Done</button>
                        </fieldset>

                        <fieldset>
                            <legend>Synopsis</legend>
                            <input bind:value={synopsisInput} placeholder="Write a synopsis…" />
                            <button onclick={applySynopsis}>Apply</button>
                        </fieldset>

                        <fieldset>
                            <legend>Word count target</legend>
                            <input type="number" min="0" value={zone.wordCountTarget ?? ''} oninput={setTarget} placeholder="e.g. 500" />
                        </fieldset>

                        <fieldset>
                            <legend>Destructive</legend>
                            <button class="danger" onclick={unwrap}>Unwrap zone A</button>
                        </fieldset>
                    </div>
                </div>
            {:else}
                <p class="hint">Zone A a été unwrappée.</p>
            {/if}

        </div>
    </div>
</div>

<style>
    .demo {
        max-width: 1100px;
        margin: 2rem auto;
        font-family: system-ui, sans-serif;
        padding: 0 1rem;
    }

    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }

    .hint { color: #666; font-size: 0.875rem; margin-bottom: 1rem; }

    .layout {
        display: grid;
        grid-template-columns: 1fr 320px;
        gap: 1.5rem;
        align-items: start;
    }

    .toolbar {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .editor-wrap {
        border: 1px solid #ddd;
        border-radius: 6px;
        overflow: hidden;
    }

    .side-col { display: flex; flex-direction: column; gap: 1rem; }

    .panel {
        background: #f8f8f8;
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        padding: 1rem 1.25rem;
    }

    .panel h2 { font-size: 0.9rem; font-weight: 700; margin: 0 0 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #444; }

    dl { display: grid; grid-template-columns: 80px 1fr; gap: 0.25rem 0.5rem; margin-bottom: 1rem; }
    dt { font-weight: 600; color: #555; font-size: 0.8rem; align-self: center; }
    dd { margin: 0; font-size: 0.85rem; }

    .badge {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        font-size: 0.75rem;
        background: #e5e7eb;
        color: #555;
    }
    .badge--active { background: #1a1a1a; color: #fff; }

    /* Zone list */
    .zone-list { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.75rem; }

    .zone-row {
        display: grid;
        grid-template-columns: 1.2rem 1fr auto auto;
        align-items: center;
        gap: 0.4rem;
        padding: 0.35rem 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
        background: #fff;
        border: 1px solid #e5e5e5;
        transition: border-color 0.15s;
    }
    .zone-row--active { border-color: #1a1a1a; background: #f0f0f0; }

    .zone-num { color: #aaa; font-variant-numeric: tabular-nums; }
    .zone-label { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .zone-wc { color: #888; font-size: 0.73rem; white-space: nowrap; }

    .zone-status {
        font-size: 0.68rem;
        padding: 0.1rem 0.35rem;
        border-radius: 3px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .zone-status--draft   { background: #f3f4f6; color: #6b7280; }
    .zone-status--revised { background: #fef3c7; color: #92400e; }
    .zone-status--done    { background: #d1fae5; color: #065f46; }

    .empty { font-size: 0.8rem; color: #aaa; margin: 0; }

    .nav-btns { display: flex; gap: 0.5rem; margin-bottom: 0.75rem; }
    .nav-btns button { flex: 1; }

    .tree-details summary { font-size: 0.78rem; color: #666; cursor: pointer; }
    .tree-pre {
        font-size: 0.72rem;
        background: #f0f0f0;
        border-radius: 4px;
        padding: 0.5rem;
        overflow: auto;
        margin-top: 0.5rem;
        max-height: 200px;
    }

    /* Actions */
    .actions { display: flex; flex-direction: column; gap: 0.5rem; }

    fieldset {
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 0.4rem 0.6rem;
        display: flex;
        align-items: center;
        gap: 0.4rem;
        flex-wrap: wrap;
    }

    legend { font-size: 0.72rem; font-weight: 600; color: #555; padding: 0 0.25rem; }

    button {
        padding: 0.28rem 0.65rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        font-size: 0.8rem;
    }
    button:hover:not(:disabled) { background: #f0f0f0; }
    button:disabled { opacity: 0.4; cursor: default; }
    button.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
    button.danger { color: #dc2626; border-color: #dc2626; }
    button.danger:hover { background: #fef2f2; }

    input {
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 0.28rem 0.5rem;
        font-size: 0.8rem;
        flex: 1;
        min-width: 0;
    }
</style>
