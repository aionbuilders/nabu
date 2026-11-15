// Set up exactly as docs/getting-started/installation.md tells a consumer. Nothing else.
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { nabu } from '@aionbuilders/nabu/vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() }), nabu()]
});
