import { extension } from "../../utils/extensions";
import { List } from "./list.svelte";
import ListComponent from "./List.svelte";
import { ListItem } from "./list-item.svelte";
import ListItemComponent from "./ListItem.svelte";
import { ListBehavior } from "./list.behavior.svelte";

/**
 * @import {SvelteSet} from "svelte/reactivity";
 */

const ListExtension = extension("list", {
    block: List,
    component: ListComponent,
    hooks: {
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
});

export { ListExtension, ListItemExtension, List, ListItem, ListComponent, ListItemComponent };
