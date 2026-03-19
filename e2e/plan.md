# Nabu Editor — Test Plan (Pré-bêta publique)

> **Révision** : 2026-03-19
> **Architecture** : Svelte 5 + Loro-CRDT, Single ContentEditable, Extension system
> **Stacks cibles** : Vitest (unit) · Playwright (E2E)
> **Légende priorité** : P0 = bloquant bêta · P1 = important · P2 = nice-to-have
> **FLAKY_RISK** = test susceptible d'être timing-dépendant (tick Svelte, commit Loro async, IDB)

---

## Section 1 — Tests Unitaires (Vitest)

> Tests sur logique pure, sans browser ni DOM réel. Chaque module est importable isolément.
> Principe : mocker uniquement les dépendances externes (Loro, DOM), pas la logique interne.

---

### 1.1 `TextBehavior` — `calculateOffset(node, offset)`

Conversion offset DOM → offset modèle texte. Fonction critique : toute saisie en dépend.

| # | Cas | Priorité |
|---|-----|----------|
| U-TB-01 | Nœud texte simple, offset 0 → retourne 0 | P0 |
| U-TB-02 | Nœud texte simple, offset = longueur → retourne longueur | P0 |
| U-TB-03 | Nœud texte simple, offset milieu → retourne valeur exacte | P0 |
| U-TB-04 | Deux nœuds texte (bold + plain), cursor dans le second → retourne offset cumulé | P0 |
| U-TB-05 | Trois nœuds texte avec marks différentes, cursor dans le troisième | P0 |
| U-TB-06 | Nœud texte vide (longueur 0), offset 0 → retourne 0 | P1 |
| U-TB-07 | Nœuds imbriqués (`<strong><em>text</em></strong>`), cursor dans feuille interne | P1 |
| U-TB-08 | Nœud texte avec emoji multi-codepoint → offset UTF-16 vs caractères Loro | P0 |
| U-TB-09 | Nœud inconnu (non texte, non span) → ignoré ou levée d'erreur définie | P1 |
| U-TB-10 | TreeWalker : parcours complet avec plusieurs éléments inline sur même niveau | P1 |

---

### 1.2 `TextBehavior` — `getDOMPoint(targetOffset)`

Conversion offset modèle → {node, offset} DOM. Inverse de `calculateOffset`.

| # | Cas | Priorité |
|---|-----|----------|
| U-TB-11 | Offset 0 dans bloc vide → premier nœud texte, offset 0 | P0 |
| U-TB-12 | Offset exact = longueur d'un nœud → retourne ce nœud, offset final | P0 |
| U-TB-13 | Offset dans deuxième span (après un bold) → nœud texte correct | P0 |
| U-TB-14 | Offset dépasse la longueur totale → retourne dernier nœud, offset max | P1 |
| U-TB-15 | Delta avec nœuds vides intercalés → ne compte pas les vides | P1 |
| U-TB-16 | Aller-retour : `getDOMPoint(calculateOffset(n, o))` = `{n, o}` pour tout point valide | P0 |

---

### 1.3 `TextBehavior` — Marks

| # | Cas | Priorité |
|---|-----|----------|
| U-TB-17 | `applyMark('bold', true, sel)` sur plage → delta contient `{bold: true}` | P0 |
| U-TB-18 | `removeMark('bold', sel)` sur plage partiellement bold → seule la plage perd le mark | P0 |
| U-TB-19 | `toggleMark` sur plage entièrement bold → retire le mark | P0 |
| U-TB-20 | `toggleMark` sur plage partiellement bold → applique le mark à tout | P0 |
| U-TB-21 | `isMarkActive('bold', sel)` : plage entièrement bold → true | P0 |
| U-TB-22 | `isMarkActive('bold', sel)` : plage partiellement bold → false | P0 |
| U-TB-23 | `isMarkActive('bold', sel)` : aucun bold → false | P0 |
| U-TB-24 | Marks combinés (bold + italic) : `isMarkActive` pour chacun indépendamment | P1 |
| U-TB-25 | `applyMark` avec sélection collapsée (longueur 0) → no-op | P1 |

---

### 1.4 `deltaToMarkdown(delta)`

| # | Cas | Priorité |
|---|-----|----------|
| U-MD-01 | Delta vide `[]` → chaîne vide | P0 |
| U-MD-02 | Delta texte plain `[{insert: "hello"}]` → `"hello"` | P0 |
| U-MD-03 | Bold simple → `**hello**` | P0 |
| U-MD-04 | Italic simple → `*hello*` | P0 |
| U-MD-05 | Underline simple → `__hello__` ou convention choisie | P1 |
| U-MD-06 | Code inline → `` `hello` `` | P0 |
| U-MD-07 | Strikethrough → `~~hello~~` | P1 |
| U-MD-08 | Bold + Italic combinés → `***hello***` | P0 |
| U-MD-09 | Marques adjacentes sans chevauchement → concaténation correcte | P0 |
| U-MD-10 | Marques qui s'ouvrent et se ferment au même endroit → pas de tokens vides | P1 |
| U-MD-11 | Texte avec newline interne `\n` → rendu correct | P1 |
| U-MD-12 | Texte avec backtick littéral dans code → échappement correct | P2 |
| U-MD-13 | Delta avec attribut inconnu → ignoré silencieusement | P1 |

---

### 1.5 `serialize()` — par format

| # | Cas | Priorité |
|---|-----|----------|
| U-SER-01 | Paragraph vide → markdown `""` | P0 |
| U-SER-02 | Paragraph plain text → texte brut | P0 |
| U-SER-03 | Paragraph avec bold → `**text**` dans markdown | P0 |
| U-SER-04 | Heading level 1 → `# titre` | P0 |
| U-SER-05 | Heading level 2-6 → `##`-`######` | P1 |
| U-SER-06 | ListItem bullet → `- item` | P0 |
| U-SER-07 | ListItem ordered → `1. item` | P1 |
| U-SER-08 | ListItem avec sous-liste → indentation correcte | P0 |
| U-SER-09 | Dialogue → format spécifique em-dash | P1 |
| U-SER-10 | serialize('json') → objet avec type, props, delta | P0 |
| U-SER-11 | serialize('json') pour ListItem avec children | P0 |
| U-SER-12 | serialize('application/x-nabu+json') → PasteBlock complet | P0 |
| U-SER-13 | Serializer inconnu → retourne `undefined` ou erreur définie | P1 |

