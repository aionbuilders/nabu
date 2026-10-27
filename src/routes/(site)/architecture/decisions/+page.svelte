<script>
  import '../../../../site/architecture/arch.css';

  let { data } = $props();
</script>

<div class="index">
  <span class="label eyebrow">ARCHITECTURE · THE RECORD</span>
  <h1>Decision records</h1>
  <p class="lead">
    Every architectural decision of Nabu, written down when it was taken: the context, the decision, its consequences, and its status. A record
    is never rewritten; when a decision is reversed, a new record replaces it and the old one says so. {data.counts.all} records,
    {data.counts.superseded} superseded, {data.counts.proposed} proposed.
  </p>
  <ul class="list">
    {#each data.list as r (r.id)}
      <li>
        <a href={r.href}>
          <span class="num label">{r.id}</span>
          <span class="title">{r.title}</span>
          <span class="status {r.status}">{#if r.status === 'superseded' && r.successor}superseded by {r.successor}{:else}{r.status}{/if}</span>
          <span class="date">{r.date}</span>
        </a>
      </li>
    {/each}
  </ul>
</div>

<style>
  .index {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 760px;
  }
  .eyebrow {
    color: var(--site-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(32px, 6vw, 44px);
    line-height: 1.08;
    letter-spacing: -0.03em;
  }
  .lead {
    margin: 0;
    color: var(--site-text-muted);
    font-size: 17px;
    line-height: 1.65;
  }
  .list {
    margin: var(--site-space-4) 0 0;
    padding: 0;
    list-style: none;
  }
  .list a {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto auto;
    gap: 6px 16px;
    align-items: baseline;
    padding: 12px 4px;
    border-top: 1px solid var(--site-border-subtle);
    color: inherit;
    text-decoration: none;
  }
  li:last-child a {
    border-bottom: 1px solid var(--site-border-subtle);
  }
  .num {
    color: var(--site-text-subtle);
  }
  .title {
    color: var(--site-text);
    font-weight: 500;
  }
  a:hover .title {
    color: var(--site-accent);
  }
  .status {
    font: 500 11px / 1.4 var(--site-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--site-text-subtle);
  }
  .status.superseded {
    color: var(--site-accent);
  }
  .status.proposed {
    color: var(--arch-warn);
  }
  .date {
    color: var(--site-text-subtle);
    font: 400 12px / 1.4 var(--site-font-mono);
  }
  @media (max-width: 639.98px) {
    .list a {
      grid-template-columns: 40px minmax(0, 1fr);
    }
    .status,
    .date {
      grid-column: 2;
    }
  }
</style>
