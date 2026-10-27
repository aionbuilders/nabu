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
 * @returns {Promise<import('vite').Plugin[]>}
 */
export async function nabu() {
    const { default: wasm } = await import('vite-plugin-wasm');
    return [
        wasm(),
        {
            name: 'nabu:esnext-target',
            config(config) {
                if (config.build?.target === undefined) return { build: { target: 'esnext' } };
            },
        },
    ];
}

export default nabu;
