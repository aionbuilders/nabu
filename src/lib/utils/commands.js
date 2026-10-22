/**
 * Command registry (ADR 017, lot 1): extensions DECLARE commands (label, keys, context, run); the core resolves the keys.
 *
 * - A command is ALSO an action of the bus: `nabu.exec(id, data)` runs it without any key (the engine wires that, see
 *   `Nabu#registerCommands`).
 * - Key resolution (`handleKeydown`) runs from `Nabu#handleKeydown`, BEFORE the legacy `onKeyDown` hooks, and ignores IME
 *   compositions. See the doc of {@link CommandRegistry#handleKeydown} for the rules.
 * - The registry names no block type: the context facts come from extensions (`Extension#commandContext`).
 *
 * @import { Nabu } from '../blocks/nabu.svelte.js'
 * @import { Platform } from './keys.js'
 */

import { detectPlatform, parseChord, chordId, eventChordId, formatChord, hasCommandModifier, isReservedChord } from './keys.js';

/**
 * What the engine builds at each key press (and for `nabu.exec` of a command, with `event: null`). Extensions add FACTS
 * (any other property) through `Extension#commandContext`; facts never replace the fields below.
 * @typedef {Object} CommandContext
 * @property {Nabu} nabu
 * @property {KeyboardEvent | null} event  the key press; `null` when the command runs from `exec` / `commands.run`
 * @property {import('../blocks/block.svelte.js').Block | null} block  the block holding the selection anchor
 * @property {import('../blocks/selection.svelte.js').NabuSelection} selection
 * @property {boolean} isCollapsed
 * @property {string[]} ancestors  types of the ancestors of `block`, nearest first (`[]` for a root block)
 * @property {boolean} inRoot  `block` is a direct child of the document (not nested in a container)
 */

/**
 * How a command that needs confirmation asks for it before a KEY PRESS runs it (`nabu.exec(id)` / `commands.run` run it
 * directly, without confirmation: the accessible path). Controller: `command-confirm.svelte.js`.
 *
 *  - `{ strategy: 'hold', holdMs?, target?(ctx), messages? }`: hold the chord for `holdMs` (default 700, global default: the
 *    `commandConfirm.holdMs` init option); `target(ctx)` is what draws the progress (a block, an element).
 *  - `{ strategy: 'invite', inviteMs?, messages? }`: first press asks, the same chord again confirms (timeout default 5000).
 *  - `{ strategy: 'choose', options(ctx), messages? }`: variants; `options` returns `[{ id, label, display?, ...any }]` and
 *    `run(nabu, ctx, option)` receives the chosen one. (Several commands tying on a key use `choose` automatically.)
 *  - `messages`: texts of the prompt / outcome for this command (see `ConfirmMessages`).
 * @typedef {{ strategy: 'hold' | 'invite' | 'choose', [option: string]: any }} CommandConfirm
 */

/**
 * @typedef {Object} CommandDef
 * @property {string | ((ctx: CommandContext) => string)} label  text for help, prompts, pickers
 * @property {string[]} [keys]  default chords (`'Mod-Shift-Enter'`, see keys.js); overridable by the `keymap` option
 * @property {(ctx: CommandContext) => boolean} [when]  where the command applies; required for a key without modifier
 * @property {string} [scope]  block type the command belongs to: beats generic commands when the caret is in such a block,
 *   and limits the static conflict check to commands of the same scope
 * @property {(nabu: Nabu, ctx: CommandContext, data?: any) => any} run  a SYNCHRONOUS `false` from a key press means "not
 *   handled": resolution goes on (next command, legacy hooks, native behavior). Any other value (a promise included) = handled.
 * @property {CommandConfirm} [confirm]
 */

/**
 * What `nabu.commands.list()` / `get()` return: a plain snapshot (the registry is fixed once the editor is built, so it
 * needs no reactivity; read it again after a `keymap` change, i.e. a new editor).
 * @typedef {Object} CommandInfo
 * @property {string} id
 * @property {string} label  resolved (a label function is called with the given / current context)
 * @property {string[]} keys  the chords bound to the command, as written (`'Mod-b'`)
 * @property {string[]} display  `keys` formatted for the platform (`'⌘B'` / `'Ctrl+B'`)
 * @property {string | undefined} scope
 * @property {string} extension  name of the declaring extension (`'core'` for the engine's own commands)
 * @property {boolean} available  `when` is true in the given / current context (true without `when`)
 * @property {CommandConfirm | null} confirm
 */

