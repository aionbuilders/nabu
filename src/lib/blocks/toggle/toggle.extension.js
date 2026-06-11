import { extension } from "../../utils/extensions";
import { ToggleBlock } from "./toggle.svelte.js";
import ToggleComponent from "./Toggle.svelte";

export const ToggleExtension = extension("toggle", {
    // @ts-ignore — static-side variance on create()
    block: ToggleBlock,
    component: ToggleComponent,
    actions: {
        'toggle': (nabu) => nabu.exec('block:transform', { type: 'toggle' }),
    },
});
