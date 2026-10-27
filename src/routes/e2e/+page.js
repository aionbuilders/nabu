import { error } from '@sveltejs/kit';
import { dev } from '$app/env';

// Client-only: the editor relies on WASM, IndexedDB and the DOM.
export const ssr = false;

/**
 * E2E harness route. Available in dev, and in a production build ONLY when it was built with
 * `VITE_NABU_E2E=1` (`bun run build:e2e`, used by the Playwright webServer). A normal
 * `vite build` (the deployed demo site) leaves the flag unset and answers 404.
 * @type {import('./$types').PageLoad}
 */
export function load() {
  if (!dev && import.meta.env.VITE_NABU_E2E !== '1') error(404, 'Not found');
  return {};
}