---

### 1.6 `Block.consume(otherBlock, direction)`

Fusion de deux blocs. Logique la plus complexe après la spine.

| # | Cas | Priorité |
|---|-----|----------|
| U-CON-01 | `absorbs(other)` : même type de base → true | P0 |
| U-CON-02 | `absorbs(other)` : types incompatibles → false | P0 |
| U-CON-03 | `consume(next, 'forward')` : texte de `next` ajouté à la fin du survivant | P0 |
| U-CON-04 | `consume(prev, 'backward')` : texte de `prev` ajouté en début | P0 |
| U-CON-05 | Victim sans enfants : supprimé du Loro tree après fusion | P0 |
| U-CON-06 | Victim avec enfants (sous-liste) : enfants adoptés si survivant est MegaBlock | P0 |
| U-CON-07 | Victim avec enfants, survivant = Paragraph : enfants promus comme frères | P0 |
| U-CON-08 | Fusion de deux blocs vides → bloc vide, pas d'erreur | P1 |
| U-CON-09 | Retour de l'offset du point de fusion → correct pour restaurer curseur | P0 |
| U-CON-10 | Fusion d'un ListItem avec un Paragraph (types différents mais `absorbs` true) | P1 |

---

### 1.7 `Block.split(options)`

| # | Cas | Priorité |
|---|-----|----------|
| U-SPL-01 | Split en milieu → deux blocs, texte correctement réparti | P0 |
| U-SPL-02 | Split en début (offset 0) → nouveau bloc vide avant | P0 |
| U-SPL-03 | Split en fin → nouveau bloc vide après | P0 |
| U-SPL-04 | Split avec marks actifs → marks propagées/non propagées selon logique choisie | P0 |
| U-SPL-05 | Split d'un bloc vide → deux blocs vides | P1 |
| U-SPL-06 | Split délégué à l'extension (hook `onSplit`) → hook appelé avec bons arguments | P0 |

---

### 1.8 `NabuSelection.calculateOffset(node, offset)` / `getSelection()`

| # | Cas | Priorité |
|---|-----|----------|
| U-SEL-01 | getSelection() sur bloc avec cursor au début → `{start: 0, end: 0}` | P0 |
| U-SEL-02 | getSelection() avec sélection de 5 chars → `{start: x, end: x+5}` | P0 |
| U-SEL-03 | getSelection() sélection inversée (focus < anchor) → start/end normalisés | P0 |
| U-SEL-04 | getSelection() quand cursor est hors du bloc → retourne null/undefined | P1 |
| U-SEL-05 | setCursor(block, 0) → collapse au début | P0 |
| U-SEL-06 | setCursor(block, n) → cursor à l'offset exact | P0 |
| U-SEL-07 | setCursor hors bornes → placé à la borne la plus proche | P1 |

---

### 1.9 `wrapOrphan(nabu, block)`

| # | Cas | Priorité |
|---|-----|----------|
| U-WRP-01 | ListItem sans parent List → List créée, ListItem adopté | P0 |
| U-WRP-02 | ListItem déjà dans une List → no-op | P0 |
| U-WRP-03 | Block sans `requiredParent` → no-op | P0 |
| U-WRP-04 | Props du wrapper héritées de `requiredParent.props()` (listType) | P0 |
| U-WRP-05 | Plusieurs ListItems orphelins consécutifs → un seul wrapper List créé | P1 |
| U-WRP-06 | ListItem imbriqué orphelin (dans un ListItem mais sans List) → wrappage récursif | P1 |

---

### 1.10 Paste — Parsing inline Markdown

| # | Cas | Priorité |
|---|-----|----------|
| U-PRS-01 | `"hello **world**"` → delta avec bold sur "world" | P0 |
| U-PRS-02 | `"**hello** world"` → bold uniquement sur "hello" | P0 |
| U-PRS-03 | `"***bold italic***"` → bold + italic combinés | P0 |
| U-PRS-04 | `"a **b *c* d** e"` → nesting bold/italic | P1 |
| U-PRS-05 | Backtick non fermé → traité comme texte littéral | P1 |
| U-PRS-06 | `"~~strike~~"` → strikethrough mark | P1 |
| U-PRS-07 | Texte sans aucun mark → delta avec un seul insert | P0 |
| U-PRS-08 | Chaîne vide → delta vide | P1 |

---

### 1.11 Paste — Parsing HTML inline

| # | Cas | Priorité |
|---|-----|----------|
| U-HTML-01 | `<strong>text</strong>` → bold mark | P0 |
| U-HTML-02 | `<em>text</em>` → italic mark | P0 |
| U-HTML-03 | `<u>text</u>` → underline mark | P0 |
| U-HTML-04 | `<code>text</code>` → code mark | P0 |
| U-HTML-05 | `<strong><em>text</em></strong>` → bold + italic | P0 |
| U-HTML-06 | `font-weight: bold` en style inline → bold mark | P1 |
| U-HTML-07 | Élément block (`<ul>`) à l'intérieur d'un inline → ignoré | P1 |
| U-HTML-08 | Texte nœud direct sans wrapper → plain text insert | P0 |

---

### 1.12 `Block.ascend(eventName, event, data)` — chaîne de responsabilité

Mécanisme central (ADR 007) par lequel tous les `onSplit`, `onBeforeInput`, et hooks d'extension transitent. Une régression ici casse silencieusement des dizaines de comportements.

