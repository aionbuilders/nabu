import { error } from '@sveltejs/kit';
import { allPages, getModel, renderItem, groupMembers, tocFor } from '../../../../../site/api/model.server.js';

export const entries = () => allPages();

export const load = async ({ params }) => {
  const model = getModel();
  const raw = /** @type {any} */ (model.items)[`${params.entry}/${params.name}`];
  if (!raw) error(404, 'Not found');
  const { item, hl } = await renderItem(raw);
  const specifier = /** @type {string} */ (model.entries.find((e) => e.id === item.entry)?.specifier);
  const importCode = item.kind === 'type'
    ? `import type { ${item.name} } from '${specifier}';`
    : `import { ${item.name} } from '${specifier}';`;
  return {
    title: `${item.name} · API · Nabu`,
    item,
    specifier,
    importHtml: hl(importCode, 'ts'),
    groups: groupMembers(item),
    toc: tocFor(item),
  };
};
