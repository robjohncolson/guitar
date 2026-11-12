import './styles.css';
import { accountsEnabled, LABELS } from './config';
import { readMeta } from './changes';
import { ApiFailure, deleteAccount, getProgress, signIn, signOut } from './api';
import { conflicts } from './reconcile';
import { markSignedIn, markSignedOut, onState, reconcile, state } from './sync';
import type { Choice } from './reconcile';
import { PROGRESS_KEYS } from './config';

const h = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
let dialog: HTMLDialogElement | undefined, navButton: HTMLButtonElement | undefined, banner: HTMLElement | undefined;
let mode: 'signin' | 'signup' = 'signin';

function paintNav(): void {
  if (!navButton) return;
  navButton.textContent = state.signedIn ? `● ${state.username}` : 'Sign in';
  navButton.title = state.signedIn ? `Signed in as ${state.username}. ${state.status}` : 'Optional: sync your progress across devices';
  if (banner) {
    banner.hidden = !state.remoteNewer;
  }
  const status = dialog?.querySelector('#account-status');
  if (status) status.textContent = state.status;
}

function paintDialog(error = ''): void {
  if (!dialog) return;
  const body = dialog.querySelector<HTMLElement>('.account-body')!;
  if (state.signedIn) {
    body.innerHTML = `
      <h2 id="account-title">Your account</h2>
      <p>Signed in as <strong>${esc(state.username ?? '')}</strong>. Trainer and Pieces progress and your Partner/Looper settings sync automatically between devices where you sign in.</p>
      <p class="account-status" role="status" id="account-status">${esc(state.status)}</p>
      <p class="account-note">Pieces you add yourself stay in this browser unless you choose <em>Save to my account</em> on the Pieces page. They are private to you.</p>
      <div class="account-actions"><button id="account-signout">Sign out</button><button class="primary" id="account-close">Done</button></div>
      <details class="account-danger"><summary>Delete my account and data</summary>
        <p>This permanently deletes your account, its synced progress and any pieces saved to it. Progress in this browser stays.</p>
        <form id="account-delete-form"><label>Password<input type="password" id="account-delete-password" autocomplete="current-password" required></label>
        <button type="submit" id="account-delete">Delete my account</button></form>
        <p class="account-error" role="alert" id="account-delete-error">${esc(error)}</p>
      </details>`;
    body.querySelector<HTMLButtonElement>('#account-close')!.onclick = () => dialog!.close();
    body.querySelector<HTMLButtonElement>('#account-signout')!.onclick = async () => {
      try { await signOut(); } catch { /* the cookie may already be gone */ }
      markSignedOut(); state.status = ''; paintDialog();
    };
    body.querySelector<HTMLFormElement>('#account-delete-form')!.onsubmit = async event => {
      event.preventDefault();
      const password = body.querySelector<HTMLInputElement>('#account-delete-password')!.value;
      try { await deleteAccount(password); markSignedOut(); state.status = 'Your account and its data were deleted.'; paintDialog(); }
      catch (e) { body.querySelector('#account-delete-error')!.textContent = (e as ApiFailure).message; }
    };
    return;
  }
  body.innerHTML = `
    <h2 id="account-title">${mode === 'signin' ? 'Sign in' : 'Create an account'}</h2>
    <p class="account-note">Optional. An account keeps your progress in sync across devices. No email needed. Without one, everything stays in this browser, as before.</p>
    ${state.status ? `<p class="account-status" role="status">${esc(state.status)}</p>` : ''}
    <form id="account-form" novalidate>
      <label>Username<input id="account-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="32" pattern="[a-z0-9_\\-]{3,32}" required></label>
      <label>Password<input id="account-password" name="password" type="password" autocomplete="${mode === 'signin' ? 'current-password' : 'new-password'}" minlength="10" maxlength="200" required></label>
      ${mode === 'signup' ? '<p class="account-hint">3–32 lowercase letters, numbers, _ or -. Password: at least 10 characters. There is no password reset, so keep it somewhere safe.</p>' : ''}
      <p class="account-error" role="alert" id="account-error">${esc(error)}</p>
      <div class="account-actions"><button type="button" id="account-switch" class="text-button">${mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}</button><button type="submit" class="primary" id="account-submit">${mode === 'signin' ? 'Sign in' : 'Create account'}</button></div>
    </form>`;
  body.querySelector<HTMLButtonElement>('#account-switch')!.onclick = () => { mode = mode === 'signin' ? 'signup' : 'signin'; paintDialog(); };
  body.querySelector<HTMLFormElement>('#account-form')!.onsubmit = async event => {
    event.preventDefault();
    const username = body.querySelector<HTMLInputElement>('#account-username')!.value.trim().toLowerCase();
    const password = body.querySelector<HTMLInputElement>('#account-password')!.value;
    const submit = body.querySelector<HTMLButtonElement>('#account-submit')!;
    if (mode === 'signup' && !/^[a-z0-9_-]{3,32}$/.test(username)) { paintError('Usernames are 3–32 characters: lowercase letters, numbers, _ or -.'); return; }
    if (mode === 'signup' && password.length < 10) { paintError('Passwords need at least 10 characters.'); return; }
    submit.disabled = true;
    try {
      const result = await signIn(username, password, mode === 'signup');
      await afterSignIn(result.username);
    } catch (e) { submit.disabled = false; paintError((e as ApiFailure).message); }
  };
  setTimeout(() => body.querySelector<HTMLInputElement>('#account-username')?.focus());
}
const paintError = (message: string) => { const el = dialog?.querySelector('#account-error'); if (el) el.textContent = message; };

