<script>
  let { engine } = $props();

  let active = $state(false);

  const KONAMI = [
    'ArrowUp', 'ArrowUp',
    'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight',
    'ArrowLeft', 'ArrowRight',
    'b', 'a',
  ];
  let keyBuffer = [];

  let selectionInfo = $derived(
    engine
      ? {
          start: JSON.stringify(engine.selection?.startBlock?.selection) ?? '—',
          end:   JSON.stringify(engine.selection?.endBlock?.selection)   ?? '—',
        }
      : null,
  );

  function toggleDebug() {
    active = !active;
    if (typeof window === 'undefined') return;
    if (active) {
      if (engine) engine.debugging = true;
      window.nabu = engine;
    } else {
      if (engine) engine.debugging = false;
      delete window.nabu;
    }
  }

  $effect(() => {
    if (typeof window === 'undefined') return;

    window.__nabu_debug = () => toggleDebug();

    function handleKeydown(e) {
      keyBuffer.push(e.key);
      if (keyBuffer.length > KONAMI.length) keyBuffer.shift();
      if (
        keyBuffer.length === KONAMI.length &&
        keyBuffer.every((k, i) => k === KONAMI[i])
      ) {
        toggleDebug();
        keyBuffer = [];
      }
    }

    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('keydown', handleKeydown);
      delete window.__nabu_debug;
    };
  });

  function serializeMarkdown() {
    if (!engine) return;
    console.log('[nabu] markdown:\n', engine.serialize('markdown'));
  }

  function serializeJson() {
    if (!engine) return;
    console.log('[nabu] json:', engine.serialize('json'));
  }

  function insertHeading() {
    engine?.insert('heading', { level: 1, text: 'Debug Heading' });
  }

  function insertParagraph() {
    engine?.insert('paragraph', { text: '' });
  }

  function insertList() {
    if (!engine) return;
    const list  = engine.insert('list', { listType: 'bullet' });
    const item1 = engine.insert('list-item', { text: 'Debug item 1' }, list.node.id.toString(), 0);
    const sub   = engine.insert('list', { listType: 'bullet' }, item1.node.id.toString());
    engine.insert('list-item', { text: 'Debug nested item' }, sub.node.id.toString(), 0);
    engine.insert('list-item', { text: 'Debug item 2' }, list.node.id.toString(), 1);
  }

  async function clearPersistence() {
    if (!engine) return;
    await engine.clearPersistence();
    if (typeof window !== 'undefined') window.location.reload();
  }
</script>

{#if active}
  <!-- Tiny indicator dot — shows debug mode is active -->
  <div
    class="debug-indicator"
    title="Debug mode active — click to disable"
    onclick={toggleDebug}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === 'Enter' && toggleDebug()}
  ></div>
{/if}

<!-- Floating debug panel — slides in from bottom-right -->
<div class="debug-panel" class:visible={active} aria-hidden={!active}>
  <div class="panel-header">
    <span class="panel-title">Nabu Debug</span>
    <button class="close-btn" onclick={toggleDebug} aria-label="Close debug panel">×</button>
  </div>

  <div class="panel-body">
    <div class="group">
      <div class="group-label">Serialize</div>
      <div class="btn-col">
        <button class="dbg-btn" onclick={serializeMarkdown}>Markdown → console</button>
        <button class="dbg-btn" onclick={serializeJson}>JSON → console</button>
      </div>
    </div>

    <div class="group">
      <div class="group-label">Insert</div>
      <div class="btn-col">
        <button class="dbg-btn" onclick={insertHeading}>Heading H1</button>
        <button class="dbg-btn" onclick={insertParagraph}>Paragraph</button>
        <button class="dbg-btn" onclick={insertList}>Nested list</button>
      </div>
    </div>

    <div class="group">
      <div class="group-label">Persistence</div>
      <div class="btn-col">
        <button class="dbg-btn danger" onclick={clearPersistence}>Clear & Reload</button>
      </div>
    </div>

    <div class="group">
      <div class="group-label">Selection</div>
      <div class="readout">
        <div class="readout-row">
          <span class="readout-label">start</span>
          <span class="readout-value">{selectionInfo?.start ?? '—'}</span>
        </div>
        <div class="readout-row">
          <span class="readout-label">end</span>
          <span class="readout-value">{selectionInfo?.end ?? '—'}</span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .debug-indicator {
    position: fixed;
    bottom: 12px;
    right: 12px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-warning);
    z-index: 9998;
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 120ms ease;
  }

  .debug-indicator:hover {
    opacity: 1;
  }

  .debug-panel {
    position: fixed;
    bottom: 28px;
    right: 16px;
    width: 288px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    z-index: 9999;
    transform: translateY(calc(100% + 36px));
    opacity: 0;
    transition: transform 200ms ease, opacity 200ms ease;
    pointer-events: none;
    overflow: hidden;
  }

  .debug-panel.visible {
    transform: translateY(0);
    opacity: 1;
    pointer-events: all;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg-tertiary);
  }

  .panel-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-faint);
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 18px;
    line-height: 1;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 120ms ease;
  }

  .close-btn:hover {
    color: var(--color-text);
  }

  .panel-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-faint);
  }

  .btn-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .dbg-btn {
    background: var(--color-bg-tertiary);
    border: 1px solid var(--color-border);
    color: var(--color-text-muted);
    font-size: 11px;
    font-family: inherit;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: background 120ms ease, color 120ms ease;
  }

  .dbg-btn:hover {
    background: var(--color-bg);
    color: var(--color-text);
  }

  .dbg-btn.danger {
    color: var(--color-danger);
  }

  .dbg-btn.danger:hover {
    background: rgba(220, 38, 38, 0.08);
  }

  .readout {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--color-bg-tertiary);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 8px;
  }

  .readout-row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }

  .readout-label {
    font-size: 10px;
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    color: var(--color-text-faint);
    flex-shrink: 0;
    width: 28px;
    padding-top: 1px;
  }

  .readout-value {
    font-size: 10px;
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    color: var(--color-text-muted);
    word-break: break-all;
    line-height: 1.4;
  }
</style>
