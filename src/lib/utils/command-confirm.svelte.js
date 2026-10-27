/**
 * Confirmation strategies of commands (ADR 017, lot 2): `hold`, `invite`, `choose`.
 *
 * The registry (`commands.js`) resolves the keys; when the winning command declares a `confirm` (or when several commands tie),
 * it hands the key press to this controller, which owns the whole life of the confirmation:
 *
 *  - `nabu.pendingCommand` (reactive) describes what is waiting for the user: see {@link PendingCommand};
 *  - while something is pending, EVERY key press goes through {@link CommandConfirmation#handleKeydown} first;
 *  - the document listeners (key release, selection, click, focus) are attached by {@link CommandConfirmation#start}, which the
 *    editor component calls through `nabu.systems`;
 *  - a polite live region (`nabu.commandAnnouncement`, rendered by `Nabu.svelte`) announces prompts and outcomes.
 *
 * The controller names no block type. The look of a confirmation belongs to the integrator: `hold` is drawn by its TARGET
 * (`Nabu.svelte` marks the target element with `data-command-target` and `--nb-command-progress`; a block may read
 * `nabu.pendingCommandOn(block)` and draw its own), `invite` and `choose` by the `CommandInvite` / `CommandChooser` components.
 *
 * @import { Nabu } from '../blocks/nabu.svelte.js'
 * @import { CommandEntry, CommandContext } from './commands.js'
 */

import { eventChord, chordId, formatChord, parseChord } from './keys.js';

/** Default duration of a `hold`, in milliseconds. */
export const DEFAULT_HOLD_MS = 700;
/** Default time an `invite` waits for its second press, in milliseconds. */
export const DEFAULT_INVITE_MS = 5000;

/**
 * Time source of the controller (injectable, so that tests drive a fake clock).
 * @typedef {Object} ConfirmClock
 * @property {() => number} now  monotonic milliseconds
 * @property {(fn: () => void, ms: number) => () => void} timeout  run `fn` once after `ms`; returns the canceller
 * @property {(fn: () => void) => () => void} frame  run `fn` before the next paint (animation frame); returns the canceller
 */

