import { getContext, setContext } from 'svelte';

/**
 * What the redrawn blocks of a documentation page need from the build (see doc.server.js): `ids` maps a heading block to its anchor,
 * `code` a code block to its Shiki tokens. Set by DocArticle, read by DocHeading / DocCode, so that the server render and the hydration
 * draw the same thing.
 * @typedef {{ ids: Record<string, string>, code: Record<string, Array<[string, string?]>> }} DocMeta
 */
const KEY = Symbol('nabu-site-doc');

/** @param {DocMeta} meta */
export const setDocMeta = (meta) => setContext(KEY, meta);

/** @returns {DocMeta} */
export const getDocMeta = () => getContext(KEY) ?? { ids: {}, code: {} };
