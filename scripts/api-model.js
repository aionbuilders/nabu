// @ts-nocheck  (build-time script, not part of the library nor of the type-checked site)
/**
 * Generates the model of the API reference: `src/site/api/model.json`.
 *
 *   JSDoc (src/lib) --TypeDoc--> JSON --this script--> model.json --(SvelteKit load, prerender)--> /api/**
 *
 * Run by `bun run api:model` (and by `build` / `build:e2e`). Build time only: nothing here reaches the library `dist/` nor the
 * client bundle. The model is plain JSON: types are lists of parts (`'text'` or `{ t, to }` for a link to another documented
 * export), prose is Markdown whose links use the `api:<item id>[#anchor]` scheme.
 *
 * Sources: TypeDoc for everything that is JavaScript; the `.svelte` files are read directly (components have no TypeDoc model).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application, OptionDefaults } from 'typedoc';
import { ENTRIES, CONTRACT_EXTRA, CONTRACT_CLASSES, COMPONENT_SUMMARY, CLASS_SUMMARY, PROP_FALLBACK, RELATED_GUIDE } from './api-config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL_PATH = resolve(ROOT, 'src/site/api/model.json');

// ---------------------------------------------------------------------------------------------------------------------
// TypeDoc kinds
// ---------------------------------------------------------------------------------------------------------------------

const K = { Variable: 32, Function: 64, Class: 128, Interface: 256, Property: 1024, Method: 2048, Constructor: 512, Accessor: 262144, TypeAlias: 2097152, Reference: 4194304, TypeLiteral: 65536 };

// ---------------------------------------------------------------------------------------------------------------------
// Running TypeDoc
// ---------------------------------------------------------------------------------------------------------------------

async function runTypeDoc() {
  const app = await Application.bootstrapWithPlugins({
    tsconfig: resolve(ROOT, 'scripts/api-tsconfig.json'),
    entryPoints: [...ENTRIES.map((e) => resolve(ROOT, e.file)), resolve(ROOT, 'scripts/api-contract.js')],
    blockTags: [...OptionDefaults.blockTags, '@unstable'],
    skipErrorChecking: true,
    readme: 'none',
    logLevel: 'Error',
    validation: false,
    excludePrivate: true,
    excludeProtected: true,
    excludeInternal: false,
  });
  const project = await app.convert();
  if (!project) throw new Error('TypeDoc could not convert the project (see the errors above).');
  return app.serializer.projectToObject(project, ROOT);
}

// ---------------------------------------------------------------------------------------------------------------------
// Context: id index, links
// ---------------------------------------------------------------------------------------------------------------------

/** Index every reflection by id (modules, members, signatures, parameters...). */
function indexById(json) {
  const byId = new Map();
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.id === 'number' && typeof node.name === 'string' && node.variant) byId.set(node.id, node);
    for (const key of Object.keys(node)) if (key !== 'sources') walk(node[key]);
  })(json);
  return byId;
}

// ---------------------------------------------------------------------------------------------------------------------
// Types -> parts
// ---------------------------------------------------------------------------------------------------------------------

/** @typedef {string | { t: string, to: string }} Part */

const text = (s) => [s];

/** Join several part lists with a separator. */
function join(lists, sep) {
  const out = [];
  lists.forEach((l, i) => { if (i) out.push(sep); out.push(...l); });
  return out;
}

/** Merge adjacent plain strings (keeps the JSON small). */
function compact(parts) {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string' && typeof out[out.length - 1] === 'string') out[out.length - 1] += p;
    else if (p !== '') out.push(p);
  }
  return out;
}

