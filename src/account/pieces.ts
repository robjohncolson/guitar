import { accountsEnabled } from './config';
import { ApiFailure, deletePiece, getPiece, listPieces, savePiece, type CloudPiece } from './api';
import { onState, state } from './sync';

type Mine = { id: string; text: string };
export type PieceHooks = { container: HTMLElement; readMine: () => Mine[]; addMine: (piece: Mine) => boolean; titleOf: (text: string) => string; refresh: () => void };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * "Your account" list on the Pieces page. Nothing is uploaded unless the user presses Save to my account for that piece.
 * Saved pieces are readable only with this account's session (owner-only rows, never a public bucket).
 */
export function mountPieceAccount(hooks: PieceHooks): { paint: () => void } {
  let cloud: CloudPiece[] | null = null, message = '', loading = false;
  const load = async () => {
    if (!state.signedIn || loading) return;
    loading = true;
    try { cloud = (await listPieces()).items; } catch (e) { message = (e as ApiFailure).message; }
    loading = false; paint();
  };
  function paint(): void {
    const c = hooks.container;
    if (!accountsEnabled || !state.signedIn) { c.innerHTML = ''; cloud = null; return; }
    if (cloud === null) { c.innerHTML = '<div class="piece-account"><p>Checking your account…</p></div>'; void load(); return; }
    const mine = hooks.readMine(), ids = new Set(cloud.map(p => p.id));
    const rows = [
      ...mine.map(m => `<div class="journal-entry"><span>${esc(hooks.titleOf(m.text))}</span>${ids.has(m.id)
        ? `<span>saved</span><button class="text-button" data-cloud-remove="${esc(m.id)}">Remove from account</button>`
        : `<button class="text-button" data-cloud-save="${esc(m.id)}">Save to my account</button>`}</div>`),
      ...cloud.filter(p => !mine.some(m => m.id === p.id)).map(p => `<div class="journal-entry"><span>${esc(p.id.replace(/^mine:/, ''))}</span><button class="text-button" data-cloud-add="${esc(p.id)}">Add to this browser</button><button class="text-button" data-cloud-remove="${esc(p.id)}">Remove from account</button></div>`),
    ];
    c.innerHTML = `<div class="piece-account"><p>Your account (private to you):</p>${rows.join('') || '<p>No pieces yet. Add one above, then choose Save to my account to use it on your other devices.</p>'}<p role="status" id="piece-account-status">${esc(message)}</p></div>`;
  }
  hooks.container.addEventListener('click', async event => {
    const b = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    b.disabled = true;
    try {
      if (b.dataset.cloudSave) {
        const piece = hooks.readMine().find(m => m.id === b.dataset.cloudSave);
        if (piece) { await savePiece(piece.id, piece.text); message = 'Saved to your account.'; }
      } else if (b.dataset.cloudRemove) {
        await deletePiece(b.dataset.cloudRemove); message = 'Removed from your account. Any copy in this browser stays.';
      } else if (b.dataset.cloudAdd) {
        const { piece } = await getPiece(b.dataset.cloudAdd);
        message = hooks.addMine({ id: piece.id, text: piece.text }) ? 'Added to this browser.' : 'Browser storage is full or unavailable.';
        hooks.refresh();
      }
      cloud = (await listPieces()).items;
    } catch (e) { message = (e as ApiFailure).message; }
    paint();
  });
  onState(() => { if (!state.signedIn) cloud = null; paint(); });
  return { paint };
}
