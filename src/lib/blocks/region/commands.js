/**
 * The commands of the regions extension (ADR 016 §3.4, ADR 018 §3.5 / §3.9; ADR 017). Each is also an action of the bus:
 * `nabu.exec('region:split')`. Default keys are few on purpose, the arrow-key chords being mostly taken by the OS / browser:
 *
 *  | id                      | default keys                   | confirmation | what                                                          |
 *  |-------------------------|--------------------------------|--------------|---------------------------------------------------------------|
 *  | `region:split`          | `Mod-Enter`                    | none         | cut here: a new region of the same type takes the rest        |
 *  | `region:merge-previous` | `Backspace`, `Shift-Backspace` | hold         | at the start of a region: join the previous one / dissolve    |
 *  | `region:merge-next`     | `Delete`                       | hold         | at the end of a region: the same for the NEXT region          |
 *  | `region:exit`           | `Mod-Shift-Enter`              | none         | a paragraph right after the region, one level up              |
 *  | `region:demote`         | `Tab` (in a title only)        | none         | becomes the last sub-region of the previous sibling           |
 *  | `region:promote`        | `Shift-Tab` (in a title only)  | none         | leaves its parent; the following siblings follow it           |
 *  | `region:unwrap`         | -                              | -            | the title becomes a paragraph, the body stays                 |
 *  | `region:insert`         | -                              | -            | `{ type?, at?: 'after' \| 'before' \| 'inside', index?, title?, fields? }` |
 *  | `region:create`         | - (`:::` + Space)              | choose       | `{ type? }`: a region where the caret is (see create.js)      |
 *  | `region:close`          | - (`:::` + Enter)              | choose       | `{ region? }`: end the region here (see close.js)             |
 *  | `region:move`           | -                              | -            | `{ direction: 'up' \| 'down' }`                                |
 *  | `region:move-up`/`move-down` | -                         | -            | the same, direction built in (what a `keymap` binds)          |
 *  | `region:next`/`prev`/`parent` | -                        | -            | caret to the first text position of the target region's body  |
 *
 * `exec` runs a command directly (no confirmation: the hold is a KEYBOARD concern, ADR 017 §3.4a). `exec` data can carry
 * `{ region }` (a `Region`, its block or its id) to act on that region instead of the one holding the caret. For
 * `region:merge-next` it is the region that absorbs: its NEXT SIBLING region is merged (or dissolved) into it.
 * Integrators bind the keyless commands with the `keymap` option of the editor.
 *
 * @import { Nabu } from "../nabu.svelte.js";
 * @import { CommandDef, CommandContext } from "../../utils/commands.js";
 * @import { Region } from "./regions.svelte.js";
 */

import { Regions } from "./regions.svelte.js";
import { createMessages } from "./messages.js";
import { mergePlan, neighbourOf } from "./facts.js";
import { createOptions, createRegionHere, placeOf } from "./create.js";
import { closeChain, closeOptions, closeRegionAt } from "./close.js";
import { demoteRegion, exitRegion, goToRegion, insertNearRegion, mergeRegion, moveRegion, promoteRegion, splitRegion, toRegion, unwrapRegion } from "./actions.js";

/** @param {Region | null | undefined} region @returns {string} the title, else the label, else the type: never empty */
const nameOf = (region) => region?.title || region?.label || region?.type || '';

/** Whether `data` names a region to act on. @param {any} data */
const givesRegion = (data) => !!data && typeof data === 'object' && 'region' in data;

/**
 * The region a command acts on: `data.region` when given, else the one holding the caret.
 * @param {CommandContext & Record<string, any>} ctx @param {any} data
 * @returns {Region | null}
 */
function targetRegion(ctx, data) {
    return givesRegion(data) ? toRegion(ctx.nabu, data.region) : (ctx.region ?? null);
}

/**
 * The region `region:merge-next` merges: with `data.region` the next SIBLING region of that one; else the region whose title
 * is right after the caret (the `nextBoundaryRegion` fact), else the next sibling region of the caret's region.
 * @param {CommandContext & Record<string, any>} ctx @param {any} data
 * @returns {Region | null}
 */
