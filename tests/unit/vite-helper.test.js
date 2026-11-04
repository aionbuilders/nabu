// @ts-nocheck
/**
 * The `nabu()` Vite helper (src/lib/vite.js): the `config` hook of its config plugin. A server-rendered page must not bundle
 * loro-crdt's node build (`Cannot find module './snippets/loro-wasm-…/inline0.js'`), so `loro-crdt` is added to `ssr.external`,
 * unless everything is already external (`external: true`). SvelteKit sets `noExternal: true` on every build, so that one must
 * NOT turn it off: the resolved config below is the regression test of a helper that skipped it and left the build broken.
 */
import { describe, it, expect } from 'vitest';
import { mergeConfig, resolveConfig } from 'vite';
import { nabu } from '#lib/vite.js';

const configHook = async () => (await nabu()).find((p) => p.name === 'nabu:config').config;

describe('nabu() Vite helper', () => {
  it('registers vite-plugin-wasm and the config plugin', async () => {
    const names = (await nabu()).map((p) => p.name);
    expect(names).toContain('nabu:config');
    expect(names).toContain('vite-plugin-wasm');
  });

  it('defaults: esnext target and loro-crdt external for SSR', async () => {
    const config = await configHook();
    expect(config({})).toEqual({ build: { target: 'esnext' }, ssr: { external: ['loro-crdt'] } });
  });

  it("keeps the consumer's own ssr.external entries when merged by Vite", async () => {
    const config = await configHook();
    const user = { ssr: { external: ['pg'] } };
    const merged = mergeConfig(user, config(user));
    expect([...merged.ssr.external].sort()).toEqual(['loro-crdt', 'pg']);
  });

  it('leaves ssr alone when external is true', async () => {
    const config = await configHook();
    expect(config({ ssr: { external: true } })).toEqual({ build: { target: 'esnext' } });
  });

  it('still adds loro-crdt when noExternal is true or a list', async () => {
    const config = await configHook();
    expect(config({ ssr: { noExternal: true } }).ssr).toEqual({ external: ['loro-crdt'] });
    expect(config({ ssr: { noExternal: ['some-lib'] } }).ssr).toEqual({ external: ['loro-crdt'] });
  });

  // What SvelteKit does on a build: its plugin comes first and sets `noExternal: true` from its own config hook.
  it('resolves to an external loro-crdt behind a plugin that sets noExternal: true', async () => {
    const kitLike = { name: 'kit-like', config: () => ({ ssr: { noExternal: true } }) };
    const resolved = await resolveConfig({ configFile: false, logLevel: 'silent', plugins: [kitLike, await nabu()] }, 'build');
    expect(resolved.ssr.noExternal).toBe(true);
    expect(resolved.ssr.external).toContain('loro-crdt');
  });

  it('leaves build.target alone when the consumer set it', async () => {
    const config = await configHook();
    expect(config({ build: { target: 'es2022' } })).toEqual({ ssr: { external: ['loro-crdt'] } });
    expect(config({ build: { target: 'es2022' }, ssr: { external: true } })).toBeUndefined();
  });
});
