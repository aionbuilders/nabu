import { getModel, inlineSummary } from '../../../site/api/model.server.js';

export const load = async () => {
  const model = getModel();
  const entries = await Promise.all(
    model.entries.map(async (entry) => ({
      id: entry.id,
      specifier: entry.specifier,
      title: entry.title,
      summary: entry.summary,
      groups: await Promise.all(
        entry.groups.map(async (group) => ({
          title: group.title,
          kind: group.kind,
          items: await Promise.all(
            group.items.map(async (name) => {
              const item = /** @type {any} */ (model.items)[`${entry.id}/${name}`];
              return { name, href: `/api/${entry.id}/${name}`, summaryHtml: await inlineSummary(item.summary ?? '') };
            }),
          ),
        })),
      ),
    })),
  );
  return {
    title: 'API reference · Nabu',
    version: model.version,
    entries,
    toc: [
      ...entries.map((e) => ({ id: `entry-${e.id}`, label: e.specifier, level: /** @type {1} */ (1) })),
      { id: 'internals', label: 'nabu.internals', level: /** @type {1} */ (1) },
    ],
  };
};
