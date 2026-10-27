import { records } from '../../../../site/architecture/adr.server.js';
import { adrHref, githubBlob } from '../../../../site/architecture/adr.js';
import { ADR_SHORT, MISSING_ADR } from '../../../../site/architecture/data.js';

export const load = () => {
  const model = records();
  return {
    records: model.adrs.map((a) => ({
      number: a.number,
      id: a.id,
      href: adrHref(a.number),
      label: ADR_SHORT[a.number] ?? a.title,
      status: /** @type {'accepted' | 'superseded' | 'proposed'} */ (a.status),
    })),
    counts: model.counts,
    missing: { text: MISSING_ADR.text, noteLabel: MISSING_ADR.noteLabel, noteUrl: githubBlob(MISSING_ADR.notePath) },
  };
};
