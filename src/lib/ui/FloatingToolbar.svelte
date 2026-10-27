<script>
    import { clipBounds, isOutside, placeAround } from './anchor.js';

    /**
     * Floating mark toolbar. Appears above the current (non-collapsed) selection.
     * Positioned with `position: fixed` in viewport coordinates, so it works
     * inside any layout (scrollable containers, overflow: hidden ancestors…)
     * without a positioning wrapper.
     *
     * Placement (see `anchor.js`): centred above the selection; flipped BELOW it when there is no room above, measured against
     * the part of the viewport where the selection is visible (the viewport intersected with its scroll containers, so a
     * selection at the top edge of a scroll container gets the toolbar below it); clamped horizontally inside the viewport
     * (and the container); repositioned on scroll (window or any scrollable ancestor) and resize; hidden while the selection
     * is entirely scrolled out of view.
     *
     * A host with a sticky / fixed header over the top of the viewport (outside any scroll container) can reserve room for it
     * with the CSS custom property `--nb-toolbar-inset-top` (a length in px, set on the toolbar or any ancestor, e.g.
     * `--nb-toolbar-inset-top: 56px`): the toolbar never goes above that line, and a selection hidden under it hides the toolbar.
     *
     * @type {{ engine: import('../blocks/nabu.svelte.js').Nabu }}
     */
    let { engine } = $props();

    /** @type {HTMLElement | null} */
    let toolbarEl = $state(null);
    let visible = $state(false);
    /** A drag is in progress (dragging the selected text, a file…): the toolbar steps aside, it would sit over the drop targets. */
    let dragging = $state(false);
    let position = $state({ top: 0, left: 0 });
    let lastTop = 0;
    let lastLeft = 0;

    /** Recompute visibility + placement from the current selection (viewport coordinates; no reactive state is read). */
    function update() {
        const sel = engine.selection;
        if (!sel || sel.isCollapsed) { visible = false; return; }
        // Position above the selection via Range.getBoundingClientRect()
        const range = sel.firstRange;
        if (!range) { visible = false; return; }
        const rect = range.getBoundingClientRect();
        // Collapsed-looking rect (e.g. selection cleared mid-update) → hide
        if (rect.width === 0 && rect.height === 0) { visible = false; return; }
        const inset = toolbarEl ? parseFloat(getComputedStyle(toolbarEl).getPropertyValue('--nb-toolbar-inset-top')) : 0;
        const bounds = clipBounds(range.commonAncestorContainer, { topInset: Number.isFinite(inset) ? inset : 0 });
        // scrolled out of its container / off the viewport: nothing to point at
        if (isOutside(rect, bounds)) { visible = false; return; }
        visible = true;
        if (!toolbarEl) return; // placed once mounted (this effect re-runs on `toolbarEl`)
        const { top, left } = placeAround(rect, toolbarEl, bounds);
        if (top !== lastTop || left !== lastLeft) { lastTop = top; lastLeft = left; position = { top, left }; }
    }

    $effect(() => {
        toolbarEl; // re-place once the element is mounted (its size is needed)
        update();
    });

    // The toolbar is fixed: follow the selection when the window or any scroll container scrolls, and on resize.
    $effect(() => {
        if (!visible) return;
        /** @param {Event} e */
        const onScroll = (e) => { if (!toolbarEl || !(e.target instanceof Node) || !toolbarEl.contains(e.target)) update(); };
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', update);
        return () => {
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', update);
        };
    });

    /** The drop is handled after this listener (capture phase): the toolbar comes back only once it is done, else it would cover the drop point. */
    function endDrag() {
        setTimeout(() => { dragging = false; update(); }, 0);
    }

    const marks = [
        { key: 'bold',          label: 'B',  name: 'Bold',          title: 'Bold (Ctrl+B)' },
        { key: 'italic',        label: 'I',  name: 'Italic',        title: 'Italic (Ctrl+I)' },
        { key: 'underline',     label: 'U',  name: 'Underline',     title: 'Underline (Ctrl+U)' },
        { key: 'code',          label: '<>', name: 'Code',          title: 'Code (Ctrl+E)' },
        { key: 'strikethrough', label: 'S',  name: 'Strikethrough', title: 'Strikethrough (Ctrl+Shift+X)' },
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

<svelte:window
    ondragstart={() => { dragging = true; }}
    ondragend={() => { dragging = false; update(); }}
    ondropcapture={endDrag}
    onpointerdowncapture={() => { dragging = false; }}
/>

{#if visible && !dragging && !engine.readonly}
<div
    bind:this={toolbarEl}
    class="nabu-toolbar"
    role="toolbar"
    aria-label="Text formatting"
    style="top: {position.top}px; left: {position.left}px;"
    contenteditable="false"
    data-nabu-ui
>
    {#each marks as mark}
        <button
            type="button"
            class="nabu-toolbar-btn"
            class:active={engine.isMarkActive(mark.key)}
            aria-pressed={engine.isMarkActive(mark.key)}
            aria-label={mark.name}
            title={mark.title}
            onmousedown={(e) => { e.preventDefault(); engine.exec('mark:toggle', { mark: mark.key }); }}
        >
            {mark.label}
        </button>
    {/each}
    <button
        type="button"
        class="nabu-toolbar-btn"
        class:active={engine.isMarkActive('link')}
        aria-pressed={engine.isMarkActive('link')}
        aria-label="Link"
        title="Link"
        onmousedown={(e) => { e.preventDefault(); toggleLink(); }}
    >
        <svg class="nabu-toolbar-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6.5 9.5a2.5 2.5 0 0 0 3.54 0l2.46-2.46a2.5 2.5 0 0 0-3.54-3.54l-.7.7"/><path d="M9.5 6.5a2.5 2.5 0 0 0-3.54 0L3.5 8.96a2.5 2.5 0 0 0 3.54 3.54l.7-.7"/></svg>
    </button>
</div>
{/if}

<style>
.nabu-toolbar {
    position: fixed;
    display: flex;
    gap: 2px;
    padding: 4px;
    background: var(--nb-bg-surface, #1a1a1a);
    border: 1px solid var(--nb-border, rgba(255,255,255,0.1));
    border-radius: var(--nb-floating-radius, 8px);
    box-shadow: var(--nb-floating-shadow, 0 4px 16px rgba(0,0,0,0.3));
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
.nabu-toolbar-icon { display: block; margin: 1px 0; pointer-events: none; }
.nabu-toolbar-btn:hover { background: var(--nb-bg-surface-hover, rgba(255,255,255,0.08)); }
.nabu-toolbar-btn.active { background: var(--nb-bg-surface-active, rgba(255,255,255,0.15)); }
</style>
