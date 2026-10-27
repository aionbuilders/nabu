// @ts-nocheck
/**
 * Shared helpers of the HTML paste unit tests (corpus + rules): a real Nabu with the block extensions, the HTML
 * interpreter, and a compact textual outline of a PasteFragment.
 */
import { Nabu } from '#lib/blocks/nabu.svelte.js';
import { ParagraphExtension } from '#lib/blocks/paragraph/index.js';
import { HeadingExtension } from '#lib/blocks/heading/index.js';
import { BlockquoteExtension } from '#lib/blocks/blockquote/index.js';
import { DividerExtension } from '#lib/blocks/divider/index.js';
import { CodeExtension } from '#lib/blocks/code/index.js';
import { CalloutExtension } from '#lib/blocks/callout/index.js';
import { ToggleExtension } from '#lib/blocks/toggle/index.js';
import { ImageExtension } from '#lib/blocks/image/index.js';
import { VideoExtension } from '#lib/blocks/video/index.js';
import { FileExtension } from '#lib/blocks/file/index.js';
import { ListExtension, ListItemExtension } from '#lib/blocks/list/index.js';
import { HtmlPasteExtension } from '#lib/paste/html.paste.js';

export const EXTENSIONS = [
  ParagraphExtension, HeadingExtension, BlockquoteExtension, DividerExtension, CodeExtension, CalloutExtension, ToggleExtension,
  ImageExtension, VideoExtension, FileExtension, ListExtension, ListItemExtension, HtmlPasteExtension,
];

export async function makeEditor(extensions = EXTENSIONS) {
  const engine = new Nabu({ extensions });
  await engine.commit();
  return engine;
}

const interpreter = HtmlPasteExtension.pasteInterpreters[0];

/** Run the HTML interpreter; returns the fragment (or null). */
export const interpret = (engine, html) => interpreter.interpret(html, engine);

const MARK_LETTER = { bold: 'b', italic: 'i', underline: 'u', strikethrough: 's', code: 'c' };

/** `plain text [b:bold] [a=https://x:link]` — marks sorted, every character visible. */
export function fmtDelta(delta = []) {
  return delta.map((op) => {
    const marks = Object.entries(op.attributes ?? {}).map(([k, v]) => (k === 'link' ? `a=${v}` : MARK_LETTER[k] ?? k)).sort();
    const text = op.insert.replace(/\n/g, '\\n').replace(/ /g, '⍽');
    return marks.length ? `[${marks.join(',')}:${text}]` : text;
  }).join('');
}

/** Outline of one PasteBlock: `p(text)`, `h2(text)`, `ul{li(a) li(b){ul{li(c)}}}`, `hr`, `code:js(text)`. */
export function outlineBlock(pb) {
  const kids = pb.children?.length ? `{${pb.children.map(outlineBlock).join(' ')}}` : '';
  const text = fmtDelta(pb.delta);
  switch (pb.type) {
    case 'paragraph': return `p(${text})${kids}`;
    case 'heading': return `h${pb.props?.level}(${text})${kids}`;
    case 'blockquote': return `quote(${text})`;
    case 'divider': return 'hr';
    case 'code': return `code${pb.props?.language ? ':' + pb.props.language : ''}(${text})`;
    case 'list': return `${pb.props?.listType === 'ordered' ? 'ol' : pb.props?.listType === 'todo' ? 'todo' : 'ul'}${kids}`;
    case 'list-item': return `li${pb.props?.checked === undefined ? '' : pb.props.checked ? '[x]' : '[ ]'}(${text})${kids}`;
    default: return `${pb.type}(${text})${kids}`;
  }
}

export const outline = (fragment) => (fragment ? fragment.blocks.map(outlineBlock).join(' ; ') : null);

/** Outline of the HTML as the interpreter reads it. */
export const read = (engine, html) => outline(interpret(engine, html));

/** Every text run of a fragment, flattened (all blocks, children included). */
export function allText(fragment) {
  const out = [];
  const walk = (b) => { for (const op of b.delta ?? []) out.push(op.insert); (b.children ?? []).forEach(walk); };
  (fragment?.blocks ?? []).forEach(walk);
  return out.join('\n');
}
