import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIMITS_DESCRIPTION } from '../../../../site/architecture/limits.js';

export const load = () => ({
  title: 'The limits · Architecture · Nabu',
  description: LIMITS_DESCRIPTION,
  // the release the page was last checked against
  version: JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')).version,
});
