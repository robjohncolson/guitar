// Headless-Chrome check of the sampled piano on the Pieces page. Starts and stops its own Vite dev server (port 5201).
// Offline renders (sampler vs simple voice): onset timing, listener verdicts, level, peak. Then the real page at 390 px.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromeSession, pause } from './chrome-session.mjs';
import { readFileSync } from 'node:fs';
const GAIN_CONSTANT = Number(/GAIN_CONSTANT = ([0-9.]+)/.exec(readFileSync(new URL('../src/piece/sampler.ts', import.meta.url), 'utf8'))[1]);
const root = fileURLToPath(new URL('..', import.meta.url)), PORT = 5201, origin = `http://127.0.0.1:${PORT}`;
const failures = [], check = (ok, message) => { if (!ok) failures.push(message); };
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: 'ignore', windowsHide: true });
const hooks = `
  window.__errs = []; window.__contexts = [];
  const Real = window.AudioContext; window.AudioContext = class extends Real { constructor(...a) { super(...a); __contexts.push(this); } };
  const ce = console.error.bind(console); console.error = (...a) => { __errs.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
  addEventListener('error', e => __errs.push('error: ' + e.message)); addEventListener('unhandledrejection', e => __errs.push('rejection: ' + e.reason));`;
const resourceErrors = "performance.getEntriesByType('resource').filter(r => r.responseStatus >= 400).map(r => r.responseStatus + ' ' + r.name)";

