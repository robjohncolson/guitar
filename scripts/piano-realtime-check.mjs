// Real-time check of the sampled piano on the Pieces page, tapping the page's real audio output.
// Starts and stops its own Vite dev server (port 5202) and headless Chrome sessions, one per scenario.
//
// Tap: an init script wraps AudioNode.prototype.connect so anything wired to a context's destination also feeds an
// AudioWorklet that posts the RMS of every 128-frame block with its exact context time. It also wraps
// AudioBufferSourceNode/OscillatorNode.start (sampler vs simple voice), window.fetch for /piano/*.mp3 (optional delay),
// and records every keydown/click/pointerdown with its event.timeStamp.
//
// Time mapping: a block stamped t (context time) reaches the speaker when the heard position of the context equals t.
// ctx.getOutputTimestamp() gives {contextTime, performanceTime}: the context time being heard at that performance.now()
// value. An event at performance time p (event.timeStamp is on the same clock) is at H(p) = contextTime + (p - performanceTime) / 1000
// (taken in a capture-phase listener, before the app reacts). Latency = t - H(p), so it already includes the output latency;
// "render" latency subtracts ctx.outputLatency. If getOutputTimestamp is unusable, H(p) = currentTime - outputLatency - (now - p) / 1000.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromeSession, pause } from './chrome-session.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)), PORT = 5202, origin = `http://127.0.0.1:${PORT}`;
const checks = [], check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), ...detail });
const SOUND = 0.01, SILENT = 0.0004;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', windowsHide: true });

const hooks = (cfg, delay) => `(() => {
  try { localStorage.setItem('piece.input.v1', ${JSON.stringify(JSON.stringify(cfg))}); } catch {}
  const T = window.__tap = { blocks: [], starts: [], events: [], mp3: [], mp3done: [], errs: [], contexts: 0, ready: false };
  const ce = console.error.bind(console); console.error = (...a) => { T.errs.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
  addEventListener('error', e => T.errs.push('error: ' + e.message)); addEventListener('unhandledrejection', e => T.errs.push('rejection: ' + e.reason));
  const code = 'registerProcessor("tap", class extends AudioWorkletProcessor { constructor() { super(); this.q = []; }' +
    ' process(inputs) { const d = inputs[0][0]; if (d) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; this.q.push(currentTime, Math.sqrt(s / d.length)); }' +
    ' else this.q.push(currentTime, 0); if (this.q.length >= 16) { this.port.postMessage(this.q); this.q = []; } return true; } });';
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const orig = AudioNode.prototype.connect, taps = new Map();
  function tapFor(ctx) {
    let t = taps.get(ctx); if (t) return t;
    t = { pending: [], node: null }; taps.set(ctx, t); T.contexts++;
    ctx.audioWorklet.addModule(url).then(() => {
      const node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = e => { for (let i = 0; i < e.data.length; i += 2) T.blocks.push([e.data[i], e.data[i + 1]]); };
      orig.call(node, ctx.destination); t.node = node; T.ready = true; for (const s of t.pending) orig.call(s, node);
    }).catch(e => T.errs.push('tap: ' + e));
    return t;
  }
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode) { const t = tapFor(dest.context); if (t.node) orig.call(this, t.node); else t.pending.push(this); T.ctx = dest.context; }
    return r;
  };
  const wrap = (proto, kind) => { const s = proto.start; proto.start = function (...a) {
    T.starts.push({ kind, freq: kind === 'osc' ? this.frequency.value : 0, ctxTime: this.context.currentTime, when: a[0] ?? 0, perf: performance.now() }); return s.apply(this, a); }; };
  wrap(AudioBufferSourceNode.prototype, 'buf'); wrap(OscillatorNode.prototype, 'osc');
  const heard = stamp => { const c = T.ctx; if (!c) return null; const ts = c.getOutputTimestamp(), lat = c.outputLatency || c.baseLatency || 0;
    if (ts.contextTime > 0 && ts.performanceTime > 0) return { H: ts.contextTime + (stamp - ts.performanceTime) / 1000, lat, via: 'getOutputTimestamp' };
    return { H: c.currentTime - lat - (performance.now() - stamp) / 1000, lat, via: 'currentTime' }; };
  for (const type of ['keydown', 'pointerdown', 'click']) addEventListener(type, e => { const h = heard(e.timeStamp);
    T.events.push({ type, code: e.code, id: e.target && e.target.id, stamp: e.timeStamp, now: performance.now(), ...(h || {}) }); }, true);
  const rf = window.fetch;
  window.fetch = function (input, init) {
    const abs = new URL(typeof input === 'string' ? input : input.url, location.href).href;
    if (!/\\/piano\\/[^/]+\\.mp3$/.test(abs)) return rf.call(this, input, init);
    T.mp3.push({ url: abs, t: performance.now() });
    return new Promise(r => setTimeout(r, ${delay})).then(() => rf.call(this, input, init)).then(res => { T.mp3done.push(abs); return res; });
  };
})();`;