/** First sign-in on this device: if both this browser and the account have different progress, ask which to keep. */
async function afterSignIn(username: string): Promise<void> {
  const meta = readMeta();
  const local = PROGRESS_KEYS.map(key => ({ key, text: localStorage.getItem(key), meta: meta.keys[key] ?? { version: 0, modifiedAt: null, dirty: false } }));
  const { items } = await getProgress();
  const differing = conflicts(local, items);
  let choice: Choice = 'merge';
  if (differing.length) {
    const picked = await askChoice(differing.map(k => LABELS[k]));
    if (!picked) { try { await signOut(); } catch { /* ignore */ } paintDialog('Sign-in cancelled. Nothing was changed.'); return; }
    choice = picked;
  }
  markSignedIn(username);
  const { changedLocal } = await reconcile(choice, false);
  state.status = 'Signed in. Progress syncs automatically.';
  if (changedLocal) { location.reload(); return; }
  paintDialog();
}

function askChoice(labels: string[]): Promise<Choice | null> {
  return new Promise(resolve => {
    const body = dialog!.querySelector<HTMLElement>('.account-body')!;
    body.innerHTML = `
      <h2 id="account-title">This browser and your account both have progress</h2>
      <p>Different copies of: ${labels.map(esc).join(', ')}. Which should you keep?</p>
      <div class="account-choices">
        <button data-choice="device"><strong>Keep this device’s progress</strong><span>Replaces the account’s copy</span></button>
        <button data-choice="cloud"><strong>Use my account’s progress</strong><span>Replaces this browser’s copy</span></button>
        <button data-choice="merge" class="primary"><strong>Merge</strong><span>For each part, keep whichever changed most recently</span></button>
      </div>
      <div class="account-actions"><button data-choice="" class="text-button">Cancel</button></div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(b => { b.onclick = () => resolve((b.dataset.choice || null) as Choice | null); });
  });
}

export function openAccount(): void { if (!dialog) return; mode = 'signin'; paintDialog(); if (!dialog.open) dialog.showModal(); }

/** Adds the Sign in / account button to the page's top navigation. Hidden entirely on the static mirror. */
export function mountAccountUi(): void {
  if (!accountsEnabled || navButton) return;
  const nav = document.querySelector('.app-nav');
  if (!nav) return;
  navButton = h('<button type="button" class="account-nav" id="account-open" aria-haspopup="dialog"></button>') as HTMLButtonElement;
  navButton.onclick = openAccount;
  nav.append(navButton);
  dialog = h('<dialog class="account-dialog" aria-labelledby="account-title"><button class="account-x text-button" aria-label="Close">×</button><div class="account-body"></div></dialog>') as HTMLDialogElement;
  dialog.querySelector<HTMLButtonElement>('.account-x')!.onclick = () => dialog!.close();
  document.body.append(dialog);
  banner = h('<div class="account-banner" role="status" hidden>Your progress changed on another device. <button class="primary" type="button">Reload to get it</button></div>');
  banner.querySelector('button')!.addEventListener('click', () => location.reload());
  document.body.append(banner);
  onState(paintNav);
  paintNav();
}