// Runs inside the page (stringified). Everything numeric is computed here.
async function pageCheck() {
  const [{ PianoSampler }, { PieceVoice }, { pianoOnsets }, { gradePiano }, { fromBars }, { compile }, { planExercise }, raw] = await Promise.all([
    import('/src/piece/sampler.ts'), import('/src/piece/voice.ts'), import('/src/piece/listen.ts'), import('/src/piece/grade.ts'),
    import('/src/piece/exercise.ts'), import('/src/piece/notation.ts'), import('/src/piece/plan.ts'), import('/src/piece/packs/gymnopedie-1.piece.txt?raw')]);
  const score = compile(raw.default).score, intro = fromBars(score, [0, 1, 2, 3], ['L'], 'L:1-4', 'Intro');
  const RATE = 48000, PLAY = 0.6, planned = [];
  for (const e of intro.events) for (const n of e.notes) planned.push({ midi: n.midi, at: PLAY + e.beat, len: Math.min(1.4, n.dur), kind: 'intro' });
  const start = PLAY + intro.beats + 2;
  for (let i = 0, m = 36; m <= 96; i++, m += 4) planned.push({ midi: m, at: start + i * 0.8, len: 0.5, kind: 'scale' });
  const total = Math.max(...planned.map(p => p.at + p.len)) + 1.5, lo = Math.min(...planned.map(p => p.midi)), hi = Math.max(...planned.map(p => p.midi));
  const render = async kind => {
    const ctx = new OfflineAudioContext(1, Math.ceil(total * RATE), RATE), voice = new PieceVoice(ctx), sampler = new PianoSampler(ctx, voice.out);
    if (kind === 'sampler') { await sampler.load(lo - 3, hi + 3); if (!sampler.ready(lo - 3, hi + 3) || sampler.failed) throw new Error('sampler not ready: ' + sampler.message); }
    for (const p of planned) { if (kind === 'sampler') { if (!sampler.play(p.midi, p.at, p.len, 0.7)) throw new Error('sampler refused note'); } else voice.play(p.midi, p.at, p.len, 0.7, 'piano'); }
    return (await ctx.startRendering()).getChannelData(0);
  };
  const stats = errs => { const a = errs.map(Math.abs).sort((x, y) => x - y); return { n: a.length, medianMs: +(1000 * (a[Math.floor(a.length / 2)] ?? NaN)).toFixed(2), maxMs: +(1000 * (a[a.length - 1] ?? NaN)).toFixed(2) }; };
  // Independent detector: 1 ms RMS frames; onset = first frame within -40..+80 ms of plan above baseline + 10% of the rise.
  const envelope = d => { const f = RATE / 1000, n = Math.floor(d.length / f), e = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < f; k++) s += d[i * f + k] ** 2; e[i] = Math.sqrt(s / f); } return e; };
  const simple = (env, t) => {
    const f = Math.round(t * 1000); let base = 0, peak = 0;
    for (let i = f - 60; i <= f - 20; i++) base = Math.max(base, env[i] ?? 0);
    for (let i = f; i <= f + 80; i++) peak = Math.max(peak, env[i] ?? 0);
    if (peak <= base * 1.5 + 1e-5) return undefined;
    const thr = base + 0.1 * (peak - base);
    for (let i = f - 40; i <= f + 80; i++) if ((env[i] ?? 0) > thr) return (i + 0.5) / 1000;
    return undefined;
  };
  const times = [...new Set(planned.map(p => p.at))];
  const out = {};
  for (const kind of ['sampler', 'simple']) {
    const data = await render(kind), env = envelope(data), onsets = pianoOnsets(data, RATE, 0, total);
    const ind = [], app = [], indMiss = [], appMiss = [];
    for (const t of times) {
      const s = simple(env, t); if (s === undefined) indMiss.push(t); else ind.push(s - t);
      const near = onsets.filter(o => Math.abs(o.t - t) < 0.06).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0]; if (!near) appMiss.push(t); else app.push(near.t - t);
    }
    const cut = data.subarray(0, Math.round((PLAY + intro.beats + 1) * RATE));
    const g = gradePiano(intro, 60, { samples: cut, rate: RATE, playAt: PLAY, coverage: 1, clipped: 0, clicks: false }, pianoOnsets(cut, RATE, 0, cut.length / RATE), 0);
    const verdicts = {}; for (const e of g.events) for (const n of e.notes) verdicts[n.verdict] = (verdicts[n.verdict] ?? 0) + 1;
    let sum = 0, peak = 0; for (const v of data) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    out[kind] = { independent: { ...stats(ind), missed: indMiss.length }, pianoOnsets: { ...stats(app), missed: appMiss.length }, verdicts, trusted: g.trusted, marks: g.events.map(e => e.mark).join(','), rms: Math.sqrt(sum / data.length), peak };
  }
  out.rmsDiffDb = +(20 * Math.log10(out.sampler.rms / out.simple.rms)).toFixed(2); out.notes = planned.length; out.range = [lo, hi];
  // Headroom renders at 192 kHz (true peak = sample peak up to the 44.1 kHz source bandwidth; also measured with a 4x windowed-sinc oversampler at 48 kHz).
  const HR = 192000;
  const renderNotes = async (kind, notes, volume, seconds, rate) => {
    const ctx = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate), voice = new PieceVoice(ctx), sampler = new PianoSampler(ctx, voice.out);
    voice.out.gain.value = volume;
    if (kind === 'sampler') { const ms = notes.map(n => n.midi); await sampler.load(Math.min(...ms) - 3, Math.max(...ms) + 3); if (!sampler.ready(Math.min(...ms) - 3, Math.max(...ms) + 3) || sampler.failed) throw new Error('sampler not ready: ' + sampler.message); }
    for (const n of notes) { if (kind === 'sampler') { if (!sampler.play(n.midi, n.at, n.len, n.level)) throw new Error('sampler refused note'); } else voice.play(n.midi, n.at, n.len, n.level, 'piano'); }
    return (await ctx.startRendering()).getChannelData(0);
  };
  const peakOf = d => { let p = 0; for (const v of d) p = Math.max(p, Math.abs(v)); return p; };
  const rmsOf = (d, a, b) => { let s = 0; for (let i = a; i < b; i++) s += d[i] ** 2; return Math.sqrt(s / (b - a)); };
  const chord = [36, 48, 55, 64, 72, 84].map(midi => ({ midi, at: 0.2, len: 4, level: 1 }));
  const chordData = await renderNotes('sampler', chord, 1, 6, HR);
  // Densest 4 consecutive bars (both hands), played as the app plays a demo: plan.ts times and levels, default volume 0.5.
  const perBar = score.bars.map((_, b) => score.notes.filter(n => n.bar === b).length);
  let bestBar = 0; for (let b = 0; b + 4 <= perBar.length; b++) if (perBar.slice(b, b + 4).reduce((x, y) => x + y, 0) > perBar.slice(bestBar, bestBar + 4).reduce((x, y) => x + y, 0)) bestBar = b;
  const dense = fromBars(score, [0, 1, 2, 3].map(i => bestBar + i), ['L', 'R'], 'dense', 'Densest bars'), plan = planExercise(dense, 66, 0.2, 'demo');
  const notes = plan.sounds.filter(s => s.kind === 'note').map(s => ({ midi: s.midi, at: s.at, len: s.length, level: s.level ?? 0.7 }));
  const seconds = plan.finish + 6, dSampler = await renderNotes('sampler', notes, 0.5, seconds, HR), dSimple = await renderNotes('simple', notes, 0.5, seconds, HR);
  const a = Math.round(plan.start * HR), b = Math.round(plan.end * HR);
  // 4x oversampled true peak via a 32-tap windowed-sinc interpolator on a 48 kHz render of the same material.
  const truePeak = d => { let p = 0; const T = 8; for (let i = T; i < d.length - T; i++) { p = Math.max(p, Math.abs(d[i])); for (const f of [0.25, 0.5, 0.75]) { let s = 0; for (let k = -T + 1; k <= T; k++) { const x = k - f, w = 0.5 + 0.5 * Math.cos(Math.PI * x / T); s += d[i + k] * (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * w; } p = Math.max(p, Math.abs(s)); } } return p; };
  const chord48 = await renderNotes('sampler', chord, 1, 6, RATE), dense48 = await renderNotes('sampler', notes, 0.5, seconds, RATE);
  out.headroom = { chordPeak192: peakOf(chordData), densePeak192: peakOf(dSampler), chordTruePeak: Math.max(peakOf(chordData), truePeak(chord48)), denseTruePeak: Math.max(peakOf(dSampler), truePeak(dense48)),
    bars: [bestBar + 1, bestBar + 4], notesInBars: notes.length, phraseRmsDiffDb: 20 * Math.log10(rmsOf(dSampler, a, b) / rmsOf(dSimple, a, b)), simplePeak: peakOf(dSimple) };
  return out;
}

