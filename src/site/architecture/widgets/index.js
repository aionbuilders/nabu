/**
 * The live X-ray widgets of the Architecture story, by id. A chapter names its widget in its frontmatter (`xray: keystroke`) and the
 * chapter route renders it after the chapter's first paragraph. Every widget is a client-side live editor with an inert, same-size shell
 * on the server (see ArchEditor.svelte).
 */

import SingleRoot from './SingleRoot.svelte';
import ModelTruth from './ModelTruth.svelte';
import Keystroke from './Keystroke.svelte';
import CaretMap from './CaretMap.svelte';
import CommandKeys from './CommandKeys.svelte';
import Persistence from './Persistence.svelte';
import RegionTitle from './RegionTitle.svelte';

export const widgets = {
  'single-root': SingleRoot, // 01
  'model-truth': ModelTruth, // 02
  keystroke: Keystroke, // 03
  'caret-map': CaretMap, // 04
  'command-keys': CommandKeys, // 05
  persistence: Persistence, // 06
  'region-title': RegionTitle, // 07
};
