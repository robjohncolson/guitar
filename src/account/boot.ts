import { installErrorReporting } from './errors';
import { isFirstVisit, showWelcome } from './welcome';

/**
 * Every page: report errors to the console, start the app, then show the welcome card on a first visit. This build has
 * no account sync, so boot never waits on a network reply and never pulls or pushes progress.
 */
export async function startPage(page: string, app: () => Promise<unknown>): Promise<void> {
  installErrorReporting(page);
  const firstVisit = isFirstVisit();
  await app();
  if (firstVisit) showWelcome();
}
