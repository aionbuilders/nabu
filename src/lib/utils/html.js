/**
 * HTML / URL safety helpers — the ONE place that decides what may be written into markup or an `href` / `src`.
 *
 * Used by every HTML serializer (clipboard `text/html`, export), by the link / media rendering, and by the
 * paste / import pipelines (defense in depth: the model, the render and the output are each guarded).
 */

const HTML_ESCAPES = /** @type {Record<string, string>} */ ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
});

/**
 * Escape text for use as HTML text content OR inside a quoted attribute value (& < > " ').
 * @param {unknown} text
 * @returns {string}
 */
export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Escape a value for a quoted HTML attribute. Same table as {@link escapeHtml}; kept as a distinct name so the
 * call sites say what they mean.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeAttr(value) {
    return escapeHtml(value);
}

/** Schemes allowed in a LINK (`<a href>`). Relative URLs and `#fragment` are always allowed. */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
/** Schemes allowed for MEDIA (`src` of img / video, `href` of a file chip). `data:` is handled separately. */
const MEDIA_SCHEMES = new Set(['http', 'https', 'blob', 'nabu-asset']);
/** `data:` URLs accepted for media only: images and videos, never HTML / script / text. */
const DATA_MEDIA = /^data:(?:image|video)\/[a-z0-9][a-z0-9.+-]*[;,]/i;

/** @type {Record<string, string>} */
const NAMED_ENTITIES = {
    colon: ':', tab: '\t', newline: '\n', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", sol: '/', lpar: '(', rpar: ')',
};

/**
 * Decode the HTML character references that could hide a URL scheme (`&#106;avascript:`, `&colon;`, `&Tab;`…).
 * Decodes repeatedly (double-encoding) a bounded number of times.
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
    let prev;
    let out = s;
    for (let i = 0; i < 4; i++) {
        prev = out;
        out = out.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));?/g, (m, dec, hex, name) => {
            if (dec !== undefined || hex !== undefined) {
                const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
                try { return String.fromCodePoint(cp); } catch { return ''; }
            }
            const named = NAMED_ENTITIES[name.toLowerCase()];
            return named !== undefined ? named : m;
        });
        if (out === prev) break;
    }
    return out;
}

/**
 * Strip what a browser URL parser ignores or tolerates inside / around a scheme: ASCII control chars, whitespace
 * (including unicode spaces, zero-width characters and BOM).
 * @param {string} s
 * @returns {string}
 */
function stripInvisible(s) {
    return s.replace(/[\u0000-\u0020\u007f-\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\ufeff]/g, '');
}

/**
 * Scheme of a (cleaned) URL, lower-cased, or `null` when it is relative / a fragment.
 * @param {string} cleaned
 * @returns {string | null}
 */
function schemeOf(cleaned) {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
    return m ? m[1].toLowerCase() : null;
}

/**
 * @param {string} cleaned whitespace/control-stripped URL
 * @param {'link' | 'media'} kind
 * @returns {boolean}
 */
function isAllowed(cleaned, kind) {
    const scheme = schemeOf(cleaned);
    if (scheme === null) return true; // relative URL, `/path`, `?q`, `#frag`, `//host`
    if (kind === 'media') return MEDIA_SCHEMES.has(scheme) || (scheme === 'data' && DATA_MEDIA.test(cleaned));
    return LINK_SCHEMES.has(scheme);
}

/**
 * Return `url` when it is safe to put in an `href` / `src`, otherwise `null`.
 *
 *  - `kind: 'link'`  (default): http, https, mailto, tel, relative URLs, `#fragment`.
 *  - `kind: 'media'`: http, https, relative, `blob:`, `data:image/*`, `data:video/*`, and Nabu's internal
 *    `nabu-asset:` scheme (see Files).
 *
 * Everything else (`javascript:`, `vbscript:`, `data:text/html`, `file:`…) is refused, including obfuscated forms:
 * surrounding / embedded whitespace and control characters (`java\nscript:`), mixed case, and HTML-entity-encoded
 * schemes (`&#106;avascript:`). The URL is returned UNCHANGED (callers still have to escape it for the attribute).
 *
 * @param {unknown} url
 * @param {{ kind?: 'link' | 'media' }} [options]
 * @returns {string | null}
 */
export function sanitizeUrl(url, { kind = 'link' } = {}) {
    if (typeof url !== 'string') return null;
    const raw = url;
    const cleaned = stripInvisible(raw);
    if (!cleaned) return null;
    // Both the literal form and its entity-decoded form must pass (the decoded one is what a browser would act
    // on if this string ever went through an HTML parser).
    if (!isAllowed(cleaned, kind)) return null;
    if (cleaned.includes('&')) {
        const decoded = stripInvisible(decodeEntities(raw));
        if (!decoded || !isAllowed(decoded, kind)) return null;
    }
    // A backslash or percent-encoded scheme separator before the first `/` is not a scheme for browsers, but
    // `%6Aavascript:` must not be mistaken for relative either: decode %XX once for the scheme check.
    if (cleaned.includes('%')) {
        let pct = cleaned;
        try { pct = stripInvisible(decodeURIComponent(cleaned)); } catch { /* malformed escape: keep literal */ }
        if (!isAllowed(pct, kind)) return null;
    }
    return raw;
}

/**
 * Sanitize the link / media URLs of PasteBlocks (the fragment format shared by paste, import and the clipboard):
 * an unsafe `link` mark is dropped from the delta (the text stays), an unsafe `ref` / `src` / `href` / `url`
 * prop is emptied. Returns NEW objects where something changed; never mutates the input.
 * @template {{ delta?: any[], props?: Record<string, any>, children?: any[] }} B
 * @param {B[]} blocks
 * @returns {B[]}
 */
export function sanitizePasteBlocks(blocks) {
    if (!Array.isArray(blocks)) return blocks;
    return blocks.map((pb) => {
        if (!pb || typeof pb !== 'object') return pb;
        let out = pb;
        if (Array.isArray(pb.delta)) {
            let changed = false;
            const delta = pb.delta.map((op) => {
                const link = op?.attributes?.link;
                if (link === undefined || link === null || link === false) return op;
                if (typeof link === 'string' && sanitizeUrl(link, { kind: 'link' }) !== null) return op;
                changed = true;
                const { link: _drop, ...attributes } = op.attributes;
                return Object.keys(attributes).length ? { ...op, attributes } : { insert: op.insert };
            });
            if (changed) out = { ...out, delta };
        }
        if (pb.props && typeof pb.props === 'object') {
            let props = null;
            for (const key of ['ref', 'src', 'href', 'url']) {
                const v = pb.props[key];
                const kind = key === 'ref' || key === 'src' ? 'media' : 'link';
                if (typeof v === 'string' && v && sanitizeUrl(v, { kind }) === null) {
                    props ??= { ...pb.props };
                    props[key] = '';
                }
            }
            if (props) out = { ...out, props };
        }
        if (Array.isArray(pb.children) && pb.children.length) {
            const children = sanitizePasteBlocks(pb.children);
            if (children.some((c, i) => c !== pb.children?.[i])) out = { ...out, children };
        }
        return out;
    });
}
