import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The first release heading of CHANGELOG.md, as the /changelog page shows it ("Unreleased" between releases, "0.1.6 (2026-11-15)"
 * right after one). Read from the file so that the site tests do not break at every release.
 */
export function latestChangelogHeading(): string {
  const raw = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8');
  const m = /^## (.+)$/m.exec(raw);
  if (!m) throw new Error('CHANGELOG.md has no "## " heading');
  return m[1].trim();
}
