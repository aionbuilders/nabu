import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// `#lib` (-> src/lib) is resolved natively through the `imports` field of package.json (same as SvelteKit 3):
// no alias needed here.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } })],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/unit/setup.js'],
    include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**'],
    },
  },
});