const literal = (v) => (v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v).replace(/^"|"$/g, "'").replace(/\\"/g, '"') : typeof v === 'object' ? `${v.negative ? '-' : ''}${v.value}n` : String(v));

function wrap(parts, yes) { return yes ? ['(', ...parts, ')'] : parts; }

function typeParts(t, cx, depth = 0) {
  if (!t) return text('any');
  switch (t.type) {
    case 'intrinsic': return text(t.name);
    case 'literal': return text(literal(t.value));
    case 'reference': {
      const name = t.name;
      const to = typeof t.target === 'number' ? cx.link(t.target) : null;
      const head = to ? [{ t: name, to }] : text(name);
      if (t.typeArguments?.length) return [...head, '<', ...join(t.typeArguments.map((a) => typeParts(a, cx, depth + 1)), ', '), '>'];
      return head;
    }
    case 'array': return [...wrap(typeParts(t.elementType, cx, depth + 1), ['union', 'intersection', 'reflection', 'conditional', 'typeOperator'].includes(t.elementType.type) && !(t.elementType.type === 'reflection' && !t.elementType.declaration.signatures)), '[]'];
    case 'union': return join(t.types.map((x) => wrap(typeParts(x, cx, depth + 1), x.type === 'reflection' && x.declaration.signatures || x.type === 'conditional')), ' | ');
    case 'intersection': return join(t.types.map((x) => wrap(typeParts(x, cx, depth + 1), x.type === 'union' || x.type === 'reflection' && x.declaration.signatures)), ' & ');
    case 'tuple': return ['[', ...join((t.elements ?? []).map((x) => typeParts(x, cx, depth + 1)), ', '), ']'];
    case 'namedTupleMember': return [`${t.name}${t.isOptional ? '?' : ''}: `, ...typeParts(t.element, cx, depth + 1)];
    case 'optional': return [...typeParts(t.elementType, cx, depth + 1), '?'];
    case 'rest': return ['...', ...typeParts(t.elementType, cx, depth + 1)];
    case 'typeOperator': return [`${t.operator} `, ...typeParts(t.target, cx, depth + 1)];
    case 'indexedAccess': return [...typeParts(t.objectType, cx, depth + 1), '[', ...typeParts(t.indexType, cx, depth + 1), ']'];
    case 'query': return ['typeof ', ...typeParts(t.queryType, cx, depth + 1)];
    case 'predicate': return [t.asserts ? 'asserts ' : '', t.name, ...(t.targetType ? [' is ', ...typeParts(t.targetType, cx, depth + 1)] : [])];
    case 'conditional': return [...typeParts(t.checkType, cx, depth + 1), ' extends ', ...typeParts(t.extendsType, cx, depth + 1), ' ? ', ...typeParts(t.trueType, cx, depth + 1), ' : ', ...typeParts(t.falseType, cx, depth + 1)];
    case 'templateLiteral': return ['`', t.head, ...(t.tail ?? []).flatMap(([ty, s]) => ['${', ...typeParts(ty, cx, depth + 1), '}', s]), '`'];
    case 'mapped': return ['{ [', t.parameter, ' in ', ...typeParts(t.parameterType, cx, depth + 1), ']: ', ...typeParts(t.templateType, cx, depth + 1), ' }'];
    case 'inferred': return text(`infer ${t.name}`);
    case 'reflection': return declarationParts(t.declaration, cx, depth);
    default: return text(t.name ?? 'unknown');
  }
}

/** The signature `(a: A, b?: B) => R` of a function type, or `(a: A): R` of a call signature when `colon`. */
function signatureParts(sig, cx, depth, arrow = true) {
  const params = (sig.parameters ?? []).map((p) => [p.flags?.isRest ? '...' : '', p.name, p.flags?.isOptional || p.defaultValue !== undefined ? '?' : '', ': ', ...typeParts(p.type, cx, depth + 1)]);
  const tp = sig.typeParameters?.length ? ['<', ...join(sig.typeParameters.map((x) => typeParamParts(x, cx)), ', '), '>'] : [];
  return [...tp, '(', ...join(params, ', '), ')', arrow ? ' => ' : ': ', ...typeParts(sig.type, cx, depth + 1)];
}

function typeParamParts(tp, cx) {
  return [tp.name, ...(tp.type ? [' extends ', ...typeParts(tp.type, cx)] : []), ...(tp.default ? [' = ', ...typeParts(tp.default, cx)] : [])];
}

/** An object / function type literal. Objects with more than three members are spread over several lines. */
function declarationParts(d, cx, depth) {
  if (d.signatures?.length && !d.children?.length) {
    return d.signatures.length === 1 ? signatureParts(d.signatures[0], cx, depth) : join(d.signatures.map((s) => ['{ ', ...signatureParts(s, cx, depth, false), ' }']), ' | ');
  }
  const members = [];
  for (const c of d.children ?? []) {
    const key = /^[A-Za-z_$][\w$]*$/.test(c.name) ? c.name : `'${c.name}'`;
    if (c.signatures?.length) members.push([key, ...signatureParts(c.signatures[0], cx, depth + 1, false)]);
    else members.push([c.flags?.isReadonly ? 'readonly ' : '', key, c.flags?.isOptional ? '?' : '', ': ', ...typeParts(c.type, cx, depth + 1)]);
  }
  for (const ix of d.indexSignatures ?? []) members.push(['[', ix.parameters?.[0]?.name ?? 'key', ': ', ...typeParts(ix.parameters?.[0]?.type, cx), ']: ', ...typeParts(ix.type, cx, depth + 1)]);
  if (!members.length) return text('{}');
  if (members.length <= 3 && depth > 0) return ['{ ', ...join(members, '; '), ' }'];
  if (members.length <= 3) return ['{ ', ...join(members, '; '), ' }'];
  const pad = '  '.repeat(depth + 1);
  return ['{\n', ...members.flatMap((m) => [pad, ...m, ';\n']), '  '.repeat(depth), '}'];
}

const partsText = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.t)).join('');

