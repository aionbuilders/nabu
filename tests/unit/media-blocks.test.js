// @ts-nocheck
/**
 * Unit tests for VideoBlock and FileBlock — static serializers/parsers and integration.
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════
// VideoBlock statics
// ═══════════════════════════════════════════════════════════

describe('VideoBlock statics', () => {
    it('toHtml renders <video src controls> tag', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        const pb = { type: 'video', props: { ref: 'v.mp4' } };
        const html = VideoBlock.toHtml(pb);
        expect(html).toContain('<video src="v.mp4" controls');
    });

    it('toHtml handles empty ref', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        const html = VideoBlock.toHtml({ type: 'video', props: {} });
        expect(html).toContain('<video src=""');
    });

    it('toMarkdown renders [alt](ref) link form (no native video in markdown)', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        const pb = { type: 'video', props: { ref: 'v.mp4', alt: 'demo' } };
        expect(VideoBlock.toMarkdown(pb)).toBe('[demo](v.mp4)');
    });

    it('toMarkdown falls back to name then "video" label', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        expect(VideoBlock.toMarkdown({ type: 'video', props: { ref: 'v.mp4', name: 'clip.mp4' } })).toBe('[clip.mp4](v.mp4)');
        expect(VideoBlock.toMarkdown({ type: 'video', props: { ref: 'v.mp4' } })).toBe('[video](v.mp4)');
    });

    it('fromHTML converts <video src> element to video PasteBlock', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        const el = document.createElement('video');
        el.setAttribute('src', 'https://example.com/clip.mp4');
        const result = VideoBlock.fromHTML(el);
        expect(result).toEqual({
            type: 'video',
            props: { ref: 'https://example.com/clip.mp4', alt: '' },
            partial: false,
        });
    });

    it('fromHTML reads <source> src when video has no src attr', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        const el = document.createElement('video');
        const source = document.createElement('source');
        source.setAttribute('src', 'https://example.com/fallback.mp4');
        el.appendChild(source);
        const result = VideoBlock.fromHTML(el);
        expect(result.props.ref).toBe('https://example.com/fallback.mp4');
    });

    it('htmlRules has selector "video"', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        expect(VideoBlock.htmlRules[0].selector).toBe('video');
    });

    it('VideoBlock has no markdownRules (videos are not parsed from markdown)', async () => {
        const { VideoBlock } = await import('$lib/blocks/video/video.svelte.js');
        expect(VideoBlock.markdownRules).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════
// FileBlock statics
// ═══════════════════════════════════════════════════════════

describe('FileBlock statics', () => {
    it('toMarkdown renders [name](ref) link form', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        expect(FileBlock.toMarkdown({ type: 'file', props: { name: 'doc.pdf', ref: 'u' } })).toBe('[doc.pdf](u)');
    });

    it('toMarkdown falls back to "file" label when name missing', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        expect(FileBlock.toMarkdown({ type: 'file', props: { ref: 'u' } })).toBe('[file](u)');
    });

    it('toHtml renders <a href download> tag with name and href', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        const html = FileBlock.toHtml({ type: 'file', props: { name: 'doc.pdf', ref: 'u' } });
        expect(html).toContain('download="doc.pdf"');
        expect(html).toContain('href="u"');
    });

    it('toHtml uses name as link text', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        const html = FileBlock.toHtml({ type: 'file', props: { name: 'doc.pdf', ref: 'u' } });
        expect(html).toContain('>doc.pdf</a>');
    });

    it('htmlRules[0].selector is "a[download]" — regression guard against hijacking plain links', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        expect(FileBlock.htmlRules[0].selector).toBe('a[download]');
    });

    it('htmlRules[0].priority is 10', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        expect(FileBlock.htmlRules[0].priority).toBe(10);
    });

    it('fromHTML converts <a download> element to file PasteBlock', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        const el = document.createElement('a');
        el.setAttribute('href', 'https://cdn/doc.pdf');
        el.setAttribute('download', 'doc.pdf');
        el.textContent = 'doc.pdf';
        const result = FileBlock.fromHTML(el);
        expect(result).toEqual({
            type: 'file',
            props: { ref: 'https://cdn/doc.pdf', name: 'doc.pdf' },
            partial: false,
        });
    });

    it('fromHTML falls back to textContent for name if download attr is empty string', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        const el = document.createElement('a');
        el.setAttribute('href', 'https://cdn/doc.pdf');
        el.setAttribute('download', '');
        el.textContent = 'Download File';
        const result = FileBlock.fromHTML(el);
        // download="" is falsy — falls back to textContent
        expect(result.props.name).toBe('Download File');
    });

    it('FileBlock has no markdownRules (plain [x](y) links are not file blocks)', async () => {
        const { FileBlock } = await import('$lib/blocks/file/file.svelte.js');
        expect(FileBlock.markdownRules).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════
// Integration: VideoBlock
// ═══════════════════════════════════════════════════════════

describe('VideoBlock integration', () => {
    it('video:insert action creates a video block with correct data', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { VideoExtension } = await import('$lib/blocks/video/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, VideoExtension] });
        await engine.exec('video:insert', { ref: 'v.mp4', alt: 'demo clip' });
        await new Promise(r => setTimeout(r, 10));

        const roots = engine.tree.roots();
        const videoNode = roots.find(r => r.data.get('type') === 'video');
        expect(videoNode).toBeTruthy();
        expect(videoNode.data.get('type')).toBe('video');
        expect(videoNode.data.get('ref')).toBe('v.mp4');
        expect(videoNode.data.get('status')).toBe('ready');
    });

    it('VideoBlock.create sets all metadata fields', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { VideoExtension, VideoBlock } = await import('$lib/blocks/video/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, VideoExtension] });
        const block = VideoBlock.create(engine, 'video', { ref: 'https://cdn/clip.mp4', alt: 'demo', status: 'ready' });
        await engine.commit();

        expect(block.ref).toBe('https://cdn/clip.mp4');
        expect(block.alt).toBe('demo');
        expect(block.status).toBe('ready');
        expect(block.positions).toBe(1);
        expect(block.getDOMPoint(0)).toBeNull();
        expect(block.beforeinput(new InputEvent('beforeinput'))).toBe(false);
    });

    it('VideoBlock serializes to markdown correctly', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { VideoExtension, VideoBlock } = await import('$lib/blocks/video/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, VideoExtension] });
        const block = VideoBlock.create(engine, 'video', { ref: 'https://cdn/clip.mp4', alt: 'my video' });
        await engine.commit();

        expect(block.serialize('markdown')).toBe('[my video](https://cdn/clip.mp4)');
    });
});

// ═══════════════════════════════════════════════════════════
// Integration: FileBlock
// ═══════════════════════════════════════════════════════════

describe('FileBlock integration', () => {
    it('file:insert action creates a file block with correct data', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { FileExtension } = await import('$lib/blocks/file/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, FileExtension] });
        await engine.exec('file:insert', { ref: 'u', name: 'd.pdf' });
        await new Promise(r => setTimeout(r, 10));

        const roots = engine.tree.roots();
        const fileNode = roots.find(r => r.data.get('type') === 'file');
        expect(fileNode).toBeTruthy();
        expect(fileNode.data.get('type')).toBe('file');
        expect(fileNode.data.get('ref')).toBe('u');
        expect(fileNode.data.get('name')).toBe('d.pdf');
        expect(fileNode.data.get('status')).toBe('ready');
    });

    it('FileBlock.create sets all metadata fields', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { FileExtension, FileBlock } = await import('$lib/blocks/file/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, FileExtension] });
        const block = FileBlock.create(engine, 'file', { ref: 'https://cdn/doc.pdf', name: 'doc.pdf', status: 'ready' });
        await engine.commit();

        expect(block.ref).toBe('https://cdn/doc.pdf');
        expect(block.name).toBe('doc.pdf');
        expect(block.status).toBe('ready');
        expect(block.positions).toBe(1);
        expect(block.getDOMPoint(0)).toBeNull();
        expect(block.beforeinput(new InputEvent('beforeinput'))).toBe(false);
    });

    it('FileBlock serializes to markdown correctly', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { FileExtension, FileBlock } = await import('$lib/blocks/file/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, FileExtension] });
        const block = FileBlock.create(engine, 'file', { ref: 'https://cdn/doc.pdf', name: 'report.pdf' });
        await engine.commit();

        expect(block.serialize('markdown')).toBe('[report.pdf](https://cdn/doc.pdf)');
    });

    it('both video:insert and file:insert work together in one Nabu instance', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { VideoExtension } = await import('$lib/blocks/video/index.js');
        const { FileExtension } = await import('$lib/blocks/file/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, VideoExtension, FileExtension] });
        await engine.exec('video:insert', { ref: 'v.mp4' });
        await engine.exec('file:insert', { ref: 'u', name: 'd.pdf' });
        await new Promise(r => setTimeout(r, 10));

        const roots = engine.tree.roots();
        const videoNode = roots.find(r => r.data.get('type') === 'video');
        const fileNode = roots.find(r => r.data.get('type') === 'file');
        expect(videoNode).toBeTruthy();
        expect(fileNode).toBeTruthy();
        expect(videoNode.data.get('ref')).toBe('v.mp4');
        expect(fileNode.data.get('ref')).toBe('u');
    });
});

// ═══════════════════════════════════════════════════════════
// MediaBlock base
// ═══════════════════════════════════════════════════════════

describe('MediaBlock base', () => {
    it('MediaBlock.createNode sets all five fields', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { ImageExtension } = await import('$lib/blocks/image/index.js');
        const { MediaBlock } = await import('$lib/blocks/media/media-block.svelte.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, ImageExtension] });
        const node = MediaBlock.createNode(engine, 'image', { ref: 'r', alt: 'a', status: 'ready', name: 'n' });
        expect(node.data.get('type')).toBe('image');
        expect(node.data.get('ref')).toBe('r');
        expect(node.data.get('alt')).toBe('a');
        expect(node.data.get('status')).toBe('ready');
        expect(node.data.get('name')).toBe('n');
    });
});