function nextMergeTarget(ctx, data) {
    const base = givesRegion(data) ? toRegion(ctx.nabu, data.region) : null;
    if (givesRegion(data) && !base) return null;
    if (!base && ctx.nextBoundaryRegion) return ctx.nextBoundaryRegion;
    const from = base ?? ctx.region;
    const sibling = from ? neighbourOf(ctx.nabu, from.block, 1) : null;
    return sibling?.type === 'region' ? Regions.get(ctx.nabu).of(sibling) : null;
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

    /**
     * The label of a protected merge of `region`: it names the region it joins, or the region that is dissolved.
     * @param {Nabu} nabu @param {Region | null | undefined} region @param {'mergePrevious' | 'mergeNext'} joined
     */
    const mergeLabel = (nabu, region, joined) => {
        const plan = region ? mergePlan(nabu, region) : null;
        // No caret (`commands.list()` without a context), or nothing to merge with: no name to give, a generic label.
        if (!region || !plan) return text(joined === 'mergePrevious' ? 'mergePreviousGeneric' : 'mergeNextGeneric');
        if (plan.kind === 'merge') return joined === 'mergePrevious' ? text('mergePrevious', params(plan.into)) : text('mergeNext', params(region));
        return text('dissolve', params(region));
    };

    return {
        'region:split': {
            label: () => text('split'),
            keys: ['Mod-Enter'],
            when: (/** @type {any} */ ctx) => ctx.isCollapsed && ctx.inBodyTextBlock && ctx.block.splitsOnEnter !== false,
            run: (nabu, ctx) => splitRegion(nabu, ctx),
        },

        'region:insert': {
            label: (/** @type {any} */ ctx) => text('insert', { type: ctx.region?.type ?? '' }),
            run: (nabu, ctx, data) => insertNearRegion(nabu, targetRegion(/** @type {any} */ (ctx), data), data ?? {}, ctx.block),
        },

        // Typing `:::` + Space in an empty paragraph asks for the type through the `choose` strategy (the hook of the extension offers
        // it: a typed trigger, no key to bind). `exec` runs it directly with `{ type }`, without asking.
        'region:create': {
            label: () => text('create'),
            when: (/** @type {any} */ ctx) => !!placeOf(ctx.nabu, ctx.block),
            confirm: {
                strategy: 'choose',
                options: (/** @type {any} */ ctx) => {
                    const place = placeOf(ctx.nabu, ctx.block);
                    if (!place) return [];
                    return createOptions(ctx.nabu, ctx.block, place.parent, text);
                },
                footer: () => text('chooserFooter'),
                messages: { choose: (/** @type {{ options: unknown[] }} */ p) => text('chooser', { count: p.options.length }) },
            },
            run: (nabu, ctx, data) => createRegionHere(nabu, ctx.block, typeof data?.type === 'string' ? data.type : undefined),
        },

        // Typing `:::` + Enter in a paragraph of a region body closes a region (the hook of the extension runs it at once when only one
        // region holds the caret, else offers the chooser; a typed trigger, no key to bind). `exec` runs it directly: `{ region }` (a
        // region holding the caret block) closes that one, without it the innermost.
        'region:close': {
            label: () => text('closeCommand'),
            when: (/** @type {any} */ ctx) => closeChain(ctx.nabu, ctx.block).length > 0,
            confirm: {
                strategy: 'choose',
                options: (/** @type {any} */ ctx) => closeOptions(closeChain(ctx.nabu, ctx.block), text),
                footer: () => text('closeFooter'),
                messages: { choose: (/** @type {{ options: unknown[] }} */ p) => text('closeChooser', { count: p.options.length }) },
            },
            run: (nabu, ctx, data) => {
                const chain = closeChain(nabu, ctx.block);
                const wanted = givesRegion(data) ? toRegion(nabu, data.region) : chain[0];
                if (!ctx.block || !wanted) return false;
                return closeRegionAt(nabu, wanted, ctx.block);
            },
        },

        'region:merge-previous': {
            label: (/** @type {any} */ ctx) => mergeLabel(ctx.nabu, ctx.region, 'mergePrevious'),
            keys: ['Backspace', 'Shift-Backspace'],
            when: (/** @type {any} */ ctx) => ctx.isCollapsed && ctx.atStartOfRegion && !!ctx.region && !!mergePlan(ctx.nabu, ctx.region),
            confirm: {
                strategy: 'hold',
                target: (/** @type {any} */ ctx) => ctx.region?.block,
                messages: { hold: (/** @type {{ keys: string, label: string }} */ p) => text('hold', p) },
            },
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? mergeRegion(nabu, region, caretOf(ctx)) : false;
            },
        },

        'region:merge-next': {
            label: (/** @type {any} */ ctx) => mergeLabel(ctx.nabu, ctx.nextBoundaryRegion, 'mergeNext'),
            keys: ['Delete'],
            when: (/** @type {any} */ ctx) => ctx.isCollapsed && ctx.atEndOfRegion && !!ctx.nextBoundaryRegion && !!mergePlan(ctx.nabu, ctx.nextBoundaryRegion),
            confirm: {
                strategy: 'hold',
                target: (/** @type {any} */ ctx) => ctx.nextBoundaryRegion?.block,
                messages: { hold: (/** @type {{ keys: string, label: string }} */ p) => text('hold', p) },
            },
            run: (nabu, ctx, data) => {
                const next = nextMergeTarget(/** @type {any} */ (ctx), data);
                return next ? mergeRegion(nabu, next, caretOf(ctx)) : false;
            },
        },

        'region:exit': {
            label: () => text('exit'),
            keys: ['Mod-Shift-Enter'],
            when: (/** @type {any} */ ctx) => ctx.isCollapsed && !!ctx.region,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? exitRegion(nabu, region, ctx.block) : false;
            },
        },

        'region:demote': {
            label: () => text('demote'),
            keys: ['Tab'],
            when: (/** @type {any} */ ctx) => ctx.inTitle,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? demoteRegion(nabu, region, caretOf(ctx)) : false;
            },
        },

        'region:promote': {
            label: () => text('promote'),
            keys: ['Shift-Tab'],
            when: (/** @type {any} */ ctx) => ctx.inTitle,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? promoteRegion(nabu, region, caretOf(ctx)) : false;
            },
        },

        'region:unwrap': {
            label: () => text('unwrap'),
            when: (/** @type {any} */ ctx) => !!ctx.region,
            run: (nabu, ctx, data) => {
                const region = targetRegion(/** @type {any} */ (ctx), data);
                return region ? unwrapRegion(nabu, region, caretOf(ctx)) : false;
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

        'region:next': {
            label: () => text('next'),
            run: (nabu, ctx, data) => {
                const regions = Regions.get(nabu);
                const base = givesRegion(data) ? toRegion(nabu, data.region) : null;
                const target = givesRegion(data) ? (base ? regions.next(base) : null) : /** @type {any} */ (ctx).nextRegion;
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