/**
 * @typedef {Object} CommandEntry
 * @property {string} id
 * @property {CommandDef} def
 * @property {string} extension
 * @property {string | undefined} scope
 * @property {string[]} keys  accepted chords (as written)
 * @property {number} order  registration order (tie-break)
 */

/**
 * @typedef {Object} CommandRegistryOptions
 * @property {Record<string, string[]>} [keymap]  per-command replacement of the chords (`[]` disables the keys)
 * @property {Platform} [platform]  defaults to the detected platform
 */

export class CommandRegistry {
    /** @param {Nabu} nabu @param {CommandRegistryOptions} [options] */
    constructor(nabu, { keymap, platform } = {}) {
        this.nabu = nabu;
        /** @type {Platform} `Mod` is Cmd on `'mac'`, Ctrl on `'other'` */
        this.platform = platform ?? detectPlatform();
        /** @type {Record<string, string[]>} */
        this.keymap = keymap && typeof keymap === 'object' ? keymap : {};
        /** @type {Map<string, CommandEntry>} */
        this.entries = new Map();
        /** canonical chord -> entries bound to it, in registration order @type {Map<string, CommandEntry[]>} */
        this.byChord = new Map();
        /** @type {Array<{ extension: string, provide: (nabu: Nabu, ctx: CommandContext) => Record<string, any> | void }>} */
        this.providers = [];
        /** @type {Set<string>} ambiguities already reported (once per chord + commands) */
        this.reported = new Set();
        this.counter = 0;
    }

    /**
     * Register a command. The command always exists (it is runnable through `exec`); only its KEYS can be refused:
     *  - invalid chord, or reserved by the browser / OS (see `RESERVED_CHORDS`) -> that chord is dropped, `nabu.warn`;
     *  - a chord without Ctrl / Alt / Meta (Backspace, Enter, a letter, Shift+letter…) on a command with no `when` -> dropped
     *    (it would swallow the key everywhere), `nabu.warn`;
     *  - the command has a `confirm` with an unknown strategy (or `choose` without `options`) -> ALL its keys dropped: a risky
     *    command is never run from a key without its confirmation.
     *  - another command with the same chord AND the same `scope` (or both unscoped) -> `nabu.warn`, both kept (the
     *    ambiguity is settled at key press, see {@link CommandRegistry#handleKeydown}).
     * A duplicate id is refused (warning, the first registration wins). The `keymap` option replaces `def.keys`, with the
     * same checks.
     * @param {string} id
     * @param {CommandDef} def
     * @param {string} [extension]
     * @returns {CommandEntry | null} null when the declaration is unusable (no `run`, duplicate id)
     */
    register(id, def, extension = 'core') {
        if (!def || typeof def.run !== 'function') { this.nabu.warn(`commands: "${id}" (${extension}) has no run(): ignored`); return null; }
        if (this.entries.has(id)) { this.nabu.warn(`commands: duplicate id "${id}" (${extension}): the first declaration is kept`); return null; }
        if (typeof def.label !== 'string' && typeof def.label !== 'function') this.nabu.warn(`commands: "${id}" has no label (string or function)`);

        /** @type {CommandEntry} */
        const entry = { id, def, extension, scope: typeof def.scope === 'string' ? def.scope : undefined, keys: [], order: this.counter++ };
        this.entries.set(id, entry);

        const override = Object.prototype.hasOwnProperty.call(this.keymap, id) ? this.keymap[id] : undefined;
        if (override !== undefined && !Array.isArray(override)) this.nabu.warn(`commands: keymap["${id}"] must be an array of chords: ignored`);
        const wanted = Array.isArray(override) ? override : Array.isArray(def.keys) ? def.keys : [];
        if (def.confirm && wanted.length) {
            const confirm = /** @type {any} */ (def.confirm);
            const known = confirm.strategy === 'hold' || confirm.strategy === 'invite' || (confirm.strategy === 'choose' && (typeof confirm.options === 'function' || Array.isArray(confirm.options)));
            if (!known) {
                this.nabu.warn(`commands: "${id}": unknown \`confirm\` strategy ${JSON.stringify(confirm.strategy)} (or \`choose\` without \`options\`): its keys are not bound; it still runs through nabu.exec("${id}")`);
                return entry;
            }
        }
        for (const text of wanted) this.#bind(entry, text);
        return entry;
    }