| # | Cas | Priorité |
|---|-----|----------|
| U-ASC-01 | `ascend('onSplit')` depuis un Paragraph root-level → hook `nabu.onSplit` appelé | P0 |
| U-ASC-02 | `ascend('onSplit')` depuis un ListItem → remonté jusqu'au List, `List.onSplit` appelé | P0 |
| U-ASC-03 | `ascend()` remonte bloc par bloc jusqu'au premier ancêtre ayant le handler | P0 |
| U-ASC-04 | Aucun ancêtre n'a le handler → no-op, pas d'erreur | P0 |
| U-ASC-05 | Handler retourne `false` → propagation stoppée, handler suivant non appelé | P0 |
| U-ASC-06 | Données `{ offset, delta }` transmises intactes jusqu'au handler | P0 |
| U-ASC-07 | Bloc imbriqué en profondeur 3 → remonte correctement les 3 niveaux | P1 |
| U-ASC-08 | `ascend('onBeforeInput')` : hook extension peut `preventDefault` → event annulé | P0 |
| U-ASC-09 | Plusieurs handlers sur le même eventName à différents niveaux → seul le plus proche est appelé | P1 |

---

### 1.13 `findLCA(blockA, blockB)` et `findDirectChildOf(block, container)`

Cœur du calcul de la spine. Une régression ici casse **toutes** les opérations multi-blocs spanning.

| # | Cas | Priorité |
|---|-----|----------|
| U-LCA-01 | Deux frères directs dans root → LCA = null (root-level, pas de container commun) | P0 |
| U-LCA-02 | Deux frères dans la même List → LCA = cette List | P0 |
| U-LCA-03 | ListItem niveau 1 et ListItem niveau 2 dans la même List → LCA = List | P0 |
| U-LCA-04 | Même nœud des deux côtés → LCA = parent direct ou null | P0 |
| U-LCA-05 | Nœuds dans deux Lists distinctes au même niveau root → LCA = null | P0 |
| U-LCA-06 | Profondeurs très différentes (n=1 vs n=4) → ancêtre commun correct | P1 |
| U-LCA-07 | `findDirectChildOf(block, container)` : enfant direct → retourne `block` lui-même | P0 |
| U-LCA-08 | `findDirectChildOf(grandchild, container)` → retourne l'enfant direct intermédiaire | P0 |
| U-LCA-09 | `findDirectChildOf(block, container)` : `block` n'est pas dans `container` → retourne null | P0 |
| U-LCA-10 | `findDirectChildOf(block, container)` : `block` = `container` → retourne null | P1 |

---

### 1.14 Factories — `createPersistedEditor` / `createFullEditor`

La logique de la factory (chargement snapshot, isNew, auto-save) mérite des tests unitaires isolés, distincts des tests E2E IDB.

| # | Cas | Priorité |
|---|-----|----------|
| U-FAC-01 | `createPersistedEditor({ docId })` sans snapshot IDB existant → `nabu.isNew === true` | P0 |
| U-FAC-02 | `createPersistedEditor` avec snapshot IDB existant → `isNew === false`, doc chargé | P0 |
| U-FAC-03 | Extension passée en option → bien enregistrée dans `nabu.registry` | P0 |
| U-FAC-04 | Preset appliqué → blocs initiaux présents dans le doc | P1 |
| U-FAC-05 | Debounce configuré → `doc.subscribe` branché, sauvegarde déclenchée après délai | P1 |
| U-FAC-06 | `createFullEditor` (preset complet) → tous les types de blocs enregistrés | P1 |

---

## Section 2 — Tests E2E (Playwright)

> Chaque test se déroule dans un vrai browser headless avec le composant `<Nabu>` monté.
> Setup commun : `await page.goto('/editor')`, attendre `contenteditable` prêt.

---

### 2.1 Frappe de base

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-TYPE-01 | Taper des caractères ASCII dans un bloc vide → apparaissent dans le DOM et le modèle | P0 | |
| E-TYPE-02 | Taper des caractères Unicode (emojis, accents, CJK) → rendu correct | P0 | |
| E-TYPE-03 | Taper en milieu de texte existant → insertion à l'offset correct | P0 | |
| E-TYPE-04 | Taper en début de texte existant → insertion avant le premier caractère | P0 | |
| E-TYPE-05 | Taper en fin de texte existant → insertion après le dernier caractère | P0 | |
| E-TYPE-06 | Taper `--` puis espace → substitution par em-dash (—) | P0 | |
| E-TYPE-07 | `--` sans espace ensuite → pas de substitution | P1 | |
| E-TYPE-08 | Sélectionner un mot, taper un caractère → remplace la sélection | P0 | |
| E-TYPE-09 | Sélectionner tout le texte d'un bloc, taper → bloc contient uniquement le nouveau caractère | P0 | |
| E-TYPE-10 | Sélectionner un mot en milieu de phrase, taper plusieurs caractères → remplacement correct | P0 | |
| E-TYPE-11 | `Backspace` sur bloc non vide → supprime le caractère avant le curseur | P0 | |
| E-TYPE-12 | `Delete` sur bloc non vide → supprime le caractère après le curseur | P0 | |
| E-TYPE-13 | `Backspace` avec une sélection active → supprime le contenu sélectionné | P0 | |
| E-TYPE-14 | `Delete` avec une sélection active → supprime le contenu sélectionné | P0 | |
| E-TYPE-15 | Taper dans un bloc avec des marks actifs → nouveau texte hérite des marks en vigueur | P1 | |
| E-TYPE-16 | Shift+Enter → insère un `\n` (line break doux) dans le même bloc | P1 | |
| E-TYPE-17 | Composition IME (ex. caractères japonais via composition event) → texte inséré correct | P1 | FLAKY_RISK |
| E-TYPE-18 | Taper très rapidement (type burst) → modèle cohérent avec le DOM | P1 | FLAKY_RISK |

---

