import { extension } from "../../utils/extensions";
import { List } from "./list.svelte";
import ListComponent from "./List.svelte";
import { ListItem } from "./list-item.svelte";
import ListItemComponent from "./ListItem.svelte";

const ListExtension = extension("list", {
    block: List,
    component: ListComponent,
});

const ListItemExtension = extension("list-item", {
    block: ListItem,
    component: ListItemComponent,
});

export { ListExtension, ListItemExtension, List, ListItem, ListComponent, ListItemComponent };
