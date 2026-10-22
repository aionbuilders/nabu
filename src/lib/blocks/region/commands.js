/**
 * The commands of the regions extension (ADR 016 §3.4, lot 2; ADR 017). Each is also an action of the bus:
 * `nabu.exec('region:split')`. Default keys are few on purpose, the arrow-key chords being mostly taken by the OS / browser:
 *
 *  | id                      | default keys                | confirmation | what                                                    |
 *  |-------------------------|-----------------------------|--------------|---------------------------------------------------------|
 *  | `region:split`          | `Mod-Enter`                 | none         | cut here: a new region of the same type starts          |
 *  | `region:merge-previous` | `Backspace`, `Shift-Backspace` | hold      | at the start of a region: remove its marker             |
 *  | `region:merge-next`     | `Delete`                    | hold         | at the end of a region: remove the NEXT marker          |
 *  | `region:insert`         | -                           | -            | `{ type?, at?: 'after' \| 'before', title?, fields? }`   |
 *  | `region:move`           | -                           | -            | `{ direction: 'up' \| 'down' }`                          |
 *  | `region:move-up`/`move-down` | -                      | -            | the same, direction built in (what a `keymap` binds)    |
 *  | `region:promote`/`demote` | -                         | -            | the type of the level above / below                     |
 *  | `region:next`/`prev`/`parent` | -                     | -            | caret to the first text position of the target region   |
 *
 * `exec` runs a command directly (no confirmation: the hold is a KEYBOARD concern, ADR 017 §3.4a). `exec` data can carry
 * `{ region }` (a `Region`, its marker block or its marker id) to act on that region instead of the one holding the caret.
 * Integrators bind the keyless commands with the `keymap` option of the editor.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { CommandDef, CommandContext } from "../../utils/commands.js";
 * @import { Region } from "./regions.svelte.js";
 */

import { Regions } from "./regions.svelte.js";
import { createMessages } from "./messages.js";
import { canMergeIntoPrevious, goToRegion, insertNearRegion, moveRegion, removeMarker, retypeRegion, splitRegion, toRegion } from "./actions.js";

/** @param {Region | null | undefined} region @returns {string} the title, else the label, else the type: never empty */
const nameOf = (region) => region?.title || region?.label || region?.type || '';

/**
 * The region a command acts on: `data.region` when given, else the one holding the caret.
 * @param {CommandContext & Record<string, any>} ctx @param {any} data
 * @returns {Region | null}
 */
function targetRegion(ctx, data) {
    return data && typeof data === 'object' && 'region' in data ? toRegion(ctx.nabu, data.region) : (ctx.region ?? null);
}

/**
 * The caret to put back after a structural command (null when there is no text caret).
 * @param {CommandContext} ctx
 * @returns {{ block: import("../block.svelte.js").Block, offset: number } | null}
 */
function caretOf(ctx) {
    const block = ctx.block;
    const sel = block?.selection;
    return block && sel && sel.from === sel.to ? { block, offset: sel.to } : null;
}

/**
 * @param {import("./messages.js").RegionMessages | undefined} messages
 * @returns {Record<string, CommandDef>}
 */
