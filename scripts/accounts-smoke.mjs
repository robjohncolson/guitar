// End-to-end account check in real Chrome with two separate browser profiles (two "devices"):
// sign-up, httpOnly cookie, progress push, private piece save, first sign-in choice on device B, cross-device sync,
// sign-out and account deletion. Uses a throwaway account and deletes it at the end.
//   SMOKE_ORIGIN=https://<preview>.vercel.app node scripts/accounts-smoke.mjs   (default http://127.0.0.1:4180, see accounts-server.mjs)
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromeSession, pause } from './chrome-session.mjs';

const origin = (process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4180').replace(/\/$/, '');
const secure = origin.startsWith('https:');
const username = `smoke-${Date.now().toString(36)}`, password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const folder = await mkdtemp(path.join(tmpdir(), 'guitar-accounts-'));
const pieceFile = path.join(folder, 'smoke-song.piece.txt');
await writeFile(pieceFile, await readFile(new URL('../src/piece/packs/gymnopedie-1.piece.txt', import.meta.url), 'utf8'));
const steps = [];
const step = name => { steps.push(name); console.log(`✓ ${name}`); };
const A = await chromeSession(), B = await chromeSession();

async function open(browser, page) {
  await browser.send('Page.navigate', { url: `${origin}/${page}` });
  await browser.until(`document.readyState === 'complete' && !!document.querySelector('#account-open')`);
}
const js = value => JSON.stringify(value);
const click = (browser, selector) => browser.evaluate(`(() => { const el = document.querySelector(${js(selector)}); if (!el) throw new Error('missing ' + ${js(selector)}); el.click(); return true; })()`);
async function fillAndSubmit(browser, user, pass) {
  await browser.evaluate(`(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('account-username', ${js(user)}); set('account-password', ${js(pass)}); document.getElementById('account-submit').click(); return true; })()`);
}
const checkPitch = browser => browser.evaluate(`document.getElementById('piece-check-pitch').checked`);
const stored = (browser, key) => browser.evaluate(`localStorage.getItem(${js(key)})`);
const apiGet = (browser, p) => browser.evaluate(`fetch('${origin}/api/${p}', { credentials: 'same-origin' }).then(async r => ({ status: r.status, body: await r.json() }))`);

try {
  // Device A: a first-time visitor.
  await open(A, 'piece.html');
  assert.equal(await A.evaluate(`document.getElementById('account-open').textContent`), 'Sign in');
  assert.ok(await A.evaluate(`!!document.querySelector('.welcome-card')`), 'first-visit how-to is shown');
  await click(A, '.welcome-card button');
  assert.ok(await A.evaluate(`!document.querySelector('.welcome-card') && localStorage.getItem('guitar.welcome.v1') === '1'`));
  step('first visit shows a dismissible how-to and a Sign in button');

  const before = await checkPitch(A);
  await click(A, '#piece-check-pitch');
  assert.equal(await checkPitch(A), !before);
  const { root } = await A.send('DOM.getDocument');
  const { nodeId } = await A.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#piece-file' });
  await A.send('DOM.setFileInputFiles', { nodeId, files: [pieceFile] });
  await A.until(`document.getElementById('piece-local-list').textContent.includes('Gymnop')`);
  step('signed-out progress and an imported piece stay in localStorage');

  await click(A, '#account-open');
  await click(A, '#account-switch');
  await fillAndSubmit(A, username, password);
  await A.until(`document.getElementById('account-open').textContent.includes(${js(username)})`, 20000);
  const cookies = (await A.send('Network.getCookies', { urls: [origin] })).cookies.filter(c => c.name.includes('guitar_session'));
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].httpOnly, true);
  assert.equal(cookies[0].sameSite, 'Lax');
  assert.equal(cookies[0].secure, secure);
  if (secure) assert.equal(cookies[0].name, '__Host-guitar_session');
  assert.equal(await A.evaluate(`document.cookie.includes('guitar_session')`), false, 'session cookie is not readable by scripts');
  const cloudA = await apiGet(A, 'progress');
  assert.equal(cloudA.status, 200);
  const pieceProgress = cloudA.body.items.find(i => i.key === 'piece.trainer.v1');
  assert.equal(pieceProgress?.value.checkPitch, !before);
  const imported = await apiGet(A, 'pieces');
  assert.deepEqual(imported.body.items, [], 'imported pieces are not uploaded without opting in');
  step('sign-up sets an httpOnly SameSite=Lax session and pushes this device’s progress (not its pieces)');

  await click(A, '.account-x');
  await A.until(`!!document.querySelector('[data-cloud-save]')`);
  await click(A, '[data-cloud-save="mine:smoke-song"]');
  await A.until(`document.getElementById('piece-account-list').textContent.includes('saved')`);
  const saved = await apiGet(A, 'pieces');
  assert.deepEqual(saved.body.items.map(i => i.id), ['mine:smoke-song']);
  step('Save to my account uploads that one piece, privately');

  // Device B: has its own different local progress, so the first sign-in asks.
  await open(B, 'piece.html');
  await click(B, '#piece-check-pitch');
  await click(B, '#piece-check-pitch');
  await B.evaluate(`(() => { const p = JSON.parse(localStorage.getItem('piece.trainer.v1')); p.checkPitch = ${before}; localStorage.setItem('piece.trainer.v1', JSON.stringify(p)); return true; })()`);
  assert.equal((await apiGet(B, 'progress')).status, 401, 'device B cannot read the account before signing in');
  await click(B, '#account-open');
  await fillAndSubmit(B, username, password);
  await B.until(`!!document.querySelector('[data-choice="cloud"]')`, 20000);
  assert.ok(await B.evaluate(`document.querySelector('.account-body').textContent.includes('Pieces progress')`));
  await click(B, '[data-choice="cloud"]');
  await pause(500);
  await B.until(`document.readyState === 'complete' && !!document.querySelector('#account-open') && document.getElementById('account-open').textContent.includes(${js(username)})`, 20000);
  assert.equal(await checkPitch(B), !before, 'device B now uses the account’s progress');
  step('first sign-in on a device with different progress asks keep / use account / merge, and “use account” applies it');

  await B.until(`!!document.querySelector('[data-cloud-add="mine:smoke-song"]')`);
  await click(B, '[data-cloud-add="mine:smoke-song"]');
  await B.until(`document.getElementById('piece-local-list').textContent.includes('Gymnop')`);
  step('device B can add the private piece from the account to its browser');

  await click(B, '#piece-check-pitch');
  assert.equal(await checkPitch(B), before);
  await B.until(`fetch('${origin}/api/progress').then(r => r.json()).then(b => b.items.find(i => i.key === 'piece.trainer.v1').value.checkPitch === ${before})`, 15000);
  await open(A, 'piece.html');
  assert.equal(await checkPitch(A), before, 'device A picks up device B’s change on load');
  step('a change on device B syncs to device A');

  await click(B, '#account-open');
  await click(B, '#account-signout');
  await B.until(`document.getElementById('account-open').textContent === 'Sign in'`);
  assert.equal((await apiGet(B, 'session')).body.signedIn, false);
  assert.equal(await stored(B, 'piece.trainer.v1') !== null, true, 'signing out keeps this browser’s progress');
  step('sign-out ends the session and keeps local progress');

  await click(A, '#account-open');
  await A.evaluate(`document.querySelector('.account-danger').open = true`);
  await A.evaluate(`(() => { document.getElementById('account-delete-password').value = ${js(password)}; document.getElementById('account-delete').click(); return true; })()`);
  await A.until(`document.getElementById('account-open').textContent === 'Sign in'`, 20000);
  const signin = await B.evaluate(`fetch('${origin}/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ${js(JSON.stringify({ username, password }))} }).then(r => r.status)`);
  assert.equal(signin, 401);
  step('delete my account removes the account: its credentials no longer work');

  assert.deepEqual([...A.errors, ...B.errors].map(e => e.exception?.description ?? e.text), []);
  step('no page errors');
  console.log(`\nAccounts smoke passed: ${steps.length} checks against ${origin}`);
} finally {
  await A.close(); await B.close();
}
