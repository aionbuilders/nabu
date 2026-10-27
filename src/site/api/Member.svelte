<script>
  import CodeBlock from '../docs/CodeBlock.svelte';
  import Prose from '../docs/Prose.svelte';
  import Badge from '../docs/Badge.svelte';
  import ParamTable from './ParamTable.svelte';
  import Parts from './Parts.svelte';

  /** A member of a class (property, accessor or method): heading, signature(s), description, parameters, returns. */
  let { member } = $props();

  const sigs = $derived(member.kind === 'method' ? member.signatures : [member]);
</script>

<section class="member" id={member.id} aria-labelledby="{member.id}-h">
  <h3 id="{member.id}-h">
    <a class="anchor" href="#{member.id}"><code>{member.static ? 'static ' : ''}{member.name}{member.kind === 'method' ? '()' : ''}</code></a>
    {#if member.unstable}<Badge tone="unstable">Unstable</Badge>{/if}
    {#if member.readonly}<span class="tag">readonly</span>{/if}
    {#if member.optional}<span class="tag">optional</span>{/if}
  </h3>
  {#each sigs as sig, i (i)}
    <CodeBlock html={sig.codeHtml} />
  {/each}
  {#if member.summaryHtml}<Prose html={member.summaryHtml} />{:else if sigs[0]?.summaryHtml}<Prose html={sigs[0].summaryHtml} />{/if}
  {#if member.descriptionHtml}<Prose html={member.descriptionHtml} />{:else if sigs[0]?.descriptionHtml}<Prose html={sigs[0].descriptionHtml} />{/if}
  {#if member.kind === 'method'}
    {#each member.signatures as sig, i (i)}
      {#if sig.params?.length}<ParamTable rows={sig.params} caption="Parameters of {member.name}" nameLabel="Parameter" />{/if}
      {#if sig.returnsHtml}
        <p class="returns"><span class="label">Returns</span> <code class="doc-code"><Parts parts={sig.returnType} /></code></p>
        <Prose html={sig.returnsHtml} />
      {/if}
    {/each}
  {/if}
  {#each member.examplesHtml ?? [] as ex}<Prose html={ex} />{/each}
</section>

<style>
  .member {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-3);
    padding-block: var(--site-space-6);
    border-top: 1px solid var(--site-border-subtle);
    scroll-margin-top: var(--site-space-4);
  }
  h3 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--site-space-3);
    margin: 0;
    font-size: 17px;
    font-weight: 500;
  }
  .anchor { color: var(--site-text); text-decoration: none; }
  .anchor code { font: 500 16px var(--site-font-mono); background: none; padding: 0; }
  .anchor:hover code { color: var(--site-accent); }
  .tag { color: var(--site-text-subtle); font: 500 12px var(--site-font-mono); }
  .returns { margin: 0; font-size: var(--site-fs-small); color: var(--site-text-muted); }
  .returns .label { color: var(--site-text-subtle); text-transform: uppercase; margin-right: 6px; }
  .returns :global(a) { color: var(--site-accent); }
</style>
