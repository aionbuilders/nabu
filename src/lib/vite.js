/**
 * Vite plugin preset for Nabu.
 * Loro-CRDT ships a WASM module, which requires `vite-plugin-wasm` and
 * `vite-plugin-top-level-await`. This helper bundles both so consumers
 * only add one entry to their Vite config:
 *
 * ```js
 * // vite.config.js
 * import { nabu } from '@aionbuilders/nabu/vite';
 * export default defineConfig({ plugins: [sveltekit(), nabu()] });
 * ```
 *
 * @returns {Promise<import('vite').Plugin[]>}
 */
export async function nabu() {
    const [{ default: wasm }, { default: topLevelAwait }] = await Promise.all([
        import('vite-plugin-wasm'),
        import('vite-plugin-top-level-await'),
    ]);
    return [wasm(), topLevelAwait()];
}

export default nabu;
