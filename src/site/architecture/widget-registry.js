/**
 * The live widgets a chapter can show right after its first paragraph (`xray: <id>` in its frontmatter): the registry of
 * `widgets/index.js` (id -> Svelte component, owned by the chapters), plus, in the e2e build only, a stand-in to test the slot.
 */
import { widgets } from './widgets/index.js';
import E2eProbe from './E2eProbe.svelte';

/** @type {Record<string, import('svelte').Component<any>>} */
export const registry = {
  ...(/** @type {Record<string, import('svelte').Component<any>>} */ (widgets)),
  ...(import.meta.env.VITE_NABU_E2E === '1' ? { 'e2e-probe': E2eProbe } : {}),
};
