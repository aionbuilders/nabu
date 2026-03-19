<script>
  import { TextBehavior } from '$lib/behaviors/text/text.behavior.svelte.js';

  let { engine = null } = $props();

  // ── Mark active state ─────────────────────────────────────
  // We read behavior.delta ($state) so the derived is invalidated when marks change.
  // We also read behavior.selection ($derived) and block.selected ($state).
  const activeMarks = $derived.by(() => {
    const MARKS = ['bold', 'italic', 'underline', 'code', 'strikethrough'];
    const inactive = new Set();
    let hasTarget = false;

    if (!engine) return {};

    for (const [, block] of engine.blocks) {
      if (!block.selected) continue;
      const behavior = block.behaviors?.get('text');
      if (!(behavior instanceof TextBehavior)) continue;
      const sel = behavior.selection;
      if (!sel || sel.isCollapsed) continue;
      hasTarget = true;

      const delta = behavior.delta; // reactive $state — tracks mark changes
      let offset = 0;
      for (const op of delta) {
        if (typeof op.insert !== 'string') continue;
        const opEnd = offset + op.insert.length;
        if (opEnd > sel.from && offset < sel.to) {
          const attrs = op.attributes || {};
          for (const mark of MARKS) {
            if (!attrs[mark]) inactive.add(mark);
          }
        }
        offset = opEnd;
      }
    }

    if (!hasTarget) return {};
    const result = {};
    for (const mark of MARKS) result[mark] = !inactive.has(mark);
    return result;
  });

  // ── Current block state ───────────────────────────────────
  const currentBlock = $derived(engine?.selection?.anchorBlock ?? null);
  const currentType  = $derived(currentBlock?.type ?? null);
  const currentLevel = $derived(currentBlock?.level ?? null); // only on Heading

  // ── Helpers ───────────────────────────────────────────────
  function exec(cmd) {
    engine?.exec(cmd);
  }

  // Prevent focus loss when clicking toolbar buttons
  function press(e, cmd) {
    e.preventDefault();
    exec(cmd);
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Editor toolbar">

  <!-- Undo / Redo -->
  <div class="group">
    <button
      class="btn"
      onmousedown={(e) => press(e, 'undo')}
      title="Undo (Ctrl+Z)"
      aria-label="Undo"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
      </svg>
    </button>
    <button
      class="btn"
      onmousedown={(e) => press(e, 'redo')}
      title="Redo (Ctrl+Y)"
      aria-label="Redo"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
      </svg>
    </button>
  </div>

  <div class="sep"></div>

  <!-- Block type -->
  <div class="group">
    <button
      class="btn label-btn"
      class:active={currentType === 'paragraph'}
      onmousedown={(e) => press(e, 'paragraph')}
      title="Paragraph"
    >P</button>
    <button
      class="btn label-btn"
      class:active={currentType === 'heading' && currentLevel === 1}
      onmousedown={(e) => press(e, 'heading:1')}
      title="Heading 1"
    >H1</button>
    <button
      class="btn label-btn"
      class:active={currentType === 'heading' && currentLevel === 2}
      onmousedown={(e) => press(e, 'heading:2')}
      title="Heading 2"
    >H2</button>
    <button
      class="btn label-btn"
      class:active={currentType === 'heading' && currentLevel === 3}
      onmousedown={(e) => press(e, 'heading:3')}
      title="Heading 3"
    >H3</button>
    <button
      class="btn label-btn"
      class:active={currentType === 'heading' && currentLevel === 4}
      onmousedown={(e) => press(e, 'heading:4')}
      title="Heading 4"
    >H4</button>
  </div>

  <div class="sep"></div>

  <!-- List indent / unindent — shown only when cursor is in a list-item -->
  {#if currentType === 'list-item'}
    <div class="group">
      <button
        class="btn"
        onmousedown={(e) => press(e, 'list:unindent')}
        title="Unindent (Shift+Tab)"
        aria-label="Unindent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="9" y2="18"/>
          <polyline points="5 8 3 6 5 4 3 6"/>
        </svg>
      </button>
      <button
        class="btn"
        onmousedown={(e) => press(e, 'list:indent')}
        title="Indent (Tab)"
        aria-label="Indent"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/>
          <polyline points="3 8 5 6 3 4 5 6"/>
        </svg>
      </button>
    </div>

    <div class="sep"></div>
  {/if}

  <!-- Text marks -->
  <div class="group">
    <button
      class="btn mark-bold"
      class:active={activeMarks.bold}
      onmousedown={(e) => press(e, 'bold')}
      title="Bold (Ctrl+B)"
      aria-label="Bold"
    >B</button>
    <button
      class="btn mark-italic"
      class:active={activeMarks.italic}
      onmousedown={(e) => press(e, 'italic')}
      title="Italic (Ctrl+I)"
      aria-label="Italic"
    >I</button>
    <button
      class="btn mark-underline"
      class:active={activeMarks.underline}
      onmousedown={(e) => press(e, 'underline')}
      title="Underline (Ctrl+U)"
      aria-label="Underline"
    >U</button>
    <button
      class="btn mark-strike"
      class:active={activeMarks.strikethrough}
      onmousedown={(e) => press(e, 'strikethrough')}
      title="Strikethrough (Ctrl+Shift+X)"
      aria-label="Strikethrough"
    >S</button>
    <button
      class="btn mark-code"
      class:active={activeMarks.code}
      onmousedown={(e) => press(e, 'code')}
      title="Inline code (Ctrl+E)"
      aria-label="Code"
    >&lt;/&gt;</button>
  </div>

  <div class="sep"></div>

  <div class="group">
    {engine?.positions}
  </div>

</div>

<style>
  .toolbar {
    height: 40px;
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 2px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    background: var(--color-bg);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .sep {
    width: 1px;
    height: 18px;
    background: var(--color-border);
    margin: 0 6px;
    flex-shrink: 0;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    min-width: 26px;
    padding: 0 5px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 12px;
    font-family: inherit;
    line-height: 1;
    transition: background 120ms, color 120ms;
    user-select: none;
  }

  .btn:hover {
    background: var(--color-bg-tertiary);
    color: var(--color-text);
  }

  .btn.active {
    background: var(--color-accent-muted);
    color: var(--color-accent);
  }

  /* Label buttons (P, H1…) */
  .label-btn {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  /* Mark button typography */
  .mark-bold      { font-weight: 700; }
  .mark-italic    { font-style: italic; }
  .mark-underline { text-decoration: underline; }
  .mark-strike    { text-decoration: line-through; }
  .mark-code      { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: -0.03em; }
</style>