/** @type {ConfirmClock} */
export const REAL_CLOCK = {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    timeout: (fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
    frame: (fn) => {
        if (typeof requestAnimationFrame === 'function') { const id = requestAnimationFrame(() => fn()); return () => cancelAnimationFrame(id); }
        const id = setTimeout(fn, 16);
        return () => clearTimeout(id);
    },
};

/**
 * What is waiting for the user, as `nabu.pendingCommand`. The reference changes when a confirmation starts or ends; `progress`
 * and `selectedIndex` are reactive fields of it.
 *
 * @typedef {Object} PendingOption
 * @property {string} id  the command id (a tie) or the variant id (explicit `choose`)
 * @property {string} label
 * @property {string} display  shortcut (a tie) or hint (explicit `choose`) to show next to the label; may be empty
 * @property {string} [group]  explicit `choose` only: the title of the group the option belongs to. Consecutive options with the
 *   same `group` are shown under one small header; options without one stay ungrouped.
 * @property {string} [detail]  explicit `choose` only: a short muted text shown right-aligned in the option (a number, a hint)
 */
export class PendingCommand {
    /**
     * @param {Object} init
     * @param {string} init.id
     * @param {'hold' | 'invite' | 'choose'} init.strategy
     * @param {string} init.label
     * @param {string} init.display
     * @param {string} init.message
     * @param {any} [init.target]
     * @param {PendingOption[]} [init.options]
     * @param {string} [init.footer]
     */
    constructor({ id, strategy, label, display, message, target, options, footer }) {
        /** command id (`choose:<chord>` for a tie) */
        this.id = id;
        this.strategy = strategy;
        /** label of the command (resolved with the context of the key press) */
        this.label = label;
        /** the shortcut that started it, formatted for the platform (`'Ctrl+Shift+Backspace'`, `'⇧⌘⌫'`) */
        this.display = display;
        /** the prompt, i18n-resolved: the text of the live region and of the default hint */
        this.message = message;
        /** what the confirmation is about (`hold`: `confirm.target(ctx)`, usually a block); `undefined` when none */
        this.target = target;
        /** `choose` only */
        this.options = options;
        /** `choose` only: a short hint shown under the options (`confirm.footer`); empty when none */
        this.footer = footer ?? '';
        /** `hold`: 0 → 1 over `holdMs` */
        this.progress = $state(0);
        /** `choose`: the highlighted option */
        this.selectedIndex = $state(0);
    }
}

/**
 * Texts of the prompts and the outcomes. Each value is a string or a function of the given parameters; override them for all
 * commands with the `commandConfirm.messages` init option, or per command with `confirm.messages` (partial objects).
 * @typedef {Object} ConfirmMessages
 * @property {string | ((p: { keys: string, label: string }) => string)} [hold]  prompt of a hold
 * @property {string | ((p: { keys: string, label: string }) => string)} [invite]  prompt of an invite
 * @property {string | ((p: { keys: string, label: string, options: PendingOption[] }) => string)} [choose]  prompt of a chooser
 * @property {string | ((p: { option: PendingOption, index: number, count: number }) => string)} [option]  the highlighted option
 * @property {string | ((p: { label: string }) => string)} [done]  after the command ran
 * @property {string | ((p: { label: string }) => string)} [cancelled]  after a release / Escape / timeout
 */

/** @type {Required<ConfirmMessages>} */
export const DEFAULT_MESSAGES = {
    hold: ({ keys, label }) => `Hold ${keys} to confirm: ${label}`,
    invite: ({ keys, label }) => `Press ${keys} again to confirm: ${label}. Escape cancels.`,
    choose: ({ options }) => `${options.length} actions apply here. Arrow keys and Enter, or a number, to choose. Escape cancels.`,
    option: ({ option, index, count }) => `${index + 1} of ${count}: ${option.label}`,
    done: ({ label }) => `${label}: done`,
    cancelled: () => 'Cancelled',
};

/**
 * @typedef {Object} CommandConfirmOptions
 * @property {number} [holdMs]  default duration of a `hold` (700)
 * @property {number} [inviteMs]  default time an `invite` waits (5000)
 * @property {ConfirmMessages} [messages]  texts, see {@link ConfirmMessages}
 * @property {ConfirmClock} [clock]  time source (tests)
 */

/** Cancellation reasons that are worth announcing: the user asked for it, or the invite expired. */
const ANNOUNCED_CANCELS = new Set(['release', 'escape', 'timeout']);

/** Keys that are only modifiers: they never cancel nor confirm anything. */
const isModifierKey = (/** @type {string} */ key) => key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'AltGraph' || key === 'OS';

/**
 * The DOM element standing for a confirmation target: a block (its `element`) or an element. `null` when it has none (yet).
 * @param {any} target
 * @returns {HTMLElement | null}
 */
export function commandTargetElement(target) {
    if (!target || typeof target !== 'object') return null;
    const el = typeof Node !== 'undefined' && target instanceof Node ? target : target.element;
    return el && typeof el === 'object' && el.nodeType === 1 && el.isConnected ? /** @type {HTMLElement} */ (el) : null;
}

/**
 * @typedef {Object} Session
 * @property {PendingCommand} pending
 * @property {'hold' | 'invite' | 'choose'} strategy
 * @property {CommandEntry | null} entry  the command (a tie / `choose` with variants: the explicit command or `null`)
 * @property {CommandContext} ctx  context of the key press that started it
 * @property {string} chord  canonical id of the chord that started it
 * @property {ReturnType<typeof eventChord>} chordInfo
 * @property {string} code  physical key of the press (`event.code`)
 * @property {boolean} [waiting]  `hold` opened from code: nobody holds the key yet; the count starts at the user's press
 * @property {number} startedAt
 * @property {number} ms  `hold`: duration; `invite`: timeout
 * @property {(() => void) | null} stopTimer
 * @property {Array<{ id: string, label: string, display: string, group?: string, detail?: string, run: () => void }>} [choices]  `choose`
 * @property {{ selection: [Node | null, number, Node | null, number] } | null} dom  selection when it started
 */

export class CommandConfirmation {
    /** @type {Nabu} */
    #nabu;
    /** @type {ConfirmClock} */
    #clock;
    #holdMs;
    #inviteMs;
    /** @type {ConfirmMessages} */
    #messages;
    /** @type {PendingCommand | null} */
    #pending = $state.raw(null);
    /** @type {Session | null} */
    #session = null;
    /** The chord of a hold that completed: its key is still down, so its repeats are swallowed until it is released. @type {{ chord: string, chordInfo: ReturnType<typeof eventChord>, code: string } | null} */
    #spent = null;
    #announcement = $state('');
    #flip = false;
    /** @type {(() => void) | null} */
    #detach = null;

    /** @param {Nabu} nabu @param {CommandConfirmOptions} [options] */
    constructor(nabu, { holdMs, inviteMs, messages, clock } = {}) {
        this.#nabu = nabu;
        this.#clock = clock ?? REAL_CLOCK;
        this.#holdMs = Number.isFinite(holdMs) && /** @type {number} */ (holdMs) > 0 ? /** @type {number} */ (holdMs) : DEFAULT_HOLD_MS;
        this.#inviteMs = Number.isFinite(inviteMs) && /** @type {number} */ (inviteMs) > 0 ? /** @type {number} */ (inviteMs) : DEFAULT_INVITE_MS;
        this.#messages = messages && typeof messages === 'object' ? messages : {};
    }

    /** What is waiting for the user (`nabu.pendingCommand`), reactive; `null` when nothing is. @returns {PendingCommand | null} */
    get pending() { return this.#pending; }

    /** Whether the keys must go through {@link CommandConfirmation#handleKeydown}: something is pending, or the key of a completed hold is still down. */
    get busy() { return this.#session !== null || this.#spent !== null; }

    /** The text of the polite live region: the last prompt or outcome (reactive). */
    get announcement() { return this.#announcement; }

    /** The pending confirmation when it is about `target` (reactive), else `null`. @param {any} target @returns {PendingCommand | null} */
    pendingOn(target) {
        const pending = this.#pending;
        return pending && target !== undefined && target !== null && pending.target === target ? pending : null;
    }

    // ── texts ───────────────────────────────────────────────────────────────

    /**
     * @template {keyof ConfirmMessages} K
     * @param {K} key @param {any} params @param {ConfirmMessages | undefined} [local]
     * @returns {string}
     */
    #text(key, params, local) {
        const value = local?.[key] ?? this.#messages[key] ?? DEFAULT_MESSAGES[key];
        try { return String(typeof value === 'function' ? /** @type {Function} */ (value)(params) : value); }
        catch (error) { this.#nabu.warn(`commands: message "${key}" failed: ${error}`); return String(typeof DEFAULT_MESSAGES[key] === 'function' ? /** @type {Function} */ (DEFAULT_MESSAGES[key])(params) : DEFAULT_MESSAGES[key]); }
    }

    /** Announce `text` in the live region (a change is needed for a screen reader to speak: alternate an invisible suffix). @param {string} text */
    #announce(text) {
        this.#flip = !this.#flip;
        this.#announcement = text + (this.#flip ? '​' : '');
    }

    // ── starting ────────────────────────────────────────────────────────────

    /**
     * A key press selected `entry`, which has a `confirm` strategy. Returns whether the key was consumed (it always is, unless
     * the strategy cannot start). The registry has already checked `when`.
     * @param {CommandEntry} entry
     * @param {CommandContext} ctx
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    begin(entry, ctx, event) {
        const confirm = /** @type {any} */ (entry.def.confirm);
        const info = eventChord(event);
        if (!info) return false;
        const chord = chordId(info);
        // A key held before the context was entered (or kept down after a hold completed) never starts nor confirms anything:
        // its repeats are swallowed here, so a user who erases text with Backspace held stops at the boundary.
        if (event.repeat) { event.preventDefault(); return true; }
        this.#spent = null;
        this.cancel('restart');

        if (confirm.strategy === 'choose') return this.#beginVariants(entry, ctx, event, info, chord);

        return this.#beginSingle(entry, ctx, event, info, chord);
    }

    /**
     * `hold` / `invite` of a command. `event` is the key press that starts it, or `null` when {@link CommandConfirmation#offer}
     * opens it from code: nothing is held yet, so a `hold` waits for the user to press its key (the count starts then), and an
     * `invite` waits for its second press; both give up after the `invite` timeout.
     * @param {CommandEntry} entry @param {CommandContext} ctx @param {KeyboardEvent | null} event
     * @param {NonNullable<ReturnType<typeof eventChord>>} info @param {string} chord
     */
    #beginSingle(entry, ctx, event, info, chord) {
        const confirm = /** @type {any} */ (entry.def.confirm);
        const display = formatChord(info, { platform: this.#nabu.commands.platform });
        const label = this.#labelOf(entry, ctx);
        const hold = confirm.strategy === 'hold';
        const ms = this.#duration(hold ? confirm.holdMs : confirm.inviteMs, hold ? this.#holdMs : this.#inviteMs);
        let target;
        if (typeof confirm.target === 'function') {
            try { target = confirm.target(ctx) ?? undefined; } catch (error) { this.#nabu.warn(`commands: confirm.target of "${entry.id}" failed: ${error}`); }
        }
        const message = this.#text(hold ? 'hold' : 'invite', { keys: display, label }, confirm.messages);
        const pending = new PendingCommand({ id: entry.id, strategy: hold ? 'hold' : 'invite', label, display, message, target });
        const session = this.#open(pending, entry, ctx, chord, info, event);
        session.ms = ms;
        this.#announce(message);
        if (!event) {
            // From code: no key is down. A hold counts from the user's press (see `handleKeydown`); until then, and for an invite, a timeout cancels.
            session.waiting = hold;
            session.stopTimer = this.#clock.timeout(() => this.cancel('timeout'), hold ? this.#inviteMs : ms);
        } else if (hold) this.#tick();
        else session.stopTimer = this.#clock.timeout(() => this.cancel('timeout'), ms);
        event?.preventDefault();
        return true;
    }

    /**
     * Several commands apply to the key: let the user pick (§3.4c).
     * @param {CommandEntry[]} ties
     * @param {CommandContext} ctx
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    beginTie(ties, ctx, event) {
        const info = eventChord(event);
        if (!info) return false;
        if (event.repeat) { event.preventDefault(); return true; }
        this.#spent = null;
        this.cancel('restart');
        const chord = chordId(info);
        const display = formatChord(info, { platform: this.#nabu.commands.platform });
        const choices = ties.map((entry) => ({
            id: entry.id,
            label: this.#labelOf(entry, ctx),
            display,
            run: () => this.#runEntry(entry, ctx, event),
        }));
        return this.#openChooser(`choose:${chord}`, choices, ctx, event, info, chord, display, undefined, undefined);
    }

    /**
     * Open the confirmation of a command WITHOUT a key press (a typed trigger, a menu, a button, an input rule): the same
     * prompt a key would open (`nabu.pendingCommand`, the `CommandInvite` / `CommandChooser` components, the keyboard handling,
     * the cancellations). The command's `when` is checked. Prefer the public `nabu.commands.offer(id)`, which also runs a command
     * that has no confirmation.
     *
     *  - `choose`: the options come from `confirm.options(ctx)`, the choice runs `run(nabu, ctx, option)`;
     *  - `invite`: asks to press the command's first key again (`invite` timeout);
     *  - `hold`: asks to hold the command's first key; the count starts at the user's press and the confirmation lapses after the
     *    `invite` timeout when no key comes.
     *
     * `hold` and `invite` need a key to confirm with: a command with no key (disabled by the `keymap`) opens nothing.
     * Returns false (nothing opens) when the command does not exist, has no confirmation, does not apply, or offers no option.
     * @param {string} id  command id
     * @param {CommandContext} [context]  default: the current context
     * @returns {boolean}
     */
    offer(id, context) {
        const entry = this.#nabu.commands.entries.get(id);
        const strategy = /** @type {any} */ (entry?.def.confirm)?.strategy;
        if (!entry || (strategy !== 'choose' && strategy !== 'hold' && strategy !== 'invite')) return false;
        const ctx = context ?? this.#nabu.commands.context(null);
        if (typeof entry.def.when === 'function') {
            let ok = false;
            try { ok = !!entry.def.when(ctx); } catch (error) { this.#nabu.warn(`commands: when() of "${id}" failed: ${error}`); }
            if (!ok) return false;
        }
        if (strategy === 'choose') {
            this.#spent = null;
            this.cancel('restart');
            return this.#beginVariants(entry, ctx, null, null, '');
        }
        const platform = this.#nabu.commands.platform;
        /** @type {ReturnType<typeof eventChord>} */
        let info = null;
        for (const key of entry.keys) { info = parseChord(key, { platform }); if (info) break; }
        if (!info) { this.#nabu.warn(`commands: "${id}" has no key to confirm with: ${strategy} not opened`); return false; }
        this.#spent = null;
        this.cancel('restart');
        return this.#beginSingle(entry, ctx, null, info, chordId(info));
    }

    /** `confirm: { strategy: 'choose', options(ctx) }`: the command offers variants; `run(nabu, ctx, option)` receives the chosen one. `event` / `info` are null when {@link CommandConfirmation#offer} opens it. */
    #beginVariants(/** @type {CommandEntry} */ entry, /** @type {CommandContext} */ ctx, /** @type {KeyboardEvent | null} */ event, /** @type {any} */ info, /** @type {string} */ chord) {
        const confirm = /** @type {any} */ (entry.def.confirm);
        let list;
        try { list = typeof confirm.options === 'function' ? confirm.options(ctx) : confirm.options; }
        catch (error) { this.#nabu.warn(`commands: confirm.options of "${entry.id}" failed: ${error}`); return false; }
        if (!Array.isArray(list) || !list.length) return false;
        const display = info ? formatChord(info, { platform: this.#nabu.commands.platform }) : '';
        const choices = list.map((option, i) => ({
            id: String(option?.id ?? i),
            label: String(option?.label ?? option?.id ?? i),
            display: typeof option?.display === 'string' ? option.display : '',
            group: typeof option?.group === 'string' && option.group ? option.group : undefined,
            detail: typeof option?.detail === 'string' && option.detail ? option.detail : undefined,
            run: () => this.#runEntry(entry, ctx, event, option),
        }));
        let footer = '';
        try { footer = String(typeof confirm.footer === 'function' ? confirm.footer(ctx) ?? '' : confirm.footer ?? ''); }
        catch (error) { this.#nabu.warn(`commands: confirm.footer of "${entry.id}" failed: ${error}`); }
        return this.#openChooser(entry.id, choices, ctx, event, info, chord, display, entry, this.#labelOf(entry, ctx), footer);
    }

    #openChooser(/** @type {string} */ id, /** @type {Session['choices']} */ choices, /** @type {CommandContext} */ ctx, /** @type {KeyboardEvent | null} */ event, /** @type {any} */ info, /** @type {string} */ chord, /** @type {string} */ display, /** @type {CommandEntry | undefined} */ entry, /** @type {string | undefined} */ label, /** @type {string} */ footer = '') {
        const options = /** @type {NonNullable<Session['choices']>} */ (choices).map(({ id, label, display, group, detail }) => ({ id, label, display, ...(group ? { group } : {}), ...(detail ? { detail } : {}) }));
        const local = /** @type {any} */ (entry?.def.confirm)?.messages;
        const message = this.#text('choose', { keys: display, label: label ?? '', options }, local);
        const pending = new PendingCommand({ id, strategy: 'choose', label: label ?? message, display, message, options, footer });
        const session = this.#open(pending, entry ?? null, ctx, chord, info, event);
        session.choices = choices;
        session.ms = this.#inviteMs;
        session.stopTimer = null; // a chooser has no timeout: it is a safety net the user is looking at
        this.#announce(`${message} ${this.#text('option', { option: options[0], index: 0, count: options.length }, local)}`);
        event?.preventDefault();
        return true;
    }

    /** @returns {Session} */
    #open(/** @type {PendingCommand} */ pending, /** @type {CommandEntry | null} */ entry, /** @type {CommandContext} */ ctx, /** @type {string} */ chord, /** @type {any} */ info, /** @type {KeyboardEvent | null} */ event) {
        /** @type {Session} */
        const session = {
            pending, strategy: pending.strategy, entry, ctx, chord, chordInfo: info, code: event?.code ?? '',
            startedAt: this.#clock.now(), ms: 0, stopTimer: null, dom: this.#domSelection(),
        };
        this.#session = session;
        this.#pending = pending;
        return session;
    }

    #labelOf(/** @type {CommandEntry} */ entry, /** @type {CommandContext} */ ctx) {
        const label = entry.def.label;
        if (typeof label === 'string') return label;
        if (typeof label === 'function') { try { return String(label(ctx)); } catch (error) { this.#nabu.warn(`commands: label of "${entry.id}" failed: ${error}`); } }
        return entry.id;
    }

    /** @param {unknown} value @param {number} fallback */
    #duration(value, fallback) { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback; }

    // ── hold ────────────────────────────────────────────────────────────────

    #tick = () => {
        const session = this.#session;
        if (!session || session.strategy !== 'hold') return;
        session.stopTimer = null;
        const progress = Math.min(1, Math.max(0, (this.#clock.now() - session.startedAt) / session.ms));
        session.pending.progress = progress;
        if (progress >= 1) this.#completeHold(session);
        else session.stopTimer = this.#clock.frame(this.#tick);
    };

    /** @param {Session} session */
    #completeHold(session) {
        // The key is still down: its repeats must not do anything (typing, a second run) until it is released.
        this.#spent = { chord: session.chord, chordInfo: session.chordInfo, code: session.code };
        this.#end();
        this.#runConfirmed(session);
    }

    // ── running ─────────────────────────────────────────────────────────────

    /** Re-check that the command still applies, then run it and announce the outcome. @param {Session} session @param {KeyboardEvent | null} [event] */
    #runConfirmed(session, event = null) {
        const entry = session.entry;
        if (!entry) return;
        const ctx = this.#nabu.commands.context(event ?? session.ctx.event);
        const when = entry.def.when;
        if (typeof when === 'function') {
            let ok = false;
            try { ok = !!when(ctx); } catch (error) { this.#nabu.warn(`commands: when() of "${entry.id}" failed: ${error}`); }
            if (!ok) return;
        }
        this.#runEntry(entry, ctx, event ?? session.ctx.event);
    }

    /** @param {CommandEntry} entry @param {CommandContext} ctx @param {KeyboardEvent | null} event @param {any} [data] */
    #runEntry(entry, ctx, event, data) {
        const label = this.#labelOf(entry, ctx);
        const local = /** @type {any} */ (entry.def.confirm)?.messages;
        try {
            const result = entry.def.run(this.#nabu, ctx, data);
            if (result && typeof result.then === 'function') result.then(undefined, (/** @type {unknown} */ error) => console.error(`[Nabu] command "${entry.id}" failed`, error));
        } catch (error) {
            console.error(`[Nabu] command "${entry.id}" failed`, error);
            return;
        }
        this.#announce(this.#text('done', { label }, local));
    }

    // ── keys ────────────────────────────────────────────────────────────────

    /**
     * Every key press goes through here before the command resolution, while a confirmation is pending (or the key of a completed
     * hold is still down). Returns `true` when the key is consumed (`preventDefault` already called); `false` lets the registry go
     * on, which is what an unrelated key must get after it cancelled the confirmation ("the key acts normally").
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    handleKeydown(event) {
        const info = eventChord(event);
        if (!info || isModifierKey(event.key)) return false; // a lone modifier changes nothing
        const chord = chordId(info);

        const spent = this.#spent;
        if (spent && !this.#session) {
            if (spent.chord === chord && event.repeat) { event.preventDefault(); return true; }
            if (spent.chord === chord) this.#spent = null; // a fresh press of the same chord: the release was missed
        }

        const session = this.#session;
        if (!session) return false;
        const same = chord === session.chord;

        if (session.strategy === 'hold') {
            if (same) {
                event.preventDefault(); // the held key repeating (or pressed twice): nothing to do…
                if (session.waiting && !event.repeat) { // …except for a hold opened from code, which counts from the user's fresh press
                    session.waiting = false;
                    session.code = event.code ?? '';
                    session.stopTimer?.();
                    session.startedAt = this.#clock.now();
                    this.#tick();
                }
                return true;
            }
            this.cancel('key');
            return false;
        }

        if (session.strategy === 'invite') {
            if (same) {
                event.preventDefault();
                if (event.repeat) return true; // a repeat never confirms
                this.#end();
                this.#runConfirmed(session, event);
                return true;
            }
            if (event.key === 'Escape') { event.preventDefault(); this.cancel('escape'); return true; }
            this.cancel('key');
            return false;
        }

        // choose
        const choices = /** @type {NonNullable<Session['choices']>} */ (session.choices);
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            this.#moveSelection(event.key === 'ArrowDown' ? 1 : -1);
            return true;
        }
        if (event.key === 'Enter' && plain && event.repeat) { event.preventDefault(); return true; } // a repeat never confirms (a held Enter that opened the chooser)
        if (event.key === 'Enter' && plain) { event.preventDefault(); this.choose(session.pending.selectedIndex); return true; }
        if (event.key === 'Escape') { event.preventDefault(); this.cancel('escape'); return true; }
        if (plain && /^[1-9]$/.test(event.key) && Number(event.key) <= choices.length) { event.preventDefault(); this.choose(Number(event.key) - 1); return true; }
        this.cancel('key');
        return false;
    }

    /** @param {number} delta */
    #moveSelection(delta) {
        const session = this.#session;
        if (!session?.choices) return;
        const count = session.choices.length;
        const index = (session.pending.selectedIndex + delta + count) % count;
        session.pending.selectedIndex = index;
        const local = /** @type {any} */ (session.entry?.def.confirm)?.messages;
        const option = /** @type {PendingOption} */ (session.pending.options?.[index]);
        this.#announce(this.#text('option', { option, index, count }, local));
    }

    /**
     * Move the highlight of a pending `choose` (the chooser component calls it on hover).
     * @param {number} index
     */
    highlight(index) {
        const session = this.#session;
        if (session?.strategy !== 'choose' || !session.choices || index < 0 || index >= session.choices.length || index === session.pending.selectedIndex) return;
        this.#moveSelection(index - session.pending.selectedIndex);
    }

    /**
     * Run option `index` of a pending `choose` (Enter, a digit, a click).
     * @param {number} index
     * @returns {boolean} whether something ran
     */
    choose(index) {
        const session = this.#session;
        if (session?.strategy !== 'choose' || !session.choices?.[index]) return false;
        const choice = session.choices[index];
        this.#end();
        choice.run();
        return true;
    }

    // ── ending ──────────────────────────────────────────────────────────────

    /** Clear the session without running anything. */
    #end() {
        const session = this.#session;
        session?.stopTimer?.();
        this.#session = null;
        this.#pending = null;
    }

    /**
     * Cancel what is pending (`nabu.cancelPendingCommand()`): nothing runs, no undo step exists. No-op when nothing is pending.
     * @param {string} [reason]  `'api'` (default), `'release'`, `'escape'`, `'key'`, `'selection'`, `'click'`, `'blur'`, `'timeout'`
     */
    cancel(reason = 'api') {
        const session = this.#session;
        if (!session) return;
        this.#end();
        if (ANNOUNCED_CANCELS.has(reason)) {
            const local = /** @type {any} */ (session.entry?.def.confirm)?.messages;
            this.#announce(this.#text('cancelled', { label: session.pending.label }, local));
        }
    }

    // ── document listeners ──────────────────────────────────────────────────

    /** @returns {{ selection: [Node | null, number, Node | null, number] } | null} */
    #domSelection() {
        const sel = typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null;
        return sel ? { selection: [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] } : null;
    }

    /**
     * The key of the chord went up: a hold that is not finished is cancelled; the key of a completed hold is free again.
     * Releasing a modifier of the chord counts like releasing its key.
     * @param {KeyboardEvent} event
     */
    onKeyup(event) {
        const releases = (/** @type {NonNullable<ReturnType<typeof eventChord>>} */ info, /** @type {string} */ code) => {
            if (event.key === 'Control') return info.ctrl;
            if (event.key === 'Alt') return info.alt;
            if (event.key === 'Shift') return info.shift;
            if (event.key === 'Meta') return info.meta;
            if (code && event.code) return event.code === code;
            return eventChord({ key: event.key })?.key === info.key;
        };
        const spent = this.#spent;
        if (spent?.chordInfo && releases(spent.chordInfo, spent.code)) this.#spent = null;
        const session = this.#session;
        if (session?.strategy === 'hold' && !session.waiting && session.chordInfo && releases(session.chordInfo, session.code)) this.cancel('release');
    }

    /** The DOM selection moved away from where the confirmation started. */
    onSelectionChange() {
        const session = this.#session;
        if (!session?.dom) return;
        const now = this.#domSelection();
        if (!now) return;
        const [a, ao, f, fo] = session.dom.selection;
        const [na, nao, nf, nfo] = now.selection;
        if (a !== na || ao !== nao || f !== nf || fo !== nfo) this.cancel('selection');
    }

    /** A click outside the confirmation's own UI cancels it. @param {Event} event */
    onPointerDown(event) {
        if (!this.#session) return;
        const target = /** @type {any} */ (event.target);
        if (target?.closest?.('[data-nabu-ui]')) return;
        this.cancel('click');
    }

    /** Focus left the editor (window blur, tab switch, a click elsewhere): nothing can be confirmed any more. */
    onBlur() {
        this.#spent = null; // the release will not be seen
        this.cancel('blur');
    }

    /** Attach the document listeners (the editor component calls it through `nabu.systems`). Idempotent. */
    start() {
        if (this.#detach || typeof document === 'undefined') return;
        const keyup = (/** @type {KeyboardEvent} */ e) => this.onKeyup(e);
        const selectionchange = () => this.onSelectionChange();
        const pointerdown = (/** @type {Event} */ e) => this.onPointerDown(e);
        const blur = () => this.onBlur();
        const focusout = (/** @type {FocusEvent} */ e) => {
            const next = /** @type {any} */ (e.relatedTarget);
            const selection = this.#nabu.selection;
            // Focus leaving ANOTHER editor is none of my business; focus moving to my own root or UI (or to a UI island on the
            // page, outside every editor) is not a blur. Moving to another editor IS one.
            if (selection.kindOf(e.target instanceof Node ? e.target : null) === 'foreign') return;
            const where = next instanceof Node ? selection.kindOf(next) : 'none';
            if (where === 'mine' || (where === 'none' && next?.closest?.('[data-nabu-ui]'))) return;
            this.onBlur();
        };
        document.addEventListener('keyup', keyup, true);
        document.addEventListener('selectionchange', selectionchange);
        document.addEventListener('mousedown', pointerdown, true);
        document.addEventListener('focusout', focusout, true);
        window.addEventListener('blur', blur);
        this.#detach = () => {
            document.removeEventListener('keyup', keyup, true);
            document.removeEventListener('selectionchange', selectionchange);
            document.removeEventListener('mousedown', pointerdown, true);
            document.removeEventListener('focusout', focusout, true);
            window.removeEventListener('blur', blur);
        };
    }

    /** Detach the listeners and drop what is pending. */
    stop() {
        this.#detach?.();
        this.#detach = null;
        this.#spent = null;
        this.cancel('api');
    }
}
