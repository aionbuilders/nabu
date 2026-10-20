# Design Document : Fichiers / Images / Médias — cycle de vie de la donnée

> **Statut** : Décidé — Juin 2026. v1 = système fichier + bloc Image.
> **Mise à jour 2026-10-20 — ADR 014** ([`docs/adr/014-asset-storage.md`](../adr/014-asset-storage.md)) : le « mode par défaut » décrit en §1 (octets DANS le
> document Loro) est **remplacé** : les octets vivent dans un stockage de fichiers séparé (mémoire, ou IndexedDB pour l'éditeur persisté), le document ne
> porte que des références par empreinte (`nabu-asset:sha256-<hex>`) et un index de métadonnées (`assetIndex`). Les documents de la beta sont migrés à
> l'ouverture. Le contrat `onBeforePersist` / `resolve` ci-dessous reste valable (le fichier passe d'abord par le stockage local). Ce document reste la référence
> du cycle de vie côté hôte (§3 et suivants) ; lots 2 et 3 de l'ADR (envoi en arrière-plan, reprise, modes d'historique) à venir.
> **Le vrai sujet** n'est PAS l'affichage (un void block, comme Divider) — c'est le **cycle de vie de la donnée** et la **DX développeur** (provisioning, upload, download, qui possède quoi).

---

## 1. ~~Le principe central : durable in Loro par défaut, override par hook~~ (remplacé par l'ADR 014)

Décision (contre-intuitive mais assumée) : **par défaut, les octets vivent DANS Loro** — pas dans l'arbre de blocs, mais dans un container `assets` séparé (`doc.getMap('assets')`), indexé par id. Le bloc ne stocke qu'une **ref** (`nabu-asset:<id>` ou une URL externe).

**Pourquoi ce défaut :**
- **Zéro-config** : images qui marchent out-of-the-box, sans backend.
- **Source de vérité jamais cassée** : le doc est auto-suffisant, médias compris (export/import = tout vient). Dogme Loro-first au bout.
- **Local-first pur** : offline / P2P, médias inclus, sans serveur.

**Vérifié** : Loro stocke un `Uint8Array` comme valeur de map, le snapshot round-trip préserve les octets. (test du 2026-06-14)

**Le piège assumé** : les octets bruts dans le CRDT bloatent (chaque snapshot/sync les porte). La vidéo y est morte. Donc :
- Le container `assets` est **séparé de l'arbre de blocs** → l'édition reste légère (que des refs).
- Mode défaut = **petit / local / proto**. Au-delà d'un **seuil (~1-2 Mo)** → **warn** (console + état du bloc), sans bloquer.
- La **prod** branche le hook d'override (les octets ne touchent jamais Loro).

---

## 2. Le contrat développeur (minimal, couvre tout)

Nabu possède : l'édition + l'état du bloc + la machine à états + le store assets par défaut.
Le dev possède : **uniquement le transport** (s'il veut sortir les octets de Loro).

```js
createEditor({
  files: {
    // OPTIONNEL. Intercepte AVANT la persistence par défaut. Le dev uploade où il
    // veut (presign/PUT/POST) et renvoie une ref propre → court-circuite le blob-in-Loro.
    // ABSENT → défaut : Nabu stocke les octets dans le container assets Loro.
    onBeforePersist: async (file, { signal, onProgress }) => ({ ref: 'https://cdn/clean.jpg' }),

    // OPTIONNEL. Ref stockée → URL affichable. Défaut : refs `nabu-asset:` résolues
    // nativement (octets Loro → objectURL) ; URL externe → identité. À override pour
    // du storage privé (URL signée fraîche à chaque rendu).
    resolve: (ref) => ref,

    // OPTIONNEL — taille max en mode défaut avant warn (def ~1-2 Mo) + events opt-in.
    maxInlineSize, onUploadProgress, onUploadError, onUploadCancel,
  }
})
```

Couvre **tout** : URL publique (pas d'upload, resolve=identité), CDN (upload→url, resolve=identité), storage privé (upload→clé, resolve la signe), local-first (défaut blob-in-Loro).

---

## 3. La machine à états (upload local via hook)

- **t0** — fichier ajouté → bloc créé, status `pending`, **aperçu optimiste** depuis un objectURL local. Autres collaborateurs : placeholder.
- **t1** — Nabu passe le `File` à `onBeforePersist` (s'il existe) → presign/PUT → ref propre.
- **t2** — succès → Loro `{ref}`, status `ready`, objectURL local révoqué.
- **erreur** → status `error`, retry/remove.
- **annulation** (bloc retiré) → `AbortController` coupe, objectURL révoqué.
- **Pas de hook** → store direct dans Loro (quasi-instant), status `ready`.

---

## 4. Les scénarios d'entrée

| Entrée | Traitement |
|---|---|
| URL externe (insert / paste / slash→URL) | ref = URL, affichage direct |
| File picker (slash `/image`) | flux upload (hook ou défaut Loro) |
| Paste presse-papier (screenshot) | flux upload *(post-v1)* |
| Drag & drop bureau | flux upload *(post-v1)* |
| Paste `<img>` HTML | ref = src de l'img (URL externe) |

---

## 5. Blocs : infra mutualisée, rendus fins

Image / File / Video **partagent toute l'infra ci-dessus** ; ne diffèrent que par le **rendu** (`<img>` / chip téléchargeable / `<video>`). Chaque bloc = un **void block** (comme Divider : `positions=1`, `getDOMPoint=null`, `beforeinput=false` — curseur trivial) + métadonnée `{ref, alt, status}` + rendu spécialisé + overlay d'état.

**v1** : le système fichier + le bloc **Image**. File/Video = coquilles fines ajoutées ensuite (le dur est mutualisé).

---

## 6. Limites v1 connues

- Sérialisation markdown d'une ref `nabu-asset:` = `![alt](nabu-asset:id)` (pas portable hors du doc — les blobs ne tiennent pas dans du markdown). Acceptable ; export "vrai" = via le hook/URL.
- Cancel-on-remove + progress : contrat présent (`signal`/`onProgress`), câblage bloc basique en v1.
- Paste/drop d'images : post-v1 (slash file-pick + insert programmatique d'abord).
- Copier-coller entre documents (P-51) : les octets d'un asset `nabu-asset:` voyagent dans le fragment `application/x-nabu+json` et sont recréés dans le document cible (hook `onBeforePersist` inclus), voir `clipboard-format.md`. Un coller sans octets donne un bloc `status: 'missing'`.
