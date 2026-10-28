<script>
  import Prose from '../../../../site/docs/Prose.svelte';
  import Badge from '../../../../site/docs/Badge.svelte';
  import CodeBlock from '../../../../site/docs/CodeBlock.svelte';
  import ParamTable from '../../../../site/api/ParamTable.svelte';

  let { data } = $props();
</script>

<header class="head">
  <span class="crumb"><a href="/api">API</a> / <a href="/api/root/Nabu#m-internals">Nabu</a></span>
  <h1>nabu.internals</h1>
  <div class="badges">
    <Badge tone="unstable">Stability: unstable</Badge>
  </div>
</header>

<section id="warning" class="warning" role="note" aria-labelledby="warning-title">
  <h2 id="warning-title">Unstable: may change in any minor version</h2>
  <p>
    Nothing reached through <code class="doc-code">nabu.internals</code> is a promise. A key, its type or its behaviour can change, move
    or disappear in <strong>any minor version</strong>. The door itself (the getter) is part of the stable contract; what is behind it is not.
  </p>
  <p>Prefer the stable members of <a href="/api/root/Nabu"><code class="doc-code">Nabu</code></a>, <a href="/api/extend/Block"><code class="doc-code">Block</code></a> and the other classes of the contract. If you must use this, pin the version of the package.</p>
  <p class="guide">Related guide: <a href="/docs/guides/extensions">Extensions: Stability &rarr;</a></p>
</section>

<h2 id="access">Access</h2>
<CodeBlock html={data.signatureHtml} />
<Prose html={data.description} />

<h2 id="keys">Keys <span class="count">{data.keys.length}</span></h2>
<p class="sub">
  The set of keys is pinned by a test, so a change always shows in the changelog. Types: see
  <a href="/api/{data.typeId}"><code class="doc-code">NabuInternals</code></a>.
</p>
<ParamTable rows={data.keys} caption="Keys of nabu.internals" nameLabel="Key" anchors />

<style>
  .head { display: flex; flex-direction: column; gap: var(--site-space-3); }
  .crumb { font-size: 13px; color: var(--site-text-subtle); }
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
  .warning {
    padding: 18px 20px;
    border: 1px solid var(--site-accent);
    border-radius: var(--site-radius-card-sm);
    background: var(--site-note-bg);
    font-size: var(--site-fs-small);
    line-height: 1.6;
    scroll-margin-top: var(--site-space-4);
  }
  .warning h2 { margin: 0 0 var(--site-space-2); font-size: 20px; color: var(--site-accent); }
  .warning p { margin: 0 0 var(--site-space-2); }
  .warning p:last-child { margin: 0; }
  .warning a { color: var(--site-accent); }
  h2 {
    margin: 14px 0 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 26px;
    letter-spacing: var(--site-ls-h3);
    scroll-margin-top: var(--site-space-4);
  }
  .count { color: var(--site-text-subtle); font: 500 14px var(--site-font-mono); }
  .sub { margin: 0; color: var(--site-text-muted); font-size: var(--site-fs-small); }
  .sub a { color: var(--site-accent); }
</style>