export function createRegionCommands(messages) {
    const text = createMessages(messages);
    /** @param {Region | null | undefined} r */
    const params = (r) => ({ title: nameOf(r), label: r?.label ?? '', type: r?.type ?? '' });

    /** @param {Region | null} previous */
    const mergePreviousLabel = (previous) => (previous ? text('mergePrevious', params(previous)) : text('mergePreamble'));

    /** Whether the plain Backspace at the start of this block is the region's business (a heading etc. converts to a paragraph first). @param {CommandContext & Record<string, any>} ctx */
    const protectsStart = (ctx) => !!ctx.block && ctx.block.type === ctx.nabu.defaultBlockType && ctx.isCollapsed && ctx.atStartOfRegion && canMergeIntoPrevious(ctx.nabu, ctx.region);

    return {
        'region:split': {
            label: () => text('split'),
            keys: ['Mod-Enter'],
            when: (/** @type {any} */ ctx) => ctx.isCollapsed && ctx.inRootTextBlock && ctx.block.splitsOnEnter !== false,
            run: (nabu, ctx) => splitRegion(nabu, ctx),
        },

        'region:insert': {
            label: (/** @type {any} */ ctx) => text('insert', { type: ctx.region?.type ?? '' }),
            run: (nabu, ctx, data) => insertNearRegion(nabu, targetRegion(/** @type {any} */ (ctx), data), data ?? {}),
        },

        'region:merge-previous': {
            label: (/** @type {any} */ ctx) => mergePreviousLabel(ctx.previousRegion),
            keys: ['Backspace', 'Shift-Backspace'],
            when: (/** @type {any} */ ctx) => protectsStart(ctx),
            confirm: {
                strategy: 'hold',
                target: (/** @type {any} */ ctx) => ctx.region?.marker,
                messages: { hold: (/** @type {{ keys: string, label: string }} */ p) => text('hold', p) },
            },
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                if (!region || !canMergeIntoPrevious(nabu, region)) return false;
                return removeMarker(nabu, region, caretOf(ctx));
            },
        },

        'region:merge-next': {
            label: (/** @type {any} */ ctx) => text('mergeNext', params(ctx.nextRegion)),
            keys: ['Delete'],
            when: (/** @type {any} */ ctx) => ctx.isCollapsed && ctx.atEndOfRegion && !!ctx.nextRegion,
            confirm: {
                strategy: 'hold',
                target: (/** @type {any} */ ctx) => ctx.nextRegion?.marker,
                messages: { hold: (/** @type {{ keys: string, label: string }} */ p) => text('hold', p) },
            },
            run: (nabu, ctx, data) => {
                // With `data.region`: the region that absorbs ITS next region (the one after it disappears as a seam).
                const given = data && typeof data === 'object' && 'region' in data;
                const base = given ? toRegion(nabu, data.region) : null;
                const next = given ? (base ? Regions.get(nabu).next(base) : null) : /** @type {any} */ (ctx).nextRegion;
                if (!next) return false;
                return removeMarker(nabu, next, caretOf(ctx));
            },
        },

        'region:move': {
            label: () => text('move'),
            when: (/** @type {any} */ ctx) => !!ctx.region,
            run: (nabu, ctx, data) => {
                const direction = data?.direction;
                if (direction !== 'up' && direction !== 'down') { nabu.warn('region:move: data.direction must be "up" or "down"'); return false; }
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? moveRegion(nabu, region, direction, caretOf(ctx)) : false;
            },
        },

        // The same move with the direction built in: a key cannot carry `data`, so these are what a `keymap` binds.
        'region:move-up': {
            label: () => text('moveUp'),
            when: (/** @type {any} */ ctx) => !!ctx.region,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? moveRegion(nabu, region, 'up', caretOf(ctx)) : false;
            },
        },

        'region:move-down': {
            label: () => text('moveDown'),
            when: (/** @type {any} */ ctx) => !!ctx.region,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? moveRegion(nabu, region, 'down', caretOf(ctx)) : false;
            },
        },

        'region:promote': {
            label: () => text('promote'),
            when: (/** @type {any} */ ctx) => !!ctx.region,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? retypeRegion(nabu, region, 'promote') : false;
            },
        },

        'region:demote': {
            label: () => text('demote'),
            when: (/** @type {any} */ ctx) => !!ctx.region,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? retypeRegion(nabu, region, 'demote') : false;
            },
        },

        'region:next': {
            label: () => text('next'),
            run: (nabu, ctx, data) => {
                const regions = Regions.get(nabu);
                const base = targetRegion(/** @type {any} */ (ctx), data);
                const target = base ? regions.next(base) : (regions.list[0] ?? null);
                return target ? goToRegion(nabu, target) : false;
            },
        },

        'region:prev': {
            label: () => text('prev'),
            run: (nabu, ctx, data) => {
                const base = targetRegion(/** @type {any} */ (ctx), data);
                const target = base ? Regions.get(nabu).prev(base) : null;
                return target ? goToRegion(nabu, target) : false;
            },
        },

        'region:parent': {
            label: () => text('parent'),
            run: (nabu, ctx, data) => {
                const parent = targetRegion(/** @type {any} */ (ctx), data)?.parent;
                return parent ? goToRegion(nabu, parent) : false;
            },
        },
    };
}
