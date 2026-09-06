// Optional real Chrome smoke check; no browser test dependency or backend needed.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:5173';
const modelFailure = process.env.SMOKE_MODEL_FAILURE === '1';
const directory = await mkdtemp(path.join(tmpdir(), 'guitar-chrome-'));
const wav = path.join(directory, 'guitar.wav');
const rate = 48000, seconds = 4, pcm = Buffer.alloc(rate * seconds * 2);
for (let i = 0; i < rate * seconds; i++) {
  const t = i / rate, age = t % 1;
  const envelope = Math.min(1, age / 0.004) * Math.exp(-age * 5);
  const sample = envelope * (Math.sin(2 * Math.PI * 110 * t) + 0.35 * Math.sin(2 * Math.PI * 220 * t) + 0.12 * Math.sin(2 * Math.PI * 330 * t));
  pcm.writeInt16LE(Math.round(sample * 14000), i * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
await writeFile(wav, Buffer.concat([header, pcm]));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  `--user-data-dir=${directory}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader', '--window-size=1280,1000', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i=0; i<100; i++) {
    try { port = (await readFile(path.join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await pause(100); }
  }
  assert.ok(port, 'Chrome DevTools did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), errors = [], requests = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) { const callback = pending.get(message.id); pending.delete(message.id); callback?.(message); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Fetch.requestPaused') void send('Fetch.fulfillRequest', {requestId:message.params.requestId,responseCode:404,body:Buffer.from('Deliberately missing model for fallback check').toString('base64')});
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id;
    pending.set(request, message => message.error ? reject(message.error) : resolve(message.result));
    socket.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async (expression, milliseconds = 30000) => {
    const end = Date.now() + milliseconds;
    while (Date.now() < end) { const result = await evaluate(expression); if (result) return result; await pause(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  if (modelFailure) await send('Fetch.enable', {patterns:[{urlPattern:'*/models/crepe-tiny/model.json'}]});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__smoke = { notes: [], contexts: [], constraints: [] };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__smoke.contexts.push(this); }
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function(time) {
      window.__smoke.notes.push({ time, now:this.context.currentTime, hz:this.frequency.value, type:this.type });
      return start.call(this,time);
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(constraints) { window.__smoke.constraints.push(constraints); return getUserMedia(constraints); };
  ` });
  await send('Page.navigate', { url: origin });
  await until(`document.getElementById('model')?.textContent === '${modelFailure ? 'FALLBACK: YIN' : 'CREPE ready (tiny)'}'`, 60000);
  await evaluate("document.getElementById('enable').click()");
  await until("document.getElementById('mic')?.textContent.includes('Mic listening')");
  await until("document.getElementById('note')?.textContent.startsWith('A2')", 30000);
  for (let i=0; i<4; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'Space', key: ' ' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'Space', key: ' ' });
    if (i<3) await pause(500);
  }
  await until("Number(document.getElementById('bpm')?.textContent) > 0");
  await until("parseInt(document.getElementById('onsets')?.textContent) >= 6");
  await evaluate("document.getElementById('lock').click()");
  await until("document.getElementById('lock')?.textContent.startsWith('Unlock')");
  await evaluate("document.getElementById('density').click()");
  await until("window.__smoke.notes.some(note => note.type === 'triangle')", 15000);
  const bpmBefore = await evaluate("document.getElementById('bpm').textContent");
  for (const role of [1,2,3,0]) {
    await evaluate(`document.querySelector('[data-role="${role}"]').click()`);
    await until(`document.querySelector('[data-role="${role}"]').getAttribute('aria-pressed') === 'true'`);
    if (role === 1) await until("window.__smoke.notes.some(note => note.type === 'sine' && note.hz < 170)", 10000);
  }
  await evaluate("document.getElementById('output').click()");
  await until("document.getElementById('mic')?.textContent.includes('headphones')");
  assert.equal(await evaluate("document.getElementById('bpm').textContent"), bpmBefore, 'Output/role switch reset the clock');
  const graph = await evaluate("({constraints:window.__smoke.constraints,contexts:window.__smoke.contexts.length,notes:window.__smoke.notes.length,late:window.__smoke.notes.filter(note=>note.time<note.now-0.001).length})");
  assert.equal(graph.contexts,1); assert.equal(graph.constraints[0].audio.echoCancellation,true);
  assert.equal(graph.constraints.at(-1).audio.echoCancellation,false); assert.equal(graph.late,0);
  await evaluate("document.getElementById('threshold').value='0.62'; document.getElementById('threshold').dispatchEvent(new Event('input'))");
  const saved = await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1'))");
  assert.equal(saved.voicedThreshold,0.62); assert.equal(saved.outputMode,'headphones');
  assert.equal(saved.density,'busy'); assert.equal(saved.crepeCapacity,'tiny'); assert.ok(!('bpm' in saved)); assert.ok(!('locked' in saved));
  await send('Input.dispatchKeyEvent', {type:'keyDown',code:'Escape',key:'Escape'});
  await until("document.getElementById('hint')?.textContent.includes('Output silenced')");
  assert.equal(await evaluate("document.getElementById('bpm').textContent"),bpmBefore,'Panic reset the clock');
  const state = await evaluate("({model:document.getElementById('model').textContent,mic:document.getElementById('mic').textContent,note:document.getElementById('note').textContent,pitch:document.getElementById('pitch-detail').textContent,onsets:document.getElementById('onsets').textContent,bpm:document.getElementById('bpm').textContent})");
  assert.ok(Number(state.bpm) >= 110 && Number(state.bpm) <= 125, JSON.stringify(state));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(requests.some(url => url === `${origin}/models/crepe-tiny/model.json`));
  assert.ok(requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith(origin)), 'Unexpected nonlocal runtime request');
  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.SMOKE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  await send('Page.reload');
  await until("document.getElementById('threshold')?.value === '0.62'");
  assert.equal(await evaluate("document.getElementById('bpm').textContent"),'—','BPM was incorrectly persisted');
  console.log(JSON.stringify({ ...state, ...graph, persisted:saved, localModelRequests: requests.filter(url => url.includes('/models/')).length, browserErrors: errors.length }, null, 2));
  await send('Browser.close');
} finally { socket?.close(); chrome.kill(); }