// ---------------------------------------------------------------------------------------------------------------------
// Comments -> Markdown
// ---------------------------------------------------------------------------------------------------------------------

function commentMd(parts, cx) {
  if (!parts?.length) return '';
  return parts.map((p) => {
    if (p.kind === 'inline-tag' && (p.tag === '@link' || p.tag === '@linkcode' || p.tag === '@linkplain')) {
      const label = p.text;
      const to = typeof p.target === 'number' ? cx.link(p.target) : null;
      return to ? `[\`${label}\`](api:${to})` : `\`${label}\``;
    }
    return p.text;
  }).join('').trim();
}

const tagOf = (comment, name) => (comment?.blockTags ?? []).filter((t) => t.tag === name);
const hasModifier = (comment, name) => (comment?.modifierTags ?? []).includes(name);

/** First paragraph / the rest. */
function splitMd(md) {
  const i = md.search(/\n\s*\n/);
  if (i < 0) return [md, ''];
  return [md.slice(0, i).trim(), md.slice(i).trim()];
}

function docOf(comment, cx) {
  const md = commentMd(comment?.summary, cx);
  const [summary, rest] = splitMd(md);
  const remarks = tagOf(comment, '@remarks').map((t) => commentMd(t.content, cx)).filter(Boolean).join('\n\n');
  return {
    summary,
    description: [rest, remarks].filter(Boolean).join('\n\n'),
    returns: tagOf(comment, '@returns').map((t) => commentMd(t.content, cx)).join('\n\n'),
    examples: tagOf(comment, '@example').map((t) => exampleOf(commentMd(t.content, cx))),
    deprecated: tagOf(comment, '@deprecated').length ? commentMd(tagOf(comment, '@deprecated')[0].content, cx) || true : undefined,
    see: tagOf(comment, '@see').map((t) => commentMd(t.content, cx)),
    defaultValue: tagOf(comment, '@defaultValue').concat(tagOf(comment, '@default')).map((t) => commentMd(t.content, cx).replace(/^```\w*\n?|\n?```$/g, '').trim())[0],
    unstable: tagOf(comment, '@unstable').length > 0,
  };
}

/** An @example is code unless it already carries a fence. */
function exampleOf(md) {
  if (md.includes('```')) return md;
  return '```js\n' + md.replace(/^\s*\n/, '') + '\n```';
}

// ---------------------------------------------------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------------------------------------------------

function paramRows(parameters, cx, prefix = '', paramDocs = {}) {
  const rows = [];
  for (const p of parameters ?? []) {
    const name = prefix + p.name;
    const decl = p.type?.type === 'reflection' && !p.type.declaration.signatures ? p.type.declaration : null;
    const row = {
      name,
      type: compact(decl?.children?.length ? text('object') : typeParts(p.type, cx)),
      optional: !!p.flags?.isOptional || p.defaultValue !== undefined,
      rest: !!p.flags?.isRest,
      default: p.defaultValue !== undefined ? String(p.defaultValue) : undefined,
      description: commentMd(p.comment?.summary, cx),
    };
    rows.push(row);
    if (decl?.children?.length) rows.push(...propertyRows(decl.children, cx, name + '.'));
  }
  return rows;
}

