import { navSections } from '../../../site/api/model.server.js';

export const load = () => ({
  nav: navSections(),
});
