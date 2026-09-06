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
const rate = 48000, seconds = 6, pcm = Buffer.alloc(rate * seconds * 2);
for (let i = 0; i < rate * seconds; i++) {
  // Let fake-microphone startup/AEC settle before the first deliberate pluck.
  const t = i / rate - 1;
  if (t < 0) continue;
  const age = t % 3;
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
    const state = await evaluate("({hint:document.getElementById('hint')?.textContent,queue:document.getElementById('queue')?.textContent,memory:document.getElementById('memory-status')?.textContent,notes:window.__smoke?.notes,attacks:window.__smoke?.attacks})");
    throw new Error(`Timed out: ${expression}\n${JSON.stringify({state,errors})}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  if (modelFailure) await send('Fetch.enable', {patterns:[{urlPattern:'*/models/crepe-tiny/model.json'}]});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__smoke = { notes: [], contexts: [], constraints: [], attacks: [] };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__smoke.contexts.push(this); }
    };
    const NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(...args) {
        super(...args);
        this.port.addEventListener('message', event => { if (event.data.type === 'attack') window.__smoke.attacks.push(event.data.t); });
      }
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
  await evaluate("document.getElementById('bpm').value='120'; document.getElementById('bpm').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#scale, #lock, #roles, #density').length"),0,'Old setup controls remain');
  await evaluate("document.getElementById('enable').click()");
  await until("document.getElementById('mic')?.textContent.includes('Mic listening')");
  await until("document.getElementById('note')?.textContent.startsWith('A2')", 30000);
  await until("window.__smoke.notes.some(note => note.type === 'triangle')",5000);
  const timing = await evaluate(`(() => {
    const echo=window.__smoke.notes.find(note=>note.type==='triangle');
    const audio=window.__smoke.contexts[0];
    const delay=audio.outputLatency || audio.baseLatency || 0;
    return {hz:echo.hz,echoAt:echo.time+delay,attacks:window.__smoke.attacks,delay,heard:document.getElementById('note').textContent};
  })()`);
  assert.ok(Math.abs(timing.hz-110)<3.3,JSON.stringify(timing));
  const heardCents = timing.heard.match(/([+−])(\d+)¢/);
  assert.ok(heardCents,JSON.stringify(timing));
  assert.ok(Math.abs(Math.round(1200*Math.log2(timing.hz/110))-Number(heardCents[2])*(heardCents[1]==='−'?-1:1))<=1,'Repeat changed the detected pitch');
  assert.ok(timing.attacks.some(t=>Math.abs(timing.echoAt-t-1)<0.025),`Repeat is not two beats after the original attack: ${JSON.stringify(timing)}`);
  assert.ok(timing.echoAt-timing.attacks[0]<1.15,`First attack was not immediately queued: ${JSON.stringify(timing)}`);
  const bpmBefore = await evaluate("document.getElementById('bpm').value");
  await evaluate("document.getElementById('output').click()");
  await until("document.getElementById('mic')?.textContent.includes('headphones')");
  assert.equal(await evaluate("document.getElementById('bpm').value"), bpmBefore, 'Output switch reset the clock');
  const graph = await evaluate("({constraints:window.__smoke.constraints,contexts:window.__smoke.contexts.length,notes:window.__smoke.notes.length,late:window.__smoke.notes.filter(note=>note.time<note.now-0.001).length})");
  assert.equal(graph.contexts,1); assert.equal(graph.constraints[0].audio.echoCancellation,true);
  assert.equal(graph.constraints.at(-1).audio.echoCancellation,false); assert.equal(graph.late,0);
  assert.equal(await evaluate("document.querySelector('[data-memory-bars=\"2\"]').getAttribute('aria-pressed')"),'true');
  await evaluate("document.querySelector('[data-memory-bars=\"1\"]').click()");
  await until("!document.getElementById('remember').disabled",10000);
  const loopEventStart = await evaluate("window.__smoke.notes.length");
  await evaluate("document.getElementById('remember').click()");
  await until("document.getElementById('remember').textContent.startsWith('Clear')");
  await until("document.getElementById('memory-status').textContent.startsWith('Looping')",5000);
  await pause(4300);
  const loopNotes = await evaluate(`window.__smoke.notes.slice(${loopEventStart}).filter(note=>note.type==='triangle')`);
  assert.ok(loopNotes.length>=2,`No repeating phrase: ${JSON.stringify(loopNotes)}`);
  const firstCycle = loopNotes.filter(note=>note.time<loopNotes[0].time+1.98);
  for (const note of firstCycle) assert.ok(loopNotes.some(next=>Math.abs(next.time-note.time-2)<0.02 && Math.abs(next.hz-note.hz)<0.01),'Frozen phrase did not repeat at its original pitch/rhythm');
  for (const note of loopNotes) assert.ok(firstCycle.some(first=>Math.abs(note.hz-first.hz)<0.01 && Math.abs((note.time-first.time)/2-Math.round((note.time-first.time)/2))<0.01),'Live playing overdubbed the frozen phrase');
  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', {format:'png'});
    await writeFile(process.env.SMOKE_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  await evaluate("document.getElementById('companion-mute').click()");
  const mutedCount = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length");
  await pause(500);
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),mutedCount,'Loop continued scheduling while muted');
  assert.ok(await evaluate("document.getElementById('remember').textContent.startsWith('Clear')"),'Mute lost the phrase');
  await evaluate("document.getElementById('companion-mute').click()");
  await until(`window.__smoke.notes.filter(note=>note.type==='triangle').length>${mutedCount}`,4000);
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyL',key:'l'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyL',key:'l'});
  await until("document.getElementById('remember').textContent.startsWith('Remember')");
  assert.equal(await evaluate("document.getElementById('repeat-label').textContent"),'REPEAT');
  const afterClear = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length");
  await until(`window.__smoke.notes.filter(note=>note.type==='triangle').length>${afterClear}`,6000);
  await evaluate("document.querySelector('[data-memory-bars=\"4\"]').click()");
  await evaluate("document.getElementById('threshold').value='0.62'; document.getElementById('threshold').dispatchEvent(new Event('input'))");
  const saved = await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1'))");
  assert.equal(saved.voicedThreshold,0.62); assert.equal(saved.outputMode,'headphones');
  assert.equal(saved.bpm,120); assert.equal(saved.crepeCapacity,'tiny'); assert.ok(!('role' in saved)); assert.ok(!('locked' in saved));
  assert.equal(saved.memoryBars,4); assert.ok(!('phrase' in saved));
  await send('Input.dispatchKeyEvent', {type:'keyDown',code:'Escape',key:'Escape'});
  await until("document.getElementById('hint')?.textContent.includes('Output silenced')");
  assert.equal(await evaluate("document.getElementById('bpm').value"),bpmBefore,'Panic reset the clock');
  const echoedBeforePanic = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length");
  await pause(1300);
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),echoedBeforePanic,'An echo survived panic');
  const state = await evaluate("({model:document.getElementById('model').textContent,mic:document.getElementById('mic').textContent,note:document.getElementById('note').textContent,bpm:document.getElementById('bpm').value})");
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.ok(requests.some(url => url === `${origin}/models/crepe-tiny/model.json`));
  assert.ok(requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith(origin)), 'Unexpected nonlocal runtime request');
  await send('Page.reload');
  await until("document.getElementById('threshold')?.value === '0.62'");
  assert.equal(await evaluate("document.getElementById('bpm').value"),'120','Entered BPM was not restored');
  assert.equal(await evaluate("document.querySelector('[data-memory-bars=\"4\"]').getAttribute('aria-pressed')"),'true');
  assert.ok(await evaluate("document.getElementById('remember').textContent.startsWith('Remember')"),'A phrase persisted across reload');
  console.log(JSON.stringify({ ...state, ...graph, timing, loopNotes, persisted:saved, localModelRequests: requests.filter(url => url.includes('/models/')).length, browserErrors: errors.length }, null, 2));
  await send('Browser.close');
} finally { socket?.close(); chrome.kill(); }
