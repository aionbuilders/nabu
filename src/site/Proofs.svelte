<script>
  import { GITHUB_URL } from './nav.js';

  /** The test suite lives in the repo (`tests/unit`, `tests/e2e`): it is the one proof that is not a page of the site. */
  const TESTS = `${GITHUB_URL}/tree/main/tests`;

  /**
   * The home page's proof strip. The performance claim is deliberately NOT a number: it is a promise measured in frames, and the lab
   * (/labs/performance) is where a visitor checks it on their own machine (the one measure: key to next paint, see measure.js).
   */
  const PROOFS = [
    { big: 'A keystroke on screen within one frame', text: 'even at 10,000 blocks', link: 'Run it yourself →', href: '/labs/performance', id: 'perf' },
    // Backed by the persistence guide and tests/e2e/persistence-audit.spec.ts (reload, tab close, two tabs merged). Modest on purpose:
    // the guide says a crash is NOT covered, so nothing here says "never lose".
    { big: 'Saved as you type', text: 'in IndexedDB, merged across tabs', link: 'Read how it saves →', href: '/docs/guides/persistence-and-sync', id: 'merge' },
    { big: '1', text: 'contenteditable, one model', link: 'Open the X-ray →', href: '#try', id: 'xray' },
    // 2,993 unit + 1,487 end-to-end at the 0.1.0 release, rounded down.
    { big: '4,400+', text: 'tests, IME and a11y included', link: 'Browse the tests →', href: TESTS, id: 'tests' },
  ];
</script>

<ul class="proofs" aria-label="Proofs" data-testid="proofs">
  {#each PROOFS as p (p.id)}
    <li data-testid="proof-{p.id}">
      <strong class:long={p.big.length > 12}>{p.big}</strong>
      <span class="text">{p.text}</span>
      <a href={p.href} target={p.href.startsWith('http') ? '_blank' : undefined} rel={p.href.startsWith('http') ? 'noopener noreferrer' : undefined}>{p.link}</a>
    </li>
  {/each}
</ul>

<style>
  .proofs {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--site-border);
    border-radius: var(--site-radius-panel);
    overflow: hidden;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: var(--site-space-1);
    min-width: 0;
    padding: var(--site-space-5) var(--site-space-6);
    border-top: 1px solid var(--site-border);
  }
  li:first-child { border-top: 0; }
  strong {
    color: var(--site-text);
    font: 500 28px / 1.2 var(--site-font-mono);
    letter-spacing: -0.01em;
  }
  strong.long {
    font: 700 19px / 1.25 var(--site-font-display);
    letter-spacing: -0.01em;
  }
  .text {
    color: var(--site-text-muted);
    font-size: var(--site-fs-small);
    line-height: var(--site-lh-small);
  }
  a {
    margin-top: var(--site-space-1);
    color: var(--site-accent);
    font-size: var(--site-fs-small);
    font-weight: 500;
  }
  @media (min-width: 760px) {
    .proofs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    li:nth-child(2) { border-top: 0; }
    li:nth-child(even) { border-left: 1px solid var(--site-border); }
  }
  @media (min-width: 1100px) {
    .proofs { grid-template-columns: 1.4fr 1fr 1fr 1fr; }
    li { border-top: 0; }
    li:nth-child(n + 2) { border-left: 1px solid var(--site-border); }
  }
</style>
