import { error } from '@sveltejs/kit';
import { dev } from '$app/env';

// Client-only, so that the rendering below really runs in the browser. Same gate as /e2e: dev, or a build made with `VITE_NABU_E2E=1`.
export const ssr = false;

/** @type {import('./$types').PageLoad} */
export function load() {
  if (!dev && import.meta.env.VITE_NABU_E2E !== '1') error(404, 'Not found');
  return {};
}
