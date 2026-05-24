import { createContext, mount, unmount } from "svelte";
import { browser } from "$app/environment";
import ContextComponent from "./Context.svelte";

/** @type {[() => Context, (ctx: Context) => Context]} */
export const [getMenuContext, setMenuContext] = createContext();

/** @import {Nabu} from "../../index.js" */

/**
 * @typedef {Object} ContextMenuItem
 * @property {string} label
 * @property {string} [icon]
 * @property {() => void} action
 * @property {boolean} [disabled]
 */

/**
 * @typedef {Object} ContextMenuSection
 * @property {string} key
 * @property {import('svelte').Component} [component]
 * @property {Record<string, any>} [props]
 * @property {ContextMenuItem[]} [items]
 */

/**
 * @typedef {Object} ContextView
 * @property {string} id
 * @property {string} [title]
 * @property {ContextMenuSection[]} sections
 */

export const CONTEXT_COLLECT_EVENT = 'nabu-context-collect';

export class ContextMenu {
    /** @param {Nabu} nabu */
    constructor(nabu) {
        this.nabu = nabu;

        if (nabu.systems.has('context')) {
            const c = nabu.systems.get('context');
            if (c instanceof ContextMenu) return c;
            else throw new Error('Context system already exists but is not an instance of ContextMenu');
        } else {
            nabu.systems.set('context', this);
        }

        this.component = $state(ContextComponent);
        this.instance = null;

        this.handleClick = this.handleClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
    }

    close() {
        if (this.instance) {
            unmount(this.instance);
            this.instance = null;
        }
    }

    /** @param {MouseEvent} event */
    handleClick(event) {
        if (!this.instance) return;
        
        const target = /** @type {Element} */ (event.target);
        if (target?.closest('.nabu-context-menu')) return;
        
        // Fix: Si l'élément cliqué n'est plus dans le DOM au moment où l'événement 
        // atteint 'window' (ex: le bouton retour a été démonté par Svelte), 
        // on ignore le clic pour ne pas fermer le menu par erreur.
        if (target && !document.documentElement.contains(target)) return;

        this.close();
    }

    /** @param {MouseEvent} event */
    handleContextMenu(event) {
        this.close();

        if (!this.component || !event.target) return;

        // Fire collecting event — bubbles up through the DOM path.
        // Each element along the way can push to detail.sections.
        /** @type {{ sections: ContextMenuSection[] }} */
        const detail = { sections: [] };
        event.target.dispatchEvent(
            new CustomEvent(CONTEXT_COLLECT_EVENT, { bubbles: true, detail })
        );

        // Only suppress the native menu if something was collected.
        if (!detail.sections.length) return;
        event.preventDefault();

        const { clientX: x, clientY: y } = event;
        this.instance = mount(this.component, {
            target: document.body,
            props: { x, y, context: new Context(this.nabu, this, detail) },
        });
    }

    start() {
        if (browser && typeof window !== 'undefined') {
            window.addEventListener('click', this.handleClick);
            window.addEventListener('contextmenu', this.handleContextMenu);
        }
    }

    stop() {
        if (browser && typeof window !== 'undefined') {
            window.removeEventListener('click', this.handleClick);
            window.removeEventListener('contextmenu', this.handleContextMenu);
        }
        this.close();
    }
}


export class Context {
    /** 
     * @param {Nabu} nabu
     * @param {ContextMenu} menu
     * @param {{sections?: ContextMenuSection[]}} [init]
     */
    constructor(nabu, menu, init = {}) {
        this.nabu = nabu;
        this.menu = menu;
        
        /** @type {ContextView[]} */
        this.history = $state([{
            id: 'root',
            sections: init.sections || []
        }]);

        /** @type {number} */
        this.direction = $state(1);
    }

    get currentView() {
        return this.history[this.history.length - 1];
    }

    /** @param {ContextView} view */
    push(view) {
        this.direction = 1;
        this.history.push(view);
    }

    pop() {
        if (this.history.length > 1) {
            this.direction = -1;
            this.history.pop();
        }
    }

    close() {
        this.menu.close();
    }
}