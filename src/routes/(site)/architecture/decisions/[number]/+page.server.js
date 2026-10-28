import { error } from '@sveltejs/kit';
import { records } from '../../../../../site/architecture/adr.server.js';
import { chapters } from '../../../../../site/architecture/chapters.server.js';
import { ADR_DIR, adrHref, describeAdr, githubBlob, plain, prepareAdrBody } from '../../../../../site/architecture/adr.js';
import { storyList } from '../../../../../site/architecture/chapters.js';
import { ADR_NOTES, ADR_SHORT } from '../../../../../site/architecture/data.js';
import { buildDoc } from '../../../../../site/docs/doc.server.js';

export const entries = () => records().adrs.map((a) => ({ number: a.id }));

export const load = async ({ params }) => {
  const model = records();
  const adr = /^\d{3}$/.test(params.number) ? model.get(Number(params.number)) : null;
  if (!adr) error(404, 'Not found');

  const { snapshot, ids, code } = await buildDoc(prepareAdrBody(adr.body), { dir: ADR_DIR, tocLevels: [] });
  const { prev, next } = model.neighbours(adr.number);
  /** @param {import('../../../../../site/architecture/adr.js').Adr | null} a */
  const brief = (a) => (a ? { id: a.id, href: adrHref(a.number), title: ADR_SHORT[a.number] ?? a.title } : null);
  const successor = adr.supersededBy ? model.get(adr.supersededBy) : null;
  // the chapter that tells the story of this record, if it exists
  const chapter = storyList(chapters()).find((c) => c.href && c.adrs.includes(adr.number));

  return {
    title: `ADR ${adr.id} · ${adr.title} · Nabu`,
    description: describeAdr(adr.body),
    record: {
      id: adr.id,
      number: adr.number,
      title: adr.title,
      status: adr.status,
      date: adr.date,
      replacedOn: model.replacedOn(adr),
      successor: brief(successor),
      supersedes: adr.supersedes.flatMap((n) => { const b = brief(model.get(n)); return b ? [b] : []; }),
      note: adr.status === 'superseded' ? ADR_NOTES[adr.number] ?? `It was replaced by ADR ${successor?.id ?? ''}.`.replace(' .', '.') : null,
      proposal: adr.status === 'proposed' ? plain(adr.statusText.replace(/^\s*proposed\s*[—–:.-]*\s*/i, '')) : null,
      story: chapter ? { href: chapter.href, label: `the story, chapter ${String(chapter.n).padStart(2, '0')}` } : null,
      frenchUrl: adr.original ? githubBlob(`${ADR_DIR}/${adr.original}`) : null,
      sourceUrl: githubBlob(adr.file),
    },
    doc: { snapshot, ids, code },
    prev: brief(prev),
    next: brief(next),
  };
};
