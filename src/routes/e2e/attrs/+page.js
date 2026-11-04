import { error } from '@sveltejs/kit';
import { dev } from '$app/env';

// Server-rendered on purpose (unlike the other /e2e routes): this page checks the attributes of <NabuEditor> in the SSR output
// and through hydration. Same gate as /e2e: dev, or a build made with `VITE_NABU_E2E=1`.

/** @type {import('./$types').PageLoad} */
export function load() {
  if (!dev && import.meta.env.VITE_NABU_E2E !== '1') error(404, 'Not found');
  return {};
}
