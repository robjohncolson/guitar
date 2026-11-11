import { startPage } from '../account/boot';

await startPage('trainer', () => import('../trainer/main'));
