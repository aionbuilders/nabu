import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDoc } from '../../../../site/docs/doc.server.js';
import history from '../../../../site/architecture/history.json';
import { ESSAY_FILES, MADE_DESCRIPTION, MADE_TITLE, ledgerNote, ledgerRows, strata } from '../../../../site/architecture/made.js';

// The page reads only what is committed: history.json (made by `bun run history`, see scripts/history.js; the build never needs jj or git)
// and the two essay files, which are Nabu documents like the chapters (read-only, built here, hydrated in the browser). They are plain
// Markdown, copied as Killian wrote them; they are not in docs/{getting-started,guides,recipes} nor in docs/architecture/chapters/, so the
// docs sidebar and the list of chapters never see them.
export const load = async () => {
  const essay = async (/** @type {'en' | 'fr'} */ lang, /** @type {number} */ peer) => {
    const md = readFileSync(resolve(process.cwd(), ESSAY_FILES[lang]), 'utf8');
    const { snapshot, ids, code } = await buildDoc(md, { dir: 'docs/architecture', tocLevels: [], peer });
    return { snapshot, ids, code };
  };
  return {
    title: MADE_TITLE,
    description: MADE_DESCRIPTION,
    strata: strata(history),
    rows: ledgerRows(history),
    note: ledgerNote(history),
    en: await essay('en', 1),
    fr: await essay('fr', 2),
  };
};
