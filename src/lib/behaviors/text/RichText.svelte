<script>
    import { sanitizeUrl } from '../../utils/html.js';

    /** @type {{ delta: import('loro-crdt').Delta<string>[] }} */
    let { delta } = $props();

    /** @param {Record<string, any>} attrs */
    function getClasses(attrs) {
        return [
            attrs.bold && 'nabu-bold',
            attrs.italic && 'nabu-italic',
            attrs.underline && 'nabu-underline',
            attrs.code && 'nabu-code',
            attrs.strikethrough && 'nabu-strikethrough',
        ].filter(Boolean).join(' ');
    }

    const segments = $derived(delta.length ? delta : [{ insert: '\n' }]);

    // A trailing "\n" does not open a visible line by itself (white-space: pre-wrap): the new line only exists once something
    // follows the break. A filler <br> after it (ProseMirror's "trailing hack") gives that last, empty line a line box, so the
    // caret sits on it right away. The filler is pure rendering: it holds no text, so offsets / Range.toString / the
    // TreeWalker over text nodes ignore it; it is not in the model nor the clipboard. An EMPTY delta renders a lone "\n"
    // text node instead (one line already) — no filler there.
    const lastInsert = $derived(delta.length ? delta[delta.length - 1].insert : '');
    const needsFiller = $derived(typeof lastInsert === 'string' && lastInsert.endsWith('\n'));
</script>

{#each segments as op}
    {@const link = /** @type {any} */ (op.attributes)?.link}
    {@const href = link ? sanitizeUrl(link, { kind: 'link' }) : null}
    {#if href !== null}
        <a {href} class="nabu-link {getClasses(op.attributes ?? {})}" target="_blank" rel="noopener noreferrer">{op.insert}</a>
    {:else if op.attributes && Object.values(op.attributes).some(Boolean)}
        <span class={getClasses(op.attributes)}>{op.insert}</span>
    {:else}
        {op.insert}
    {/if}
{/each}{#if needsFiller}<br data-nabu-filler>{/if}

<style>
    :global(.nabu-bold)          { font-weight: bold; }
    :global(.nabu-italic)        { font-style: italic; }
    :global(.nabu-underline)     { text-decoration: underline; }
    :global(.nabu-strikethrough) { text-decoration: line-through; }
    :global(.nabu-code)          { font-family: monospace; background: rgba(135, 131, 120, 0.15); border-radius: 3px; padding: 0.1em 0.3em; }
    :global(.nabu-link)          { color: var(--nb-link, #4d9fff); text-decoration: underline; cursor: pointer; }
</style>
