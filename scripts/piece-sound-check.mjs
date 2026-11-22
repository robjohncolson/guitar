// Real Chrome against a production build: the Pieces page must sound the sampled piano, never the built-in synth voice.
// Build, serve and stop the server yourself, like the piece smoke:
//   npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1
//   SMOKE_ORIGIN=http://127.0.0.1:4173 node scripts/piece-sound-check.mjs
// A synth note is an oscillator given a PeriodicWave (the simple voice). A sampled note is a buffer source playing a recording longer than 0.8 s.
// Four fresh pages: the default setup; recordings that arrive slowly (a demo that starts early must wait for them);
// one failed manifest request plus one failed recording (the piano must recover without a reload); and a piano that never
// loads (the stage must say so, and the page must still play). Exits 1 on any failure.
import { chromeSession, pause } from './chrome-session.mjs';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4173';
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  return ok;
};

const instrument = (config) => `(() => {
  window.__snd = { synth: 0, sampled: 0, decodeFail: 0, fetches: [] };
  const wave = OscillatorNode.prototype.setPeriodicWave;
  OscillatorNode.prototype.setPeriodicWave = function (...a) { __snd.synth++; return wave.apply(this, a); };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { if (this.buffer && this.buffer.duration > 0.8) __snd.sampled++; return start.apply(this, a); };
  const decode = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (...a) { const p = decode.apply(this, a); Promise.resolve(p).catch(() => __snd.decodeFail++); return p; };
  const config = ${JSON.stringify(config)}, nativeFetch = window.fetch;
  window.fetch = async (...a) => {
    const url = String(a[0] && a[0].url || a[0]), name = (/piano\\/(.*)$/.exec(url) || [])[1];
    if (name && config.fail && config.fail[name] > 0) { config.fail[name]--; __snd.fetches.push({ name, status: 404, injected: true }); return new Response(null, { status: 404 }); }
    if (name && config.delay && name.endsWith('.mp3')) await new Promise(resolve => setTimeout(resolve, config.delay));
    try { const r = await nativeFetch(...a); if (name) __snd.fetches.push({ name, status: r.status }); return r; }
    catch (error) { if (name) __snd.fetches.push({ name, status: 0 }); throw error; }
  };
})()`;
const SNAP = `(() => { const box = document.getElementById('piece-notice'); return {
  synth: __snd.synth, sampled: __snd.sampled, decodeFail: __snd.decodeFail, fetches: __snd.fetches.slice(),
  select: document.getElementById('piece-piano') && document.getElementById('piece-piano').value, status: (document.getElementById('piece-piano-status') || {}).textContent || '',
  notice: box && !box.hidden ? (document.getElementById('piece-feedback').textContent || '') : '' }; })()`;