### 2.2 Navigation structurelle — Enter (split) et Backspace en début (merge)

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-NAV-01 | Enter en milieu d'un Paragraph → split en deux paragraphes, curseur au début du second | P0 | |
| E-NAV-02 | Enter en fin d'un Paragraph → nouveau paragraphe vide après, curseur dedans | P0 | |
| E-NAV-03 | Enter en début d'un Paragraph → nouveau paragraphe vide avant, curseur dans l'original | P0 | |
| E-NAV-04 | Enter dans un Heading → crée un Paragraph (pas un Heading) après | P0 | |
| E-NAV-05 | Enter dans un bloc vide → comportement défini (nouveau para ou sortie de type) | P0 | |
| E-NAV-06 | Backspace en début d'un Paragraph (second bloc) → fusionne avec le bloc précédent | P0 | |
| E-NAV-07 | Backspace en début du premier bloc du document → no-op | P0 | |
| E-NAV-08 | Backspace en début d'un Heading → merge avec le paragraphe précédent (devient paragraphe) | P1 | |
| E-NAV-09 | Delete en fin d'un Paragraph (avant le bloc suivant) → fusionne avec le bloc suivant | P0 | |
| E-NAV-10 | Delete en fin du dernier bloc → no-op | P0 | |
| E-NAV-11 | Après un split, curseur est bien positionné au début du nouveau bloc | P0 | |
| E-NAV-12 | Après un merge (Backspace), curseur est au point de jonction des deux textes | P0 | |
| E-NAV-13 | Merge de deux blocs : les marks du premier bloc préservées, celles du second aussi | P0 | |
| E-NAV-14 | Split dans un bloc avec marks → le mark ne "déborde" pas sur le nouveau bloc (selon logique choisie) | P1 | |
| E-NAV-15 | Backspace en début de Dialogue → fusionne en Paragraph | P1 | |

---

### 2.3 Listes imbriquées — Tab / Shift+Tab / sortie / merge

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-LIST-01 | Enter dans un ListItem non vide → crée un nouvel ListItem au même niveau | P0 | |
| E-LIST-02 | Enter dans un ListItem vide (dernier de la liste) → sort de la liste, crée un Paragraph | P0 | |
| E-LIST-03 | Enter dans un ListItem vide qui n'est pas le dernier → crée un paragraphe et continue la liste | P1 | |
| E-LIST-04 | Tab sur un ListItem (pas le premier) → indent : devient enfant du ListItem précédent | P0 | |
| E-LIST-05 | Tab sur le premier ListItem d'une liste → no-op (pas de précédent à rejoindre) | P0 | |
| E-LIST-06 | Shift+Tab sur un ListItem imbriqué → unindent : remonte au niveau parent | P0 | |
| E-LIST-07 | Shift+Tab sur un ListItem de niveau 0 → no-op | P0 | |
| E-LIST-08 | Tab crée une sous-liste du même type (bullet/ordered) que le parent | P1 | |
| E-LIST-09 | Shift+Tab sur un ListItem avec des enfants → les enfants remontent aussi | P0 | |
| E-LIST-10 | Enter sur ListItem vide imbriqué (profondeur 2) → sort d'un niveau (devient niveau 1) | P0 | |
| E-LIST-11 | Enter sur ListItem vide de niveau 1 → sort complètement, crée Paragraph | P0 | |
| E-LIST-12 | Backspace en début du premier ListItem → merge avec le bloc précédent la liste | P0 | |
| E-LIST-13 | Backspace en début d'un ListItem (non premier) → merge avec le ListItem précédent | P0 | |
| E-LIST-14 | Merge ListItem avec sous-liste → sous-liste adoptée correctement | P0 | |
| E-LIST-15 | Delete en fin du dernier ListItem → merge avec le bloc suivant la liste | P1 | |
| E-LIST-16 | Liste bullet convertie en ordered et vice versa (via exec/transform) | P1 | |
| E-LIST-17 | Trois niveaux d'imbrication : Tab × 2 depuis niveau 0 | P1 | |
| E-LIST-18 | Sélection multi-blocs spanning deux ListItems → Delete → orphans wrappés | P0 | FLAKY_RISK |
| E-LIST-19 | wrapOrphan automatique après une opération de paste dans une liste | P0 | FLAKY_RISK |
| E-LIST-20 | Après Shift+Tab, bloc relâché correctement même si orphan temporaire | P0 | |

---

### 2.4 Rich text marks — Ctrl+B / I / U / E

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-MARK-01 | Sélectionner un mot, Ctrl+B → mot en gras | P0 | |
| E-MARK-02 | Sélectionner un mot déjà en gras, Ctrl+B → gras retiré (toggle) | P0 | |
| E-MARK-03 | Sélectionner un mot, Ctrl+I → italique | P0 | |
| E-MARK-04 | Sélectionner un mot, Ctrl+U → souligné | P0 | |
| E-MARK-05 | Sélectionner un mot, Ctrl+E → code inline | P0 | |
| E-MARK-06 | Sélectionner une plage partiellement bold → Ctrl+B applique bold à toute la plage | P0 | |
| E-MARK-07 | Ctrl+B sur sélection vide (collapsed) → état activé pour la prochaine frappe | P1 | |
| E-MARK-08 | Bold + Italic combinés sur même plage → `***text***` en markdown | P0 | |
| E-MARK-09 | Sélection multi-blocs (deux paragraphes), Ctrl+B → bold appliqué à tous les blocs concernés | P0 | |
| E-MARK-10 | Sélection multi-blocs partiellement bold → toggle applique partout | P1 | |
| E-MARK-11 | Marks préservées après undo/redo | P0 | FLAKY_RISK |
| E-MARK-12 | Marks préservées après split (Enter) | P0 | |
| E-MARK-13 | Marks préservées après merge (Backspace) | P0 | |
| E-MARK-14 | Mark code empêche l'application d'autres marks (ex. bold dans code) | P2 | |
| E-MARK-15 | Taper dans un bloc avec bold actif → nouveau texte en bold | P0 | |
| E-MARK-16 | Sélection multi-blocs spanning ListItem → bold appliqué à tous | P1 | |

---

