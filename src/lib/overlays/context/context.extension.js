import { Extension } from '../../utils/extensions.js';
import { ContextMenu } from './context.svelte.js';

export const ContextExtension = new Extension('context', {
    hooks: {
        onInit: (nabu) => new ContextMenu(nabu),
    },
});
