<script>
    import { sanitizeUrl } from '../../utils/html.js';
    import { linkAttributes } from '../../utils/links.js';

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

    // Only a link to ANOTHER site opens in a new tab; the origin is read once (not known while rendering on the server: see links.js).
    const origin = typeof location === 'undefined' ? undefined : location.origin;

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
        {@const attrs = linkAttributes(href, origin)}
        <a {href} class="nabu-link {getClasses(op.attributes ?? {})}" target={attrs.target} rel={attrs.rel}>{op.insert}</a>
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
    :global(.nabu-link)          { color: var(--nb-link, #0b57d0); text-decoration: underline; cursor: pointer; } /* fallback 6.4:1 on white (AA text: 4.5:1); the base theme sets --nb-link for both schemes */
    @media (prefers-color-scheme: dark) {
        :global(.nabu-link)      { color: var(--nb-link, #8ab4f8); } /* fallback 7.9:1 on #1e1e1e, 9.9:1 on black */
    }
</style>