async function open(cfg, delay = 0) {
  const s = await chromeSession();
  await s.send('Page.addScriptToEvaluateOnNewDocument', { source: hooks(cfg, delay) });
  await s.send('Page.navigate', { url: `${origin}/piece.html` });
  await s.until("document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1' && window.__pieceDev", 60000);
  return s;
}
const ev = (s, x) => s.evaluate(x);
const click = async (s, sel) => {
  const [x, y] = await ev(s, `(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  await pause(60);
  const p = { x, y, button: 'left', clickCount: 1 };
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p });
};
const KEYS = { KeyZ: [90, 'z'], KeyX: [88, 'x'], KeyC: [67, 'c'], KeyV: [86, 'v'], KeyB: [66, 'b'], Escape: [27, 'Escape'] };
const keyDown = (s, code) => s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: KEYS[code][1], windowsVirtualKeyCode: KEYS[code][0] });
const keyUp = (s, code) => s.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: KEYS[code][1], windowsVirtualKeyCode: KEYS[code][0] });
const tap = async (s, from = 0) => ev(s, `__tap.blocks.slice(${from})`);
const count = s => ev(s, '__tap.blocks.length');
const startsOf = async (s, from = 0) => (await ev(s, `__tap.starts.slice(${from})`));
const isClick = f => Math.abs(f - 1000) < 5 || Math.abs(f - 1300) < 5;
const oscNotes = list => list.filter(x => x.kind === 'osc' && !isClick(x.freq)).length;
const bufs = list => list.filter(x => x.kind === 'buf').length;
const peak = (blocks, a, b) => blocks.reduce((m, [t, r]) => (t >= a && t <= b ? Math.max(m, r) : m), 0);
const waitSound = async (s, timeout = 20000) => {
  const end = Date.now() + timeout; let n = await count(s);
  while (Date.now() < end) { await pause(100); const b = await tap(s, Math.max(0, n - 1)); n = Math.max(n, 0); const all = await tap(s, (await count(s)) - 60); if (Math.max(0, ...all.map(x => x[1])) > SOUND) return true; }
  return false;
};
const grandReady = s => s.until("document.getElementById('piece-piano-status').textContent === '' && __tap.mp3done.length > 0 && __pieceDev.audio.sampler?.ready(...__pieceDev.audio.pianoRange)", 60000);
const lastEvent = (s, type) => ev(s, `__tap.events.filter(e => e.type === '${type}').pop()`);
const around = async (s, n0) => { await pause(500); return tap(s, n0); };
const stopRunning = s => ev(s, "!document.getElementById('piece-stop').disabled");
const openAbout = s => ev(s, "document.getElementById('piece-about').open = true");
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const r1 = x => (x === null ? null : Math.round(x * 10) / 10);

// Silence after a stop: seconds (speaker-inclusive) from the event to the first block that begins ten quiet blocks in a row.
function silenceAfter(blocks, ev0) {
  const from = ev0.H - ev0.lat; let i = blocks.findIndex(([t]) => t >= from);
  const before = peak(blocks, ev0.H - 0.25, ev0.H + ev0.lat);
  for (; i >= 0 && i < blocks.length - 10; i++) if (blocks.slice(i, i + 10).every(([, r]) => r < SILENT)) return { before, ms: (blocks[i][0] - ev0.H) * 1000, renderMs: (blocks[i][0] - ev0.H - ev0.lat) * 1000 };
  return { before, ms: null };
}
// First loud block after an event: milliseconds from the event.
function onsetAfter(blocks, ev0) {
  const hit = blocks.find(([t, r]) => t >= ev0.H - ev0.lat - 0.02 && r > SOUND);
  const quiet = peak(blocks, ev0.H - 0.2, ev0.H - 0.01);
  return hit ? { ms: (hit[0] - ev0.H) * 1000, renderMs: (hit[0] - ev0.H - ev0.lat) * 1000, quiet } : { ms: null, quiet };
}
const mp3Names = s => ev(s, "[...new Set(__tap.mp3.map(m => m.url.split('/').pop()))].sort()");
const common = async (s, label, out) => {
  out[label] = { errors: [...await ev(s, '__tap.errs'), ...s.errors.map(e => e.text + ' ' + (e.exception?.description ?? ''))],
    resourceErrors: await ev(s, "performance.getEntriesByType('resource').filter(r => r.responseStatus >= 400).map(r => r.responseStatus + ' ' + r.name)"),
    crossOrigin: s.requests.filter(u => /^(https?|wss?):/.test(u) && !u.startsWith(origin) && !u.startsWith(`ws://127.0.0.1:${PORT}`)), contexts: await ev(s, '__tap.contexts') };
};

const out = {}; const sessions = [];
let failed = false;
try {
  for (let i = 0; i < 400; i++) { try { if ((await fetch(`${origin}/piece.html`)).ok) break; } catch { /* starting */ } await pause(250); }

  // ---- A: grand piano, keys mode: checks 1, 2, 3, 6
  {
    const s = await open({ keys: true, piano: 'grand' }); sessions.push(s);
    const before = await ev(s, '__tap.mp3.length');
    await click(s, '#piece-title'); // the first user gesture
    await grandReady(s);
    const mp3 = await mp3Names(s), lo = await ev(s, '__pieceDev.audio.pianoRange');
    out.A = { mp3BeforeGesture: before, status: await ev(s, "document.getElementById('piece-piano-status').textContent"), tapReady: await ev(s, '__tap.ready') };
    // 1: demo sounds from buffer sources
    await openAbout(s);
    const s0 = (await ev(s, '__tap.starts.length')), n0 = await count(s);
    await click(s, '#piece-listen');
    const sounded = await waitSound(s); await pause(600);
    const st = await startsOf(s, s0), pk = peak(await tap(s, n0), 0, 1e9);
    check('1 grand demo sounds via buffer sources', sounded && bufs(st) > 0 && oscNotes(st) === 0, { peakRms: r1(pk * 1000) / 1000, bufferStarts: bufs(st), pianoOscillators: oscNotes(st), clickOscillators: st.length - bufs(st) - oscNotes(st) });
    // 2a: Escape stops within 100 ms; 2b: Stop button
    const stops = [];
    for (const how of ['Escape', 'button']) {
      if (how === 'button') { await pause(300); await click(s, '#piece-listen'); await waitSound(s); await pause(800); }
      const n1 = await count(s);
      if (how === 'Escape') { await keyDown(s, 'Escape'); await keyUp(s, 'Escape'); } else await click(s, '#piece-stop');
      await pause(800);
      const e = await lastEvent(s, how === 'Escape' ? 'keydown' : 'click'), blocks = await tap(s, n1 - 80);
      const r = silenceAfter(blocks, e); stops.push({ how, via: e.via, outputLatencyMs: r1(e.lat * 1000), soundBefore: r1(r.before * 1000) / 1000, silenceMs: r1(r.ms), renderMs: r1(r.renderMs) });
    }
    check('2 stop silences output within 100 ms (Escape and Stop button)', stops.every(x => x.silenceMs !== null && x.silenceMs <= 100 && x.soundBefore > SOUND), { stops });
    // 3: live key latency
    await ev(s, "document.activeElement && document.activeElement.blur()"); await pause(300);
    const lat = [], sBefore = await ev(s, '__tap.starts.length');
    for (const code of ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyZ']) {
      const n1 = await count(s); await pause(150);
      await keyDown(s, code); await pause(250); await keyUp(s, code); await pause(500);
      const e = await lastEvent(s, 'keydown'), r = onsetAfter(await tap(s, n1 - 20), e);
      lat.push({ code, ms: r1(r.ms), renderMs: r1(r.renderMs), quiet: r1(r.quiet * 1000) / 1000, via: e.via, stampLagMs: r1(e.now - e.stamp) });
    }
    const ks = await startsOf(s, sBefore);
    const ms = lat.map(x => x.renderMs); // the tap is before the output device, so the 50 ms budget is the render latency; ms (device-inclusive) is reported too
    check('3 computer-keys live key sounds within 50 ms (grand)', ms.every(x => x !== null && x <= 50) && bufs(ks) >= lat.length && oscNotes(ks) === 0, { medianRenderMs: r1(med(ms)), maxRenderMs: Math.max(...ms), medianWithOutputLatencyMs: r1(med(lat.map(x => x.ms))), presses: lat, bufferStarts: bufs(ks), pianoOscillators: oscNotes(ks) });
    // 6: requested roots
    const manifest = await ev(s, "fetch('/piano/manifest.json').then(r => r.json())"), roots = manifest.notes.map(n => n.midi);
    const midis = await ev(s, "(async () => { const [{ compile }, raw] = await Promise.all([import('/src/piece/notation.ts'), import('/src/piece/packs/gymnopedie-1.piece.txt?raw')]); return compile(raw.default).score.notes.map(n => n.midi); })()");
    const nearest = m => roots.reduce((b, r) => (Math.abs(r - m) < Math.abs(b - m) || (Math.abs(r - m) === Math.abs(b - m) && r < b) ? r : b));
    const want = new Set(); for (let m = Math.min(...midis) - 3; m <= Math.max(...midis) + 3; m++) want.add(nearest(m));
    const wantFiles = [...want].sort((a, b) => a - b).map(r => manifest.notes.find(n => n.midi === r).file).sort(), spare = mp3.filter(f => !wantFiles.includes(f)), missing = wantFiles.filter(f => !mp3.includes(f));
    const netMp3 = [...new Set(s.requests.filter(u => /\.mp3$/.test(u)).map(u => u.split('/').pop()))].sort();
    check('6 mp3 requests are exactly the roots for the piece range +/-3 semitones', !spare.length && !missing.length && JSON.stringify(netMp3) === JSON.stringify(mp3) && out.A.mp3BeforeGesture === 0,
      { pieceRange: [Math.min(...midis), Math.max(...midis)], appRange: lo, count: mp3.length, files: mp3, extra: spare, missing, networkMatchesFetch: JSON.stringify(netMp3) === JSON.stringify(mp3), requestedBeforeGesture: out.A.mp3BeforeGesture });
    await common(s, 'A_errors', out);
  }

  // ---- B: simple selected: check 4
  {
    const s = await open({ keys: true, piano: 'simple' }); sessions.push(s);
    await click(s, '#piece-title'); await pause(1500);
    await openAbout(s);
    const s0 = await ev(s, '__tap.starts.length'), n0 = await count(s);
    await click(s, '#piece-listen');
    const sounded = await waitSound(s); await pause(600);
    const st = await startsOf(s, s0), pk = peak(await tap(s, n0), 0, 1e9);
    await keyDown(s, 'Escape'); await keyUp(s, 'Escape'); await pause(500);
    const s1 = await ev(s, '__tap.starts.length'), n1 = await count(s);
    await keyDown(s, 'KeyZ'); await pause(300); await keyUp(s, 'KeyZ'); await pause(400);
    const ks = await startsOf(s, s1), kp = peak(await tap(s, n1), 0, 1e9);
    const requested = await ev(s, '__tap.mp3.length') + s.requests.filter(u => /piano\/(manifest\.json|.*\.mp3)/.test(u)).length;
    check('4 simple voice: demo and live key sound with zero buffer-source starts', sounded && kp > SOUND && bufs(st) === 0 && bufs(ks) === 0 && oscNotes(st) > 0 && oscNotes(ks) > 0 && requested === 0,
      { demoPeak: r1(pk * 1000) / 1000, keyPeak: r1(kp * 1000) / 1000, demoBufferStarts: bufs(st), keyBufferStarts: bufs(ks), demoPianoOscillators: oscNotes(st), keyPianoOscillators: oscNotes(ks), pianoRequests: requested });
    await common(s, 'B_errors', out);
  }

  // ---- C: grand, mp3 fetches delayed 4 s: check 5
  {
    const DELAY = 4000;
    const s = await open({ keys: false, piano: 'grand' }, DELAY); sessions.push(s);
    await openAbout(s);
    const s0 = await ev(s, '__tap.starts.length'), n0 = await count(s);
    await click(s, '#piece-listen'); // first gesture: starts loading and the demo together
    const sounded = await waitSound(s, 8000);
    const status = await ev(s, "document.getElementById('piece-piano-status').textContent"), tStart = Date.now();
    const early = await startsOf(s, s0), arrived0 = await ev(s, '__tap.mp3done.length');
    // Hold the demo past the arrival and decoding of every recording.
    await s.until("__tap.mp3.length > 0 && __tap.mp3done.length === __tap.mp3.length && document.getElementById('piece-piano-status').textContent === '' && __pieceDev.audio.sampler.ready(...__pieceDev.audio.pianoRange)", 60000);
    await pause(3000);
    const running = await stopRunning(s), late = await startsOf(s, s0);
    const peakDemo = peak(await tap(s, n0), 0, 1e9);
    await keyDown(s, 'Escape'); await keyUp(s, 'Escape'); await pause(600);
    // Afterwards the loaded grand piano is used by a new demo.
    const s2 = await ev(s, '__tap.starts.length'); await click(s, '#piece-listen'); await waitSound(s); await pause(500);
    const next = await startsOf(s, s2);
    check('5 while samples load the demo uses the simple voice, status shows loading, and the take keeps it', sounded && status === 'Loading piano…' && oscNotes(early) > 0 && bufs(early) === 0 && running && bufs(late) === 0 && oscNotes(late) > 0 && peakDemo > SOUND,
      { delayMs: DELAY, statusWhileLoading: status, mp3DoneAtSound: arrived0, demoStillRunningAfterArrival: running, pianoOscillatorsEarly: oscNotes(early), bufferStartsEarly: bufs(early), bufferStartsThroughArrival: bufs(late), pianoOscillatorsTotal: oscNotes(late), nextDemoBufferStarts: bufs(next), nextDemoPianoOscillators: oscNotes(next) });
    check('5b a demo started after loading finished uses the sampler', bufs(next) > 0 && oscNotes(next) === 0, { bufferStarts: bufs(next), pianoOscillators: oscNotes(next) });
    await common(s, 'C_errors', out);
  }

  for (const k of ['A_errors', 'B_errors', 'C_errors']) {
    const e = out[k];
    check(`no console errors / failed resources / cross-origin requests (${k[0]})`, !e.errors.length && !e.resourceErrors.length && !e.crossOrigin.length && e.contexts === 1, e);
  }
  failed = checks.some(c => !c.ok);
} catch (error) {
  failed = true; out.exception = String(error?.stack ?? error).slice(0, 1500);
} finally {
  for (const s of sessions) { try { await s.close(); } catch { /* gone */ } }
  server.kill();
}
console.log(JSON.stringify({ ok: !failed, checks, ...out }));
process.exit(failed ? 1 : 0);
