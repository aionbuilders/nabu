import { getModel, renderItem } from '../../../../site/api/model.server.js';

export const load = async () => {
  const model = getModel();
  const nabu = /** @type {any} */ (model.items)['root/Nabu'];
  const member = nabu.members.find((/** @type {any} */ m) => m.name === 'internals');
  const { item, hl } = await renderItem({ ...(/** @type {any} */ (model.items)[model.internals.id]), members: [member] });
  const rendered = item.members[0];
  return {
    title: 'nabu.internals — API — Nabu',
    description: rendered.descriptionHtml || rendered.summaryHtml,
    summary: rendered.summaryHtml,
    typeId: model.internals.id,
    keys: item.properties,
    signatureHtml: hl('get internals(): NabuInternals', 'ts'),
    toc: [
      { id: 'warning', label: 'Unstable' },
      { id: 'access', label: 'Access' },
      { id: 'keys', label: 'Keys' },
    ],
  };
};
