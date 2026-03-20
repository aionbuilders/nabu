<script>
  import roadmap from '../../data/roadmap.json';

  let expandedId = $state(null);

  /** @param {string} id */
  function toggle(id) {
    expandedId = expandedId === id ? null : id;
  }

  /** @param {string} status */
  function statusMeta(status) {
    switch (status) {
      case 'done':         return { cls: 'done',        label: 'Done' };
      case 'in-progress':  return { cls: 'in-progress', label: 'In progress' };
      case 'buggy':        return { cls: 'buggy',       label: 'Buggy' };
      default:             return { cls: 'planned',     label: 'Planned' };
    }
  }

  /** @param {{ tasks: { status: string }[] }} milestone */
  function taskProgress(milestone) {
    const done  = milestone.tasks.filter(t => t.status === 'done').length;
    const total = milestone.tasks.length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0, complete: done === total };
  }

  const statusOrder = { 'in-progress': 0, 'buggy': 1, 'planned': 2, 'done': 3 };

  /** @param {{ tasks: { status: string }[] }} milestone */
  function sortedTasks(milestone) {
    return [...milestone.tasks].sort((a, b) =>
      (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2)
    );
  }
</script>

<ul class="milestones">
  {#each roadmap.milestones as milestone (milestone.id)}
    {@const meta     = statusMeta(milestone.status)}
    {@const progress = taskProgress(milestone)}
    {@const isExpanded = expandedId === milestone.id}

    <li class="milestone" class:is-expanded={isExpanded}>
      <button
        class="milestone-header"
        onclick={() => toggle(milestone.id)}
        aria-expanded={isExpanded}
      >
        <span class="dot {meta.cls}" title={meta.label}></span>

        <div class="milestone-meta">
          <span class="milestone-label">{milestone.label}</span>
        </div>

        <span class="progress-count" class:complete={progress.complete}>
          {progress.done}/{progress.total}
        </span>

        <span class="expand-arrow" class:expanded={isExpanded}>›</span>
      </button>

      <div class="progress-bar-track">
        <div
          class="progress-bar-fill {meta.cls}"
          style="width: {progress.pct}%"
        ></div>
      </div>

      <div class="task-list" class:expanded={isExpanded} aria-hidden={!isExpanded}>
        <div class="task-list-inner">
          <div class="task-list-content">
            <p class="milestone-desc">{milestone.description}</p>
            <ul class="tasks">
              {#each sortedTasks(milestone) as task (task.id)}
                <li class="task" data-status={task.status}>
                  <span class="task-indicator" data-status={task.status}>
                    {#if task.status === 'done'}✓{/if}
                  </span>
                  <span class="task-body">
                    <span class="task-header">
                      <span class="task-text">{task.text}</span>
                      {#if task.priority}
                        <span class="task-priority" data-priority={task.priority}>{task.priority}</span>
                      {/if}
                    </span>
                    {#if task.note}
                      <span class="task-note">{task.note}</span>
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      </div>
    </li>
  {/each}
</ul>

<style>
  .milestones {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .milestone {
    border-bottom: 1px solid var(--color-border);
  }

  .milestone:last-child {
    border-bottom: none;
  }

  /* ── Header ──────────────────────────────────────────── */

  .milestone-header {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 9px 10px 9px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--color-text);
    transition: background 120ms ease;
  }

  .milestone-header:hover {
    background: var(--color-bg-tertiary);
  }

  .is-expanded > .milestone-header {
    background: var(--color-bg-tertiary);
  }

  /* ── Status dot ──────────────────────────────────────── */

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot.done {
    background: var(--color-success);
  }

  .dot.in-progress {
    background: var(--color-warning);
    animation: pulse-dot 2s ease-in-out infinite;
  }

  .dot.buggy {
    background: var(--color-warning);
    opacity: 0.7;
  }

  .dot.planned {
    background: transparent;
    border: 1.5px solid var(--color-text-faint);
  }

  @keyframes pulse-dot {
    0%, 100% { transform: scale(1);   opacity: 1; }
    50%       { transform: scale(1.5); opacity: 0.5; }
  }

  /* ── Label + progress ────────────────────────────────── */

  .milestone-meta {
    flex: 1;
    min-width: 0;
  }

  .milestone-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text);
    line-height: 1.4;
  }

  .progress-count {
    font-size: 10px;
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    color: var(--color-text-faint);
    letter-spacing: 0.02em;
    flex-shrink: 0;
  }

  .progress-count.complete {
    color: var(--color-success);
    opacity: 0.8;
  }

  .expand-arrow {
    font-size: 14px;
    color: var(--color-text-faint);
    flex-shrink: 0;
    line-height: 1;
    transition: transform 120ms ease;
    user-select: none;
    width: 16px;
    text-align: center;
  }

  .expand-arrow.expanded {
    transform: rotate(90deg);
  }

  /* ── Progress bar ─────────────────────────────────────── */

  .progress-bar-track {
    height: 2px;
    background: var(--color-border);
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    transition: width 400ms ease;
  }

  .progress-bar-fill.done {
    background: var(--color-success);
    opacity: 0.6;
  }

  .progress-bar-fill.in-progress {
    background: var(--color-warning);
    opacity: 0.7;
  }

  .progress-bar-fill.buggy {
    background: var(--color-warning);
    opacity: 0.4;
  }

  .progress-bar-fill.planned {
    background: var(--color-text-faint);
    opacity: 0.3;
  }

  /* ── Task list (animated height) ─────────────────────── */

  .task-list {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 200ms ease;
  }

  .task-list.expanded {
    grid-template-rows: 1fr;
  }

  .task-list-inner {
    overflow: hidden;
  }

  .task-list-content {
    padding: 2px 12px 12px 28px;
    border-top: 1px solid var(--color-border);
  }

  /* ── Description ─────────────────────────────────────── */

  .milestone-desc {
    margin: 10px 0 10px;
    font-size: 11px;
    color: var(--color-text-muted);
    line-height: 1.6;
  }

  /* ── Tasks ───────────────────────────────────────────── */

  .tasks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border-left: 1px solid var(--color-border);
    padding-left: 12px;
  }

  .task {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 4px 0;
  }

  /* ── Task indicator (dot or checkmark) ──────────────── */

  .task-indicator {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    border-radius: 50%;
  }

  .task-indicator[data-status='done'] {
    background: color-mix(in srgb, var(--color-success) 15%, transparent);
    color: var(--color-success);
  }

  .task-indicator[data-status='in-progress'] {
    width: 6px;
    height: 6px;
    margin: 4px 4px 0;
    background: var(--color-warning);
    border-radius: 50%;
    animation: pulse-dot 2s ease-in-out infinite;
  }

  .task-indicator[data-status='planned'],
  .task-indicator {
    width: 5px;
    height: 5px;
    margin: 5px 4.5px 0;
    background: transparent;
    border: 1px solid var(--color-text-faint);
    border-radius: 50%;
  }

  /* ── Task body (text + note) ─────────────────────────── */

  .task-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .task-header {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }

  .task-text {
    font-size: 11px;
    line-height: 1.55;
  }

  .task-priority {
    font-size: 9px;
    font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
    letter-spacing: 0.03em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .task-priority[data-priority='high'] {
    background: color-mix(in srgb, var(--color-accent, #6366f1) 12%, transparent);
    color: var(--color-accent, #6366f1);
  }

  .task-priority[data-priority='medium'] {
    background: color-mix(in srgb, var(--color-text-faint) 12%, transparent);
    color: var(--color-text-muted);
  }

  .task-priority[data-priority='low'] {
    background: transparent;
    color: var(--color-text-faint);
    border: 1px solid var(--color-border);
  }

  .task-note {
    font-size: 10px;
    line-height: 1.5;
    color: var(--color-text-faint);
    font-style: italic;
  }

  .task[data-status='done'] .task-text {
    color: var(--color-text-muted);
  }

  .task[data-status='in-progress'] .task-text {
    color: var(--color-text);
  }

  .task[data-status='planned'] .task-text {
    color: var(--color-text-faint);
  }
</style>
