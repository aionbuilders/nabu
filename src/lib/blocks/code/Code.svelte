<script>
    /** @type {{ block: import('./code.svelte.js').CodeBlock }} */
    let { block } = $props();
    const LANGS = ['plaintext', 'javascript', 'typescript', 'html', 'css', 'json', 'python', 'rust', 'bash', 'markdown', 'sql', 'go'];
    // A language the list does not know (`ts`, `c++`, from a fence, a paste or the API) is listed too: the select shows what the block holds.
    const langs = $derived(block.language && !LANGS.includes(block.language) ? [...LANGS, block.language] : LANGS);

    // A long line scrolls sideways: the browser does not bring a caret the editor places itself (after typing, Enter, Tab…) into view.
    $effect(() => {
        const el = block.element;
        if (!el) return;
        const keepCaretVisible = () => {
            const sel = getSelection();
            if (!sel || !sel.isCollapsed || !sel.anchorNode || !el.contains(sel.anchorNode) || el.scrollWidth <= el.clientWidth) return;
            const range = document.createRange();
            range.setStart(sel.anchorNode, sel.anchorOffset);
            const caret = range.getClientRects()[0];
            if (!caret) return;
            const box = el.getBoundingClientRect();
            const margin = 24;
            if (caret.right > box.right - margin) el.scrollLeft += caret.right - box.right + margin;
            else if (caret.left < box.left + margin) el.scrollLeft -= box.left + margin - caret.left;
        };
        document.addEventListener('selectionchange', keepCaretVisible);
        return () => document.removeEventListener('selectionchange', keepCaretVisible);
    });
    // The select is out of the Tab order (tabindex -1): inside the editor it would catch the Tab of every block above it.
    // Escape then Shift+Tab, in the code, focuses it (CodeBlock#keydown).
</script>

<div class="nabu-code-wrapper"><select
        class="nabu-code-lang"
        data-nabu-ui
        contenteditable="false"
        tabindex="-1"
        value={block.language ?? 'plaintext'}
        disabled={block.nabu.readonly}
        aria-label="Code language"
        onchange={(e) => block.setLanguage(e.currentTarget.value === 'plaintext' ? null : e.currentTarget.value)}
    >
        {#each langs as lang}<option value={lang}>{lang}</option>{/each}
    </select><pre
        bind:this={block.element}
        data-block-id={block.id}
        data-block-type="code"
        spellcheck="false"
        data-placeholder={block.placeholder}
        class="nabu-code"
        class:debug={block.nabu.debugging}
        class:selected={block.selected}
    ><code>{block.text || '\n'}{#if block.text.endsWith('\n')}<br data-nabu-filler>{/if}</code></pre></div>

<style>
    .nabu-code-wrapper {
        position: relative;
        margin: 0.5em 0;
        border-radius: 6px;
        border: 1px solid var(--nb-border, rgba(255, 255, 255, 0.12));
        background: var(--nb-bg-surface-sunken, rgba(0, 0, 0, 0.25));
        overflow: hidden;
    }

    .nabu-code-lang {
        position: absolute;
        top: 0.4em;
        right: 0.5em;
        font-size: 10px;
        font-family: inherit;
        color: var(--nb-text-muted, rgba(255, 255, 255, 0.4));
        background: var(--nb-bg-surface, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--nb-border-subtle, rgba(255, 255, 255, 0.08));
        border-radius: 4px;
        padding: 1px 4px;
        cursor: pointer;
        user-select: none;
        outline: none;
        z-index: 1;
    }

    .nabu-code-lang:focus {
        border-color: var(--nb-border, rgba(255, 255, 255, 0.2));
    }

    .nabu-code {
        display: block;
        white-space: pre;
        font-family: var(--nb-font-mono, 'Menlo', 'Monaco', 'Consolas', monospace);
        font-size: 0.85em;
        line-height: 1.6;
        padding: 0.75em 1em;
        margin: 0;
        /* The library's inline-code rule (`.nabu-code`, RichText) also matches this <pre>: its tint is not wanted here. */
        background: none;
        border-radius: 0;
        overflow-x: auto;
        color: var(--nb-text-primary, rgba(255, 255, 255, 0.85));
        outline: none;
        min-height: 1.6em;
    }

    .nabu-code.debug.selected {
        background-color: rgba(59, 130, 246, 0.1);
    }

    .nabu-code code {
        font-family: inherit;
        font-size: inherit;
        background: none;
        padding: 0;
        white-space: inherit;
    }
</style>
