import { startPage } from '../account/boot';

await startPage('piece', () => import('../piece/main'));
