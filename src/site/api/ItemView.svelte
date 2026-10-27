<script>
  import CodeBlock from '../docs/CodeBlock.svelte';
  import Prose from '../docs/Prose.svelte';
  import Badge from '../docs/Badge.svelte';
  import ParamTable from './ParamTable.svelte';
  import Member from './Member.svelte';
  import Parts from './Parts.svelte';

  /**
   * The page of one export. `item` is the model item after server-side rendering (Markdown -> `*Html`, code -> `codeHtml`).
   * @type {{ item: any, specifier: string, importHtml: string, groups: { statics: any[], properties: any[], methods: any[], inherited: any[], inheritedBy: Array<{ owner: string, href: string, members: Array<{ name: string, id: string }> }> } }}
   */
  let { item, specifier, importHtml, groups } = $props();

  const KIND = { function: 'Function', class: 'Class', component: 'Component', constant: 'Constant', type: 'Type' };
</script>

<header class="head">
  <span class="crumb"><a href="/api">API</a> / <a href="/api#entry-{item.entry}">{specifier}</a></span>
  <h1>{item.name}</h1>
  <div class="badges">
    <Badge>{KIND[/** @type {keyof typeof KIND} */ (item.kind)]}</Badge>
    {#if item.stability === 'unstable'}
      <Badge tone="unstable">Stability: unstable</Badge>
    {:else}
      <Badge tone="stable">Stability: stable</Badge>
    {/if}
    {#if item.contract}<Badge>Stable contract</Badge>{/if}
  </div>
  {#if item.summaryHtml}<Prose class="lead" html={item.summaryHtml} />{/if}
  {#if item.reachedThrough}
    <p class="note"><span class="note-label">Note</span> Not exported by name: you reach it through <code class="doc-code">{item.reachedThrough}</code>.</p>
  {/if}
  {#if item.stability === 'unstable'}
    <p class="note warn" role="note"><span class="note-label">Unstable</span> This shape may change in any minor version. See <a href="/api/internals"><code class="doc-code">nabu.internals</code></a>.</p>
  {/if}
  {#if item.deprecated}
    <p class="note warn" role="note"><span class="note-label">Deprecated</span> {#if typeof item.deprecated === 'string'}<Prose tag="span" html={item.deprecatedHtml} />{/if}</p>
  {/if}
  {#if item.guide}
    <p class="guide">Related guide: <a href={item.guide.href}>{item.guide.title} &rarr;</a></p>
  {/if}
</header>

{#if item.descriptionHtml}<Prose html={item.descriptionHtml} />{/if}

{#if item.kind === 'function'}
  <h2 id="signature">Signature</h2>
  <CodeBlock html={importHtml} />
  {#each item.signatures as sig, i (i)}
    <CodeBlock html={sig.codeHtml} />
    {#if i > 0 && sig.summaryHtml}<Prose html={sig.summaryHtml} />{/if}
  {/each}
  {#if item.signatures.some((/** @type {any} */ s) => s.params.length)}
    <h2 id="parameters">Parameters</h2>
    {#each item.signatures as sig, i (i)}
      {#if item.signatures.length > 1}<h3 class="overload">Overload {i + 1}</h3>{/if}
      {#if sig.params.length}<ParamTable rows={sig.params} caption="Parameters of {item.name}" nameLabel="Parameter" />{:else}<p class="empty">No parameters.</p>{/if}
    {/each}
  {/if}
  <h2 id="returns">Returns</h2>
  {#each item.signatures as sig, i (i)}
    <p class="returns"><code class="doc-code"><Parts parts={sig.returnType} /></code></p>
    {#if sig.returnsHtml}<Prose html={sig.returnsHtml} />{/if}
  {/each}
{:else if item.kind === 'class'}
  <h2 id="import">Import</h2>
  <CodeBlock html={importHtml} />
  {#if item.extends}<p class="meta">Extends <code class="doc-code"><Parts parts={item.extends} /></code></p>{/if}
  {#if item.constructors?.length}
    <h2 id="constructor">Constructor</h2>
    {#each item.constructors as sig, i (i)}
      <CodeBlock html={sig.codeHtml} />
      {#if sig.params.length}<ParamTable rows={sig.params} caption="Parameters of the constructor" nameLabel="Parameter" />{/if}
    {/each}
  {/if}
  {#if groups.statics.length}
    <h2 id="static-members">Static members</h2>
    {#each groups.statics as member (member.id)}<Member {member} />{/each}
  {/if}
  {#if groups.properties.length}
    <h2 id="properties">Properties</h2>
    {#each groups.properties as member (member.id)}<Member {member} />{/each}
  {/if}
  {#if groups.methods.length}
    <h2 id="methods">Methods</h2>
    {#each groups.methods as member (member.id)}<Member {member} />{/each}
  {/if}
  {#if groups.inheritedBy.length}
    <h2 id="inherited">Inherited</h2>
    {#each groups.inheritedBy as group (group.owner)}
      <p class="inherited"><span class="label">From {#if group.href}<a href={group.href}>{group.owner}</a>{:else}{group.owner}{/if}</span>
        {#each group.members as m, i (m.id)}{i ? ', ' : ''}{#if group.href}<a href="{group.href}#{m.id}"><code class="doc-code">{m.name}</code></a>{:else}<code class="doc-code">{m.name}</code>{/if}{/each}
      </p>
    {/each}
  {/if}
{:else if item.kind === 'type'}
  <h2 id="definition">Definition</h2>
  <CodeBlock html={importHtml} />
  <CodeBlock html={item.codeHtml} />
  {#if item.combines?.length}
    <p class="meta">Combined with {#each item.combines as c, i}{i ? ', ' : ''}<code class="doc-code"><Parts parts={c} /></code>{/each}</p>
  {/if}
  {#if item.extends?.length}
    <p class="meta">Extends {#each item.extends as c, i}{i ? ', ' : ''}<code class="doc-code"><Parts parts={c} /></code>{/each}</p>
  {/if}
  {#if item.properties?.length}
    <h2 id="properties">Properties</h2>
    <ParamTable rows={item.properties} caption="Properties of {item.name}" nameLabel="Property" anchors />
  {/if}
{:else if item.kind === 'constant'}
  <h2 id="declaration">Declaration</h2>
  <CodeBlock html={importHtml} />
  <CodeBlock html={item.codeHtml} />
  {#if item.properties?.length}
    <h2 id="properties">Properties</h2>
    <ParamTable rows={item.properties} caption="Properties of {item.name}" nameLabel="Property" anchors />
  {/if}
{:else if item.kind === 'component'}
  <h2 id="usage">Usage</h2>
  <CodeBlock html={item.codeHtml} label="Svelte" />
  {#if item.props?.length}
    <h2 id="props">Props</h2>
    <ParamTable rows={item.props} caption="Props of {item.name}" nameLabel="Prop" anchors />
  {/if}
{/if}

{#if item.examplesHtml?.length}
  <h2 id="examples">Examples</h2>
  {#each item.examplesHtml as ex}<Prose html={ex} />{/each}
{/if}

{#if item.seeHtml?.length}
  <p class="meta">See also {#each item.seeHtml as s, i}{i ? ' · ' : ''}<Prose tag="span" html={s} />{/each}</p>
{/if}

{#if item.source}
  <p class="source">Source: <code class="doc-code">{item.source}</code></p>
{/if}

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-3);
  }
  .crumb {
    font-size: 13px;
    color: var(--site-text-subtle);
    overflow-wrap: anywhere;
  }
  .crumb a { color: inherit; text-decoration: none; }
  .crumb a:hover { color: var(--site-text); }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(32px, 6vw, var(--site-fs-h1));
    line-height: var(--site-lh-heading);
    letter-spacing: var(--site-ls-heading);
    overflow-wrap: anywhere;
  }
  .badges { display: flex; flex-wrap: wrap; gap: var(--site-space-2); }
  .head :global(.lead) { font-size: 18px; color: var(--site-text-muted); }
  .note {
    display: flex;
    gap: var(--site-space-3);
    margin: 0;
    padding: 14px 16px;
    border: 1px solid var(--site-note-border);
    border-radius: var(--site-radius-card-sm);
    background: var(--site-note-bg);
    font-size: var(--site-fs-small);
    line-height: 1.6;
  }
  .note-label { color: var(--site-accent); font-weight: 600; }
  .note a { color: var(--site-accent); }
  .guide { margin: 0; font-size: var(--site-fs-small); }
  .guide a { color: var(--site-accent); font-weight: 500; }
  h2 {
    margin: 14px 0 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 26px;
    line-height: var(--site-lh-h3);
    letter-spacing: var(--site-ls-h3);
    scroll-margin-top: var(--site-space-4);
  }
  .overload { margin: 0; font-size: 14px; color: var(--site-text-muted); }
  .meta, .returns, .empty, .source, .inherited { margin: 0; font-size: var(--site-fs-small); color: var(--site-text-muted); }
  .meta :global(a), .returns :global(a), .inherited a { color: var(--site-accent); }
  .source { color: var(--site-text-subtle); }
  .inherited .label { color: var(--site-text-subtle); margin-right: 8px; text-transform: uppercase; }
  .inherited .label a { color: inherit; }
</style>
