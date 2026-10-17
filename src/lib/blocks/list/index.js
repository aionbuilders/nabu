import { extension } from "../../utils/extensions";
import { List } from "./list.svelte.js";
import ListComponent from "./List.svelte";
import { ListItem } from "./list-item.svelte.js";
import ListItemComponent from "./ListItem.svelte";
import { normalizeLists } from "./normalize.js";
import { moveItems, selectedItems, handleTab } from "./indent.js";
import { onBeforeInput } from "./hooks/onBeforeInput.hook.js";

const ListExtension = extension("list", {
    block: List,
    component: ListComponent,
    hooks: {
        onBeforeInput,
        // Tab / Shift+Tab with a selection spanning several blocks: the keydown would otherwise resolve to
        // the lowest common ancestor (a List, a container, the root), which does not know about indenting.
        // A selection inside one block is handled by ListItem.keydown.
        onKeyDown: (nabu, event) => {
            const sel = nabu.selection;
            if (sel.anchorBlock === sel.focusBlock) return nabu.CONTINUE;
            return handleTab(nabu, event) ? nabu.BREAK : nabu.CONTINUE;
        },
        // Runs before doc.commit(): the fixes belong to the same transaction (same undo step) as the
        // operation that broke the structure. See normalize.js for the invariants.
        onBeforeTransaction: normalizeLists,
    }
});

const ListItemExtension = extension("list-item", {
    block: ListItem,
    component: ListItemComponent,
    actions: {
        // Every list item the selection touches (the anchor item for a caret).
        'list:indent': (nabu) => { moveItems(nabu, selectedItems(nabu), false); },
        'list:unindent': (nabu) => { moveItems(nabu, selectedItems(nabu), true); },
    }
});

export { ListExtension, ListItemExtension, List, ListItem, ListComponent, ListItemComponent };
export { Todos } from "./todos.svelte.js";
