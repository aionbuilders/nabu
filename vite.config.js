import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig({
	plugins: [sveltekit(), wasm()],
	build: {
		target: 'esnext', // top-level await natif, pas besoin de vite-plugin-top-level-await
	},
});
