// @ts-nocheck
/**
 * Unit tests for ImageBlock — static serializers/parsers and integration.
 */

import { describe, it, expect } from 'vitest';

describe('ImageBlock statics', () => {
    it('toMarkdown renders ![alt](ref) format', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const pb = { type: 'image', props: { alt: 'a', ref: 'u' } };
        expect(ImageBlock.toMarkdown(pb)).toBe('![a](u)');
    });

    it('toMarkdown handles empty alt and ref', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const pb = { type: 'image', props: {} };
        expect(ImageBlock.toMarkdown(pb)).toBe(''); // no source: alt text only (here none)
        expect(ImageBlock.toMarkdown({ type: 'image', props: { alt: 'cat' } })).toBe('cat');
    });

    it('toHtml renders <img src alt> tag', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const pb = { type: 'image', props: { alt: 'a', ref: 'u' } };
        const html = ImageBlock.toHtml(pb);
        expect(html).toContain('<img src="u" alt="a">');
    });

    it('toHtml handles empty props gracefully', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const pb = { type: 'image', props: {} };
        const html = ImageBlock.toHtml(pb);
        expect(html).toBe(''); // no source: no live <img>
        expect(ImageBlock.toHtml({ type: 'image', props: { alt: 'cat' } })).toBe('<p>cat</p>');
    });

    it('fromMarkdown parses alt and ref from image syntax', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const result = ImageBlock.fromMarkdown(['![cat](http://x/y.png)']);
        expect(result).toEqual({
            type: 'image',
            props: { alt: 'cat', ref: 'http://x/y.png' },
            partial: false,
        });
    });

    it('fromMarkdown handles empty alt text', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const result = ImageBlock.fromMarkdown(['![](https://example.com/img.jpg)']);
        expect(result).toEqual({
            type: 'image',
            props: { alt: '', ref: 'https://example.com/img.jpg' },
            partial: false,
        });
    });

    it('fromMarkdown returns null when input does not match image syntax', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        expect(ImageBlock.fromMarkdown(['plain text'])).toBeNull();
        expect(ImageBlock.fromMarkdown(['[link](url)'])).toBeNull();
    });

    it('fromHTML converts <img> element to image PasteBlock', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const el = document.createElement('img');
        el.setAttribute('src', 'http://example.com/photo.png');
        el.setAttribute('alt', 'a photo');
        const result = ImageBlock.fromHTML(el);
        expect(result).toEqual({
            type: 'image',
            props: { ref: 'http://example.com/photo.png', alt: 'a photo' },
            partial: false,
        });
    });

    it('fromHTML: an <img> without src (lazy placeholder) is no image block; a missing alt is empty', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        expect(ImageBlock.fromHTML(document.createElement('img'))).toBeNull();
        const el = document.createElement('img');
        el.setAttribute('src', ' https://example.com/a.png ');
        expect(ImageBlock.fromHTML(el).props).toEqual({ ref: 'https://example.com/a.png', alt: '' });
    });

    it('markdownRules[0].detect matches image markdown', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const rule = ImageBlock.markdownRules[0];
        expect(rule.detect.test('![a](u)')).toBe(true);
        expect(rule.detect.test('![](http://example.com/img.png)')).toBe(true);
    });

    it('markdownRules[0].detect does NOT match plain text', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        const rule = ImageBlock.markdownRules[0];
        // Reset lastIndex (regex is not global, so no issues — but be safe)
        expect(rule.detect.test('text')).toBe(false);
        expect(rule.detect.test('[link](url)')).toBe(false);
    });

    it('markdownRules[0].priority is 25', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        expect(ImageBlock.markdownRules[0].priority).toBe(25);
    });

    it('markdownRules[0].consume always returns 1', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        expect(ImageBlock.markdownRules[0].consume()).toBe(1);
    });

    it('htmlRules has selector "img"', async () => {
        const { ImageBlock } = await import('$lib/blocks/image/image.svelte.js');
        expect(ImageBlock.htmlRules[0].selector).toBe('img');
    });
});

