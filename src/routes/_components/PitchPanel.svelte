<script>
  import roadmap from '../../data/roadmap.json';
  import InstallSnippet from './InstallSnippet.svelte';
  import RoadmapSection from './RoadmapSection.svelte';
  import svelteLogo from '../../assets/svelte.png';
  import CodeBlock from './CodeBlock.svelte';

  const version = roadmap.version;

  const githubUrl = 'https://github.com/aionbuilders/nabu';
  const npmUrl    = 'https://www.npmjs.com/package/@aionbuilders/nabu';

  let setupExpanded = $state(false);

  const viteConfigCode = `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [sveltekit(), wasm(), topLevelAwait()],
});`;

  const pillars = [
    {
      label: 'Single ContentEditable',
      description: 'Entire document in one root. Native selection, copy-paste, and consistent IME handling.',
    },
    {
      label: 'Svelte 5 Runes',
      description: '$state and $derived throughout. Only modified blocks re-render — no virtual DOM, no diffing.',
    },
    {
      label: 'Extension Registry',
      description: 'Block types, serializers, actions, and paste interpreters registered declaratively.',
    },
    {
      label: 'Local-first via Loro-CRDT',
      description: 'State lives in a Loro document. Offline editing and conflict-free sync out of the box.',
    },
  ];

  // · = visual placeholder for Space (type this sequence at line start)
  const shortcuts = [
    {
      group: 'Blocks',
      items: [
        { type: 'seq', seq: '#·',   desc: 'Heading 1' },
        { type: 'seq', seq: '##·',  desc: 'Heading 2' },
        { type: 'seq', seq: '###·', desc: 'Heading 3' },
        { type: 'seq', seq: '--·',  desc: 'Dialogue' },
        { type: 'key', keys: ['Tab'],       desc: 'Indent' },
        { type: 'key', keys: ['⇧', 'Tab'], desc: 'Unindent' },
      ],
    },
    {
      group: 'Marks',
      items: [
        { type: 'key', keys: ['Ctrl', 'B'], desc: 'Bold' },
        { type: 'key', keys: ['Ctrl', 'I'], desc: 'Italic' },
        { type: 'key', keys: ['Ctrl', 'E'], desc: 'Code' },
        { type: 'key', keys: ['Ctrl', 'U'], desc: 'Underline' },
        { type: 'key', keys: ['Ctrl', 'Z'], desc: 'Undo' },
        { type: 'key', keys: ['Ctrl', 'Y'], desc: 'Redo' },
      ],
    },
  ];
</script>

<div class="svelte-banner">
  <img src={svelteLogo} alt="Svelte" width="14" height="14" />
  <span>Built exclusively for <strong>Svelte 5</strong></span>
</div>

