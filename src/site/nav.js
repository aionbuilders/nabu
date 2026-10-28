/** Main navigation, shared by the header (and mirrored by the footer columns). Every entry is a real page. Active on its own route and below it (`/architecture/*`). */
export const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/api', label: 'API' },
  { href: '/labs', label: 'Labs' },
  { href: '/architecture', label: 'Architecture' },
  { href: '/changelog', label: 'Changelog' }
];

export const GITHUB_URL = 'https://github.com/aionbuilders/nabu';
export const DISCORD_URL = 'https://discord.gg/gKkyqRRuWe';
export const LICENSE_URL = 'https://opensource.org/licenses/MIT';

/** Footer columns (HomeB). */
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
      { href: '/architecture/limits', label: 'Limits' },
      { href: '/architecture/decisions', label: 'Decision records' }
    ]
  },
  {
    title: 'Project',
    links: [
      { href: '/changelog', label: 'Changelog' },
      { href: '/architecture/how-it-is-made', label: "How it's made" },
      { href: '/brand', label: 'Brand' },
      { href: GITHUB_URL, label: 'GitHub' },
      { href: DISCORD_URL, label: 'Discord' },
      { href: LICENSE_URL, label: 'License' }
    ]
  }
];
