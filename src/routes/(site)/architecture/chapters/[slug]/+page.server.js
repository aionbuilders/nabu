import { error } from '@sveltejs/kit';
import { chapterFiles, chapters } from '../../../../../site/architecture/chapters.server.js';
import { records } from '../../../../../site/architecture/adr.server.js';
import { CHAPTERS_DIR, chapterNumber, nextAfter, prepareChapterBody, prevBefore, splitLead, storyList } from '../../../../../site/architecture/chapters.js';
import { ADR_SHORT } from '../../../../../site/architecture/data.js';
import { adrHref, pad } from '../../../../../site/architecture/adr.js';
import { buildDoc } from '../../../../../site/docs/doc.server.js';

export const entries = () => chapters().map((c) => ({ slug: c.slug }));

export const load = async ({ params }) => {
  const chapter = chapters().find((c) => c.slug === params.slug);
  if (!chapter) error(404, 'Not found');

  // The body is two Nabu documents, cut after the first paragraph, so that the live widget can sit between them.
  const { lead, rest } = splitLead(prepareChapterBody(chapter.body, chapterFiles()));
  const build = async (/** @type {string} */ md, /** @type {number} */ peer) => {
    if (!md.trim()) return null;
    const { snapshot, ids, code } = await buildDoc(md, { dir: CHAPTERS_DIR, tocLevels: [], peer });
    return { snapshot, ids, code };
  };

  const model = records();
  const story = storyList(chapters());
  return {
    title: `${chapter.title} — Architecture — Nabu`,
    description: chapter.description,
    chapter: { n: chapter.n, number: chapterNumber(chapter.n), title: chapter.title, file: chapter.file },
    lead: await build(lead, 1),
    rest: await build(rest, 2),
    xray: chapter.xray,
    adrs: chapter.adrs.map((n) => {
      const adr = model.get(n);
      return { id: pad(n), label: `ADR ${pad(n)} · ${ADR_SHORT[n] ?? adr?.title ?? ''}`.replace(/ · $/, ''), href: adr ? adrHref(n) : null };
    }),
    prev: prevBefore(chapter.n, story),
    next: nextAfter(chapter.n, story),
  };
};
