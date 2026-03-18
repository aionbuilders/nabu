/**
* @typedef {{
*   anchorNode: Node | null,
*   anchorOffset: number,
*   focusNode: Node | null,
*   focusOffset: number,
*   startNode: Node | null,
*   startOffset: number,
*   endNode: Node | null,
*   endOffset: number,
*   isCollapsed: boolean,
*   rangeCount: number,
*   type: string,
*   direction: "forward" | "backward" | "none",
*   text: string,
*   html: string
* }} SelectionObject 
*/


/**
* Utilitaire réactif pour gérer la sélection de texte avec Svelte 5 runes
* @example
* const selection = new SvelteSelection();
* // Utiliser selection.text, selection.isCollapsed, etc. dans vos composants
*/
export class SvelteSelection {
    constructor() {
        // Utilisation d'un effect root pour éviter les fuites mémoire
        this.#cleanup = $effect.root(() => {
            $effect(() => {
                // Vérification de la disponibilité de l'API
                if (typeof window === 'undefined' || !window.getSelection) {
                    return;
                }
                
                document.addEventListener('selectionchange', this.#updateSelection);
                this.#updateSelection();
                
                return () => {
                    document.removeEventListener('selectionchange', this.#updateSelection);
                    this.#cleanup?.();
                };
            });
        });
    }
    
    /** @type {Function?} */
    #cleanup = null;
    
    /** @type {Selection?} */
    raw = null;
    
