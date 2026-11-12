/** Accounts need the /api functions, so they are on for the Vercel build and off for the static GitHub Pages mirror (VITE_ACCOUNTS=off). */
export const accountsEnabled = import.meta.env.VITE_ACCOUNTS !== 'off';
export const PROGRESS_KEYS = ['guitar.trainer.v1', 'guitar.practice.v1', 'piece.trainer.v1'] as const;
export type ProgressKey = typeof PROGRESS_KEYS[number];
export const PIECES_KEY = 'piece.imported.v1';
export const LABELS: Record<ProgressKey, string> = { 'guitar.trainer.v1': 'Trainer progress', 'guitar.practice.v1': 'Partner & Looper settings', 'piece.trainer.v1': 'Pieces progress' };
