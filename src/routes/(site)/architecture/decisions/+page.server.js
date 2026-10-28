import { records } from '../../../../site/architecture/adr.server.js';
import { adrHref } from '../../../../site/architecture/adr.js';
import { ADR_SHORT } from '../../../../site/architecture/data.js';

export const load = () => {
  const model = records();
  return {
    title: 'Decision records · Architecture · Nabu',
    description: `Every architectural decision of Nabu, as it was taken: context, decision, consequences and status. ${model.counts.all} records, ${model.counts.superseded} superseded.`,
    list: model.adrs.map((a) => ({
      id: a.id,
      href: adrHref(a.number),
      title: ADR_SHORT[a.number] ?? a.title,
      status: a.status,
      date: a.date,
      successor: a.supersededBy ? String(a.supersededBy).padStart(3, '0') : null,
    })),
    counts: model.counts,
  };
};
