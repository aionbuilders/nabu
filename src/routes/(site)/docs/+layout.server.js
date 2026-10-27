import { docsNav } from '../../../site/docs/content.server.js';

export const load = () => ({
  nav: docsNav().navSections,
});
