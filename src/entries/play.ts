import { startPage } from '../account/boot';

await startPage('play', () => import('../main'));
