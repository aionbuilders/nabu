<script>
  import Parts from './Parts.svelte';
  import Prose from '../docs/Prose.svelte';

  /**
   * Parameters, properties or props: name, type, default, description. A table from 640px, stacked cards below (no sideways scroll).
   * @type {{ rows: any[], caption: string, nameLabel?: string, anchors?: boolean }}
   */
  let { rows, caption, nameLabel = 'Name', anchors = false } = $props();

  const hasDefault = $derived(rows.some((r) => r.default !== undefined));
</script>

<table class="params">
  <caption class="sr-only">{caption}</caption>
  <thead>
    <tr>
      <th scope="col">{nameLabel}</th>
      <th scope="col">Type</th>
      {#if hasDefault}<th scope="col">Default</th>{/if}
      <th scope="col">Description</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row (row.name)}
      <tr id={anchors ? `p-${row.name}` : undefined}>
        <td class="name" data-label={nameLabel}>
          <code class="doc-code">{row.rest ? '...' : ''}{row.name}</code>{#if row.optional}<span class="opt">optional</span>{/if}{#if row.readonly}<span class="opt">readonly</span>{/if}
        </td>
        <td class="type" data-label="Type"><code class="doc-code"><Parts parts={row.type} /></code></td>
        {#if hasDefault}
          <td class="default" data-label="Default">{#if row.default !== undefined}<code class="doc-code">{row.default}</code>{:else}<span class="none">n/a</span>{/if}</td>
        {/if}
        <td class="desc" data-label="Description">{#if row.descriptionHtml}<Prose html={row.descriptionHtml} />{:else}<span class="none">n/a</span>{/if}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .params {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--site-fs-small);
    line-height: var(--site-lh-small);
  }
  th {
    padding: 0 var(--site-space-3) var(--site-space-2) 0;
    border-bottom: 1px solid var(--site-border);
    color: var(--site-text-subtle);
    font: 500 var(--site-fs-label) / var(--site-lh-label) var(--site-font-mono);
    letter-spacing: var(--site-ls-label);
    text-align: left;
    text-transform: uppercase;
  }
  td {
    padding: var(--site-space-3) var(--site-space-3) var(--site-space-3) 0;
    border-bottom: 1px solid var(--site-border-subtle);
    vertical-align: top;
    color: var(--site-text-muted);
  }
  .name { white-space: nowrap; }
  .type { max-width: 280px; }
  .type :global(code) { white-space: pre-wrap; }
  .type :global(a) { color: var(--site-accent); text-underline-offset: 3px; }
  .desc :global(.prose p) { margin-bottom: var(--site-space-2); }
  .opt {
    margin-left: 8px;
    color: var(--site-text-subtle);
    font: 500 11px var(--site-font-mono);
  }
  .none { color: var(--site-text-subtle); }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (max-width: 639.98px) {
    .params, tbody, tr, td { display: block; }
    thead { display: none; }
    tr {
      padding: var(--site-space-3) 0;
      border-bottom: 1px solid var(--site-border-subtle);
    }
    td { padding: 2px 0; border: 0; }
    .name { white-space: normal; }
    .type { max-width: none; }
    td[data-label='Type']::before, td[data-label='Default']::before {
      content: attr(data-label) ': ';
      color: var(--site-text-subtle);
      font: 500 11px var(--site-font-mono);
      text-transform: uppercase;
    }
  }
</style>
