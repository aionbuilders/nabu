/**
 * Region types: declaration, normalisation and field validation (ADR 016 §3.2). Pure functions, no
 * runes, no engine: everything here is testable on its own.
 *
 * A region TYPE is declared by the integrator:
 *
 *     { chapter: { level: 2, label: 'Chapter {index}', numbering: 'document', fields: { pov: 'text' } } }
 *
 * - `level`      depth of the division (1 = the highest). The extent of a region is deduced from the levels.
 * - `label`      display template: `{index}`, `{path}` ("2.3"), `{title}`, `{type}`, `{level}`.
 * - `numbering`  `'parent'` (restarts at 1 in each parent region; the default), `'document'` (continues
 *                over the whole document, for that type) or `'none'` (no index).
 * - `fields`     typed fields: `text`, `richtext` (LoroText), `number`, `boolean`, `enum`, `date`.
 *                A field is declared by its kind (`'text'`) or by an object (`{ type: 'enum', values: [...] }`).
 *
 * @typedef {'text' | 'richtext' | 'number' | 'boolean' | 'enum' | 'date'} FieldKind
 *
 * @typedef {Object} FieldSpec
 * @property {string} name
 * @property {FieldKind} kind
 * @property {string[]} [values]  the allowed values of an `enum`
 *
 * @typedef {'parent' | 'document' | 'none'} Numbering
 *
 * @typedef {Object} RegionTypeInit
 * @property {number} level
 * @property {string} [label]
 * @property {Numbering} [numbering]
 * @property {Record<string, FieldKind | { type: FieldKind, values?: string[] }>} [fields]
 *
 * @typedef {Object} RegionTypeDef
 * @property {string} id
 * @property {number} level
 * @property {string} label
 * @property {Numbering} numbering
 * @property {Map<string, FieldSpec>} fields  the DECLARED fields (the base `title` is not in it)
 *
 * @typedef {Object} RegionsConfig
 * @property {Map<string, RegionTypeDef>} types  in declaration order
 * @property {string} defaultType  the type `insertRegion` uses when none is given: the declared type of the lowest level
 * @property {number} maxLevel  the deepest declared level (the level given to a marker whose type is not declared)
 */

export const FIELD_KINDS = /** @type {const} */ (['text', 'richtext', 'number', 'boolean', 'enum', 'date']);
export const NUMBERINGS = /** @type {const} */ (['parent', 'document', 'none']);

/** The base field every region has. */
export const TITLE_SPEC = /** @type {FieldSpec} */ ({ name: 'title', kind: 'text' });

/**
 * Default types: ONE generic `section` division over three levels, as three types (the level IS the type: changing
 * the level of a region = changing its type, ADR 016 §3.4). Labels "1.", "1.1", "1.1.1".
 * @type {Record<string, RegionTypeInit>}
 */
export const DEFAULT_TYPES = {
    'section-1': { level: 1, label: '{path}. {title}' },
    'section-2': { level: 2, label: '{path} {title}' },
    'section-3': { level: 3, label: '{path} {title}' },
};

/**
 * @param {string} id @param {string} name @param {unknown} raw
 * @returns {FieldSpec}
 */
function normalizeField(id, name, raw) {
    const spec = typeof raw === 'string' ? { type: raw } : /** @type {any} */ (raw);
    const kind = spec?.type;
    if (!FIELD_KINDS.includes(kind)) {
        throw new Error(`Region type "${id}": field "${name}" has an unknown kind ${JSON.stringify(kind)} (expected one of ${FIELD_KINDS.join(', ')}).`);
    }
    /** @type {FieldSpec} */
    const out = { name, kind };
    if (kind === 'enum') {
        if (!Array.isArray(spec.values) || !spec.values.length || spec.values.some((/** @type {unknown} */ v) => typeof v !== 'string')) {
            throw new Error(`Region type "${id}": enum field "${name}" needs a non-empty \`values\` array of strings.`);
        }
        out.values = [...spec.values];
    }
    return out;
}

/**
 * Validates the declaration and returns the resolved configuration. Throws on an invalid declaration (a
 * configuration error is the integrator's, and is reported when the extension is created).
 * @param {{ types?: Record<string, RegionTypeInit> }} [options]
 * @returns {RegionsConfig}
 */
