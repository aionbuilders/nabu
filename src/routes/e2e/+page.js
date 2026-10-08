import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

// Client-only: the editor relies on WASM, IndexedDB and the DOM.
export const ssr = false;

/**
 * E2E harness route — available in dev only, never shipped to the deployed site.
 * @type {import('./$types').PageLoad}
 */
export function load() {
  if (!dev) error(404, 'Not found');
  return {};
}
