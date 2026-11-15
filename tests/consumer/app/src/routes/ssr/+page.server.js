import { createMinimalEditor } from '@aionbuilders/nabu';

// Builds a document with the engine on the server (loro-crdt's Node build).
export async function load() {
  const engine = createMinimalEditor();
  await engine.importJSON({ version: '1', blocks: [{ type: 'paragraph', content: [{ text: 'Rendered on the server.' }] }] });
  await engine.commit();
  return { text: engine.serialize('text'), snapshot: engine.doc.export({ mode: 'snapshot' }) };
}
