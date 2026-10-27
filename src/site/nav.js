/** Main navigation, shared by the header (and mirrored by the footer columns). Docs, API and Changelog are real pages; the others are stubs for now. */
export const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/api', label: 'API' },
  { href: '/labs', label: 'Labs' },
  { href: '/architecture', label: 'Architecture' },
  { href: '/changelog', label: 'Changelog' }
];

export const GITHUB_URL = 'https://github.com/aionbuilders/nabu';
export const LICENSE_URL = 'https://opensource.org/licenses/MIT';

/** Footer columns (HomeB). Learn/Explore targets that have no page of their own yet point at the nearest stub. */
export const FOOTER_COLUMNS = [
  {
    title: 'Learn',
    links: [
      { href: '/docs/getting-started/installation', label: 'Getting started' },
      { href: '/docs#guides', label: 'Guides' },
      { href: '/api', label: 'API reference' }
    ]
  },
  {
    title: 'Explore',
    links: [
      { href: '/labs', label: 'Labs' },
      { href: '/architecture', label: 'Architecture' },
      { href: '/architecture#roadmap', label: 'Roadmap' } // TODO: own page / anchor once the architecture page exists
    ]
  },
  {
    title: 'Project',
    links: [
      { href: '/changelog', label: 'Changelog' },
      { href: GITHUB_URL, label: 'GitHub' },
      { href: LICENSE_URL, label: 'License' }
    ]
  }
];