### 2.5 Undo / Redo

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-UNDO-01 | Ctrl+Z après insertion de texte → texte supprimé | P0 | FLAKY_RISK |
| E-UNDO-02 | Ctrl+Z après suppression (Backspace) → texte restauré | P0 | FLAKY_RISK |
| E-UNDO-03 | Ctrl+Z après Enter (split) → blocs fusionnés | P0 | FLAKY_RISK |
| E-UNDO-04 | Ctrl+Z après Backspace merge → blocs re-splittrés | P0 | FLAKY_RISK |
| E-UNDO-05 | Ctrl+Z après application de mark (Ctrl+B) → mark retirée | P0 | FLAKY_RISK |
| E-UNDO-06 | Ctrl+Z après Tab (indent) → ListItem retourne au niveau précédent | P0 | FLAKY_RISK |
| E-UNDO-07 | Ctrl+Z après paste → contenu collé retiré | P0 | FLAKY_RISK |
| E-UNDO-08 | Ctrl+Z après transformTo (Heading → Paragraph) → type restauré | P1 | FLAKY_RISK |
| E-UNDO-09 | Ctrl+Y / Ctrl+Shift+Z après undo → redo correct | P0 | FLAKY_RISK |
| E-UNDO-10 | Redo après undo enchaîné (3 undos puis 2 redos) | P0 | FLAKY_RISK |
| E-UNDO-11 | Curseur restauré à la position avant la mutation lors du undo | P0 | FLAKY_RISK |
| E-UNDO-12 | Curseur restauré à la position après la mutation lors du redo | P0 | FLAKY_RISK |
| E-UNDO-13 | Undo en début de pile → no-op, pas d'erreur | P0 | |
| E-UNDO-14 | Redo en fin de pile → no-op, pas d'erreur | P0 | |
| E-UNDO-15 | Nouvelles mutations après undo invalident la pile redo | P1 | |
| E-UNDO-16 | Undo d'une opération multi-blocs (Delete spanning) → tous les blocs restaurés | P0 | FLAKY_RISK |
| E-UNDO-17 | Undo enchaîné rapide (Ctrl+Z × 10 rapidement) → état cohérent | P1 | FLAKY_RISK |

---

### 2.6 Copy / Paste

#### 2.6.1 Copy

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-COPY-01 | Copier une sélection dans un bloc → clipboard contient `text/plain`, `text/html`, `application/x-nabu+json` | P0 | |
| E-COPY-02 | Copier une sélection multi-blocs → PasteFragment avec partial boundaries correctes | P0 | |
| E-COPY-03 | Copier un ListItem avec sa sous-liste → structure hiérarchique dans le clipboard | P0 | |
| E-COPY-04 | Copier tout le document (Ctrl+A puis Ctrl+C) → tous les blocs sérialisés | P1 | |
| E-COPY-05 | Copier sélection vide → clipboard inchangé ou vide proprement | P1 | |
| E-COPY-06 | Couper (Ctrl+X) → clipboard rempli + contenu supprimé du document | P0 | |
| E-COPY-07 | Couper multi-blocs → contenu retiré, blocs restants réorganisés correctement | P0 | |

