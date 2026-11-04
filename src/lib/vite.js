/**
 * Vite plugin preset for Nabu.
 *
 * Loro-CRDT ships a WebAssembly module loaded with top-level `await`. This
 * helper bundles what Vite needs for it, so consumers only add one entry to
 * their Vite config:
 *
 * ```js
 * // vite.config.js
 * import { nabu } from '@aionbuilders/nabu/vite';
 * export default defineConfig({ plugins: [sveltekit(), nabu()] });
 * ```
 *
 * It registers `vite-plugin-wasm` and sets `build.target` to `'esnext'`
 * (unless you already set it): modern browsers support top-level await
 * natively, so no `vite-plugin-top-level-await` transform is needed (that
 * plugin is incompatible with Vite 8 / Rolldown).
 *
 * It also adds `loro-crdt` to `ssr.external`, so that a server-rendered page
 * (SvelteKit) loads loro-crdt's Node build from `node_modules` at run time.
 * Bundled into the SSR output, that build fails with
 * `Cannot find module './snippets/loro-wasm-…/inline0.js'`. It is left alone
 * when `ssr.external` is `true` (everything is already external). `noExternal`
 * is no reason to skip it: SvelteKit sets `ssr.noExternal: true` on every build,
 * and an entry of `ssr.external` still wins over it.
 *
 * @returns {Promise<import('vite').Plugin[]>}
 */
export async function nabu() {
    const { default: wasm } = await import('vite-plugin-wasm');
    return [
        wasm(),
        {
            name: 'nabu:config',
            config(config) {
                /** @type {import('vite').UserConfig} */
                const patch = {};
                if (config.build?.target === undefined) patch.build = { target: 'esnext' };
                // Arrays merge in Vite's `mergeConfig`, so the consumer's own `ssr.external` entries are kept.
                if (config.ssr?.external !== true) patch.ssr = { external: ['loro-crdt'] };
                return Object.keys(patch).length ? patch : undefined;
            },
        },
    ];
}

export default nabu;