function propertyRows(children, cx, prefix = '') {
  const rows = [];
  for (const c of children) {
    const sig = c.signatures?.[0];
    const comment = c.comment ?? sig?.comment ?? c.getSignature?.comment;
    const doc = docOf(comment, cx);
    const type = sig ? compact(signatureParts(sig, cx, 1)) : compact(typeParts(c.type ?? c.getSignature?.type, cx, 1));
    const dflt = c.defaultValue !== undefined && c.defaultValue !== '...' && String(c.defaultValue) !== partsText(type) ? String(c.defaultValue) : doc.defaultValue;
    rows.push({
      name: prefix + c.name,
      type,
      optional: !!c.flags?.isOptional,
      readonly: !!c.flags?.isReadonly,
      default: dflt,
      description: [doc.summary, doc.description].filter(Boolean).join('\n\n'),
    });
    const decl = c.type?.type === 'reflection' && !c.type.declaration.signatures ? c.type.declaration : null;
    if (decl?.children?.length && prefix.split('.').length < 3) rows.push(...propertyRows(decl.children, cx, prefix + c.name + '.'));
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------
// Signatures as code
// ---------------------------------------------------------------------------------------------------------------------

function fnCode(name, sig, cx, kw = 'function ') {
  const tp = sig.typeParameters?.length ? '<' + partsText(join(sig.typeParameters.map((x) => typeParamParts(x, cx)), ', ')) + '>' : '';
  const params = (sig.parameters ?? []).map((p) => {
    const decl = p.type?.type === 'reflection' && !p.type.declaration.signatures ? p.type.declaration : null;
    const type = decl && decl.children?.length ? 'object' : partsText(typeParts(p.type, cx));
    return `${p.flags?.isRest ? '...' : ''}${p.name}${p.flags?.isOptional || p.defaultValue !== undefined ? '?' : ''}: ${type}`;
  });
  const oneLine = `${kw}${name}${tp}(${params.join(', ')})`;
  const ret = partsText(typeParts(sig.type, cx));
  const head = oneLine.length > 90 && params.length > 1 ? `${kw}${name}${tp}(\n  ${params.join(',\n  ')}\n)` : oneLine;
  return `${head}: ${ret}`;
}

function sigDoc(sig, cx) {
  const d = docOf(sig.comment, cx);
  return {
    ...d,
    typeParams: (sig.typeParameters ?? []).map((tp) => ({ name: tp.name, constraint: tp.type ? compact(typeParts(tp.type, cx)) : undefined, description: commentMd(tp.comment?.summary, cx) })),
    params: paramRows(sig.parameters, cx),
    returnType: sig.type ? compact(typeParts(sig.type, cx)) : undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Members of a class
// ---------------------------------------------------------------------------------------------------------------------

function convertMember(m, cx, owner) {
  const isStatic = !!m.flags?.isStatic;
  const base = { name: m.name, static: isStatic, id: (isStatic ? 's-' : 'm-') + m.name };
  const inheritedFrom = m.inheritedFrom?.name ? m.inheritedFrom.name.split('.')[0] : undefined;
  if (inheritedFrom) base.inheritedFrom = inheritedFrom;
  if (m.kind === K.Method || m.signatures?.length && m.kind !== K.Property) {
    const sigs = m.signatures ?? [];
    return { ...base, kind: 'method', signatures: sigs.map((s) => ({ code: fnCode((isStatic ? '' : '') + m.name, s, cx, '').replace(/^/, ''), ...sigDoc(s, cx) })), ...mergeTopDoc(sigs[0], cx) };
  }
  if (m.kind === K.Accessor) {
    const g = m.getSignature, s = m.setSignature;
    const doc = docOf(g?.comment ?? s?.comment, cx);
    const type = g?.type ?? s?.parameters?.[0]?.type;
    const parts = compact(typeParts(type, cx));
    return { ...base, kind: 'property', accessor: true, readonly: !s, optional: false, type: parts, code: `${isStatic ? 'static ' : ''}${s ? '' : 'readonly '}${m.name}: ${partsText(parts)}`, ...pick(doc) };
  }
  // property
  const doc = docOf(m.comment, cx);
  const parts = compact(typeParts(m.type, cx));
  return { ...base, kind: 'property', readonly: !!m.flags?.isReadonly, optional: !!m.flags?.isOptional, type: parts, default: m.defaultValue && m.defaultValue !== '...' ? String(m.defaultValue) : undefined, code: `${isStatic ? 'static ' : ''}${m.flags?.isReadonly ? 'readonly ' : ''}${m.name}${m.flags?.isOptional ? '?' : ''}: ${partsText(parts)}`, ...pick(doc) };
}

function pick(d) { const { summary, description, examples, deprecated, unstable, see, defaultValue } = d; return { summary, description, examples, deprecated, unstable, see, docDefault: defaultValue }; }
function mergeTopDoc(sig, cx) { return sig ? pick(docOf(sig.comment, cx)) : { summary: '', description: '', examples: [], see: [] }; }

// ---------------------------------------------------------------------------------------------------------------------
// Top-level items
// ---------------------------------------------------------------------------------------------------------------------

function baseItem(entry, name, kind, refl, cx, extra = {}) {
  return {
    id: `${entry}/${name}`,
    entry,
    name,
    kind,
    stability: 'stable',
    source: refl?.sources?.[0] ? `${refl.sources[0].fileName}:${refl.sources[0].line}` : undefined,
    guide: RELATED_GUIDE[name] ? { title: RELATED_GUIDE[name][0], href: RELATED_GUIDE[name][1] } : undefined,
    ...extra,
  };
}

function convertFunction(entry, refl, cx) {
  const sigs = refl.signatures ?? [];
  const first = sigs[0];
  const doc = docOf(first?.comment, cx);
  return baseItem(entry, refl.name, 'function', refl, cx, {
    summary: doc.summary, description: doc.description, examples: doc.examples, deprecated: doc.deprecated, see: doc.see,
    signatures: sigs.map((s) => ({ code: fnCode(refl.name, s, cx), ...sigDoc(s, cx) })),
  });
}

function convertClass(entry, refl, cx, contract) {
  const doc = docOf(refl.comment, cx);
  const all = (refl.children ?? []);
  const useFilter = contract;
  const kept = all.filter((m) => m.kind !== K.Constructor && (!useFilter || m.flags?.isPublic) && !m.name.startsWith('_') && !m.name.startsWith('#'));
  const members = kept.map((m) => convertMember(m, cx, refl.name));
  const ctor = all.find((m) => m.kind === K.Constructor);
  const ext = refl.extendedTypes?.[0] ? compact(typeParts(refl.extendedTypes[0], cx)) : undefined;
  const item = baseItem(entry, refl.name, 'class', refl, cx, {
    summary: doc.summary, description: doc.description, examples: doc.examples, deprecated: doc.deprecated, see: doc.see,
    extends: ext,
    contract: !!contract,
    constructors: (ctor?.signatures ?? []).map((s) => ({ code: fnCode(`new ${refl.name}`, s, cx, '').replace(/: [^:]*$/, ''), ...sigDoc(s, cx) })),
    members,
  });
  return item;
}

function convertTypeLike(entry, refl, cx) {
  const doc = docOf(refl.comment, cx);
  const item = baseItem(entry, refl.name, 'type', refl, cx, {
    summary: doc.summary, description: doc.description, examples: doc.examples, deprecated: doc.deprecated, see: doc.see,
    typeParams: (refl.typeParameters ?? []).map((tp) => ({ name: tp.name, constraint: tp.type ? compact(typeParts(tp.type, cx)) : undefined, description: commentMd(tp.comment?.summary, cx) })),
  });
  const tp = refl.typeParameters?.length ? '<' + partsText(join(refl.typeParameters.map((x) => typeParamParts(x, cx)), ', ')) + '>' : '';
  if (refl.kind === K.Interface) {
    item.declKind = 'interface';
    item.extends = refl.extendedTypes?.map((t) => compact(typeParts(t, cx)));
    item.properties = propertyRows(refl.children ?? [], cx);
    const members = item.properties.map((p) => `  ${p.readonly ? 'readonly ' : ''}${p.name}${p.optional ? '?' : ''}: ${partsText(p.type)};`);
    item.code = `interface ${refl.name}${tp} {\n${members.join('\n')}\n}`;
    return item;
  }
  item.declKind = 'alias';
  const t = refl.type;
  item.code = `type ${refl.name}${tp} = ${partsText(typeParts(t, cx))}`;
  // properties of object-literal parts (a plain object type, or the literal half of an intersection)
  const literals = t?.type === 'reflection' ? [t] : t?.type === 'intersection' ? t.types.filter((x) => x.type === 'reflection') : [];
  const children = literals.flatMap((l) => l.declaration.children ?? []);
  if (children.length) item.properties = propertyRows(children, cx);
  if (t?.type === 'intersection') item.combines = t.types.filter((x) => x.type !== 'reflection').map((x) => compact(typeParts(x, cx)));
  if (t?.type === 'reflection' && t.declaration.signatures) item.signatureOnly = true;
  if (t?.type === 'union') item.variants = t.types.map((x) => compact(typeParts(x, cx)));
  return item;
}

function convertVariable(entry, refl, cx) {
  const doc = docOf(refl.comment, cx);
  const type = compact(typeParts(refl.type, cx));
  const decl = refl.type?.type === 'reference' && refl.type.typeArguments?.[0]?.type === 'reflection' ? refl.type.typeArguments[0].declaration : refl.type?.type === 'reflection' ? refl.type.declaration : null;
  const item = baseItem(entry, refl.name, 'constant', refl, cx, {
    summary: doc.summary, description: doc.description, examples: doc.examples, deprecated: doc.deprecated, see: doc.see,
    type,
    value: refl.defaultValue && refl.defaultValue !== '...' ? String(refl.defaultValue) : undefined,
    code: `const ${refl.name}: ${partsText(type)}`,
  });
  if (decl?.children?.length) item.properties = propertyRows(decl.children, cx);
  return item;
}

// ---------------------------------------------------------------------------------------------------------------------
// Svelte components (read from the source)
// ---------------------------------------------------------------------------------------------------------------------

/** Split at the top level (outside brackets, quotes, templates) on `,` `;` or a newline. */
function splitTop(src) {
  const out = []; let depth = 0, quote = null, cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) { cur += c; if (c === quote && src[i - 1] !== '\\') quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; cur += c; continue; }
    if ('<([{'.includes(c)) depth++;
    if ('>)]}'.includes(c) && !(c === '>' && src[i - 1] === '=')) depth--;
    if (depth === 0 && (c === ',' || c === ';' || c === '\n')) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the brace that closes the one at `open`. */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

const cleanJsdoc = (body) => body.split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n');

/** `import('../x.js').Name` -> `Name` and the names that were imported. */
function simplifyImports(type) { return type.replace(/import\((['"]).*?\1\)\.(\w+)/g, '$2'); }

/** Type text -> parts, linking the identifiers that are documented items. */
function textToParts(type, cx) {
  const parts = []; const re = /[A-Za-z_$][\w$]*/g; let last = 0, m;
  while ((m = re.exec(type))) {
    parts.push(type.slice(last, m.index));
    const to = cx.byName.get(m[0]);
    parts.push(to && !/^[a-z]/.test(m[0]) ? { t: m[0], to } : m[0]);
    last = m.index + m[0].length;
  }
  parts.push(type.slice(last));
  return compact(parts);
}

function parseComponent(entry, name, file, cx) {
  const src = readFileSync(resolve(ROOT, 'src/lib', file), 'utf8');
  const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? '';
  const propsAt = script.search(/let\s*\{[\s\S]*?\}\s*=\s*\$props\(\)/);
  const destructure = /let\s*\{([\s\S]*?)\}\s*=\s*\$props\(\)/.exec(script)?.[1] ?? '';
  const defaults = {};
  for (const part of splitTop(destructure)) {
    const m = /^(\w+)\s*(?:=\s*([\s\S]+))?$/.exec(part);
    if (m) defaults[m[1]] = m[2]?.trim();
  }
  // the JSDoc comment right before `let {...} = $props()` that holds the `@type {{...}}`
  let typeText = '', prose = '', trailing = '';
  const comments = [...script.slice(0, propsAt < 0 ? script.length : propsAt).matchAll(/\/\*\*([\s\S]*?)\*\//g)].map((m) => cleanJsdoc(m[1]));
  const holder = [...comments].reverse().find((c) => /@type\s*\{\{/.test(c));
  if (holder) {
    const at = holder.search(/@type\s*\{\{/);
    const open = holder.indexOf('{', at);
    const close = matchBrace(holder, open);
    typeText = holder.slice(open + 2, close - 1);
    prose = holder.slice(0, at).trim();
    trailing = holder.slice(close + 1).trim();
  }
  const props = [];
  const docs = {};
  const docText = [prose, trailing].join('\n');
  // "- `name`: description" or "`name`: description", continued on following indented lines
  let curName = null;
  const proseLines = [];
  for (const line of docText.split('\n')) {
    const m = /^\s*(?:[-*]\s*)?`(\w+)`:\s*(.*)$/.exec(line);
    if (m) { curName = m[1]; docs[curName] = m[2]; }
    else if (curName && /^\s+\S/.test(line)) docs[curName] += ' ' + line.trim();
    else { curName = null; proseLines.push(line); }
  }
  const proseOnly = proseLines.join('\n').replace(/The texts the menu[\s\S]*$/, (s) => s).trim();
  for (const member of splitTop(typeText)) {
    const m = /^(\w+)(\?)?\s*:\s*([\s\S]+)$/.exec(member);
    if (!m) continue;
    const [, pname, opt, type] = m;
    const desc = docs[pname] ?? PROP_FALLBACK[pname] ?? '';
    props.push({
      name: pname,
      type: textToParts(simplifyImports(type.trim()), cx),
      optional: !!opt || defaults[pname] !== undefined,
      default: defaults[pname] !== undefined && defaults[pname] !== 'undefined' ? defaults[pname] : undefined,
      description: desc,
      fallback: docs[pname] === undefined && !!PROP_FALLBACK[pname],
    });
  }
  // description: the prose of the type comment, else the leading `//` comment of the script for the two command surfaces
  let description = proseOnly;
  const header = /^\s*((?:\/\/.*\n\s*)+)/.exec(script)?.[1];
  const useHeader = ['CommandInvite', 'CommandChooser'].includes(name);
  if (!description && useHeader && header) description = header.split('\n').map((l) => l.replace(/^\s*\/\/ ?/, '')).join(' ').replace(/\s+/g, ' ').trim();
  const [summary0, rest] = splitMd(description);
  const handwritten = !summary0 && !!COMPONENT_SUMMARY[name];
  const summary = summary0 || COMPONENT_SUMMARY[name] || '';
  const required = props.filter((p) => !p.optional).map((p) => p.name);
  const usage = `<${name} ${required.map((r) => `{${r}}`).join(' ')} />`.replace(/ \/>$/, required.length ? ' />' : '/>');
  return baseItem(entry, name, 'component', null, cx, {
    summary, description: rest, handwrittenSummary: handwritten, examples: [], see: [],
    source: `src/lib/${file}`,
    props,
    usage,
    code: `<script>\n  import { ${name} } from '${ENTRIES.find((e) => e.id === entry).specifier}';\n</script>\n\n${usage}`,
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------------------

/** Component exports of an entry file, in source order: `export { default as X } from './Y.svelte'`. */
function componentsOf(entry) {
  const src = readFileSync(resolve(ROOT, entry.file), 'utf8');
  const dir = dirname(entry.file).replace(/^src\/lib\/?/, '');
  return [...src.matchAll(/export\s*\{\s*default as (\w+)\s*\}\s*from\s*'([^']+\.svelte)'/g)].map((m) => ({ name: m[1], file: resolve('/', dir, m[2]).slice(1) }));
}

export async function buildModel() {
  const json = await runTypeDoc();
  const byId = indexById(json);
  const modules = new Map();
  for (const mod of json.children) {
    const key = /contract/.test(mod.name) ? 'contract' : /(^|\/)ui$|ui\/index$/.test(mod.name) ? 'ui' : /extend$/.test(mod.name) ? 'extend' : 'root';
    modules.set(key, mod);
  }

  const idToItem = new Map(); // reflection id -> item id (+ member anchors)
  const byName = new Map(); // export name -> item id (root wins)
  const pending = []; // [entry, refl, extra]
  const order = ['root', 'ui', 'extend'];

  const comps = {};
  for (const e of ENTRIES) comps[e.id] = componentsOf(e);
  const compNames = new Set(Object.values(comps).flat().map((c) => c.name));

  // first pass: register ids so links resolve in any order
  const register = (entry, refl, contract) => {
    const target = refl.kind === K.Reference ? byId.get(refl.target) ?? refl : refl;
    const itemId = `${entry}/${refl.name}`;
    if (!byName.has(refl.name)) byName.set(refl.name, itemId);
    if (!idToItem.has(target.id)) idToItem.set(target.id, itemId);
    idToItem.set(refl.id, idToItem.get(target.id));
    if (target.kind === K.Class) {
      for (const m of target.children ?? []) if (!idToItem.has(m.id)) idToItem.set(m.id, `${itemId}#${m.flags?.isStatic ? 's-' : 'm-'}${m.name}`);
    }
    if (target.kind === K.Interface) {
      for (const m of target.children ?? []) if (!idToItem.has(m.id)) idToItem.set(m.id, `${itemId}#p-${m.name}`);
    }
    pending.push({ entry, refl: target, name: refl.name, contract });
  };
  for (const entry of order) {
    for (const refl of modules.get(entry)?.children ?? []) {
      if (compNames.has(refl.name) && (refl.kind === K.Variable || refl.kind === K.TypeAlias || refl.kind === K.Reference && !byId.get(refl.target))) continue;
      register(entry, refl, false);
    }
  }
  for (const refl of modules.get('contract')?.children ?? []) {
    if (CONTRACT_EXTRA.includes(refl.name)) register('extend', refl, true);
  }

  const cx = {
    byName,
    link(target) {
      const to = idToItem.get(target);
      return to ?? null;
    },
  };
  // component names are linkable too
  for (const e of ENTRIES) for (const c of comps[e.id]) if (!byName.has(c.name)) byName.set(c.name, `${e.id}/${c.name}`);

  const items = {};
  const gaps = { exports: [], members: [], params: [] };
  for (const { entry, refl, name, contract } of pending) {
    const named = { ...refl, name };
    let item;
    switch (refl.kind) {
      case K.Function: item = convertFunction(entry, named, cx); break;
      case K.Class: item = convertClass(entry, named, cx, contract || CONTRACT_CLASSES.includes(name)); break;
      case K.Interface: case K.TypeAlias: item = convertTypeLike(entry, named, cx); break;
      case K.Variable: item = convertVariable(entry, named, cx); break;
      default: continue;
    }
    if (contract) item.reachedThrough = name === 'CommandRegistry' ? 'nabu.commands' : 'nabu.selection';
    if (item.id !== `${entry}/${refl.name}`) { /* alias of a re-export keeps its own page id */ }
    items[item.id] = item;
  }
  for (const e of ENTRIES) {
    for (const c of comps[e.id]) {
      const item = parseComponent(e.id, c.name, c.file, cx);
      items[item.id] = item;
    }
  }

  // the unstable door
  const internals = items['extend/NabuInternals'] ?? items['root/NabuInternals'];
  if (!internals) throw new Error('NabuInternals typedef not found: the `nabu.internals` page cannot be generated.');
  const nabuMember = items['root/Nabu'].members.find((m) => m.name === 'internals');
  if (nabuMember) nabuMember.unstable = true;
  internals.stability = 'unstable';

  // `Nabu` has no JSDoc of its own: the `NabuInternals` typedef written right above it sticks to the class
  const stuck = items['root/Nabu'];
  if (stuck && /^The engine machinery behind/.test(stuck.summary)) {
    if (!internals.summary) { internals.summary = stuck.summary; internals.description = stuck.description; }
    stuck.summary = CLASS_SUMMARY.Nabu;
    stuck.description = '';
    stuck.handwrittenSummary = true;
  }

  // JSDoc gaps
  for (const item of Object.values(items)) {
    if (!item.summary) gaps.exports.push(item.id);
    else if (item.handwrittenSummary) gaps.exports.push(`${item.id} (summary handwritten in scripts/api-config.js)`);
    for (const s of item.signatures ?? []) for (const p of s.params) if (!p.description && !p.name.includes('.')) gaps.params.push(`${item.id}(${p.name})`);
    for (const p of item.props ?? []) if (!p.description || p.fallback) gaps.params.push(`${item.id}<${p.name}>`);
    for (const m of item.members ?? []) {
      if (m.inheritedFrom) continue;
      if (!m.summary && !(m.signatures?.[0]?.summary)) gaps.members.push(`${item.id}#${m.name}`);
    }
  }

  stripDeadAnchors(items);

  const groupsOf = (entryId) => {
    const kinds = [['function', 'Functions'], ['class', 'Classes'], ['component', 'Components'], ['constant', 'Constants'], ['type', 'Types']];
    const list = Object.values(items).filter((i) => i.entry === entryId);
    return kinds.map(([kind, title]) => ({ kind, title, items: list.filter((i) => i.kind === kind).map((i) => i.name).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })) })).filter((g) => g.items.length);
  };

  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  return {
    package: pkg.name,
    version: pkg.version,
    entries: ENTRIES.map((e) => ({ id: e.id, specifier: e.specifier, title: e.title, summary: e.summary, groups: groupsOf(e.id) })),
    items,
    internals: { id: internals.id, keys: (internals.properties ?? []).map((p) => p.name).filter((n) => !n.includes('.')) },
    gaps,
  };
}

/** Anchors that exist on the page of an item (see src/site/api/ItemView.svelte, Member.svelte, ParamTable.svelte). */
export function validAnchors(item) {
  const ids = new Set();
  for (const m of item.members ?? []) if (!m.inheritedFrom) ids.add(m.id);
  for (const p of item.properties ?? []) ids.add(`p-${p.name}`);
  for (const p of item.props ?? []) ids.add(`p-${p.name}`);
  return ids;
}

/**
 * A link to a member the page does not draw (an inherited member, a private one, a row without id) would be a dead
 * `#anchor`: keep the link to the page, drop the anchor.
 */
function stripDeadAnchors(items) {
  const ok = (target) => {
    const [id, anchor] = target.split('#');
    if (!anchor) return target;
    const item = items[id];
    return item && validAnchors(item).has(anchor) ? target : id;
  };
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'to' && typeof value === 'string') node[key] = ok(value);
      else if (typeof value === 'string' && value.includes('](api:')) node[key] = value.replace(/\]\(api:([^)]+)\)/g, (_, t) => `](api:${ok(t)})`);
      else walk(value);
    }
  })(items);
}

export function writeModel(model) {
  mkdirSync(dirname(MODEL_PATH), { recursive: true });
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 1) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = Date.now();
  // `--if-missing`: dev / check only need a model to exist; builds always regenerate it.
  if (process.argv.includes('--if-missing') && existsSync(MODEL_PATH)) process.exit(0);
  const model = await buildModel();
  writeModel(model);
  const n = Object.keys(model.items).length;
  const members = Object.values(model.items).reduce((a, i) => a + (i.members?.length ?? 0), 0);
  console.log(`api-model: ${n} items, ${members} class members, ${model.internals.keys.length} internals keys -> ${MODEL_PATH} (${Date.now() - started} ms)`);
  console.log(`api-model: JSDoc gaps: ${model.gaps.exports.length} exports, ${model.gaps.members.length} members, ${model.gaps.params.length} params/props`);
}
