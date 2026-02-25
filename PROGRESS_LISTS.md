# Listes Imbriquées : Roadmap & Cas aux limites

## 1. Split (Touche Entrée)
- [x] **Split basique :** `Entrée` au milieu d'un texte crée un nouvel item juste en dessous au même niveau d'indentation.
- [ ] **Split avec enfants :** Si l'item courant possède une sous-liste (des enfants), faire `Entrée` doit transférer cette sous-liste au *nouvel* item créé. *(Ex: faire Entrée avant le mot "Parent" qui a une sous-liste doit faire descendre le mot "Parent" ET sa sous-liste).*
- [ ] **Sortie de liste (Exit) :** `Entrée` sur un item vide.
    - [ ] Cas simple : À la fin d'une liste -> supprime l'item vide et crée un paragraphe juste après la liste.
    - [ ] Cas complexe : Au milieu d'une liste -> scinde la liste en deux (Liste Haut, Paragraphe, Liste Bas).

## 2. Indentation (Touche Tab)
- [ ] **Tabulation (Indent) :**
    - Intercepter la touche `Tab` sur un ListItem.
    - Trouver l'item frère précédent (celui juste au-dessus).
    - S'il n'a pas de sous-liste, en créer une (nouveau MegaBlock `List`).
    - Déplacer l'item courant (`LoroTree.move`) dans cette sous-liste.
- [ ] **Désindentation (Shift+Tab) :**
    - Intercepter `Shift+Tab`.
    - L'item courant quitte sa sous-liste parent.
    - Il remonte d'un niveau pour s'insérer *après* le parent actuel.
    - Gérer le cas où la sous-liste devient vide (la détruire).

## 3. Fusion (Backspace/Delete)
- [ ] **Dé-transformation au Backspace :** Appuyer sur `Backspace` à l'offset 0 d'un ListItem le transforme en `Paragraph`.
    - [ ] Si l'item est au milieu d'une liste, scinder la liste parente en deux.
- [ ] **Merge basique :** `Backspace` au début d'un item (si c'est déjà un paragraphe ou si on est à l'offset 0 d'un paragraphe) fusionne son texte avec l'item précédent.
- [ ] **Merge avec enfants :** Si on fusionne l'Item B dans l'Item A :
    - Si B a une sous-liste, elle doit fusionner avec la sous-liste de A (ou la créer si A n'en a pas).

## 4. UX & Raccourcis
- [ ] **Markdown :** Transformer un Paragraphe en Liste (`- ` ou `* `).
