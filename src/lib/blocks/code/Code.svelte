<script>
    /** @type {{ block: import('./code.svelte.js').CodeBlock }} */
    let { block } = $props();
    const LANGS = ['plaintext', 'javascript', 'typescript', 'html', 'css', 'json', 'python', 'rust', 'bash', 'markdown', 'sql', 'go'];
</script>

<div class="nabu-code-wrapper">
    <select
        class="nabu-code-lang"
        data-nabu-ui
        contenteditable="false"
        value={block.language ?? 'plaintext'}
        onchange={(e) => block.setLanguage(e.currentTarget.value === 'plaintext' ? null : e.currentTarget.value)}
    >
        {#each LANGS as lang}<option value={lang}>{lang}</option>{/each}
    </select>
    <pre
        bind:this={block.element}
        data-block-id={block.id}
        data-block-type="code"
        data-placeholder={block.placeholder}
        class="nabu-code"
        class:debug={block.nabu.debugging}
        class:selected={block.selected}
    ><code>{block.text || '\n'}</code></pre>
</div>

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