    /** 
    * État interne de la sélection
    * @type {SelectionObject?}
    */
    #sel = $state(null);
    is = $derived(!!this.#sel);
    
    /** @type {Range[]} */
    #ranges = $state([]);
    
    // Propriétés réactives de base
    anchorNode = $derived(this.#sel?.anchorNode ?? null);
    anchorOffset = $derived(this.#sel?.anchorOffset ?? 0);
    focusNode = $derived(this.#sel?.focusNode ?? null);
    focusOffset = $derived(this.#sel?.focusOffset ?? 0);
    isCollapsed = $derived(this.#sel?.isCollapsed ?? true);
    rangeCount = $derived(this.#sel?.rangeCount ?? 0);
    type = $derived(this.#sel?.type ?? '');
    direction = $derived(this.#sel?.direction ?? 'none');

    startNode = $derived(this.#sel?.startNode ?? null);
    endNode = $derived(this.#sel?.endNode ?? null);
    startOffset = $derived(this.#sel?.startOffset ?? 0);
    endOffset = $derived(this.#sel?.endOffset ?? 0);

    // Propriétés des ranges
    ranges = $derived(this.#ranges);
    firstRange = $derived(this.#ranges[0] ?? null);
    get range() {
        // Retourne la première range si elle existe, sinon null
        return this.firstRange;
    }
    lastRange = $derived(this.#ranges[this.#ranges.length - 1] ?? null);
    
    // Propriétés dérivées utiles
    text = $derived(this.#sel?.text ?? '');
    html = $derived(this.#sel?.html ?? '');
    hasSelection = $derived(!this.isCollapsed && this.rangeCount > 0);
    isEmpty = $derived(this.text.length === 0);
    hasMultipleRanges = $derived(this.#ranges.length > 1);
    
    // Informations sur les éléments contenants
    commonAncestor = $derived.by(() => {
        if (!this.hasSelection || this.rangeCount === 0) return null;
        try {
            const range = this.firstRange;
            return range?.commonAncestorContainer ?? null;
        } catch {
            return null;
        }
    });
    
    // Informations dérivées des ranges
    allText = $derived.by(() => {
        return this.#ranges.map(range => range.toString()).join('');
    });
    
    allHtml = $derived.by(() => {
        return this.#ranges.map(range => {
            try {
                const fragment = range.cloneContents();
                const div = document.createElement('div');
                div.appendChild(fragment);
                return div.innerHTML;
            } catch {
                return '';
            }
        }).join('');
    });
    
    // Bounding rectangles de toutes les ranges
    boundingRects = $derived.by(() => {
        return this.#ranges.map(range => {
            try {
                return range.getBoundingClientRect();
            } catch {
                return null;
            }
        }).filter(rect => rect !== null);
    });
    
    // Méthode privée pour mettre à jour la sélection
    #updateSelection = () => {
        try {
            this.raw = window.getSelection();
            
            if (!this.raw) {
                this.#sel = null;
                this.#ranges = [];
                return;
            }
            
            // Mise à jour des ranges
            const newRanges = [];
            for (let i = 0; i < this.raw.rangeCount; i++) {
                try {
                    const range = this.raw.getRangeAt(i);
                    newRanges.push(range);
                } catch (error) {
                    console.warn(`Erreur lors de la récupération de la range ${i}:`, error);
                }
            }
            this.#ranges = newRanges;
            
            
            let text = '';
            let html = '';
            
            if (this.raw.rangeCount > 0 && !this.raw.isCollapsed) {
                try {
                    const range = this.raw.getRangeAt(0);
                    text = range.toString();
                    
                    const fragment = range.cloneContents();
                    const div = document.createElement('div');
                    div.appendChild(fragment);
                    html = div.innerHTML;
                } catch (error) {
                    console.warn('Erreur lors de l\'extraction du contenu de la sélection:', error);
                }
            }

            const range = this.raw.rangeCount > 0 ? this.raw.getRangeAt(0) : null;

            this.#sel = {
                //SEL
                anchorNode: this.raw.anchorNode,
                anchorOffset: this.raw.anchorOffset,
                focusNode: this.raw.focusNode,
                focusOffset: this.raw.focusOffset,
                //RANGE:
                startNode: range?.startContainer || null,
                startOffset: range?.startOffset || 0,
                endNode: range?.endContainer || null,
                endOffset: range?.endOffset || 0,
                //MISC
                isCollapsed: this.raw.isCollapsed,
                rangeCount: this.raw.rangeCount,
                type: this.raw.type,
                direction: this.raw.direction || 'none',
                text,
                html
            };
        } catch (error) {
            console.error('Erreur lors de la mise à jour de la sélection:', error);
            this.#sel = null;
            this.#ranges = [];
        }
    };
    
    // Méthode pour rafraîchir la sélection manuellement
    refresh = () => this.#updateSelection();
    
    // Méthodes de manipulation de la sélection avec gestion d'erreurs
    
    /** 
    * Ajoute une range à la sélection.
    * @param {Range} range - La range à ajouter.
    * @returns {boolean} True si l'opération a réussi
    */
    addRange = (range) => {
        try {
            this.raw?.addRange(range);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de l\'ajout de la range:', error);
            return false;
        }
    };
    
    /** 
    * Supprime toutes les ranges de la sélection.
    * @returns {boolean} True si l'opération a réussi
    */
    removeAllRanges = () => {
        try {
            this.raw?.removeAllRanges();
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la suppression des ranges:', error);
            return false;
        }
    };
    
    /** 
    * Supprime une range spécifique de la sélection.
    * @param {Range} range - La range à supprimer.
    * @returns {boolean} True si l'opération a réussi
    */
    removeRange = (range) => {
        try {
            this.raw?.removeRange(range);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la suppression de la range:', error);
            return false;
        }
    };
    
    /**
    * Récupère la range à l'index spécifié.
    * @param {number} index - L'index de la range à récupérer.
    * @returns {Range|null} La range à l'index spécifié, ou null si elle n'existe pas.
    */
    getRangeAt = (index) => {
        try {
            return this.raw?.getRangeAt(index) ?? null;
        } catch (error) {
            console.warn('Erreur lors de la récupération de la range:', error);
            return null;
        }
    };
    
    /**
    * Réduit la sélection à un nœud et offset spécifiques.
    * @param {Node} node - Le nœud vers lequel réduire la sélection.
    * @param {number} offset - L'offset dans le nœud.
    * @returns {boolean} True si l'opération a réussi
    */
    collapse = (node, offset = 0) => {
        try {
            this.raw?.collapse(node, offset);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la réduction de la sélection:', error);
            return false;
        }
    };
    
    /**
    * Réduit la sélection au début de la range courante.
    * @returns {boolean} True si l'opération a réussi
    */
    collapseToStart = () => {
        try {
            this.raw?.collapseToStart();
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la réduction au début:', error);
            return false;
        }
    };
    
    /**
    * Réduit la sélection à la fin de la range courante.
    * @returns {boolean} True si l'opération a réussi
    */
    collapseToEnd = () => {
        try {
            this.raw?.collapseToEnd();
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la réduction à la fin:', error);
            return false;
        }
    };
    
    /**
    * Sélectionne le contenu d'un nœud.
    * @param {Node} node - Le nœud dont le contenu doit être sélectionné.
    * @returns {boolean} True si l'opération a réussi
    */
    selectAllChildren = (node) => {
        try {
            this.raw?.selectAllChildren(node);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la sélection des enfants:', error);
            return false;
        }
    };
    
    /**
    * Étend la sélection vers un nœud et offset spécifiques.
    * @param {Node} node - Le nœud vers lequel étendre.
    * @param {number} offset - L'offset dans le nœud.
    * @returns {boolean} True si l'opération a réussi
    */
    extend = (node, offset = 0) => {
        try {
            this.raw?.extend(node, offset);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de l\'extension de la sélection:', error);
            return false;
        }
    };
    
    /**
    * Définit la base et l'extension de la sélection.
    * @param {Node} anchorNode - Le nœud d'ancrage.
    * @param {number} anchorOffset - L'offset d'ancrage.
    * @param {Node} focusNode - Le nœud de focus.
    * @param {number} focusOffset - L'offset de focus.
    * @returns {boolean} True si l'opération a réussi
    
    */
    setBaseAndExtent = (anchorNode, anchorOffset, focusNode, focusOffset) => {
        try {
            this.raw?.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la définition de la base et extension:', error);
            return false;
        }
    };
    
    /**
    * Vérifie si la sélection contient un nœud donné.
    * @param {Node} node - Le nœud à vérifier.
    * @param {boolean} allowPartialContainment - Permet la contenance partielle.
    * @returns {boolean} True si le nœud est contenu dans la sélection.
    */
    containsNode = (node, allowPartialContainment = false) => {
        try {
            return this.raw?.containsNode(node, allowPartialContainment) ?? false;
        } catch (error) {
            console.warn('Erreur lors de la vérification de contenance:', error);
            return false;
        }
    };
    
    /**
    * Crée une nouvelle range basée sur la sélection courante.
    * @returns {Range|null} Une nouvelle range ou null.
    */
    createRange = () => {
        try {
            if (!this.hasSelection) return null;
            return this.firstRange?.cloneRange() ?? null;
        } catch (error) {
            console.warn('Erreur lors de la création de la range:', error);
            return null;
        }
    };
    
    /**
    * Crée des copies de toutes les ranges courantes.
    * @returns {Range[]} Un array de toutes les ranges clonées.
    */
    createAllRanges = () => {
        try {
            return this.#ranges.map(range => range.cloneRange());
        } catch (error) {
            console.warn('Erreur lors de la création des ranges:', error);
            return [];
        }
    };
    
    /**
    * Récupère les coordonnées de toutes les ranges.
    * @returns {DOMRect[]} Un array des rectangles de toutes les ranges.
    */
    getAllBoundingRects = () => {
        return this.boundingRects;
    };
    
    /**
    * Vérifie si toutes les ranges sont dans un élément donné.
    * @param {Element} element - L'élément à vérifier.
    * @returns {boolean} True si toutes les ranges sont contenues.
    */
    allRangesInElement = (element) => {
        return this.#ranges.every(range => {
            try {
                return element.contains(range.commonAncestorContainer);
            } catch {
                return false;
            }
        });
    };
    
    /**
    * Filtre les ranges selon un prédicat.
    * @param {function(Range): boolean} predicate - Fonction de filtre.
    * @returns {Range[]} Les ranges qui passent le filtre.
    */
    filterRanges = (predicate) => {
        return this.#ranges.filter(predicate);
    };
    
    /**
    * Sélectionne tout le contenu du document.
    * @returns {boolean} True si l'opération a réussi
    */
    selectAll = () => {
        try {
            this.raw?.selectAllChildren(document.body);
            this.#updateSelection();
            return true;
        } catch (error) {
            console.warn('Erreur lors de la sélection de tout:', error);
            return false;
        }
    };
    
    /**
    * Efface la sélection courante.
    * @returns {boolean} True si l'opération a réussi
    */
    clear = () => {
        return this.removeAllRanges();
    };
    
    /**
    * Ajout à la classe SvelteSelection pour observer les mutations DOM
    * qui peuvent affecter la position du caret sans déclencher selectionchange
    */
    
    // Propriétés à ajouter à la classe
    /** @type {MutationObserver?} */
    #mutationObserver = null;
    
    /** @type {Set<Element>} */
    #observedElements = new Set();
    
    /** @type {number?} */
    #debounceTimer = null;
    
    /**
    * Observe un élément contenteditable pour les mutations DOM qui peuvent
    * affecter la position du caret sans déclencher selectionchange
    * 
    * @param {Element} element - L'élément contenteditable à observer
    * @param {Object} options - Options d'observation
    * @param {number} options.debounceMs - Délai de debounce en ms (défaut: 16ms = ~1 frame)
    * @param {boolean} options.observeAttributes - Observer les changements d'attributs (défaut: false)
    * @returns {boolean} True si l'observation a été configurée avec succès
    */
    observe = (element, options = {}) => {
        const {
            debounceMs = 16,
            observeAttributes = false
        } = options;
        
        try {
            // Vérifier que l'élément est contenteditable
            if (!element.isContentEditable && element.contentEditable !== 'true') {
                console.warn('L\'élément observé n\'est pas contenteditable');
            }
            
            // Créer l'observer si il n'existe pas encore
            if (!this.#mutationObserver) {
                this.#mutationObserver = new MutationObserver((mutations) => {
                    // Filtrer les mutations pertinentes
                    const relevantMutations = mutations.filter(mutation => {
                        // Ignorer les mutations sur les attributs non-pertinents
                        if (mutation.type === 'attributes') {
                            const attr = mutation.attributeName;
                            // Ne considérer que les attributs qui peuvent affecter le layout/contenu
                            return ['class', 'style', 'contenteditable'].includes(attr);
                        }
                        
                        // Toujours considérer les changements de contenu
                        return mutation.type === 'childList' || mutation.type === 'characterData';
                    });
                    
                    if (relevantMutations.length === 0) return;
                    
                    this.#updateSelection();
                });
            }
            
            // Ajouter l'élément à la liste des observés
            this.#observedElements.add(element);
            
            // Configurer l'observation
            this.#mutationObserver.observe(element, {
                childList: true,        // Ajout/suppression d'enfants
                subtree: true,          // Observer tous les descendants
                characterData: true,    // Changements de texte dans les nœuds text
                attributes: observeAttributes, // Changements d'attributs (optionnel)
                attributeFilter: observeAttributes ? ['class', 'style', 'contenteditable'] : undefined
            });
            
            return true;
        } catch (error) {
            console.warn('Erreur lors de la configuration de l\'observation:', error);
            return false;
        }
    };
    
    /**
    * Arrête l'observation d'un élément spécifique
    * @param {Element} element - L'élément à ne plus observer
    * @returns {boolean} True si l'élément était observé et a été retiré
    */
    unobserve = (element) => {
        const wasObserved = this.#observedElements.delete(element);
        
        // Si plus aucun élément n'est observé, déconnecter l'observer
        if (this.#observedElements.size === 0 && this.#mutationObserver) {
            this.#mutationObserver.disconnect();
            this.#mutationObserver = null;
            clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }
        
        return wasObserved;
    };
    
    /**
    * Arrête l'observation de tous les éléments
    */
    unobserveAll = () => {
        if (this.#mutationObserver) {
            this.#mutationObserver.disconnect();
            this.#mutationObserver = null;
        }
        
        this.#observedElements.clear();
        clearTimeout(this.#debounceTimer);
        this.#debounceTimer = null;
    };
    
    /**
    * Getter pour savoir quels éléments sont observés
    * @returns {Element[]} Liste des éléments actuellement observés
    */
    get observedElements() {
        return Array.from(this.#observedElements);
    }
    
    /**
    * Vérifie si un élément est actuellement observé
    * @param {Element} element - L'élément à vérifier
    * @returns {boolean} True si l'élément est observé
    */
    isObserving = (element) => {
        return this.#observedElements.has(element);
    };
    
    /**
    * Nettoie les ressources utilisées par l'instance.
    * À appeler lors de la destruction du composant.
    */
    destroy = () => {
        this.unobserveAll();
        this.#cleanup?.();
        this.raw = null;
        this.#sel = null;
        this.#ranges = [];
    };
}