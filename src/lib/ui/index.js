/**
 * @module @aionbuilders/nabu/ui
 *
 * The optional UI components, to mount next to `<NabuEditor {engine} />`: formatting toolbar, slash menu, drag handle and the
 * two command-confirmation surfaces (`CommandInvite`, `CommandChooser`). None is required: the editor works without them.
 */

export { default as FloatingToolbar } from './FloatingToolbar.svelte';
export { default as SlashMenu } from './SlashMenu.svelte';
export { default as DragHandle } from './DragHandle.svelte';
export { default as CommandInvite } from './CommandInvite.svelte';
export { default as CommandChooser } from './CommandChooser.svelte';
export { SlashMenuController, DEFAULT_SLASH_COMMANDS } from './slash-menu.svelte.js';

/** @typedef {import('./slash-menu.svelte.js').SlashCommand} SlashCommand An entry of the slash menu. */