export function resolveConfig(options = {}) {
    const declared = options.types && Object.keys(options.types).length ? options.types : DEFAULT_TYPES;
    /** @type {Map<string, RegionTypeDef>} */
    const types = new Map();
    for (const [id, init] of Object.entries(declared)) {
        if (!init || !Number.isInteger(init.level) || init.level < 1) {
            throw new Error(`Region type "${id}": \`level\` must be an integer >= 1.`);
        }
        const numbering = init.numbering ?? 'parent';
        if (!NUMBERINGS.includes(numbering)) {
            throw new Error(`Region type "${id}": \`numbering\` must be one of ${NUMBERINGS.join(', ')}.`);
        }
        /** @type {Map<string, FieldSpec>} */
        const fields = new Map();
        for (const [name, raw] of Object.entries(init.fields ?? {})) {
            if (name === TITLE_SPEC.name) continue; // `title` is a base field of every region
            fields.set(name, normalizeField(id, name, raw));
        }
        types.set(id, {
            id,
            level: init.level,
            label: typeof init.label === 'string' ? init.label : (numbering === 'none' ? '{title}' : '{path} {title}'),
            numbering,
            fields,
        });
    }
    let defaultType = '';
    let maxLevel = 1;
    for (const def of types.values()) {
        if (!defaultType || def.level < /** @type {RegionTypeDef} */ (types.get(defaultType)).level) defaultType = def.id;
        if (def.level > maxLevel) maxLevel = def.level;
    }
    return { types, defaultType, maxLevel };
}

/**
 * The spec of a field of a region type: the base `title`, a declared field, or `undefined` (an unknown field,
 * kept as-is).
 * @param {RegionTypeDef | undefined} def @param {string} name
 * @returns {FieldSpec | undefined}
 */
export function fieldSpec(def, name) {
    return name === TITLE_SPEC.name ? TITLE_SPEC : def?.fields.get(name);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Whether `value` is a valid date string: ISO 8601 `YYYY-MM-DD`, optionally with a time (`YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±HH:MM]`).
 * @param {unknown} value
 * @returns {value is string}
 */
export function isDateString(value) {
    if (typeof value !== 'string') return false;
    const m = DATE_RE.exec(value);
    if (!m) return false;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return false; // 2024-02-31
    return !Number.isNaN(Date.parse(value.replace(' ', 'T')));
}

/** @param {unknown} v @returns {v is Array<{ insert: string, attributes?: Record<string, any> }>} */
const isDelta = (v) => Array.isArray(v) && v.every((op) => op && typeof op === 'object' && typeof (/** @type {any} */ (op)).insert === 'string');

/**
 * Validates (and normalises) a value against a field spec.
 *  - `null` / `undefined` always validate: they CLEAR the field (`{ ok: true, value: undefined }`);
 *  - `text` a string; `number` a finite number; `boolean` a boolean; `enum` one of the declared values;
 *  - `date` a valid ISO date string, or a `Date` (stored as its ISO string);
 *  - `richtext` a string, or a Loro delta array (`[{ insert, attributes? }]`): normalised to a delta.
 * Never throws and never coerces across kinds (`'3'` is not a number).
 * @param {FieldSpec} spec @param {unknown} value
 * @returns {{ ok: true, value: any } | { ok: false }}
 */
export function validateField(spec, value) {
    if (value === undefined || value === null) return { ok: true, value: undefined };
    switch (spec.kind) {
        case 'text': return typeof value === 'string' ? { ok: true, value } : { ok: false };
        case 'number': return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false };
        case 'boolean': return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
        case 'enum': return typeof value === 'string' && spec.values?.includes(value) ? { ok: true, value } : { ok: false };
        case 'date':
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? { ok: false } : { ok: true, value: value.toISOString() };
            return isDateString(value) ? { ok: true, value } : { ok: false };
        case 'richtext':
            if (typeof value === 'string') return { ok: true, value: value ? [{ insert: value }] : [] };
            return isDelta(value) ? { ok: true, value } : { ok: false };
        default: return { ok: false };
    }
}

/**
 * Applies a label template. `{index}` (the number, empty when the type is not numbered), `{path}` ("2.3"), `{title}`,
 * `{type}`, `{level}`; any other `{token}` is left as written. The result is trimmed and its whitespace collapsed,
 * so an empty `{title}` leaves no dangling space ("1.1 " → "1.1").
 * @param {string} template
 * @param {{ index: number | null, path: string, title: string, type: string, level: number }} values
 * @returns {string}
 */
export function formatLabel(template, values) {
    const map = /** @type {Record<string, string>} */ ({
        index: values.index == null ? '' : String(values.index),
        path: values.path,
        title: values.title,
        type: values.type,
        level: String(values.level),
    });
    return template
        .replace(/\{(index|path|title|type|level)\}/g, (_, token) => map[token])
        .replace(/\s+/g, ' ')
        .trim();
}
