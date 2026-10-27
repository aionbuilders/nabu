/**
 * Svelte action: makes the `[data-copy]` buttons of server-rendered code blocks (`.cb`) copy their code.
 * @param {HTMLElement} node
 */
export function copyable(node) {
  /** @param {MouseEvent} e */
  function onclick(e) {
    const button = /** @type {HTMLElement | null} */ ((/** @type {Element} */ (e.target)).closest?.('[data-copy]'));
    if (!button || !node.contains(button)) return;
    const code = button.closest('.cb')?.querySelector('pre')?.textContent ?? '';
    navigator.clipboard?.writeText(code).then(() => {
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy'; }, 1800);
    }, () => {});
  }
  node.addEventListener('click', onclick);
  return { destroy: () => node.removeEventListener('click', onclick) };
}
