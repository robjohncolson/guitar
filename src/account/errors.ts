import { accountsEnabled } from './config';

/** Basic error reporting: always to the console; on the Vercel build also to our own function log (no third-party trackers, no ids). */
export function installErrorReporting(page: string): void {
  let sent = 0;
  const report = (message: string, source?: string, line?: number, stack?: string) => {
    console.error('[guitar]', message, source ?? '', line ?? '');
    if (!accountsEnabled || sent >= 5) return;
    sent++;
    const body = JSON.stringify({ page, message: message.slice(0, 500), source: source?.replace(location.origin, '').slice(0, 200), line, stack: stack?.slice(0, 1500) });
    void fetch(`${import.meta.env.BASE_URL}api/client-error`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => undefined);
  };
  window.addEventListener('error', e => report(String(e.message), e.filename, e.lineno, (e.error as Error | undefined)?.stack));
  window.addEventListener('unhandledrejection', e => { const r = e.reason as Error | undefined; report(`Unhandled rejection: ${r?.message ?? String(e.reason)}`, undefined, undefined, r?.stack); });
}
