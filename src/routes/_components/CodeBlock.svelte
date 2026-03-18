<script>
  /** @type {{ code: string, lang?: 'js' | 'bash', filename?: string | null }} */
  let { code, lang = 'js', filename = null } = $props();

  let copied = $state(false);
  let timeout;

  function handleCopy() {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard.writeText(code).then(() => {
      copied = true;
      clearTimeout(timeout);
      timeout = setTimeout(() => (copied = false), 1800);
    });
  }

  function esc(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightJS(raw) {
    return raw.split('\n').map(line => {
      const strs = [];

      // 1. Escape HTML
      let out = esc(line);

      // 2. Protect string literals
      out = out.replace(/'[^']*'|"[^"]*"/g, m => {
        const i = strs.length;
        strs.push(m);
        return `\x01${i}\x01`;
      });

      // 3. Pull out line comment
      let cmt = '';
      const ci = out.indexOf('//');
      if (ci >= 0) { cmt = out.slice(ci); out = out.slice(0, ci); }

      // 4. Keywords
      out = out.replace(
        /\b(import|export|default|from|const|let|var|function|return|async|await)\b/g,
        '<span class="t-kw">$1</span>'
      );

      // 5. Function calls (identifier immediately before '(')
      out = out.replace(
        /\b([a-zA-Z_$][\w$]*)\s*(?=\()/g,
        '<span class="t-fn">$1</span>'
      );

      // 6. Restore strings
      out = out.replace(/\x01(\d+)\x01/g, (_, i) => `<span class="t-str">${strs[+i]}</span>`);

      // 7. Re-attach comment
      if (cmt) out += `<span class="t-cmt">${cmt}</span>`;

      return out;
    }).join('\n');
  }

  function highlightBash(raw) {
    return esc(raw)
      .replace(/^(\$ ?)/, '<span class="t-prompt">$1</span>')
      .replace(/\b(npm|bun|pnpm|yarn)\b/, '<span class="t-cmd">$1</span>')
      .replace(/ (-[\w-]+)/g, ' <span class="t-flag">$1</span>');
  }

  const html = $derived(lang === 'bash' ? highlightBash(code) : highlightJS(code));
</script>

<div class="cb">
  <div class="cb-header">
    {#if filename}
      <span class="cb-filename">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        {filename}
      </span>
    {:else}
      <span class="cb-lang">{lang}</span>
    {/if}

    <button class="cb-copy" class:ok={copied} onclick={handleCopy} title="Copy to clipboard" aria-label="Copy to clipboard">
      {#if copied}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Copied</span>
      {:else}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="4" rx="1"/>
          <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>
        </svg>
      {/if}
    </button>
  </div>

  <pre class="cb-pre"><code>{@html html}</code></pre>
</div>

<style>
  .cb {
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.06);
    background: #12121c;
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    font-size: 11px;
  }

  /* ── Header ──────────────────────────────────────────── */

  .cb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #0e0e18;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .cb-filename {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: #6a6a90;
  }

  .cb-lang {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #44445a;
  }

  .cb-copy {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 10px;
    color: #44445a;
    transition: color 100ms ease, border-color 100ms ease, background 100ms ease;
  }

  .cb-copy:hover {
    color: #9090b8;
    border-color: rgba(255, 255, 255, 0.09);
    background: rgba(255, 255, 255, 0.04);
  }

  .cb-copy.ok {
    color: #4ade80;
    border-color: rgba(74, 222, 128, 0.18);
  }

  /* ── Code area ───────────────────────────────────────── */

  .cb-pre {
    margin: 0;
    padding: 12px 14px;
    overflow-x: auto;
    line-height: 1.8;
    color: #c8c8e0;
    tab-size: 2;
  }

  .cb-pre code {
    font-family: inherit;
    font-size: inherit;
  }

  /* ── Syntax tokens (scoped via .cb-pre in :global) ───── */

  :global(.cb-pre .t-kw)     { color: #c084fc; }              /* keywords       — purple  */
  :global(.cb-pre .t-str)    { color: #86efac; }              /* strings        — green   */
  :global(.cb-pre .t-fn)     { color: #93c5fd; }              /* function calls — blue    */
  :global(.cb-pre .t-cmt)    { color: #3c3c58; font-style: italic; }  /* comments — dim  */
  :global(.cb-pre .t-prompt) { color: #3c3c58; user-select: none; }   /* bash $  — dim   */
  :global(.cb-pre .t-cmd)    { color: #34d399; }              /* npm/bun        — emerald */
  :global(.cb-pre .t-flag)   { color: #f9a8d4; }              /* -D flag        — pink    */
</style>
