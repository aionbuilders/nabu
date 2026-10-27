---
title: Installation
description: Install Nabu, set up Vite (or SvelteKit) for its WebAssembly core, and fix the common build errors.
section: getting-started
order: 1
---

# Installation

Nabu is a block editor for **Svelte 5**. It is a regular npm package; the only non-obvious part is the Vite setup, because its CRDT core ([Loro](https://loro.dev)) is a WebAssembly module.

## Requirements

| What | Version |
|---|---|
| Svelte | **5.20 or newer** (`peerDependencies.svelte` is `^5.20.0`) |
| Bundler | Vite with a Svelte plugin (SvelteKit already includes it) |
| Browser | A modern browser: the WebAssembly module is loaded with top-level `await` |

## Install

```bash
npm install @aionbuilders/nabu
# or
bun add @aionbuilders/nabu
```

`loro-crdt` and `vite-plugin-wasm` come with it as dependencies; you do not install them yourself.

## Vite setup

Add the `nabu()` helper to your Vite config. It registers `vite-plugin-wasm` and sets `build.target` to `'esnext'` (unless you already set a target yourself).

```js
// vite.config.js
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite'; // or `svelte` from '@sveltejs/vite-plugin-svelte'
import { nabu } from '@aionbuilders/nabu/vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    nabu()
  ]
});
```

The same file works for a plain Svelte + Vite project: replace `sveltekit()` with `svelte()`.

`nabu()` is asynchronous and returns an array of plugins; Vite flattens and awaits plugin arrays, so you pass it as is. You can check what it returns:

```js test
import { nabu } from '@aionbuilders/nabu/vite';

const plugins = await nabu();
expect(plugins.map((p) => p.name)).toContain('nabu:esnext-target');

// It only sets the target when you did not.
const targetPlugin = plugins.find((p) => p.name === 'nabu:esnext-target');
expect(targetPlugin.config({})).toEqual({ build: { target: 'esnext' } });
expect(targetPlugin.config({ build: { target: 'es2022' } })).toBeUndefined();
```

### Manual setup

If you prefer not to use the helper, this is exactly what it does:

```js
// vite.config.js
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite'; // or svelte()
import wasm from 'vite-plugin-wasm';

export default defineConfig({
  plugins: [sveltekit(), wasm()],
  build: { target: 'esnext' }
});
```

### Why `esnext`?

Loro's WebAssembly module is loaded with top-level `await`, which every modern browser supports natively. The `esnext` build target tells Vite not to down-level it. Vite's default target does not allow top-level `await`, so without it the production build fails.

You do **not** need `vite-plugin-top-level-await`, and you should not use it: it is incompatible with Vite 8 (Rolldown). If you set `build.target` yourself, keep it at `esnext` or any target that supports top-level `await`.

## Check that it works

Mount an editor as shown in [Your first editor](./first-editor.md). If the page shows an editable area and you can type, the setup is complete.

## Troubleshooting

**The production build fails on "top-level await" (or the target environment).**
`build.target` is too low. Use the `nabu()` helper, or set `build: { target: 'esnext' }`.

**An error about a `.wasm` file or the WebAssembly "ESM integration".**
`vite-plugin-wasm` is not active. Add `nabu()` (or `wasm()`) to the `plugins` of the config Vite actually loads, and restart the dev server.

**`Cannot find module 'rollup'` or `'esbuild'` on Vite 8.**
You have `vite-plugin-top-level-await` in your config (or from an older Nabu version). Remove it and use `nabu()` instead.

**Vite cannot resolve `@aionbuilders/nabu`.**
The package exposes its entry points under the `svelte` export condition. A Svelte plugin (`@sveltejs/vite-plugin-svelte`, included in SvelteKit) must be present for Vite to pick it up.

**A runtime error mentioning `$props.id`.**
Your Svelte is older than 5.20. Upgrade `svelte`.

## The three entry points

Everything public comes from three imports. Anything not exported from them is internal and may change without notice.

| Import | What it is for |
|---|---|
| `@aionbuilders/nabu` | Using the editor: the `NabuEditor` component, the editor factories and presets, the built-in extensions, and a few subsystems |
| `@aionbuilders/nabu/ui` | The optional UI components: `FloatingToolbar`, `SlashMenu`, `DragHandle`, `CommandInvite`, `CommandChooser` |
| `@aionbuilders/nabu/extend` | Writing your own blocks and extensions |

A fourth import, `@aionbuilders/nabu/vite`, is the build helper described above.

Next: [Your first editor](./first-editor.md).
