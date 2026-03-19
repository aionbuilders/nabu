// Vitest setup — runs before every unit test file
import { vi } from 'vitest';

// Svelte 5 runes are compiled away; in happy-dom we just need a real DOM.
// Nothing special needed here beyond resetting mocks between tests.
beforeEach(() => {
  vi.clearAllMocks();
});
