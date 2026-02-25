<script>
    import { ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension, Nabu, NabuEditor } from "../blocks";

    let engine = new Nabu({
        extensions: [ParagraphExtension, HeadingExtension, ListExtension, ListItemExtension]
    });

    if (typeof window !== 'undefined') {
        window.nabu = engine;
    }
</script>

<div class="app-shell">
    <header class="toolbar">
        <div class="brand">
            <h1>Nabu</h1>
            <span class="badge">alpha</span>
            <p>start: {JSON.stringify(engine.selection.startBlock?.selection)} / end: {JSON.stringify(engine.selection.endBlock?.selection)}</p>
        </div>
        <div class="actions">
            <button onclick={() => engine.insert("heading", { level: 1, text: "Nouveau Titre" })}>+ Heading H1</button>
            <button onclick={() => engine.insert("paragraph", { text: "" })}>+ Paragraph</button>
            <button onclick={() => {
                // 1. Liste Racine
                const mainList = engine.insert("list", { listType: "bullet" });
                
                // 2. Items simples
                engine.insert("list-item", { text: "Item racine 1" }, mainList.node.id.toString(), 0);
                const item2 = engine.insert("list-item", { text: "Item racine 2 (Parent)" }, mainList.node.id.toString(), 1);
                
                // 3. Sous-liste (enfant de l'Item 2)
                const subList = engine.insert("list", { listType: "ordered" }, item2.node.id.toString());
                
                // 4. Sous-items
                engine.insert("list-item", { text: "Sous-item A" }, subList.node.id.toString(), 0);
                engine.insert("list-item", { text: "Sous-item B" }, subList.node.id.toString(), 1);
            }}>+ Nested List Test</button>
            <button onclick={() => console.log(engine)}>Log Engine</button>
        </div>
    </header>

    <main class="editor-viewport">
        <div class="paper-sheet">
            <NabuEditor {engine} />
        </div>
    </main>
</div>

<style>
    :global(body) {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: #f3f4f6;
        color: #1f2937;
        height: 100vh;
        overflow: hidden;
    }

    .app-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-width: 100%;
    }

    .toolbar {
        background: white;
        border-bottom: 1px solid #e5e7eb;
        padding: 0.75rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
        z-index: 10;
    }

    .brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    h1 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        letter-spacing: -0.025em;
        color: #111827;
    }

    .badge {
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        background-color: #e0f2fe;
        color: #0369a1;
        padding: 0.125rem 0.375rem;
        border-radius: 9999px;
        letter-spacing: 0.05em;
    }

    .editor-viewport {
        flex: 1;
        overflow-y: auto;
        padding: 2rem;
        display: flex;
        justify-content: center;
    }

    .paper-sheet {
        background: white;
        width: 100%;
        max-width: 800px; /* Largeur type A4/Lettre */
        min-height: 100%; /* Prend toute la hauteur dispo */
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        border-radius: 0.5rem;
        /* Padding géré par NabuEditor */
    }

    button {
        background: white;
        border: 1px solid #d1d5db;
        color: #374151;
        font-size: 0.875rem;
        font-weight: 500;
        padding: 0.375rem 0.75rem;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.15s ease-in-out;
    }

    button:hover {
        background-color: #f9fafb;
        border-color: #9ca3af;
        color: #111827;
    }

    button:active {
        background-color: #f3f4f6;
        transform: translateY(1px);
    }
</style>
