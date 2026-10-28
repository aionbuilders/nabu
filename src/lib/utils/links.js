/**
 * Whether a link leaves the site it is shown on. Only such a link is opened in a new tab (`target="_blank"`): a relative link, a
 * `#anchor`, a link to the same origin, `mailto:` and `tel:` all open in place.
 *
 * External means an absolute `http(s)://` (or protocol-relative `//`) URL whose origin is not `origin`. Without an `origin` (rendering
 * on the server, where the page's origin is not known) every such absolute URL counts as external, which is the safe side.
 * @param {string | null | undefined} href
 * @param {string} [origin] The origin of the current page, e.g. `location.origin`.
 * @returns {boolean}
 */
export function isExternalLink(href, origin) {
    if (typeof href !== 'string') return false;
    const url = href.trim();
    if (!/^(?:https?:)?\/\//i.test(url)) return false;
    if (!origin) return true;
    try {
        return new URL(url, origin).origin !== origin;
    } catch {
        return false;
    }
}

/**
 * The attributes a rendered link takes: `target="_blank"` and `rel="noopener noreferrer"` for an external link, nothing otherwise
 * (`undefined` removes the attribute).
 * @param {string | null | undefined} href
 * @param {string} [origin]
 * @returns {{ target: '_blank' | undefined, rel: 'noopener noreferrer' | undefined }}
 */
export function linkAttributes(href, origin) {
    return isExternalLink(href, origin)
        ? { target: '_blank', rel: 'noopener noreferrer' }
        : { target: undefined, rel: undefined };
}
