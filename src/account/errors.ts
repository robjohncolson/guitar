/**
 * Basic error reporting: the console only. This build is offline-first and has no backend, so no page error leaves the
 * browser. The page name stays in the message so a report from the guitar course or Pieces is easy to tell apart.
 */
export function installErrorReporting(page: string): void {
  const report = (message: string, source?: string, line?: number) =>
    console.error('[guitar]', page, message, source ?? '', line ?? '');
  window.addEventListener('error', (e) => report(String(e.message), e.filename, e.lineno));
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as Error | undefined;
    report(`Unhandled rejection: ${reason?.message ?? String(e.reason)}`);
  });
}
