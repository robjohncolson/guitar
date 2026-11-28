/**
 * This build is offline-first: accounts and cross-device sync are switched off. The account modules remain in the
 * repository for reference, but no account button is mounted, no `/api/*` request starts, and progress moves between
 * browsers only through the explicit JSON backup in `src/storage/backup.ts`.
 */
export const accountsEnabled = false;
/**
 * The localStorage keys the old sync code knew. Kept so its own tests and types still describe the historical records;
 * they are not synced by this build. `guitar.practice.v1` (the removed Play page's settings) is neither written nor
 * included in the new backup.
 */
export const PROGRESS_KEYS = ['guitar.trainer.v1', 'piece.trainer.v1'] as const;
export type ProgressKey = (typeof PROGRESS_KEYS)[number];
export const isProgressKey = (key: string): key is ProgressKey => (PROGRESS_KEYS as readonly string[]).includes(key);
export const PIECES_KEY = 'piece.imported.v1';
export const LABELS: Record<ProgressKey, string> = {
  'guitar.trainer.v1': 'Guitar course progress',
  'piece.trainer.v1': 'Pieces progress',
};
