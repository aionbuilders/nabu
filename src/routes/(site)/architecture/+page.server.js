import { chapters } from '../../../site/architecture/chapters.server.js';
import { records } from '../../../site/architecture/adr.server.js';
import { adrLine, storyList } from '../../../site/architecture/chapters.js';
import { ARCH_DESCRIPTION } from '../../../site/architecture/data.js';

export const load = () => {
  const model = records();
  const supersededBy = new Map(model.adrs.map((a) => [a.number, a.supersededBy]));
  const story = storyList(chapters()).map((c) => ({ ...c, adrLine: adrLine(c.adrs, supersededBy) }));
  return {
    title: 'Architecture — Nabu',
    description: ARCH_DESCRIPTION,
    story,
    counts: model.counts,
  };
};
