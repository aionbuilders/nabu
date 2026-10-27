import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const lib = (path) => fileURLToPath(new URL(`./src/lib/${path}`, import.meta.url));

// `#lib` (-> src/lib) is resolved natively through the `imports` field of package.json (same as SvelteKit 3):
// no alias needed here.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { hmr: false } })],
  resolve: {
    // The documentation snippets (```js test, see tests/unit/docs-examples.test.js) import the PUBLIC package names, exactly as a
    // consumer writes them: map them to the source entry files. Exact matches only (`^...$`), so `#lib/*` is untouched.
    alias: [
      { find: /^@aionbuilders\/nabu$/, replacement: lib('index.js') },
      { find: /^@aionbuilders\/nabu\/ui$/, replacement: lib('ui/index.js') },
      { find: /^@aionbuilders\/nabu\/extend$/, replacement: lib('extend.js') },
      { find: /^@aionbuilders\/nabu\/vite$/, replacement: lib('vite.js') },
    ],
  },
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
