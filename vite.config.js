import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	plugins: [
		sveltekit({
			// Only used by the demo/e2e app (`vite build`); the library itself is packaged with `svelte-package`.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter()
		}),
		wasm()
	],
	build: {
		target: 'esnext' /* top-level await natif (Loro WASM) */
	}
});
