<script>
    /**
     * Floating mark toolbar. Appears above the current (non-collapsed) selection.
     * Positioned with `position: fixed` in viewport coordinates, so it works
     * inside any layout (scrollable containers, overflow: hidden ancestors…)
     * without a positioning wrapper.
     *
     * @type {{ engine: import('../blocks/nabu.svelte.js').Nabu }}
     */
    let { engine } = $props();

    /** @type {HTMLElement | null} */
    let toolbarEl = $state(null);
    let visible = $state(false);
    let position = $state({ top: 0, left: 0 });

    $effect(() => {
        const sel = engine.selection;
        if (!sel || sel.isCollapsed) {
            visible = false;
            return;
        }
        // Position above the selection via Range.getBoundingClientRect()
        const range = sel.firstRange;
        if (!range) {
            visible = false;
            return;
        }
        const rect = range.getBoundingClientRect();
        // Collapsed-looking rect (e.g. selection cleared mid-update) → hide
        if (rect.width === 0 && rect.height === 0) {
            visible = false;
            return;
        }
        visible = true;
        // Viewport coordinates — the toolbar is position: fixed
        position = {
            top: Math.max(8, rect.top - (toolbarEl?.offsetHeight ?? 40) - 8),
            left: rect.left + rect.width / 2,
        };
    });

    const marks = [
        { key: 'bold',          label: 'B',  title: 'Bold (Ctrl+B)' },
        { key: 'italic',        label: 'I',  title: 'Italic (Ctrl+I)' },
        { key: 'underline',     label: 'U',  title: 'Underline (Ctrl+U)' },
        { key: 'code',          label: '<>', title: 'Code (Ctrl+E)' },
        { key: 'strikethrough', label: 'S',  title: 'Strikethrough (Ctrl+Shift+X)' },
    ];

    function toggleLink() {
        if (engine.isMarkActive('link')) {
            engine.exec('link:remove');
            return;
        }
        const href = window.prompt('Link URL');
        if (href) engine.exec('link:set', { href });
    }
</script>

{#if visible}
<div
    bind:this={toolbarEl}
    class="nabu-toolbar"
    style="top: {position.top}px; left: {position.left}px;"
    contenteditable="false"
    data-nabu-ui
>
    {#each marks as mark}
        <button
            class="nabu-toolbar-btn"
            class:active={engine.isMarkActive(mark.key)}
            title={mark.title}
            onmousedown={(e) => { e.preventDefault(); engine.exec('mark:toggle', { mark: mark.key }); }}
        >
            {mark.label}
        </button>
    {/each}
    <button
        class="nabu-toolbar-btn"
        class:active={engine.isMarkActive('link')}
        title="Link"
        onmousedown={(e) => { e.preventDefault(); toggleLink(); }}
    >
        🔗
    </button>
</div>
{/if}

<style>
.nabu-toolbar {
    position: fixed;
    transform: translateX(-50%);
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--nb-bg-surface, #1a1a1a);
    border: 1px solid var(--nb-border, rgba(255,255,255,0.1));
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    z-index: 100;
    pointer-events: all;
}
.nabu-toolbar-btn {
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--nb-text-primary, rgba(255,255,255,0.85));
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: background 0.1s;
}
.nabu-toolbar-btn:hover { background: var(--nb-bg-surface-hover, rgba(255,255,255,0.08)); }
.nabu-toolbar-btn.active { background: var(--nb-bg-surface-active, rgba(255,255,255,0.15)); }
</style>
