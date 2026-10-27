<script>
  import { page } from '$app/state';

  /**
   * The timeline of the decision records, with the filters (All / Accepted / Superseded / Proposed) and the honest note about ADR 012.
   * The record being read stays in the list whatever the filter says.
   * @type {{
   *   records: Array<{ number: number, id: string, href: string, label: string, status: 'accepted' | 'superseded' | 'proposed' }>,
   *   counts: { all: number, accepted: number, superseded: number, proposed: number },
   *   missing: { text: string, noteLabel: string, noteUrl: string },
   * }}
   */
  let { records, counts, missing } = $props();

  /** @type {'all' | 'accepted' | 'superseded' | 'proposed'} */
  let filter = $state('all');
  const current = $derived(page.url.pathname);

  const FILTERS = /** @type {const} */ ([
    ['all', 'All'],
    ['accepted', 'Accepted'],
    ['superseded', 'Superseded'],
    ['proposed', 'Proposed'],
  ]);
</script>

<nav class="rail" aria-label="Decision records">
  <a class="eyebrow label" href="/architecture/decisions">DECISION RECORDS</a>
  <div class="filters" role="group" aria-label="Filter by status">
    {#each FILTERS as [id, label] (id)}
      <button type="button" class:on={filter === id} aria-pressed={filter === id} data-filter={id} onclick={() => (filter = id)}
        >{id === 'all' ? `${label} ${counts.all}` : label}</button
      >
    {/each}
  </div>
  <ol class="timeline" data-filter={filter}>
    {#each records as r (r.number)}
      {@const here = current === r.href}
      <li data-status={r.status} hidden={filter !== 'all' && filter !== r.status && !here}>
        <a href={r.href} aria-current={here ? 'page' : undefined}>
          <span class="num">{r.id}</span>
          <span class="dot {r.status}" aria-hidden="true"></span>
          <span class="name">{r.label}{#if r.status !== 'accepted'}<span class="tag {r.status}">{r.status}</span>{/if}</span>
        </a>
      </li>
    {/each}
  </ol>
  <p class="missing">{missing.text} <a href={missing.noteUrl}>{missing.noteLabel}</a>.</p>
</nav>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .eyebrow {
    color: var(--site-text-subtle);
    text-decoration: none;
    letter-spacing: 0.08em;
  }
  .eyebrow:hover {
    color: var(--site-text);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .filters button {
    min-height: 26px;
    padding: 3px 10px;
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-pill);
    background: none;
    color: var(--site-text-muted);
    font: 400 12px / 1.4 var(--site-font-body);
    cursor: pointer;
  }
  .filters button:hover {
    color: var(--site-text);
  }
  .filters button.on {
    border-color: var(--site-text);
    background: var(--site-text);
    color: var(--site-bg);
    font-weight: 600;
  }
  .timeline {
    position: relative;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }
  .timeline::before {
    content: '';
    position: absolute;
    top: 14px;
    bottom: 14px;
    left: 59px;
    width: 1px;
    background: var(--site-border);
  }
  .timeline li[hidden] {
    display: none;
  }
  .timeline a {
    position: relative;
    display: grid;
    grid-template-columns: 40px 14px minmax(0, 1fr);
    gap: 12px;
    align-items: center;
    padding: 7px 0;
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.3;
    text-decoration: none;
  }
  .timeline a:hover,
  .timeline a[aria-current='page'] {
    color: var(--site-text);
  }
  .num {
    color: var(--site-text-subtle);
    font: 400 12px / 1.4 var(--site-font-mono);
    text-align: right;
  }
  .dot {
    justify-self: center;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--site-text-subtle) 70%, var(--site-bg));
  }
  .dot.superseded {
    background: var(--site-accent);
  }
  .dot.proposed {
    border: 2px solid var(--arch-warn);
    background: var(--site-bg);
  }
  a[aria-current='page'] .dot {
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--site-accent) 28%, transparent);
  }
  a[aria-current='page'] .dot:not(.superseded):not(.proposed) {
    background: var(--site-accent);
  }
  .tag {
    margin-left: 8px;
    font: 500 10px / 1 var(--site-font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .tag.superseded {
    color: var(--site-accent);
  }
  .tag.proposed {
    color: var(--arch-warn);
  }
  .missing {
    margin: 6px 0 0;
    color: var(--site-text-subtle);
    font-size: 12px;
    line-height: 1.5;
  }
  .missing a {
    color: var(--site-text-muted);
    overflow-wrap: anywhere;
  }
</style>
