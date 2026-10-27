/**
 * The curated extension set of the site's editors (home page, Performance lab): text, headings, lists (+ to-do), quote, code, divider,
 * regions, rich text, shortcuts, paste. No media. Public API only (the root entry's exports).
 * @param {typeof import('#lib')} lib
 */
export function curatedPreset(lib) {
  return [
    lib.ParagraphExtension,
    lib.HeadingExtension,
    lib.BlockquoteExtension,
    lib.DividerExtension,
    lib.CodeExtension,
    lib.ListExtension,
    lib.ListItemExtension,
    lib.RegionsExtension(),
    lib.RichTextExtension,
    lib.TypographyExtension,
    lib.MarkdownShortcutsExtension,
    lib.PlainTextPasteExtension,
    lib.HtmlPasteExtension,
    lib.MarkdownPasteExtension,
    lib.NabuPasteExtension,
    lib.BlockExtension,
  ];
}
