// Real Chrome, native worklets, the analysis worker and (for guitar) actual CREPE. Input is recorded piano and guitar notes
// scheduled where an exactly timed player would sound them; the expected scores here are written independently of the app.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromeSession, pause } from './chrome-session.mjs';
const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4173';
const piano = JSON.parse(await readFile(new URL('../tests/fixtures/piano-notes.json', import.meta.url), 'utf8'));
const pianoWav = (await readFile(new URL('../tests/fixtures/piano-notes.wav', import.meta.url))).toString('base64');
const guitar = JSON.parse(await readFile(new URL('../tests/fixtures/guitar-plucks.json', import.meta.url), 'utf8'));
const guitarWav = (await readFile(new URL('../tests/fixtures/guitar-plucks.wav', import.meta.url))).toString('base64');
await mkdir(new URL('../smoke-artifacts/', import.meta.url), { recursive: true });
const browser = await chromeSession(), { send, evaluate, until } = browser, results = [];
try {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__piece = { contexts: [], records: [], tracks: [], errors: [], calibration: false, delay: 0.12, scenario: 'clean', score: [] };
    const Context = AudioContext, Worklet = AudioWorkletNode, connect = AudioNode.prototype.connect;
    window.AudioContext = class extends Context { constructor(...a) { super(...a); __piece.contexts.push(this); } };
    const decode = (b64, rate, each, list) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), view = new DataView(bytes.buffer); return { rate, each, list, sample: (n, i) => view.getInt16(44 + 2 * (n * each + i), true) / 32768 }; };
    const pianoData = decode(${JSON.stringify(pianoWav)}, ${piano.rate}, ${Math.round(piano.rate * piano.secondsPerNote)}, ${JSON.stringify(piano.midis)});
    const guitarData = decode(${JSON.stringify(guitarWav)}, ${guitar.rate}, ${Math.round(guitar.rate * guitar.secondsPerPluck)}, ${JSON.stringify(guitar.midis)});
    navigator.mediaDevices.getUserMedia = async () => {
      const context = __piece.contexts[0], destination = context.createMediaStreamDestination();
      __piece.mic = destination; __piece.tracks.push(...destination.stream.getTracks());
      destination.stream.getAudioTracks().forEach(track => { const s = track.getSettings.bind(track); track.getSettings = () => ({ ...s(), deviceId: 'recorded-test-input' }); });
      return destination.stream;
    };
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination === this.context.destination && __piece.calibration && __piece.mic) { const d = this.context.createDelay(); d.delayTime.value = __piece.delay; connect.call(this, d); connect.call(d, __piece.mic); }
      return result;
    };
    __piece.play = (data, midi, at, length, noise) => {
      const context = __piece.contexts[0], base = data.list.includes(midi) ? midi : data.list.reduce((a, b) => Math.abs(a - midi) < Math.abs(b - midi) ? a : b), n = data.list.indexOf(base);
      const buffer = context.createBuffer(1, data.each, data.rate), out = buffer.getChannelData(0); let seed = 5;
      for (let i = 0; i < data.each; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; out[i] = noise ? ((seed >>> 0) / 4294967296 - 0.5) * 0.4 * Math.exp(-i / (data.rate * 0.03)) : data.sample(n, i); }
      const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer; source.playbackRate.value = noise ? 1 : 2 ** ((midi - base) / 12);
      gain.gain.setValueAtTime(1, at); gain.gain.setValueAtTime(1, at + length); gain.gain.linearRampToValueAtTime(0, at + length + 0.08);
      source.connect(gain).connect(__piece.mic); source.start(at); source.stop(at + length + 0.1);
    };
    __piece.feed = command => {
      if (__piece.calibration || __piece.scenario === 'silence') return;
      const context = __piece.contexts[0], playAt = command.startFrame / context.sampleRate + 0.5, offset = __piece.delay - (context.outputLatency || context.baseLatency || 0);
      for (const [beat, midis, length, kind] of __piece.score) for (const midi of midis) {
        const sounding = __piece.scenario === 'wrong' && beat === 10 && midi === 61 ? 60 : midi;
        __piece.play(kind === 'guitar' || kind === 'strum' ? guitarData : pianoData, sounding, playAt + beat * __piece.period + offset + (kind === 'piano' ? (midi % 3) * 0.006 : 0), length * __piece.period, kind === 'strum');
      }
    };
    window.AudioWorkletNode = class extends Worklet {
      constructor(context, name, ...args) {
        super(context, name, ...args); this.addEventListener('processorerror', () => __piece.errors.push(name));
        if (name === 'guitar-looper') { const post = this.port.postMessage.bind(this.port); this.port.postMessage = message => { if (message.type === 'record') { __piece.records.push(message); __piece.feed(message); } post(message); }; }
      }
    };
  ` });
  await send('Page.navigate', { url: `${origin}/piece.html` });
  await until("document.getElementById('piece-title')?.textContent === 'Gymnopédie No. 1'", 30000);
  const counts = await evaluate("({ units: document.querySelectorAll('#course-list [data-unit]').length, today: document.querySelectorAll('#today-list [data-unit]').length })");
  assert.ok(counts.units > 80, `course has ${counts.units} units`); assert.ok(counts.today >= 3);
  await evaluate("document.getElementById('piece-settings').open = true; __piece.calibration = true; document.getElementById('piece-calibrate').click()");
  await until("document.getElementById('piece-calibration-feedback').textContent.startsWith('Timing measured')", 20000);
  await evaluate("__piece.calibration = false");
  const stored = await evaluate("JSON.parse(localStorage.getItem('piece.trainer.v1'))");
  assert.equal(stored.calibrated, true); console.log(JSON.stringify({ phase: 'calibrated', offset: stored.offset }));
  // Independent score of bars 1-4, left hand: [beat, midis, beats held].
  const intro = [[0, [43], 3], [1, [59, 62, 66], 2], [3, [38], 3], [4, [57, 61, 66], 2], [6, [43], 3], [7, [59, 62, 66], 2], [9, [38], 3], [10, [57, 61, 66], 2]].map(x => [...x, 'piano']);
  const take = async (scenario, setup) => {
    const before = await evaluate("document.getElementById('piece-trace').href");
    await evaluate(`__piece.scenario = ${JSON.stringify(scenario)}; ${setup ?? ''}; document.getElementById('piece-start').click()`);
    await until(`document.getElementById('piece-trace').href.startsWith('blob:') && document.getElementById('piece-trace').href !== ${JSON.stringify(before)}`, 120000);
    const trace = await evaluate("fetch(document.getElementById('piece-trace').href).then(r => r.json())");
    assert.equal(await evaluate("__piece.tracks.every(t => t.readyState === 'ended')"), true, 'Mic stayed open after a take');
    results.push({ scenario, ...trace }); return trace;
  };
  // An answer starts the next take by itself, and Start will not drop an unanswered take: stop the automatic take so each scenario starts its own.
  const halt = async () => { await until("!document.getElementById('piece-stop').disabled"); await evaluate("document.getElementById('piece-stop').click()"); await until("document.getElementById('piece-stop').disabled && !document.getElementById('piece-start').disabled"); };
  const answer = async id => { await evaluate(`document.getElementById('${id}').click()`); await halt(); };
  const select = async (id, bpm) => {
    await evaluate(`document.querySelector('[data-unit="${id}"]').click()`);
    if (bpm) await evaluate(`{ const b = document.getElementById('piece-bpm'); b.value = '${bpm}'; b.dispatchEvent(new Event('input')); }`);
    // Hear it once (then stop) so the next take starts with the count-in, not a demonstration.
    await evaluate("document.getElementById('piece-demo').click()"); await pause(400); await evaluate("document.getElementById('piece-stop').click()");
    await until("!document.getElementById('piece-start').disabled");
  };
  await select('L:1-4', 66);
  await evaluate(`__piece.score = ${JSON.stringify(intro)}; __piece.period = 60 / 66`);
  const clean = await take('clean');
  const verdicts = clean.result.events.flatMap(e => e.notes.map(n => n.verdict));
  console.log(JSON.stringify({ phase: 'clean piano take', timing: clean.result.timing, pitch: clean.result.pitch, trusted: clean.result.trusted, marks: clean.result.events.map(e => e.mark), verdicts, tuning: clean.result.tuning }));
  assert.equal(clean.result.trusted, true); assert.equal(clean.result.timing, 1);
  assert.equal(verdicts.filter(v => v === 'wrong' || v === 'not-heard').length, 0, 'A played note was accused');
  assert.ok(verdicts.filter(v => v === 'heard').length >= 10);
  await evaluate("document.getElementById('piece-comfortable').click()");
  await until("/Free tempo/.test(document.getElementById('piece-feedback').textContent)");
  await halt();
  const wrong = await take('wrong');
  const target = wrong.result.events.find(e => e.beat === 10).notes.find(n => n.midi === 61);
  await pause(150);
  console.log(JSON.stringify({ phase: 'wrong chord tone', verdict: target.verdict, heardAs: target.heardAs, feedback: await evaluate("document.getElementById('piece-feedback').textContent") }));
  assert.notEqual(target.verdict, 'heard', 'A wrong note was confirmed');
  await answer('piece-struggling');
  const silent = await take('silence');
  console.log(JSON.stringify({ phase: 'silence', marks: silent.result.events.map(e => e.mark), score: silent.result.score }));
  assert.ok(silent.result.events.every(e => e.mark === 'missed')); assert.equal(silent.result.score, 0);
  await answer('piece-struggling');
  // At the tempo step itself (50% of 66 = 33 BPM) a clean, comfortable take counts toward the ladder.
  await evaluate(`{ const b = document.getElementById('piece-bpm'); b.value = '33'; b.dispatchEvent(new Event('input')); __piece.period = 60 / 33; }`);
  const step = await take('clean');
  assert.equal(step.bpm, 33); assert.equal(step.result.timing, 1);
  await evaluate("document.getElementById('piece-comfortable').click()");
  await until("JSON.parse(localStorage.getItem('piece.trainer.v1')).units['gymnopedie-1|L:1-4']?.attempts === 1");
  await pause(100);
  const p1 = await evaluate("JSON.parse(localStorage.getItem('piece.trainer.v1')).units['gymnopedie-1|L:1-4']");
  console.log(JSON.stringify({ phase: 'ladder', progress: p1, feedback: await evaluate("document.getElementById('piece-feedback').textContent") }));
  await halt();
  assert.equal(p1.attempts, 1); assert.equal(p1.best, 0.5);
  await browser.screenshot('smoke-artifacts/piece-piano.png');
  // Guitar: a muted strum pattern graded by timing only, then a shape with each string's pitch checked by real CREPE.
  await evaluate("document.getElementById('inst-guitar').click()");
  await until("document.getElementById('inst-guitar').getAttribute('aria-pressed') === 'true'");
  await select('g-pattern:muted', 66);
  const strums = Array.from({ length: 12 }, (_, i) => [i, [55], 0.15, 'strum']);
  await evaluate(`__piece.score = ${JSON.stringify(strums)}; __piece.period = 60 / 66`);
  const muted = await take('clean');
  console.log(JSON.stringify({ phase: 'guitar strums', timing: muted.result.timing, marks: muted.result.events.map(e => e.mark), trusted: muted.result.trusted }));
  assert.equal(muted.result.trusted, true); assert.ok(muted.result.timing >= 0.9);
  await select('g-shape:Em', 60);
  const em = [[0, [40], 0.7, 'guitar'], [1, [47], 0.7, 'guitar'], [2, [52], 0.7, 'guitar'], [3, [55], 0.7, 'guitar'], [4, [59], 0.7, 'guitar'], [5, [64], 0.7, 'guitar'], [7, [64], 1.5, 'strum']];
  await evaluate(`__piece.score = ${JSON.stringify(em)}; __piece.period = 1`);
  const shape = await take('clean');
  const plucks = shape.result.events.flatMap(e => e.notes).filter(n => n.verdict !== 'unchecked');
  console.log(JSON.stringify({ phase: 'guitar shape with CREPE', model: await evaluate("document.getElementById('piece-model').textContent"), plucks: plucks.map(n => [n.midi, n.verdict, n.heardAs ?? '']), timing: shape.result.timing, trusted: shape.result.trusted }));
  assert.ok(plucks.filter(n => n.verdict === 'heard').length >= 4, 'CREPE heard too few of the shape strings');
  assert.equal(plucks.filter(n => n.verdict === 'wrong').length, 0);
  await browser.screenshot('smoke-artifacts/piece-guitar.png');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  for (const panel of ['piece-today', 'piece-course', 'piece-about', 'piece-settings', 'piece-add', 'piece-journal']) await evaluate(`document.getElementById('${panel}').open = true`);
  await pause(300);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Mobile overflow');
  await browser.screenshot('smoke-artifacts/piece-mobile.png');
  assert.equal(await evaluate('__piece.contexts.length'), 1); assert.deepEqual(await evaluate('__piece.errors'), []); assert.deepEqual(browser.errors, []);
  assert.ok(browser.requests.filter(u => /^https?:/.test(u)).every(u => u.startsWith(origin)), 'External runtime request');
  await writeFile('smoke-artifacts/piece-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ phase: 'complete', takes: results.length, errors: browser.errors.length }));
} catch (error) {
  await browser.screenshot('smoke-artifacts/piece-failed.png').catch(() => {});
  await writeFile('smoke-artifacts/piece-failed.json', JSON.stringify({ error: String(error), results }, null, 2));
  throw error;
} finally { await browser.close(); }
