import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// `NABU_SLOT=<1-9>` gives a build its own output folders, so that several builds / e2e runs can happen at once
// without overwriting each other (the default slot uses `.svelte-kit` and `build`). See playwright.config.js.
const SLOT = process.env.NABU_SLOT;

// Hosts the dev and preview servers answer besides localhost: any Cloudflare quick tunnel (`cloudflared tunnel --url …`), plus
// extra hosts from `NABU_ALLOWED_HOSTS` (comma separated, e.g. a named tunnel's domain). A leading dot allows every subdomain.
// Not `true`: Vite's host check is what stops DNS-rebinding attacks on the dev server.
const ALLOWED_HOSTS = ['.trycloudflare.com', ...(process.env.NABU_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)];

export default defineConfig({
	plugins: [
		sveltekit({
			// Only used by the demo/e2e app (`vite build`); the library itself is packaged with `svelte-package`.
			// See https://svelte.dev/docs/kit/adapters for more information about adapters.
			adapter: adapter(SLOT ? { out: `build-${SLOT}` } : {}),
			...(SLOT ? { outDir: `.svelte-kit-${SLOT}` } : {})
		}),
		wasm()
	],
	server: {
		allowedHosts: ALLOWED_HOSTS,
		// Other slots' builds and test runs write into the repo: without this the dev server reloads the page on every one of their files.
		// The API model too: every build regenerates it (identical content) and a reload re-renders every open page server-side.
		// Restart the dev server (or `bun run api:model`) to see JSDoc changes in /api.
		watch: { ignored: ['**/build-*/**', '**/.svelte-kit-*/**', '**/test-results*/**', '**/src/site/api/model.json'] }
	},
	preview: { allowedHosts: ALLOWED_HOSTS },
	build: {
		target: 'esnext' /* top-level await natif (Loro WASM) */
	}
});
