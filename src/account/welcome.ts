import { accountsEnabled, PIECES_KEY, PROGRESS_KEYS } from './config';

const WELCOME_KEY = 'guitar.welcome.v1';

/** True for a first-time visitor: nothing saved yet. Check before the app starts, because apps save defaults on load. */
export function isFirstVisit(): boolean {
  try { return !localStorage.getItem(WELCOME_KEY) && [...PROGRESS_KEYS, PIECES_KEY].every(k => localStorage.getItem(k) === null); } catch { return false; }
}

/** A short how-to for first-time visitors only, dismissed for good with one click. */
export function showWelcome(): void {
  const main = document.querySelector('#app main, main');
  const nav = main?.querySelector('.app-nav');
  if (!main) return;
  const card = document.createElement('section');
  card.className = 'welcome-card';
  card.setAttribute('aria-label', 'How to use this site');
  card.innerHTML = `<h2>New here? How it works</h2><ol>
    <li><strong>Use headphones</strong> and allow the microphone when asked. Your playing is analysed on this device; audio is never uploaded.</li>
    <li><strong>Trainer</strong> is a guided guitar course. <strong>Pieces</strong> teaches one piece on piano or guitar. <strong>Partner</strong> and <strong>Looper</strong> are for playing along.</li>
    <li>Calibrate timing once (under Sound &amp; timing) for accurate tempo steps, then start slowly.</li>
    <li>Progress saves in this browser automatically.${accountsEnabled ? ' Create a free account (Sign in, top right) to sync it across devices.' : ''}</li>
  </ol><button type="button" class="primary">Got it</button>`;
  card.querySelector('button')!.addEventListener('click', () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ } card.remove(); });
  if (nav) nav.after(card); else main.prepend(card);
}
