import { CUSTOM_PAGES, SECTIONS, editUrl } from '../../../../../site/docs/content.js';
import { docsNav } from '../../../../../site/docs/content.server.js';
import { loadTour } from '../../../../../site/tour/tour.server.js';

// A page of the docs that is not Markdown (see CUSTOM_PAGES): the story, the cards and the "after" of each case are Nabu documents built here, at build time,
// like the pages of the docs (src/site/tour/tour.server.js), and rebuilt in the browser from their snapshots.
const PAGE = /** @type {import('../../../../../site/docs/content.js').DocPage} */ (CUSTOM_PAGES.find((p) => p.slug === 'tour-of-the-blocks'));

export const load = async () => {
  const { prev, next } = docsNav().neighbours(PAGE.href);
  const brief = (/** @type {typeof PAGE | null} */ p) => (p ? { title: p.title, href: p.href } : null);
  return {
    title: `${PAGE.title} — Docs — Nabu`,
    description: PAGE.description,
    wide: true, // the docs layout: the whole width, no "On this page", the navigation behind its button
    page: { title: PAGE.title, section: PAGE.section, sectionTitle: SECTIONS.find((s) => s.id === PAGE.section)?.title ?? PAGE.section },
    edit: editUrl(PAGE.file),
    prev: brief(prev),
    next: brief(next),
    tour: await loadTour(),
  };
};
