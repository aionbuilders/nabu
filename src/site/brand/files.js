/** Files of the brand kit. They live in `brand/` (the single source) and are served at `/brand/files/<name>`: see the endpoint. */

export const KIT_NAME = 'nabu-brand-kit.zip';
export const KIT_URL = `/brand/files/${KIT_NAME}`;

/** @type {{ name: string, type: string, note: string }[]} */
export const FILES = [
  { name: 'nabu-logo-light.svg', type: 'image/svg+xml', note: 'Lockup for light backgrounds' },
  { name: 'nabu-logo-dark.svg', type: 'image/svg+xml', note: 'Lockup for dark backgrounds' },
  { name: 'nabu-logo-mono.svg', type: 'image/svg+xml', note: 'Lockup in one colour (currentColor)' },
  { name: 'nabu-mark.svg', type: 'image/svg+xml', note: 'The mark alone, one colour (currentColor)' },
  { name: 'nabu-icon.svg', type: 'image/svg+xml', note: 'App icon, rounded square' },
  { name: 'nabu-icon-square.svg', type: 'image/svg+xml', note: 'App icon, square (for platforms that round it)' },
  { name: 'nabu-icon-512.png', type: 'image/png', note: 'App icon, 512 × 512 px' },
  { name: 'apple-touch-icon.png', type: 'image/png', note: 'Touch icon, 180 × 180 px' },
  { name: 'favicon-32.png', type: 'image/png', note: 'Favicon, 32 × 32 px' },
  { name: 'nabu.svg', type: 'image/svg+xml', note: 'The original board, 1920 × 1080 (source drawing)' }
];

/** @param {string} name */
export const fileUrl = (name) => `/brand/files/${name}`;
