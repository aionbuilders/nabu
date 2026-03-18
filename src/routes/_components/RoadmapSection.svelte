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
    return { done, total, complete: done === total };
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

      <div class="task-list" class:expanded={isExpanded} aria-hidden={!isExpanded}>
        <div class="task-list-inner">
          <div class="task-list-content">
            <p class="milestone-desc">{milestone.description}</p>
            <ul class="tasks">
              {#each milestone.tasks as task (task.id)}
                <li class="task" data-status={task.status}>
                  <span class="task-dot" data-status={task.status}></span>
                  <span class="task-text">{task.text}</span>
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

  .task-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 5px;
  }

  .task-dot[data-status='done'] {
    background: var(--color-success);
    opacity: 0.75;
  }

  .task-dot[data-status='in-progress'] {
    background: var(--color-warning);
    animation: pulse-dot 2s ease-in-out infinite;
  }

  .task-dot[data-status='planned'],
  .task-dot {
    background: transparent;
    border: 1px solid var(--color-text-faint);
  }

  .task-text {
    font-size: 11px;
    line-height: 1.55;
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
