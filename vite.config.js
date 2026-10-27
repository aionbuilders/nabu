import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// `NABU_SLOT=<1-9>` gives a build its own output folders, so that several builds / e2e runs can happen at once
// without overwriting each other (the default slot uses `.svelte-kit` and `build`). See playwright.config.js.
const SLOT = process.env.NABU_SLOT;

export default defineConfig({
	plugins: [
		sveltekit({
			// Only used by the demo/e2e app (`vite build`); the library itself is packaged with `svelte-package`.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter(SLOT ? { out: `build-${SLOT}` } : {}),
			...(SLOT ? { outDir: `.svelte-kit-${SLOT}` } : {}),
			prerender: {
				// TEMP: the API reference links into /docs pages that are still being built.
				// Remove once the docs routes land, so a broken link fails the build again.
				handleHttpError: ({ path, message }) => {
					if (path.startsWith('/docs/')) return console.warn(message);
					throw new Error(message);
				}
			}
		}),
		wasm()
	],
	build: {
		target: 'esnext' /* top-level await natif (Loro WASM) */
	}
});
