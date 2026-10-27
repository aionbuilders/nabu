import { getChangelog } from '../../../site/docs/content.server.js';
import { buildDoc } from '../../../site/docs/doc.server.js';

export const load = async () => {
  const { body, dir, edit } = getChangelog();
  const { snapshot, ids, code, toc, headings } = await buildDoc(body, { dir });
  return {
    title: 'Changelog — Nabu',
    description: 'What changed in each release of Nabu, the block editor for Svelte 5: added, changed and breaking, with the unreleased work on top.',
    doc: { snapshot, ids, code },
    toc,
    // The left column lists the releases (the level-2 headings).
    releases: headings.filter((h) => h.depth === 2).map((h) => ({ label: h.label, href: `#${h.id}`, mono: false })),
    edit,
  };
};
