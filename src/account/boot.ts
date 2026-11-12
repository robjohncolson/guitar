import { installErrorReporting } from './errors';
import { bootSync } from './sync';
import { mountAccountUi } from './ui';
import { isFirstVisit, showWelcome } from './welcome';

/** Every page: report errors, pull synced progress (signed-in devices only), start the app, then add the account button and welcome card. */
export async function startPage(page: string, app: () => Promise<unknown>): Promise<void> {
  installErrorReporting(page);
  const firstVisit = isFirstVisit();
  try { await bootSync(); } catch (error) { console.error('[guitar] sync failed to start', error); }
  await app();
  mountAccountUi();
  if (firstVisit) showWelcome();
}