<div class="panel">
  <header class="header">
    <div class="brand">
      <span class="wordmark">Nabu</span>
      <span class="version-badge">v{version}</span>
      <span class="alpha-pill">alpha</span>
    </div>
    <p class="tagline">
      A modular, local-first block editor engine.<br />
      Single contenteditable. Loro-CRDT.
    </p>
  </header>

  <section class="section">
    <InstallSnippet />
    <div class="setup-block">
      <button
        class="setup-toggle"
        class:expanded={setupExpanded}
        onclick={() => setupExpanded = !setupExpanded}
        aria-expanded={setupExpanded}
      >
        <span class="setup-toggle-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </span>
        <span>Requires <code class="inline-code">vite-plugin-wasm</code></span>
        <span class="setup-toggle-arrow" class:rotated={setupExpanded}>›</span>
      </button>

      <div class="setup-content" class:expanded={setupExpanded} aria-hidden={!setupExpanded}>
        <div class="setup-content-inner">
          <div class="setup-step">
            <span class="step-label">1. Install plugins</span>
            <CodeBlock lang="bash" code="$ npm install -D vite-plugin-wasm vite-plugin-top-level-await" />
          </div>
          <div class="setup-step">
            <span class="step-label">2. Update your config</span>
            <CodeBlock lang="js" filename="vite.config.js" code={viteConfigCode} />
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <h2 class="section-label">Architecture</h2>
    <ul class="pillars">
      {#each pillars as pillar}
        <li class="pillar" class:svelte-pillar={pillar.label === 'Svelte 5 Runes'}>
          <span class="pillar-bullet">·</span>
          <div class="pillar-content">
            <span class="pillar-label">{pillar.label}</span>
            <span class="pillar-desc">
              {#if pillar.label === 'Svelte 5 Runes'}
                <code class="rune">$state</code> and <code class="rune">$derived</code> throughout.
                Only modified blocks re-render — no virtual DOM, no diffing.
              {:else}
                {pillar.description}
              {/if}
            </span>
          </div>
        </li>
      {/each}
    </ul>
  </section>

  <section class="section">
    <h2 class="section-label">Shortcuts</h2>
    <div class="shortcuts-grid">
      {#each shortcuts as group}
        <div class="shortcut-col">
          <span class="col-label">{group.group}</span>
          <ul class="shortcut-list">
            {#each group.items as item}
              <li class="shortcut-row">
                {#if item.type === 'seq'}
                  <code class="seq">{item.seq}</code>
                {:else}
                  <span class="keys">
                    {#each item.keys as key, i}
                      <kbd>{key}</kbd>{#if i < item.keys.length - 1}<span class="key-sep">+</span>{/if}
                    {/each}
                  </span>
                {/if}
                <span class="shortcut-desc">{item.desc}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </section>

  <section class="section">
    <h2 class="section-label">Roadmap</h2>
    <RoadmapSection />
  </section>

  <footer class="footer-banner">
    <a href={githubUrl} target="_blank" rel="noopener noreferrer" class="footer-link">
      <svg class="footer-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12c0-5.523-4.477-10-10-10z"/>
      </svg>
      GitHub
    </a>
    <span class="footer-sep">·</span>
    <a href={npmUrl} target="_blank" rel="noopener noreferrer" class="footer-link npm-link">
      <svg class="footer-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/>
      </svg>
      npm
    </a>
  </footer>
</div>

<style>
  .panel {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-height: 100%;
  }

  .header {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .wordmark {
    font-size: 22px;
    font-weight: 500;
    letter-spacing: -0.035em;
    color: var(--color-text);
    line-height: 1;
  }

  .version-badge {
    font-size: 11px;
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    color: var(--color-text-muted);
    padding: 2px 6px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg-tertiary);
    line-height: 1.5;
  }

  .alpha-pill {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-accent);
    background: var(--color-accent-muted);
    padding: 2px 7px;
    border-radius: 999px;
    line-height: 1.5;
  }

  .svelte-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 8px 24px;
    background: rgba(255, 62, 0, 0.05);
    border-bottom: 1px solid rgba(255, 62, 0, 0.13);
    font-size: 11px;
    color: rgba(255, 62, 0, 0.75);
    flex-shrink: 0;
  }

  .svelte-banner strong {
    font-weight: 600;
    color: #ff3e00;
  }

  .svelte-banner img {
    display: block;
    flex-shrink: 0;
    opacity: 0.9;
  }

  @media (prefers-color-scheme: dark) {
    .svelte-banner {
      background: rgba(255, 62, 0, 0.07);
      border-bottom-color: rgba(255, 62, 0, 0.18);
    }
  }

  .tagline {
    margin: 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--color-text-muted);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-label {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-text-faint);
  }

  .pillars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }

  .pillar {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .pillar-bullet {
    color: var(--color-text-faint);
    font-size: 18px;
    line-height: 1.2;
    flex-shrink: 0;
    margin-top: -1px;
    user-select: none;
  }

  .pillar-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .pillar-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text);
    line-height: 1.4;
  }

  .pillar-desc {
    font-size: 11px;
    color: var(--color-text-muted);
    line-height: 1.55;
  }

  .rune {
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    font-size: 10.5px;
    color: #ff3e00;
    background: rgba(255, 62, 0, 0.08);
    border-radius: 3px;
    padding: 0 3px;
  }

  @media (prefers-color-scheme: dark) {
    .rune {
      background: rgba(255, 62, 0, 0.12);
    }
  }

  /* ── Shortcuts ──────────────────────────────────────── */

  .shortcuts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
    align-items: start;
  }

  .shortcut-col {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .col-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-faint);
  }

  .shortcut-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  /* Sequence badge — "type this at line start" */
  .seq {
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    font-size: 10px;
    color: var(--color-accent);
    background: var(--color-accent-muted);
    border: 1px solid rgba(79, 70, 229, 0.2);
    border-radius: 3px;
    padding: 1px 5px;
    white-space: nowrap;
    flex-shrink: 0;
    line-height: 1.6;
  }

  /* Key combo — "press this" */
  .keys {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  kbd {
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    font-size: 10px;
    color: var(--color-text-muted);
    background: var(--color-bg-tertiary);
    border: 1px solid var(--color-border);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 1px 4px;
    line-height: 1.6;
    white-space: nowrap;
  }

  .key-sep {
    font-size: 8px;
    color: var(--color-text-faint);
    user-select: none;
  }

  .shortcut-desc {
    font-size: 11px;
    color: var(--color-text-muted);
    line-height: 1.4;
  }

  /* ─────────────────────────────────────────────────── */

  /* ── Footer banner (mirrors svelte-banner, bleeds to column edges) ── */

  .footer-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    /* negative margins cancel the panel's 24px padding */
    margin-top: auto;
    margin-left: -24px;
    margin-right: -24px;
    margin-bottom: -24px;
    padding: 10px 24px;
    border-top: 1px solid var(--color-border);
    background: var(--color-bg-tertiary);
  }

  .footer-link {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-muted);
    text-decoration: none;
    transition: color 120ms ease;
  }

  .footer-link:hover {
    color: var(--color-text);
  }

  .npm-link {
    color: #cb3837;
    opacity: 0.75;
  }

  .npm-link:hover {
    color: #cb3837;
    opacity: 1;
  }

  .footer-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
  }

  .footer-sep {
    color: var(--color-text-faint);
    font-size: 12px;
    user-select: none;
  }

  /* ── Vite setup block ──────────────────────────────── */

  .setup-block {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .setup-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 8px 11px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    font-size: 11px;
    color: var(--color-text-muted);
    transition: background 120ms ease;
  }

  .setup-toggle:hover {
    background: var(--color-bg-tertiary);
    color: var(--color-text);
  }

  .setup-toggle.expanded {
    background: var(--color-bg-tertiary);
    color: var(--color-text);
  }

  .setup-toggle-icon {
    display: flex;
    align-items: center;
    color: var(--color-text-faint);
    flex-shrink: 0;
  }

  .setup-toggle-arrow {
    margin-left: auto;
    font-size: 14px;
    color: var(--color-text-faint);
    line-height: 1;
    transition: transform 120ms ease;
    user-select: none;
  }

  .setup-toggle-arrow.rotated {
    transform: rotate(90deg);
  }

  .inline-code {
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    font-size: 10.5px;
    color: var(--color-accent);
    background: var(--color-accent-muted);
    border-radius: 3px;
    padding: 0 3px;
  }

  .setup-content {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 200ms ease;
  }

  .setup-content.expanded {
    grid-template-rows: 1fr;
  }

  .setup-content-inner {
    overflow: hidden;
  }

  .setup-step {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--color-border);
  }

  .step-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-faint);
  }

</style>