#### 2.6.2 Paste — Format interne Nabu (`application/x-nabu+json`)

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-PASTE-01 | Coller un unique PasteBlock flat dans un bloc → merge inline au curseur | P0 | FLAKY_RISK |
| E-PASTE-02 | Coller deux PasteBlocks dans un Paragraph → split + insertion + merge | P0 | FLAKY_RISK |
| E-PASTE-03 | Coller un ListItem dans un Paragraph → wrapOrphan crée une List | P0 | FLAKY_RISK |
| E-PASTE-04 | Coller avec `partial: 'start'` → contenu partiel fusionné correctement | P0 | FLAKY_RISK |
| E-PASTE-05 | Coller avec `partial: 'end'` → fin fusionnée dans le bloc d'accueil | P0 | FLAKY_RISK |
| E-PASTE-06 | Coller avec `partial: 'both'` (fragment d'un unique bloc) → insertion inline | P0 | FLAKY_RISK |
| E-PASTE-07 | Coller dans un ListItem → ListItem reçoit le contenu, structure préservée | P0 | FLAKY_RISK |
| E-PASTE-08 | Coller une liste complète dans un Paragraph → liste insérée après le paragraphe | P0 | FLAKY_RISK |
| E-PASTE-09 | Coller des blocs avec marks → marks préservées | P0 | |

#### 2.6.3 Paste — HTML (depuis Notion, Google Docs, Word Online)

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-PASTE-10 | Coller un `<p>` simple → crée/merge un Paragraph | P0 | |
| E-PASTE-11 | Coller `<h1>` à `<h6>` → crée Heading avec niveau correct | P0 | |
| E-PASTE-12 | Coller `<ul><li>` → crée List bullet + ListItem | P0 | |
| E-PASTE-13 | Coller `<ol><li>` → crée List ordered + ListItem | P0 | |
| E-PASTE-14 | Coller `<ul>` imbriqué → structure imbriquée préservée | P1 | |
| E-PASTE-15 | Coller HTML depuis Notion (avec divs wrappers transparents) → structure nettoyée | P0 | |
| E-PASTE-16 | Coller HTML depuis Google Docs (avec spans de style) → marks préservées | P0 | |
| E-PASTE-17 | Coller `<strong>` → bold mark | P0 | |
| E-PASTE-18 | Coller `<em>` → italic mark | P0 | |
| E-PASTE-19 | Coller `<code>` → code inline mark | P0 | |
| E-PASTE-20 | Coller élément HTML inconnu → fallback plain text ou ignoré | P1 | |
| E-PASTE-21 | Coller tableau HTML → comportement défini (ignore ou fallback plain) | P2 | |

#### 2.6.4 Paste — Markdown (plain text)

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-PASTE-22 | Coller `**bold**` → Paragraph avec bold mark | P0 | |
| E-PASTE-23 | Coller `# Titre` → Heading level 1 | P0 | |
| E-PASTE-24 | Coller `## Titre` → Heading level 2 | P0 | |
| E-PASTE-25 | Coller `- item` → List bullet + ListItem | P0 | |
| E-PASTE-26 | Coller liste markdown multi-niveaux (indentation par 2/4 espaces) → structure imbriquée | P1 | |
| E-PASTE-27 | Coller `` `code` `` → code inline mark | P0 | |
| E-PASTE-28 | Coller `~~strike~~` → strikethrough | P1 | |
| E-PASTE-29 | Coller `***bold italic***` → bold + italic | P0 | |
| E-PASTE-30 | Coller deux paragraphes séparés par `\n\n` → deux blocs distincts | P0 | |

#### 2.6.5 Paste — Plain text (fallback)

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-PASTE-31 | Coller texte brut sans formatage → Paragraph plain | P0 | |
| E-PASTE-32 | Coller texte avec `\n\n` → plusieurs paragraphes | P0 | |
| E-PASTE-33 | Coller texte avec `\n` simple → comportement défini (même bloc ou line break) | P1 | |
| E-PASTE-34 | Coller texte brut dans un ListItem → texte ajouté au ListItem, pas de nouveau bloc | P0 | |

---

### 2.7 Sérialisation

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-SER-01 | `nabu.serialize('markdown')` document vide → chaîne vide | P0 | |
| E-SER-02 | `serialize('markdown')` un seul Paragraph → texte brut | P0 | |
| E-SER-03 | `serialize('markdown')` Paragraph avec bold → `**text**` | P0 | |
| E-SER-04 | `serialize('markdown')` Heading 1-6 → `#` × niveau + titre | P0 | |
| E-SER-05 | `serialize('markdown')` List bullet → `- item` par ListItem | P0 | |
| E-SER-06 | `serialize('markdown')` List ordered → `1. item` etc. | P0 | |
| E-SER-07 | `serialize('markdown')` liste imbriquée → indentation correcte | P0 | |
| E-SER-08 | `serialize('markdown')` après un Enter (split) → deux blocs dans l'output | P0 | |
| E-SER-09 | `serialize('markdown')` après un Backspace merge → un seul bloc dans l'output | P0 | |
| E-SER-10 | `serialize('markdown')` après paste → output reflète le contenu collé | P0 | |
| E-SER-11 | `serialize('markdown')` après undo → output = état avant la mutation | P0 | FLAKY_RISK |
| E-SER-12 | `serialize('json')` document avec tous les types de blocs → structure valide | P1 | |
| E-SER-13 | `serialize('json')` ListItem avec sous-liste → `children` imbriqués | P1 | |
| E-SER-14 | `serialize('json')` après transformTo → nouveau type dans l'output | P1 | |
| E-SER-15 | `serialize('markdown')` Dialogue → format em-dash correct | P1 | |
| E-SER-16 | Round-trip : markdown → paste → `serialize('markdown')` → identique à l'original | P1 | FLAKY_RISK |

---

### 2.8 Persistence (IndexedDB)

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-PERS-01 | Document sauvegardé automatiquement après mutation (attendre debounce) | P0 | FLAKY_RISK |
| E-PERS-02 | Reload de la page → document restauré à l'état sauvegardé | P0 | FLAKY_RISK |
| E-PERS-03 | Nouveau document (`isNew === true`) avant toute mutation | P0 | |
| E-PERS-04 | `isNew === false` après auto-save initial | P0 | FLAKY_RISK |
| E-PERS-05 | `nabu.saveNow()` force la sauvegarde immédiate sans attendre le debounce | P0 | FLAKY_RISK |
| E-PERS-06 | `nabu.clearPersistence()` → IDB entry supprimée, reload crée un document vide | P0 | FLAKY_RISK |
| E-PERS-07 | Restauration d'un document complexe (listes imbriquées, marks) | P0 | FLAKY_RISK |
| E-PERS-08 | Sauvegarde incrémentielle : plusieurs mutations entre deux sauvegardes → état final correct | P1 | FLAKY_RISK |
| E-PERS-09 | Plusieurs docIds distincts → isolation des snapshots IDB | P1 | |
| E-PERS-10 | Snapshot corrompu dans IDB → éditeur démarre vide proprement (pas de crash) | P1 | FLAKY_RISK |
| E-PERS-11 | IDB indisponible (private mode simulé) → éditeur fonctionne sans persistence | P2 | |

---

### 2.9 Transformations de type

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-TRF-01 | Taper `# ` en début de Paragraph vide → transformé en Heading 1 (markdown shortcut) | P0 | |
| E-TRF-02 | Taper `## ` → Heading 2 | P0 | |
| E-TRF-03 | Taper `### ` jusqu'à `###### ` → Heading 3-6 | P1 | |
| E-TRF-04 | Taper `- ` en début de Paragraph → transformé en List bullet + ListItem | P0 | |
| E-TRF-05 | Taper `1. ` → transformé en List ordered + ListItem | P1 | |
| E-TRF-06 | Taper `-- ` en début de Paragraph → transformé en Dialogue | P0 | |
| E-TRF-07 | Shortcut markdown dans un Heading existant → de-transformation en Paragraph d'abord | P1 | |
| E-TRF-08 | `nabu.exec('block:transform', { type: 'heading', level: 2 })` → bloc courant transformé | P0 | |
| E-TRF-09 | Transformation Heading → Paragraph via exec → contenu préservé | P0 | |
| E-TRF-10 | Transformation d'un bloc avec marks → marks préservées après transformTo | P0 | |
| E-TRF-11 | Transformation Paragraph → List via exec → wrapOrphan crée le wrapper List | P0 | |
| E-TRF-12 | Undo d'une transformation → type original restauré | P1 | FLAKY_RISK |
| E-TRF-13 | Shortcut `# ` en milieu de texte (pas en début) → pas de transformation | P0 | |
| E-TRF-14 | Backspace après transformation markdown (ex. `# ` puis Backspace) → annulation de la transformation | P1 | |

---

### 2.10 Edge cases critiques

#### 2.10.1 Document vide / Bloc unique

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-EDGE-01 | Document vide : Backspace → no-op | P0 | |
| E-EDGE-02 | Document vide : Delete → no-op | P0 | |
| E-EDGE-03 | Document vide : Enter → crée un second bloc vide | P0 | |
| E-EDGE-04 | Document vide : Ctrl+Z → no-op | P0 | |
| E-EDGE-05 | Document à un seul bloc vide : Backspace en début → no-op | P0 | |
| E-EDGE-06 | Document à un seul bloc non vide : Backspace en début → no-op | P0 | |
| E-EDGE-07 | Document à un seul bloc : Enter → split en deux | P0 | |
| E-EDGE-08 | Sélectionner tout (Ctrl+A) dans document vide → no-op | P1 | |
| E-EDGE-09 | Sélectionner tout puis Delete dans document à un seul bloc vide → no-op | P1 | |
| E-EDGE-10 | Sélectionner tout puis Delete dans document multi-blocs → tous les blocs vidés / réduits à un bloc vide | P0 | |

#### 2.10.2 Paste dans un ListItem

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-EDGE-11 | Coller du texte simple dans un ListItem → texte ajouté au ListItem | P0 | FLAKY_RISK |
| E-EDGE-12 | Coller un Paragraph dans un ListItem → ListItem reçoit le texte inline | P0 | FLAKY_RISK |
| E-EDGE-13 | Coller une List entière dans un ListItem → List insérée comme sub-list ou après | P0 | FLAKY_RISK |
| E-EDGE-14 | Coller un ListItem dans un Paragraph → wrapOrphan → List autour | P0 | FLAKY_RISK |
| E-EDGE-15 | Coller un Heading dans un ListItem → comportement défini (Heading après ou inline text) | P1 | FLAKY_RISK |
| E-EDGE-16 | Coller multi-blocs (Paragraph + List) au milieu d'un ListItem | P0 | FLAKY_RISK |

#### 2.10.3 Undo après paste

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-EDGE-17 | Undo après paste simple → contenu collé retiré, curseur restauré | P0 | FLAKY_RISK |
| E-EDGE-18 | Undo après paste multi-blocs → tous les blocs créés retirés | P0 | FLAKY_RISK |
| E-EDGE-19 | Undo après paste dans ListItem → ListItem revient à son état précédent | P0 | FLAKY_RISK |
| E-EDGE-20 | Undo après paste avec wrapOrphan → wrapper List supprimé aussi | P0 | FLAKY_RISK |
| E-EDGE-21 | Undo × 2 après paste puis frappe → chaque undo annule une étape distincte | P1 | FLAKY_RISK |

#### 2.10.4 Spine algorithm — sélections multi-blocs

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-EDGE-22 | Delete sélection spanning deux Paragraphs → un seul Paragraph résultant | P0 | |
| E-EDGE-23 | Delete sélection spanning Paragraph + Heading → un seul bloc résultant | P0 | |
| E-EDGE-24 | Delete sélection spanning Paragraph + List entière → List disparaît | P0 | |
| E-EDGE-25 | Delete sélection spanning ListItem parent + sous-liste → sous-liste supprimée | P0 | |
| E-EDGE-26 | Delete sélection partielle dans une liste imbriquée → orphans wrappés | P0 | FLAKY_RISK |
| E-EDGE-27 | Delete sélection du premier caractère du premier bloc au dernier du dernier → document vide | P0 | |
| E-EDGE-28 | Delete sélection crossing container boundaries (List ↔ root) | P0 | FLAKY_RISK |
| E-EDGE-29 | LCA = null (sélection dans root-level blocks) → container = nabu | P0 | |
| E-EDGE-30 | LCA = List (sélection dans deux ListItems de la même List) → delete géré par List | P0 | |

#### 2.10.5 Autres edge cases

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-EDGE-31 | Bloc avec texte de 10 000 caractères → toutes opérations fonctionnent | P1 | FLAKY_RISK |
| E-EDGE-32 | 100 blocs dans le document → performances acceptables | P1 | FLAKY_RISK |
| E-EDGE-33 | Emoji en début de bloc, Backspace → supprime l'emoji entier (pas demi-codepoint) | P0 | |
| E-EDGE-34 | Emoji en milieu de sélection → sélection ne coupe pas l'emoji | P1 | |
| E-EDGE-35 | Curseur entre deux marks différentes (ex. bold|italic) → taper produit le bon mark | P1 | |
| E-EDGE-36 | Clic pour placer le curseur après une opération programmatique → position correcte | P1 | |
| E-EDGE-37 | Sélection native modifiée par l'utilisateur pendant un tick Svelte → pas de désync | P1 | FLAKY_RISK |
| E-EDGE-38 | Deux mutations Loro dans le même tick → un seul commit (transaction) | P1 | FLAKY_RISK |

---

### 2.11 Bloc Dialogue

Sous-couvert dans la v1 du plan. Le Dialogue a sa propre logique de split/exit et sa sérialisation em-dash qui divergent du Paragraph.

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-DIAL-01 | Enter dans un Dialogue non vide → crée un nouveau bloc Dialogue après | P0 | |
| E-DIAL-02 | Enter dans un Dialogue vide → sort du Dialogue, crée un Paragraph | P0 | |
| E-DIAL-03 | Backspace en début d'un Dialogue → fusionne avec le bloc précédent (devient Paragraph) | P0 | |
| E-DIAL-04 | Delete en fin d'un Dialogue → fusionne avec le bloc suivant | P1 | |
| E-DIAL-05 | Ctrl+B dans un Dialogue → bold mark appliqué | P0 | |
| E-DIAL-06 | `serialize('markdown')` d'un Dialogue → préfixe em-dash correct | P0 | |
| E-DIAL-07 | Coller du texte dans un Dialogue → texte reçu correctement | P1 | FLAKY_RISK |
| E-DIAL-08 | Copier une sélection depuis un Dialogue → clipboard avec le format em-dash | P1 | |
| E-DIAL-09 | Undo après Enter dans un Dialogue → Dialogue unique restauré | P1 | FLAKY_RISK |

---

### 2.12 Action Bus — `nabu.exec(topic, data)`

API publique principale pour l'UI externe et les extensions. Si un handler régresse, aucun test ne le détecte actuellement.

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-EXEC-01 | `exec('mark:toggle', { mark: 'bold' })` avec sélection → toggle bold | P0 | |
| E-EXEC-02 | `exec('mark:apply', { mark: 'italic' })` → italic appliqué à la sélection courante | P0 | |
| E-EXEC-03 | `exec('mark:remove', { mark: 'bold' })` → bold retiré de la sélection | P0 | |
| E-EXEC-04 | `exec('mark:toggle', { mark: 'bold' })` sélection collapsée → état activé pour frappe suivante | P1 | |
| E-EXEC-05 | `exec('list:indent')` sur ListItem → indente (équivalent Tab) | P0 | |
| E-EXEC-06 | `exec('list:unindent')` sur ListItem imbriqué → désindente (équivalent Shift+Tab) | P0 | |
| E-EXEC-07 | `exec('list:indent')` sur premier ListItem → no-op | P0 | |
| E-EXEC-08 | `exec('undo')` → équivalent Ctrl+Z | P0 | FLAKY_RISK |
| E-EXEC-09 | `exec('redo')` → équivalent Ctrl+Y | P0 | FLAKY_RISK |
| E-EXEC-10 | `exec('block:transform', { type: 'heading', props: { level: 1 } })` → bloc transformé | P0 | |
| E-EXEC-11 | `exec('block:transform', { type: 'paragraph' })` depuis Heading → revient en Paragraph | P0 | |
| E-EXEC-12 | `exec()` avec topic inconnu → no-op, pas d'erreur ni exception | P0 | |
| E-EXEC-13 | `exec()` sans sélection active (blur) → comportement défini (no-op ou erreur propre) | P1 | |
| E-EXEC-14 | Extension enregistrant une action custom via `exec()` → handler appelé | P1 | |

---

### 2.13 Accessibilité et navigation clavier

Absente de la v1. Requis pour un éditeur open source.

| # | Description | Priorité | FLAKY_RISK |
|---|-------------|----------|------------|
| E-A11Y-01 | L'élément `contenteditable` a `role="textbox"` ou équivalent sémantique | P1 | |
| E-A11Y-02 | `aria-multiline="true"` présent sur le `contenteditable` | P1 | |
| E-A11Y-03 | `aria-label` ou `aria-labelledby` présent sur l'éditeur | P1 | |
| E-A11Y-04 | Tab depuis l'extérieur → focus entre dans l'éditeur (premier bloc) | P0 | |
| E-A11Y-05 | Shift+Tab depuis l'éditeur → focus sort proprement (pas de piège de focus) | P0 | |
| E-A11Y-06 | Flèche haut/bas → navigation inter-blocs (curseur se déplace) | P1 | |
| E-A11Y-07 | Flèche gauche/droite aux limites d'un bloc → traverse vers le bloc adjacent | P1 | |
| E-A11Y-08 | Focus visible (outline) sur l'éditeur lorsqu'il a le focus clavier | P1 | |
| E-A11Y-09 | Changement de type de bloc annoncé via `aria-live` ou équivalent (si implémenté) | P2 | |

---

## Récapitulatif par priorité

| Priorité | Unit | E2E | Total |
|----------|------|-----|-------|
| **P0** | 72 | 130 | **202** |
| **P1** | 34 | 70 | **104** |
| **P2** | 4 | 6 | **10** |
| **Total** | **110** | **206** | **316** |

Tests avec `FLAKY_RISK` : **57** → à isoler en suite dédiée avec retry et timeouts explicites.

**Ajouts v2** (suite au code-review) : +22 tests unitaires (ascend ×9, findLCA/findDirectChildOf ×10, factories ×6 — attention U-FAC a 6 cas dont 2 P1 = total 3P0+3P1), +32 tests E2E (Dialogue ×9, exec ×14, a11y ×9).

---

## Notes d'implémentation

### Setup Playwright recommandé

```
tests/
├── fixtures/
│   ├── editor.fixture.ts      # mount <Nabu>, attendre ready
│   ├── keyboard.ts            # helpers type(), press(), select()
│   └── clipboard.ts           # helpers pour injecter clipboard data
├── unit/                      # Vitest, pas de browser
└── e2e/                       # Playwright, browser headless
```

### Gestion des FLAKY_RISK

**En Vitest (unit)** :
- `await tick()` (API Svelte) pour laisser les effets réactifs se propager avant d'asserter
- `await vi.waitFor(() => expect(...))` pour les assertions sur état Loro asynchrone

**En Playwright (E2E)** :
- Ne **pas** utiliser `tick()` — c'est une API Svelte interne, inaccessible depuis Playwright
- Utiliser `await page.waitForFunction(() => condition_dans_le_browser)` pour attendre qu'un état soit stable
- Utiliser `await expect(locator).toHaveText(...)` avec le timeout Playwright par défaut
- Pour les mutations Loro : `await page.waitForSelector('[data-block-id]', { state: 'attached' })`
- Pour IDB : `await page.evaluate(() => /* lire IDB directement */)` après `saveNow()`
- Suite séparée `flaky/` avec `retries: 2` dans la config Playwright

### Ordre de développement suggéré

1. Tests unitaires P0 (Section 1) — fondations, rapides à écrire et à exécuter
2. E2E P0 frappe de base + navigation (2.1 + 2.2) — smoke tests essentiels
3. E2E P0 marks + undo (2.4 + 2.5)
4. E2E P0 copy/paste (2.6) — le plus long à écrire
5. E2E P0 listes (2.3) — le plus complexe structurellement
6. E2E P0 edge cases spine (2.10.4)
7. Tout le reste P1 puis P2
