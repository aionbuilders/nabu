import { error } from '@sveltejs/kit';
import { allDocPages, docsNav, getDocPage } from '../../../../../site/docs/content.server.js';
import { SECTIONS } from '../../../../../site/docs/content.js';
import { buildDoc } from '../../../../../site/docs/doc.server.js';

export const entries = () => allDocPages();

export const load = async ({ params }) => {
  const found = getDocPage(params.section, params.slug);
  if (!found) error(404, 'Not found');
  const { page, body, dir, edit } = found;
  const { snapshot, ids, code, toc } = await buildDoc(body, { dir });
  const { prev, next } = docsNav().neighbours(page.href);
  const brief = (/** @type {typeof page | null} */ p) => (p ? { title: p.title, href: p.href } : null);
  return {
    title: `${page.title} · Docs · Nabu`,
    description: page.description,
    page: { title: page.title, section: page.section, sectionTitle: SECTIONS.find((s) => s.id === page.section)?.title ?? page.section },
    doc: { snapshot, ids, code },
    toc,
    edit,
    prev: brief(prev),
    next: brief(next),
  };
};
