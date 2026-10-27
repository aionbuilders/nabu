/**
 * The extension set of the editors of the tour: ALL of `FullPreset` (the tour shows every block), with the code block drawn like the ones of the docs
 * (Shiki colours computed at build time, see doc.server.js). Shared by the build (tour.server.js builds each document with it) and the page (the browser
 * rebuilds the same engine from the snapshot): both MUST list the same extensions, in the same order.
 *
 * Public entry points only: the root entry and `/extend`.
 */
import { FullPreset, createEditor } from '#lib';
import { extension } from '#lib/extend.js';
import DocCode from '../docs/DocCode.svelte';
import { fromBase64 } from '../docs/doc-preset.js';

/** "Redraw a block" (guide: Theming): an extension of the same name with only a component replaces how that type is drawn. */
export const tourPreset = () => [...FullPreset, extension('code', { component: DocCode })];

/** An EMPTY engine, for the build to fill. */
export const createTourEngine = () => createEditor({ preset: tourPreset(), lang: 'en', readonly: true });

/**
 * The engine of an example, built SYNCHRONOUSLY from its snapshot: the server render and the hydration call this, get the same tree with the same block
 * ids and so draw the same markup. `readonly` is the state to start from (the card of the wall is read-only; the open card may be tried).
 * @param {string} snapshot from `exportSnapshot`
 * @param {boolean} [readonly]
 */
export const loadTourEngine = (snapshot, readonly = true) =>
  createEditor({ preset: tourPreset(), lang: 'en', readonly, snapshot: fromBase64(snapshot) });