const summary = {};
let a, b;
try {
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${origin}/piece.html`)).ok) break; } catch { /* starting */ } await pause(250); }
  // Part 1: offline renders.
  a = await chromeSession();
  await a.send('Page.addScriptToEvaluateOnNewDocument', { source: hooks });
  await a.send('Page.navigate', { url: `${origin}/piece.html` });
  await a.until("document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1'", 60000);
  let r; for (let tries = 0; tries < 3 && !r; tries++) { try { r = await a.evaluate(`(${pageCheck})()`); } catch (error) { if (tries === 2) throw error; await pause(3000); await a.until("document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1'", 60000); } }
  const s = r.sampler;
  summary.offline = { notes: r.notes, range: r.range, sampler: { independent: s.independent, pianoOnsets: s.pianoOnsets, verdicts: s.verdicts, trusted: s.trusted, peak: +s.peak.toFixed(3) }, simple: { independent: r.simple.independent, pianoOnsets: r.simple.pianoOnsets, verdicts: r.simple.verdicts, trusted: r.simple.trusted, peak: +r.simple.peak.toFixed(3) }, rmsDiffDb: r.rmsDiffDb, headroom: r.headroom, gainConstant: GAIN_CONSTANT };
  // Onset timing is asserted with the direct energy detector only; the app's pianoOnsets figures are information.
  check(s.independent.missed === 0, `independent: ${s.independent.missed} onsets not found`); check(s.independent.medianMs <= 5, `independent median ${s.independent.medianMs} ms`); check(s.independent.maxMs <= 15, `independent max ${s.independent.maxMs} ms > 15`);
  check(Object.keys(s.verdicts).every(v => v === 'heard') && s.verdicts.heard > 0, `sampler verdicts ${JSON.stringify(s.verdicts)}`);
  const h = r.headroom; check(h.chordTruePeak < 0.98, `six-note chord true peak ${h.chordTruePeak}`); check(h.denseTruePeak < 0.98, `densest bars true peak ${h.denseTruePeak}`);
  summary.partA = { requestsOffOrigin: a.requests.filter(u => /^https?:/.test(u) && !u.startsWith(origin)), errors: await a.evaluate('__errs'), resourceErrors: await a.evaluate(resourceErrors), audioContexts: await a.evaluate('__contexts.length'), exceptions: a.errors.length };
  check(summary.partA.requestsOffOrigin.length === 0, 'request to another origin (A)'); check(summary.partA.errors.length === 0 && summary.partA.exceptions === 0 && summary.partA.resourceErrors.length === 0, 'console/resource errors (A)');
  check(summary.partA.audioContexts === 0, `page created ${summary.partA.audioContexts} real AudioContext(s) before any click`);
  await a.close(); a = undefined;
  // Part 2: the page at 390 px, settings, then a real demonstration.
  b = await chromeSession();
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: hooks });
  await b.send('Page.navigate', { url: `${origin}/piece.html` });
  const ready = "document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1'";
  await b.until(ready, 60000);
  await b.evaluate("document.getElementById('piece-settings').open = true"); await pause(300);
  const stored = () => b.evaluate("JSON.parse(localStorage.getItem('piece.input.v1') ?? '{}').piano");
  const choose = v => b.evaluate(`{ const s = document.getElementById('piece-piano'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); }`);
  const ui = { scrollWidth: await b.evaluate('document.documentElement.scrollWidth'), innerWidth: await b.evaluate('innerWidth') };
  await choose('simple'); ui.afterSimple = await stored();
  await b.send('Page.reload'); await pause(500); await b.until(ready, 60000); ui.selectAfterReload = await b.evaluate("document.getElementById('piece-piano').value");
  await choose('grand'); ui.afterGrand = await stored();
  await b.send('Page.reload'); await pause(500); await b.until(ready, 60000); ui.selectAfterReload2 = await b.evaluate("document.getElementById('piece-piano').value");
  await b.evaluate("document.getElementById('piece-settings').open = true"); await pause(300);
  ui.scrollWidthAfter = await b.evaluate('document.documentElement.scrollWidth');
  check(ui.scrollWidth <= 390 && ui.scrollWidthAfter <= 390, `scrollWidth ${ui.scrollWidth}/${ui.scrollWidthAfter} > 390`);
  check(ui.afterSimple === 'simple' && ui.selectAfterReload === 'simple' && ui.afterGrand === 'grand' && ui.selectAfterReload2 === 'grand', `piano preference did not persist ${JSON.stringify(ui)}`);
  const isMp3 = u => /\/piano\/[^/]+\.mp3(\?|$)/.test(u);
  const before = b.requests.filter(isMp3).length; ui.mp3BeforeClick = before;
  check(before === 0, `${before} piano mp3 requests before any click`);
  await b.evaluate("document.getElementById('piece-about').open = true"); await pause(200);
  const mark = b.requests.length;
  await b.evaluate("document.getElementById('piece-listen').click()"); await pause(3000);
  ui.mp3AfterClick = b.requests.slice(mark).filter(isMp3).length; ui.contexts = await b.evaluate('__contexts.length'); ui.contextState = await b.evaluate('__contexts[0]?.state');
  ui.pianoStatus = await b.evaluate("document.getElementById('piece-piano-status').textContent"); ui.feedback = await b.evaluate("document.getElementById('piece-feedback')?.textContent");
  check(ui.mp3AfterClick > 0, 'no piano mp3 requested after the demo click'); check(ui.contexts === 1, `${ui.contexts} AudioContexts after demo`);
  ui.requestsOffOrigin = b.requests.filter(u => /^https?:/.test(u) && !u.startsWith(origin)); ui.errors = await b.evaluate('__errs'); ui.resourceErrors = await b.evaluate(resourceErrors); ui.exceptions = b.errors.length;
  check(ui.requestsOffOrigin.length === 0, 'request to another origin (B)'); check(ui.errors.length === 0 && ui.exceptions === 0 && ui.resourceErrors.length === 0, 'console/resource errors (B)');
  summary.ui = ui;
} catch (error) { failures.push(String(error?.stack ?? error)); }
finally { await a?.close().catch(() => {}); await b?.close().catch(() => {}); server.kill(); }
summary.failures = failures; console.log(JSON.stringify(summary));
process.exit(failures.length ? 1 : 0);
