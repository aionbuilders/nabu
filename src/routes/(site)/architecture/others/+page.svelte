<script>
  import '../../../../site/architecture/arch.css';
  import { GITHUB_ISSUES_URL } from '../../../../site/architecture/data.js';
  import { githubBlob } from '../../../../site/architecture/adr.js';
  import {
    AHEAD, CELLS, COMPARISON_CHECKED, COMPARISON_LEAD, COMPARISON_NOTES, COMPARISON_TITLE, DIFFERENT, EDITORS, OPTIONS, ROWS, SVEDIT_DEPTH, WHICH, WHICH_MORE,
  } from '../../../../site/architecture/comparison.js';

  let all = $state(false);
  const shown = $derived(all ? EDITORS.length : EDITORS.filter((e) => !e.extra).length);
</script>

{#snippet cell(/** @type {import('../../../../site/architecture/comparison.js').Cell} */ c)}
  {#if c.url}
    <a class="src" class:unverified={c.unverified} href={c.url} rel="noopener" title={c.unverified ? `unverified: ${c.note ?? 'not confirmed'}` : c.note}>{c.text}</a>
  {:else}
    <span class="src unverified" title="unverified: {c.note ?? 'no source found'}">{c.text}</span>
  {/if}
{/snippet}

<div class="container others">
  <div class="top">
    <div class="intro">
      <span class="label eyebrow">ARCHITECTURE · COMPARISON</span>
      <h1>{COMPARISON_TITLE}</h1>
      <p class="lead">{COMPARISON_LEAD}</p>
    </div>
    <aside class="checked" aria-labelledby="checked-title">
      <h2 id="checked-title" class="label">HOW WE CHECKED</h2>
      <p>Every cell links to its source: official docs, repos, npm. Checked on <strong>{COMPARISON_CHECKED}</strong>.</p>
      <p>We ran no benchmark against them, so we claim no speed.</p>
      <p>A dotted underline marks a cell we could not verify. The research notes are in <a href={githubBlob(COMPARISON_NOTES)} rel="noopener">the repository</a>.</p>
      <a class="issue" href={GITHUB_ISSUES_URL} rel="noopener">Something is wrong? Open an issue →</a>
    </aside>
  </div>

  <section aria-labelledby="options-title">
    <h2 id="options-title" class="section">Your real options in Svelte</h2>
    <div class="options">
      {#each OPTIONS as o (o.name)}
        <article class="option" class:nabu={o.nabu} data-testid="option">
          <div class="oname">
            <h3><a href={o.url} rel="noopener">{o.name}</a></h3>
            <span class="tag">{o.tag}</span>
          </div>
          <dl>
            <dt>Engine</dt>
            <dd>{@render cell(o.engine)}</dd>
            <dt>Collab</dt>
            <dd>{@render cell(o.collab)}</dd>
          </dl>
          <p>{o.blurb}</p>
        </article>
      {/each}
    </div>
    <!-- TODO: a separate deep Nabu vs Svedit comparison will come; set SVEDIT_DEPTH.href in comparison.js and this link shows. -->
    {#if SVEDIT_DEPTH.href}
      <a class="depth" href={SVEDIT_DEPTH.href}>{SVEDIT_DEPTH.label}</a>
    {/if}
  </section>

  <div class="lists">
    <section aria-labelledby="different-title">
      <h2 id="different-title" class="section">Where Nabu is different</h2>
      <ul>
        {#each DIFFERENT as d (d.title)}
          <li><span class="mark plus" aria-hidden="true">+</span><span class="item"><strong>{d.title}</strong><span>{d.text}</span></span></li>
        {/each}
      </ul>
    </section>
    <section aria-labelledby="ahead-title">
      <h2 id="ahead-title" class="section">Where the others are clearly ahead</h2>
      <ul>
        {#each AHEAD as d (d.title)}
          <li><span class="mark minus" aria-hidden="true">–</span><span class="item"><strong>{d.title}</strong><span>{d.text}</span></span></li>
        {/each}
      </ul>
    </section>
  </div>

  <section aria-labelledby="side-title">
    <div class="side-head">
      <h2 id="side-title" class="section">Side by side</h2>
      <button type="button" class="toggle" aria-expanded={all} aria-controls="compare" onclick={() => (all = !all)}>
        {all ? `Only ${EDITORS.filter((e) => !e.extra).length} editors` : `All ${EDITORS.length} editors`}
        <span aria-hidden="true">{all ? '▴' : '▾'}</span>
      </button>
    </div>
    <div class="scroller" role="region" aria-label="Side-by-side comparison, scrolls sideways" tabindex="0">
      <table id="compare" class:all data-columns={shown}>
        <thead>
          <tr>
            <td></td>
            {#each EDITORS as e (e.id)}
              <th scope="col" class:extra={e.extra} class:nabu={e.nabu}>{e.name}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each ROWS as row (row.id)}
            <tr>
              <th scope="row">{row.label}</th>
              {#each EDITORS as e (e.id)}
                <td class:extra={e.extra} class:nabu={e.nabu} data-editor={e.id} data-row={row.id}>{@render cell(CELLS[row.id][e.id])}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <section class="which" aria-labelledby="which-title">
    <h2 id="which-title">So, which one?</h2>
    <ul>
      {#each WHICH as w (w.name)}
        <li><span class="who" class:nabu={w.nabu}>{w.name}</span><span>{w.text}</span></li>
      {/each}
    </ul>
    <a class="more" href={WHICH_MORE.href}>{WHICH_MORE.label} →</a>
  </section>
</div>

<style>
  .others {
    display: flex;
    flex-direction: column;
    gap: 40px;
    padding-block: var(--site-space-12) var(--site-space-18);
  }
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: var(--site-space-12);
    align-items: end;
  }
  .intro {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .eyebrow {
    color: var(--site-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: clamp(32px, 6vw, 52px);
    line-height: 1.04;
    letter-spacing: -0.03em;
  }
  .lead {
    max-width: 680px;
    margin: 0;
    color: var(--site-text-muted);
    font-size: 19px;
    line-height: 1.6;
  }
  .checked {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 16px 18px;
    border: 1px solid var(--site-border);
    border-radius: 14px;
    color: var(--site-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .checked h2 {
    margin: 0;
    color: var(--site-text-subtle);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.08em;
  }
  .checked p {
    margin: 0;
  }
  .checked strong {
    color: var(--site-text);
  }
  .checked a {
    color: var(--site-accent);
  }
  .issue {
    margin-top: 2px;
  }

  .section {
    margin: 0 0 16px;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 26px;
    letter-spacing: -0.01em;
  }

  .options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 14px;
  }
  .option {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 18px 20px;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    background: var(--site-surface);
  }
  .option.nabu {
    border-color: var(--site-accent);
  }
  .oname {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .oname h3 {
    margin: 0;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 20px;
    overflow-wrap: anywhere;
  }
  .oname h3 a {
    color: var(--site-text);
    text-decoration: none;
  }
  .oname h3 a:hover {
    color: var(--site-accent);
  }
  .tag {
    color: var(--site-text-subtle);
    font: 400 11px / 1.4 var(--site-font-mono);
  }
  .nabu .tag {
    color: var(--site-accent);
  }
  dl {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 6px 10px;
    margin: 0;
    font-size: 13px;
    line-height: 1.45;
  }
  dt {
    color: var(--site-text-subtle);
  }
  dd {
    margin: 0;
    color: var(--site-text);
    overflow-wrap: anywhere;
  }
  .option p {
    margin: 0;
    padding-top: 10px;
    border-top: 1px solid var(--site-border-subtle);
    color: var(--site-text-muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .depth {
    display: inline-block;
    margin-top: 14px;
    color: var(--site-accent);
    font-size: 14px;
  }

  /* a cell: linked to its source (a hairline underline) or unverified (a dotted amber one, no link) */
  .src {
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid color-mix(in srgb, var(--site-text-subtle) 55%, transparent);
  }
  a.src:hover {
    color: var(--site-accent);
    border-bottom-color: var(--site-accent);
  }
  .src.unverified {
    border-bottom: 0;
    text-decoration: underline dotted var(--arch-warn);
    text-underline-offset: 4px;
    text-decoration-thickness: 1.5px;
    cursor: help;
  }

  .lists {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--site-space-10);
  }
  .lists ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .lists li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 10px;
    padding: 12px 0;
    border-top: 1px solid var(--site-border-subtle);
  }
  .mark {
    font-family: var(--site-font-mono);
  }
  .mark.plus {
    color: var(--arch-ok);
  }
  .mark.minus {
    color: var(--site-accent);
  }
  .item {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .item strong {
    color: var(--site-text);
    font-weight: 600;
    font-size: 15px;
  }
  .item span {
    color: var(--site-text-muted);
    font-size: 14px;
    line-height: 1.5;
  }

  .side-head {
    display: flex;
    flex-wrap: wrap;
    gap: 8px var(--site-space-4);
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .side-head .section {
    margin: 0;
  }
  .toggle {
    min-height: 34px;
    padding: 0 var(--site-space-3);
    border: 1px solid var(--site-border-strong);
    border-radius: var(--site-radius-control);
    background: none;
    color: var(--site-text-muted);
    font: 500 13px var(--site-font-body);
    cursor: pointer;
  }
  .toggle:hover {
    color: var(--site-text);
    border-color: var(--site-text-subtle);
  }
  .scroller {
    overflow-x: auto;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    background: var(--site-surface);
    scrollbar-width: thin;
  }
  .scroller:focus-visible {
    outline-offset: -2px;
  }
  table {
    width: 100%;
    min-width: 760px;
    border-collapse: collapse;
    font-size: 14px;
    line-height: 1.4;
  }
  table.all {
    min-width: 1120px;
  }
  table :is(th, td) {
    padding: 9px 13px;
    border-bottom: 1px solid var(--site-border-subtle);
    text-align: left;
    vertical-align: top;
  }
  tbody tr:last-child :is(th, td) {
    border-bottom: 0;
  }
  thead th {
    color: var(--site-text);
    font-weight: 600;
    white-space: nowrap;
  }
  tbody th {
    position: sticky;
    left: 0;
    z-index: 1;
    background: var(--site-surface);
    color: var(--site-text-subtle);
    font-weight: 400;
    white-space: nowrap;
  }
  thead td {
    position: sticky;
    left: 0;
    background: var(--site-surface);
  }
  td {
    color: var(--site-text);
  }
  table:not(.all) .extra {
    display: none;
  }
  th.nabu {
    color: var(--site-accent);
  }
  td.nabu,
  th.nabu {
    background: color-mix(in srgb, var(--site-accent) 7%, var(--site-surface));
  }

  .which {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 24px 26px;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    background: var(--site-surface);
  }
  .which h2 {
    margin: 0 0 4px;
    font-family: var(--site-font-display);
    font-weight: 700;
    font-size: 22px;
  }
  .which ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .which li {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    align-items: baseline;
    color: var(--site-text);
    font-size: 16px;
    line-height: 1.55;
  }
  .who {
    font-family: var(--site-font-display);
    font-weight: 700;
  }
  .who.nabu {
    color: var(--site-accent);
  }
  .more {
    align-self: flex-start;
    margin-top: 4px;
    color: var(--site-accent);
    font-weight: 500;
    font-size: 14px;
  }

  @media (max-width: 959.98px) {
    .top {
      grid-template-columns: 1fr;
      gap: var(--site-space-6);
    }
    .lists {
      grid-template-columns: 1fr;
      gap: var(--site-space-8);
    }
  }
  @media (max-width: 639.98px) {
    .others {
      gap: 32px;
      padding-block: var(--site-space-8) var(--site-space-12);
    }
    .which {
      padding: 20px;
    }
  }
</style>
