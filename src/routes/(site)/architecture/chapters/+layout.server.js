import { chapters } from '../../../../site/architecture/chapters.server.js';
import { storyList } from '../../../../site/architecture/chapters.js';

export const load = () => ({ story: storyList(chapters()).map(({ n, title, href }) => ({ n, title, href })) });
