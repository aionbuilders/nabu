import { extension } from "../../utils/extensions";
import { List } from "./list.svelte.js";
import ListComponent from "./List.svelte";
import { ListItem, indentListItem, unindentListItem } from "./list-item.svelte.js";
import ListItemComponent from "./ListItem.svelte";
import { ListBehavior } from "./list.behavior.svelte.js";
import { onBeforeInput } from "./hooks/onBeforeInput.hook.js";

/**
 * @import {SvelteSet} from "svelte/reactivity";
 */

const ListExtension = extension("list", {
    block: List,
    component: ListComponent,
    hooks: {
        onBeforeInput,
        onBeforeTransaction(nabu) {
            const lists = /** @type {SvelteSet<List>} */ (nabu.blocksByType.get("list"));
            lists?.forEach(list => {
                const behavior = list.behaviors.get("list");
                if (!behavior || !(behavior instanceof ListBehavior)) return;
                const sibblings = list.getAdjacentSiblings();
                const previous = sibblings.previous;
                if (!previous) return;
                const previousBehavior = previous.behaviors.get("list");
                if (!previousBehavior || !(previousBehavior instanceof ListBehavior)) return;
                
                previousBehavior.absorbs(list);
                list.destroy();

            })

        }
    }
});

const ListItemExtension = extension("list-item", {
    block: ListItem,
    component: ListItemComponent,
    actions: {
        'list:indent': (nabu) => {
            const block = nabu.selection.anchorBlock;
            if (block?.type !== 'list-item') return;
            indentListItem(/** @type {ListItem} */ (block));
        },
        'list:unindent': (nabu) => {
            const block = nabu.selection.anchorBlock;
            if (block?.type !== 'list-item') return;
            unindentListItem(/** @type {ListItem} */ (block));
        },
    }
});

export { ListExtension, ListItemExtension, List, ListItem, ListComponent, ListItemComponent };
