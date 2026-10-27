<script>
  import '../../../../../site/architecture/arch.css';
  import DocArticle from '../../../../../site/docs/DocArticle.svelte';

  let { data } = $props();
  const r = $derived(data.record);
  const label = $derived(r.status === 'superseded' ? 'Accepted' : r.status === 'proposed' ? 'Proposed' : 'Accepted');
</script>

<div class="record">
  <header class="head">
    <div class="meta">
      <span class="label num">ADR {r.id}</span>
      {#if r.status === 'superseded' && r.successor}
        <a class="pill superseded" href={r.successor.href}>Superseded by ADR {r.successor.id}</a>
      {:else if r.status === 'proposed'}
        <span class="pill proposed">Proposed</span>
      {:else}
        <span class="pill accepted">Accepted</span>
      {/if}
      <span class="date">{label} {r.date}{r.replacedOn ? ` · replaced ${r.replacedOn}` : ''}</span>
      {#each r.supersedes as s (s.id)}
        <span class="date">{'· Supersedes '}<a href={s.href}>ADR {s.id}</a></span>
      {/each}
      {#if r.frenchUrl}
        <a class="date french" href={r.frenchUrl} rel="noopener">French original <span aria-hidden="true">↗</span></a>
      {/if}
    </div>
    <h1>{r.title}</h1>
  </header>

  {#if r.status === 'superseded'}
    <p class="note" data-testid="adr-note">
      <span class="tag label">NOTE</span>
      <span>
        This record is kept as it was written. {r.note}
        {#if r.successor}<a href={r.successor.href}>Read ADR {r.successor.id}</a>{/if}{#if r.story}{' · '}<a href={r.story.href}>{r.story.label}</a>{/if}
      </span>
    </p>
  {:else if r.proposal}
    <p class="note neutral" data-testid="adr-note">
      <span class="tag label">PROPOSED</span>
      <span>{r.proposal}</span>
    </p>
  {/if}

  <div class="arch-record"><DocArticle doc={data.doc} label="ADR {r.id}: {r.title}" /></div>

  <footer class="foot">
    <a class="source" href={r.sourceUrl} rel="noopener">View source on GitHub</a>
    <span class="grow"></span>
    {#if data.prev}<a rel="prev" href={data.prev.href} title={data.prev.title} aria-label="Previous record: ADR {data.prev.id}, {data.prev.title}">← {data.prev.id}</a>{/if}
    {#if data.next}<a rel="next" href={data.next.href} title={data.next.title} aria-label="Next record: ADR {data.next.id}, {data.next.title}">{data.next.id} →</a>{/if}
  </footer>
</div>

<style>
  .record {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 760px;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    align-items: center;
  }
  .num {
    color: var(--site-text-subtle);
    letter-spacing: 0.08em;
  }
  .pill {
    padding: 3px 9px;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-pill);
    font: 500 12px / 1.4 var(--site-font-mono);
    text-decoration: none;
  }
  .pill.accepted {
    border-color: color-mix(in srgb, var(--arch-ok) 55%, transparent);
    color: var(--arch-ok);
  }
  .pill.superseded {
    border-color: var(--site-accent);
    color: var(--site-accent);
  }
  .pill.proposed {
    border-color: color-mix(in srgb, var(--arch-warn) 60%, transparent);
    color: var(--arch-warn);
  }
  a.pill:hover {
    background: color-mix(in srgb, var(--site-accent) 12%, transparent);
  }
  .date {
    color: var(--site-text-subtle);
    font-size: 13px;
  }
  .date a {
    color: inherit;
  }
  .date a:hover {
    color: var(--site-text);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(28px, 5vw, 40px);
    line-height: 1.12;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  .note {
    display: flex;
    gap: 12px;
    align-items: baseline;
    margin: 0;
    padding: 14px 18px;
    border: 1px solid var(--site-note-border);
    border-radius: var(--site-radius-card-sm);
    background: var(--site-note-bg);
    color: var(--site-text);
    font-size: 15px;
    line-height: 1.55;
  }
  .note.neutral {
    border-color: var(--site-border);
    background: var(--site-surface);
  }
  .note .tag {
    flex: none;
    color: var(--site-accent);
  }
  .note.neutral .tag {
    color: var(--arch-warn);
  }
  .note a {
    color: var(--site-accent);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    padding-top: 12px;
    border-top: 1px solid var(--site-border-subtle);
    font-size: 14px;
  }
  .foot a {
    color: var(--site-text-muted);
  }
  .foot a:hover {
    color: var(--site-text);
  }
  .grow {
    flex-grow: 1;
  }
</style>