describe('ImageBlock integration', () => {
    it('image:insert action creates an image block with correct data', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { ImageExtension } = await import('$lib/blocks/image/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, ImageExtension] });
        await engine.exec('image:insert', { ref: 'http://x/y.png', alt: 'cat' });
        // exec is async but the action calls nabu.commit() which ticks
        // Wait a microtask for commit to settle
        await new Promise(r => setTimeout(r, 10));

        const roots = engine.tree.roots();
        const imageNode = roots.find(r => r.data.get('type') === 'image');
        expect(imageNode).toBeTruthy();
        expect(imageNode.data.get('type')).toBe('image');
        expect(imageNode.data.get('ref')).toBe('http://x/y.png');
        expect(imageNode.data.get('alt')).toBe('cat');
        expect(imageNode.data.get('status')).toBe('ready');
    });

    it('ImageBlock.create sets all metadata fields', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { ImageExtension, ImageBlock } = await import('$lib/blocks/image/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, ImageExtension] });
        const block = ImageBlock.create(engine, 'image', { ref: 'https://cdn/img.jpg', alt: 'desc', status: 'ready' });
        await engine.commit();

        expect(block.ref).toBe('https://cdn/img.jpg');
        expect(block.alt).toBe('desc');
        expect(block.status).toBe('ready');
        expect(block.positions).toBe(1);
        expect(block.getDOMPoint(0)).toBeNull();
        expect(block.beforeinput(new InputEvent('beforeinput'))).toBe(false);
    });

    it('ImageBlock serializes to markdown correctly', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { ImageExtension, ImageBlock } = await import('$lib/blocks/image/index.js');

        const engine = new Nabu({ extensions: [ParagraphExtension, ImageExtension] });
        const block = ImageBlock.create(engine, 'image', { ref: 'https://cdn/img.jpg', alt: 'my photo' });
        await engine.commit();

        expect(block.serialize('markdown')).toBe('![my photo](https://cdn/img.jpg)');
    });
});

describe('Files system', () => {
    it('Files.get returns the same instance for the same nabu', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { Files } = await import('$lib/files/files.svelte.js');

        const engine = new Nabu({ extensions: [ParagraphExtension] });
        const f1 = Files.get(engine);
        const f2 = Files.get(engine);
        expect(f1).toBe(f2);
    });

    it('Files.resolve returns identity for external URLs', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { Files } = await import('$lib/files/files.svelte.js');

        const engine = new Nabu({ extensions: [ParagraphExtension] });
        const files = Files.get(engine);
        expect(files.resolve('https://example.com/image.png')).toBe('https://example.com/image.png');
    });

    it('Files.resolve returns empty string for empty ref', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { Files } = await import('$lib/files/files.svelte.js');

        const engine = new Nabu({ extensions: [ParagraphExtension] });
        const files = Files.get(engine);
        expect(files.resolve('')).toBe('');
    });

    it('Files.resolve uses custom config.resolve for non-nabu refs', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { Files } = await import('$lib/files/files.svelte.js');

        const engine = new Nabu({
            extensions: [ParagraphExtension],
            files: { resolve: (ref) => 'https://cdn.example.com/' + ref }
        });
        const files = Files.get(engine);
        expect(files.resolve('images/photo.jpg')).toBe('https://cdn.example.com/images/photo.jpg');
    });

    it('Files.persist stores bytes in Loro and returns nabu-asset: ref (if URL.createObjectURL available)', async () => {
        const { Nabu } = await import('$lib/blocks/nabu.svelte.js');
        const { ParagraphExtension } = await import('$lib/blocks/paragraph/index.js');
        const { Files } = await import('$lib/files/files.svelte.js');

        // If File.arrayBuffer or URL.createObjectURL are unavailable, skip
        if (typeof URL.createObjectURL !== 'function') {
            console.log('SKIP: URL.createObjectURL not available in this environment');
            return;
        }

        const engine = new Nabu({ extensions: [ParagraphExtension] });
        const files = Files.get(engine);

        const fakeFile = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' });
        const ref = await files.persist(fakeFile);

        expect(ref).toMatch(/^nabu-asset:/);

        // resolve should return a non-empty objectURL
        const url = files.resolve(ref);
        expect(url).toBeTruthy();
        expect(typeof url).toBe('string');
    });
});