    /**
     * @param {CommandEntry} entry
     * @param {string} text
     */
    #bind(entry, text) {
        const { id, def } = entry;
        const chord = parseChord(text, { platform: this.platform });
        if (!chord) { this.nabu.warn(`commands: "${id}": invalid chord ${JSON.stringify(text)}: ignored`); return; }
        const key = chordId(chord);
        if (isReservedChord(chord, this.platform)) { this.nabu.warn(`commands: "${id}": chord "${text}" is reserved by the browser / OS: ignored`); return; }
        if (!hasCommandModifier(chord) && typeof def.when !== 'function') {
            this.nabu.warn(`commands: "${id}": chord "${text}" has no modifier and the command has no \`when\`: ignored (it would swallow the key everywhere)`);
            return;
        }
        let list = this.byChord.get(key);
        if (!list) this.byChord.set(key, list = []);
        if (list.includes(entry)) return; // the same chord written twice
        const twin = list.find((other) => other.scope === entry.scope);
        if (twin) this.nabu.warn(`commands: "${id}" and "${twin.id}" both bind "${text}" with the same scope (${entry.scope ?? 'none'}): ambiguous, the first registered wins unless their \`when\` differ`);
        list.push(entry);
        entry.keys.push(text);
    }

    /**
     * Warn about `keymap` entries that name no registered command (call once every extension is registered).
     */
    checkKeymap() {
        for (const id of Object.keys(this.keymap)) {
            if (!this.entries.has(id)) this.nabu.warn(`commands: keymap["${id}"] names no registered command`);
        }
    }

    /**
     * Let an extension contribute FACTS to the context (`Extension#commandContext`). Facts are merged after the core fields
     * and never replace them; a provider that throws is ignored (warning).
     * @param {(nabu: Nabu, ctx: CommandContext) => Record<string, any> | void} provide
     * @param {string} [extension]
     */
    addContextProvider(provide, extension = 'core') {
        if (typeof provide === 'function') this.providers.push({ extension, provide });
    }

    /**
     * Build the context a command sees: the core fields, then the facts of the extensions.
     * @param {KeyboardEvent | null} [event]
     * @returns {CommandContext}
     */
    context(event = null) {
        const nabu = this.nabu;
        const selection = nabu.selection;
        const block = selection.anchorBlock ?? null;
        /** @type {CommandContext} */
        const ctx = {
            nabu,
            event,
            block,
            selection,
            isCollapsed: !!selection.isCollapsed,
            ancestors: block ? block.parents.map((parent) => parent.type) : [],
            inRoot: !!block && !block.parent,
        };
        for (const { extension, provide } of this.providers) {
            try {
                const facts = provide(nabu, ctx);
                if (facts && typeof facts === 'object') {
                    for (const [name, value] of Object.entries(facts)) if (!CORE_FIELDS.has(name)) /** @type {any} */ (ctx)[name] = value;
                }
            } catch (error) {
                nabu.warn(`commands: commandContext of "${extension}" failed: ${error}`);
            }
        }
        return ctx;
    }

    /**
     * Key resolution, called by `Nabu#handleKeydown` before the legacy `onKeyDown` hooks. Returns whether a command
     * handled the key (the event is then `preventDefault`ed); `false` = fall through to the hooks and the native behavior.
     *
     *  1. nothing happens during an IME composition, or when someone already `preventDefault`ed the event;
     *  2. the chord of the event (keys.js) selects the commands bound to it; none -> return (no context is even built);
     *  3. candidates are the commands whose `when(ctx)` is true (absent = true; a throwing `when` = false);
     *  4. ONE -> it runs, through its `confirm` strategy when it has one (the controller keeps the key from there: see
     *     `command-confirm.svelte.js`). SEVERAL -> a command whose `scope` is the type of the caret's block beats generic ones;
     *     still tied -> the `choose` strategy lets the user pick (and the ambiguity is reported once with `nabu.warn`: the
     *     default keys should not step on each other);
     *  5. a command whose `run` returns `false` synchronously did not handle the key: the next candidate (in priority order)
     *     is tried, then the legacy hooks.
     * @param {KeyboardEvent} event
     * @returns {boolean}
     */
    handleKeydown(event) {
        if (event.isComposing || event.keyCode === 229 || this.nabu.composing) return false;
        const confirmation = this.nabu.commandConfirm;
        if (confirmation?.busy) {
            if (event.defaultPrevented) confirmation.cancel('key'); // somebody else took the key (slash menu…): the pending one is moot
            else if (confirmation.handleKeydown(event)) return true;
        }
        if (!this.byChord.size || event.defaultPrevented) return false;
        const chord = eventChordId(event);
        const bound = chord ? this.byChord.get(chord) : undefined;
        if (!bound?.length) return false;

        const ctx = this.context(event);
        const type = ctx.block?.type;
        const candidates = bound.filter((entry) => {
            if (typeof entry.def.when !== 'function') return true;
            try { return !!entry.def.when(ctx); } catch (error) { this.nabu.warn(`commands: when() of "${entry.id}" failed: ${error}`); return false; }
        });
        if (!candidates.length) return false;

        const rank = (/** @type {CommandEntry} */ entry) => (entry.scope !== undefined && entry.scope === type ? 1 : 0);
        candidates.sort((a, b) => rank(b) - rank(a) || a.order - b.order); // stable by registration order
        if (candidates.length > 1 && rank(candidates[0]) === rank(candidates[1])) {
            const ties = candidates.filter((entry) => rank(entry) === rank(candidates[0])).map((entry) => entry.id);
            const signature = `${chord}|${ties.join(',')}`;
            if (!this.reported.has(signature)) {
                this.reported.add(signature);
                this.nabu.warn(`commands: ambiguous key ${chord}: ${ties.join(', ')} all apply here; the user is asked to choose`);
            }
            if (confirmation && confirmation.beginTie(candidates.filter((entry) => rank(entry) === rank(candidates[0])), ctx, event)) return true;
        }
        for (const entry of candidates) {
            // A command that asks for confirmation never runs from the key press itself: the controller takes over.
            if (entry.def.confirm && confirmation) {
                if (confirmation.begin(entry, ctx, event)) return true;
                continue;
            }
            let result;
            try {
                result = entry.def.run(this.nabu, ctx);
            } catch (error) {
                console.error(`[Nabu] command "${entry.id}" failed`, error);
                event.preventDefault();
                return true;
            }
            if (result === false) continue;
            if (result && typeof result.then === 'function') result.then(undefined, (/** @type {unknown} */ error) => console.error(`[Nabu] command "${entry.id}" failed`, error));
            event.preventDefault();
            return true;
        }
        return false;
    }

    /**
     * Run a command from the bus (`nabu.exec(id, data)`): no key press, `ctx.event` is `null`, `when` is not checked.
     * @param {CommandEntry} entry
     * @param {any} [data]
     */
    invoke(entry, data) {
        return entry.def.run(this.nabu, this.context(null), data);
    }

    /**
     * Run a command by id, like `nabu.exec(id, data)` (which it calls).
     * @param {string} id
     * @param {any} [data]
     */
    run(id, data) {
        if (!this.entries.has(id)) { this.nabu.warn(`commands.run: unknown command "${id}"`); return undefined; }
        return this.nabu.exec(id, data);
    }

    /**
     * @param {CommandEntry} entry
     * @param {() => CommandContext} getContext
     * @returns {CommandInfo}
     */
    #info(entry, getContext) {
        const { def } = entry;
        let label = entry.id;
        if (typeof def.label === 'string') label = def.label;
        else if (typeof def.label === 'function') { try { label = String(def.label(getContext())); } catch (error) { this.nabu.warn(`commands: label of "${entry.id}" failed: ${error}`); } }
        let available = true;
        if (typeof def.when === 'function') { try { available = !!def.when(getContext()); } catch { available = false; } }
        return {
            id: entry.id,
            label,
            keys: [...entry.keys],
            display: entry.keys.map((text) => formatChord(text, { platform: this.platform })),
            scope: entry.scope,
            extension: entry.extension,
            available,
            confirm: def.confirm ?? null,
        };
    }

    /**
     * Every command, in registration order, as a plain snapshot (for a help sheet, a palette). Function labels and `when`
     * are evaluated with `ctx` (default: the current context, `event: null`).
     * @param {CommandContext} [ctx]
     * @returns {CommandInfo[]}
     */
    list(ctx) {
        /** @type {CommandContext | undefined} */
        let current = ctx;
        const getContext = () => (current ??= this.context(null));
        return [...this.entries.values()].map((entry) => this.#info(entry, getContext));
    }

    /**
     * @param {string} id
     * @param {CommandContext} [ctx]
     * @returns {CommandInfo | null}
     */
    get(id, ctx) {
        const entry = this.entries.get(id);
        return entry ? this.#info(entry, () => ctx ?? this.context(null)) : null;
    }

    /** @param {string} id @returns {boolean} */
    has(id) { return this.entries.has(id); }
}

/** Context fields the extensions' facts cannot replace. */
const CORE_FIELDS = new Set(['nabu', 'event', 'block', 'selection', 'isCollapsed', 'ancestors', 'inRoot']);