const mouse = async (s, x, y) => {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const key = async (s, code) => {
  for (const type of ['keyDown', 'keyUp'])
    await s.send('Input.dispatchKeyEvent', {
      type,
      key: code.slice(-1).toLowerCase(),
      code,
      windowsVirtualKeyCode: code.charCodeAt(code.length - 1),
    });
};
const clickHearIt = async (s) => {
  const at = await s.evaluate(
    `(() => { const e = document.getElementById('piece-demo'); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  await mouse(s, at.x, at.y);
};
/** Waits until the piano status is empty and no recording request has been logged for about two seconds. */
async function quiet(s, ms) {
  const end = Date.now() + ms;
  let last = -1,
    still = 0;
  while (Date.now() < end) {
    await pause(300);
    const now = await s.evaluate(SNAP);
    still = now.fetches.length === last ? still + 1 : 0;
    last = now.fetches.length;
    if (still >= 7 && now.status === '' && now.fetches.length > 0) return now;
  }
  return s.evaluate(SNAP);
}
async function page(name, config, run) {
  const s = await chromeSession();
  try {
    await s.send('Page.addScriptToEvaluateOnNewDocument', { source: instrument(config) });
    await s.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await s.send('Page.navigate', { url: `${origin}/piece.html` });
    await s.until(
      "document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1' && document.querySelectorAll('#today-list [data-unit]').length >= 3",
      45000,
    );
    await pause(600);
    const summary = await run(s);
    check(s.errors.length === 0, `${name}: ${s.errors.length} uncaught page error(s)`);
    check(
      !s.requests.some((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')),
      `${name}: a request left ${origin}`,
    );
    console.log(`${name}: ${summary}`);
  } catch (error) {
    check(false, `${name}: ${error.message.split('\n')[0]}`);
  } finally {
    await s.close();
  }
}
const sounded = (before, after) => ({ synth: after.synth - before.synth, sampled: after.sampled - before.sampled });
const recordings = (fetches) => fetches.filter((f) => /\.mp3$/.test(f.name));

await page('default setup', {}, async (s) => {
  await mouse(s, 5, 5);
  const ready = await quiet(s, 30000);
  check(ready.select === 'grand', `default setup: the Piano sound control starts on "${ready.select}", not "grand"`);
  check(ready.status === '', `default setup: piano status says "${ready.status}"`);
  check(
    ready.fetches.some((f) => f.name === 'manifest.json' && f.status === 200),
    'default setup: piano/manifest.json did not load',
  );
  check(
    recordings(ready.fetches).length >= 10,
    `default setup: only ${recordings(ready.fetches).length} recordings were requested`,
  );
  const bad = ready.fetches.filter((f) => f.status !== 200).map((f) => `${f.name} ${f.status}`);
  check(bad.length === 0, `default setup: piano requests failed: ${bad.join(', ')}`);
  check(ready.decodeFail === 0, `default setup: ${ready.decodeFail} recording(s) could not be decoded`);
  await clickHearIt(s);
  await pause(5500);
  const demo = sounded(ready, await s.evaluate(SNAP));
  check(
    demo.synth === 0 && demo.sampled >= 4,
    `default setup: Hear it sounded ${demo.sampled} sampled and ${demo.synth} synth notes`,
  );
  await s.evaluate(`document.getElementById('piece-stop').click(); true`);
  await pause(700);
  await s.evaluate(`document.getElementById('input-keys').click(); true`);
  await pause(700);
  const before = await s.evaluate(SNAP);
  for (const code of ['KeyZ', 'KeyS', 'KeyX']) {
    await key(s, code);
    await pause(200);
  }
  await pause(500);
  const keys = sounded(before, await s.evaluate(SNAP));
  check(
    keys.synth === 0 && keys.sampled >= 3,
    `default setup: three keys sounded ${keys.sampled} sampled and ${keys.synth} synth notes`,
  );
  return `${recordings(ready.fetches).length} recordings loaded; Hear it ${demo.sampled} sampled / ${demo.synth} synth; keys ${keys.sampled} sampled / ${keys.synth} synth`;
});

await page('slow recordings', { delay: 1500 }, async (s) => {
  await clickHearIt(s);
  await pause(7500);
  const after = await s.evaluate(SNAP);
  check(
    after.synth === 0 && after.sampled >= 4,
    `slow recordings: the first Hear it sounded ${after.sampled} sampled and ${after.synth} synth notes`,
  );
  return `first Hear it ${after.sampled} sampled / ${after.synth} synth`;
});

await page('failed requests', { fail: { 'manifest.json': 1, 'C3.mp3': 1 } }, async (s) => {
  await mouse(s, 5, 5);
  const ready = await quiet(s, 40000);
  const injected = ready.fetches.filter((f) => f.injected).map((f) => f.name);
  check(injected.length === 2, `failed requests: expected two injected failures, saw ${injected.join(', ') || 'none'}`);
  check(ready.status === '', `failed requests: the piano never recovered ("${ready.status}")`);
  await clickHearIt(s);
  await pause(5500);
  const demo = sounded(ready, await s.evaluate(SNAP));
  check(
    demo.synth === 0 && demo.sampled >= 4,
    `failed requests: after the failures Hear it sounded ${demo.sampled} sampled and ${demo.synth} synth notes`,
  );
  return `${injected.length} requests failed on purpose; Hear it ${demo.sampled} sampled / ${demo.synth} synth`;
});

await page('piano that never loads', { fail: { 'manifest.json': 99 } }, async (s) => {
  await mouse(s, 5, 5);
  const end = Date.now() + 40000;
  let state = await s.evaluate(SNAP);
  while (Date.now() < end && !/^Grand piano could not load/.test(state.status)) {
    await pause(500);
    state = await s.evaluate(SNAP);
  }
  check(
    /^Grand piano could not load/.test(state.status),
    `piano that never loads: the Sound & timing line says "${state.status}" after 40 s`,
  );
  check(
    /Grand piano could not load/.test(state.notice),
    `piano that never loads: the stage notice says "${state.notice}"`,
  );
  await clickHearIt(s);
  await pause(8500);
  const demo = sounded(state, await s.evaluate(SNAP));
  check(
    demo.sampled === 0 && demo.synth >= 4,
    `piano that never loads: Hear it sounded ${demo.sampled} sampled and ${demo.synth} synth notes (the simple piano should play)`,
  );
  return `notice "${state.notice}"; Hear it ${demo.sampled} sampled / ${demo.synth} synth`;
});

if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nThe sampled piano is the default, recovers from failed requests, and says so when it cannot load.');
