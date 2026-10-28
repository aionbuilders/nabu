import { docsNav } from '../../../site/docs/content.server.js';

export const load = () => {
  const nav = docsNav();
  return {
    title: 'Docs · Nabu',
    description: 'Guides, recipes and getting-started pages for Nabu, the block editor for Svelte 5 built on a CRDT: install it, mount an editor, extend it, persist and sync it, theme it.',
    sections: nav.sections.map((s) => ({
      id: s.id,
      title: s.title,
      blurb: s.blurb,
      pages: s.pages.map((p) => ({ title: p.title, description: p.description, href: p.href })),
    })),
    toc: nav.sections.map((s) => ({ id: s.id, label: s.title, level: /** @type {1} */ (1) })),
  };
};
