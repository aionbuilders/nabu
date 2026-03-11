# ADR 008 : Logique Multi-Blocs Partagée — Pattern Spine (container.utils.js)

## Statut
Accepté — *Mars 2026*

## Contexte

Lorsqu'une sélection traverse plusieurs blocs (ex: sélectionner du texte de la fin d'un paragraphe jusqu'au milieu d'un item de liste imbriqué), l'événement `beforeinput` doit être géré par le **Lowest Common Ancestor (LCA)** de la sélection dans l'arbre des blocs.

Deux classes jouent ce rôle de container :
- **`MegaBlock`** : LCA pour les sélections intra-container (ex: deux items d'une même liste)
- **`Nabu`** : LCA de dernier recours pour les sélections qui traversent des blocs racines

Le problème initial : `Nabu.beforeinput` et `MegaBlock.beforeinput` implémentaient deux logiques distinctes. La version de `Nabu` était une version naïve et ancienne (scan linéaire, API `mergeWith` dépréciée), tandis que `MegaBlock` avait développé une logique correcte basée sur les "spines".

## Décision

Extraction de la logique `beforeinput` multi-blocs dans **`src/blocks/container.utils.js`**, exportée comme `handleContainerBeforeInput(container, nabu, event)`.

Les deux classes délèguent :
```javascript
// MegaBlock
beforeinput(event) {
    return handleContainerBeforeInput(this, this.nabu, event);
}

// Nabu
beforeinput(e) {
    return handleContainerBeforeInput(this, this, e);
}
```

## Mécanisme — Approche Spine

Pour chaque extrémité de la sélection (`startBlock`, `endBlock`), on remonte la chaîne de parents jusqu'au container en construisant une **spine** (épine dorsale) :

```
startBlock
  └── parent (listItem)     → supprime les next-siblings de startBlock
        └── parent (list)   → supprime les next-siblings de listItem
              └── container  ← arrêt
```

La **spine start** prune les blocs après chaque nœud (ce qui est "après le début" = sélectionné = à supprimer).
La **spine end** prune les blocs avant chaque nœud (ce qui est "avant la fin" = sélectionné = à supprimer).

Une fois les spines construites, on identifie les **enfants directs du container** dans chaque spine, puis on supprime les blocs intermédiaires entre ces deux enfants.

## Problème d'unification — Terminaison des spines

La différence clé entre `MegaBlock` et `Nabu` est la façon dont la spine se termine :

- **MegaBlock** : le container est pushé dans la spine (boucle `while at(-1) !== this`), donc l'enfant direct = `spine.at(-2)`
- **Nabu** : les blocs racines ont `parent = null`, la boucle break avant que Nabu soit pushé, donc l'enfant direct = `spine.at(-1)`

**Solution unifiée :**
```javascript
const directChild = (spine) => spine.at(-1) === container ? spine.at(-2) : spine.at(-1);
```

## Conséquences

- **Cohérence :** `Nabu` et `MegaBlock` utilisent exactement la même logique, plus aucun risque de divergence
- **Maintenabilité :** Un seul endroit à modifier pour les opérations multi-blocs
- **Correctness :** La logique spine gère correctement les structures imbriquées arbitraires, contrairement à l'ancien scan linéaire de `Nabu`
- **Extensibilité :** Tout futur container (ex: tableau, colonnes) peut utiliser `handleContainerBeforeInput` en passant `{ children, commit }` + sa référence nabu

## Pourquoi pas `Nabu extends MegaBlock`

L'héritage a été envisagé mais rejeté pour trois raisons :
1. **Dépendance circulaire** : `Block → Nabu`, `MegaBlock → Block`, `Nabu → MegaBlock → Block → Nabu`
2. **Incompatibilité constructeur** : `MegaBlock(nabu, node)` — Nabu n'a pas de `LoroTreeNode`
3. **Héritage de baggage inutile** : `selected`, `element`, `behaviors`, `parent`, `index` n'ont aucun sens sur Nabu
