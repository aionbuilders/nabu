// The brand page is static: prerendered, with its own title and description (the root layout reads them from the load data).
export const prerender = true;

export const load = () => ({
  title: 'Brand · Nabu',
  description:
    'The Nabu brand: the scribe’s mark and its three readings, the logo and how it is built, icons, colours with their contrast ratios, type, voice, and what not to do. Files to download.'
});
