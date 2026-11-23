/** Accounts need the /api functions, so they are on for the Vercel build and off for the static GitHub Pages mirror (VITE_ACCOUNTS=off). */
export const accountsEnabled = import.meta.env.VITE_ACCOUNTS !== 'off';
/**
 * The localStorage keys this app syncs. The server also still accepts `guitar.practice.v1` (the removed Play page's settings) so
 * that old clients keep working; this client neither writes nor syncs it.
 */
export const PROGRESS_KEYS = ['guitar.trainer.v1', 'piece.trainer.v1'] as const;
export type ProgressKey = (typeof PROGRESS_KEYS)[number];
export const isProgressKey = (key: string): key is ProgressKey => (PROGRESS_KEYS as readonly string[]).includes(key);
export const PIECES_KEY = 'piece.imported.v1';
export const LABELS: Record<ProgressKey, string> = {
  'guitar.trainer.v1': 'Guitar course progress',
  'piece.trainer.v1': 'Pieces progress',
};
