import { Block, extension } from '#lib/extend.js';
import EmbedComponent from './Embed.svelte';

/**
 * Test-only block: a void block whose UI island hosts ANOTHER editor (a nested editor), to check that the outer engine and the
 * nested one never act on each other's selection. The nested engines are handed over by key (`props.key`) through {@link nested}.
 */

/** The engines the embed blocks render, by key. @type {Map<string, import('#lib').Nabu>} */
export const nested = new Map();

export class EmbedBlock extends Block {
  /** @param {any} nabu @param {any} node */
  constructor(nabu, node) {
    super(nabu, node);
    this.serializers.set('markdown', () => '');
    this.serializers.set('json', () => ({ id: this.id, type: 'embed' }));
    this.serializers.set('application/x-nabu+json', () => ({ type: 'embed', partial: false }));
  }

  component = $derived(this.nabu.components.get('embed') || EmbedComponent);
  positions = $derived(1);
  /** @param {number} offset */
  getDOMPoint(offset) { return null; }
  /** @param {InputEvent} event */
  beforeinput(event) { return false; }

  /** @param {any} nabu @param {string} type @param {Record<string, any>} [props] @param {string | null} [parentId] @param {number | null} [index] */
  static create(nabu, type, props = {}, parentId = null, index = null) {
    const node = nabu.tree.createNode(parentId || undefined, index ?? undefined);
    node.data.set('type', 'embed');
    node.data.set('key', props.key ?? 'n');
    return new EmbedBlock(nabu, node);
  }
}

export const EmbedExtension = extension('embed', { block: EmbedBlock, component: EmbedComponent });
