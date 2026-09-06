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
const rate = 48000, seconds = 16, pcm = Buffer.alloc(rate * seconds * 2);
for (let i = 0; i < rate * seconds; i++) {
  // Let fake-microphone startup/AEC settle before the first deliberate pluck.
  const t = i / rate - 1;
  if (t < 0) continue;
  const phase = t%2, index = Math.floor(phase/0.5), age = phase%0.5;
  if (index === 3 || age > 0.22) continue;
  const hz = [220,261.625565,329.627557][index];
  const envelope = Math.min(1,age/0.004)*Math.exp(-age*5)*Math.max(0,Math.min(1,(0.22-age)/0.01));
  const sample = envelope*(Math.sin(2*Math.PI*hz*t)+0.35*Math.sin(4*Math.PI*hz*t)+0.12*Math.sin(6*Math.PI*hz*t));
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
    const state = await evaluate("({hint:document.getElementById('hint')?.textContent,phrase:document.getElementById('phrase-status')?.textContent,harmony:document.getElementById('harmony')?.textContent,heard:document.getElementById('note')?.textContent,notes:window.__smoke?.notes,attacks:window.__smoke?.attacks})");
    throw new Error(`Timed out: ${expression}\n${JSON.stringify({state,errors})}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  if (modelFailure) await send('Fetch.enable', {patterns:[{urlPattern:'*/models/crepe-tiny/model.json'}]});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__smoke = { notes: [], contexts: [], constraints: [], attacks: [], ramps: [], responseTargets: [], responseSamples: [], tracks: [] };
    setInterval(() => {
      if (window.__smoke.responseParam) window.__smoke.responseSamples.push(window.__smoke.responseParam.value);
    },25);
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
    const ramp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function(value,time) {
      if (value>0 && value<0.7) window.__smoke.ramps.push({value,time});
      return ramp.call(this,value,time);
    };
    const target = AudioParam.prototype.setTargetAtTime;
    AudioParam.prototype.setTargetAtTime = function(value,time,constant) {
      window.__smoke.responseTargets.push({value,time}); window.__smoke.responseParam = this;
      return target.call(this,value,time,constant);
    };
    const start = OscillatorNode.prototype.start, stop = OscillatorNode.prototype.stop, events = new WeakMap();
    OscillatorNode.prototype.start = function(time) {
      const peak = window.__smoke.ramps.findLast(ramp => ramp.time>=time && ramp.time<=time+0.19)?.value;
      const event = { time, now:this.context.currentTime, hz:this.frequency.value, type:this.type, peak };
      window.__smoke.notes.push(event); events.set(this,event);
      return start.call(this,time);
    };
    OscillatorNode.prototype.stop = function(time) {
      const event = events.get(this); if (event && event.end === undefined) event.end = time;
      return stop.call(this,time);
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function(constraints) {
      window.__smoke.constraints.push(constraints);
      const stream = await getUserMedia(constraints); window.__smoke.tracks.push(...stream.getAudioTracks()); return stream;
    };
  ` });
  await send('Page.navigate', {url:origin});
  const modelState = modelFailure ? 'FALLBACK: YIN' : 'CREPE ready (tiny)';
  await until(`document.getElementById('model')?.textContent === '${modelState}'`,60000);
  await evaluate("document.getElementById('bpm').value='120'; document.getElementById('bpm').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('#remember, #delay-value, [data-memory-bars], #roles').length"),0);
  assert.equal(await evaluate("document.getElementById('click-mute').getAttribute('aria-pressed')"),'true');
  await evaluate("document.getElementById('enable').click()");
  await until("document.getElementById('mic').textContent.includes('Mic listening')");
  await until("document.querySelectorAll('.pass.heard').length === 2",15000);
  assert.equal(await evaluate('window.__smoke.notes.length'),0,'Sound started before three matching phrases');
  await until("document.getElementById('harmony').textContent === 'Am'",15000);
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>=3",5000);
  const first = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').slice(0,3)");
  const input = await evaluate('({firstAttack:window.__smoke.attacks[0],delay:window.__smoke.contexts[0].outputLatency || window.__smoke.contexts[0].baseLatency || 0})');
  assert.ok(first[0].time+input.delay>=input.firstAttack+5,'The third phrase was not complete');
  assert.ok(first.every(note=>Math.abs(note.time-first[0].time)<0.001 && note.time>=note.now),'Chord voices were late or staggered');
  assert.deepEqual(first.map(note=>(Math.round(69+12*Math.log2(note.hz/440))%12)).sort((a,b)=>a-b),[0,4,9]);
  assert.ok(first.every(note=>note.peak<0.2 && note.end-note.time>1.8),'Chord should have a quiet, sustained envelope');
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>=6",5000);
  const second = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').slice(3,6)");
  second.forEach((note,i)=>{ assert.ok(Math.abs(note.time-first[i].time-2)<0.01); assert.equal(note.hz,first[i].hz); });
  await evaluate("document.getElementById('output').click()");
  await until("document.getElementById('mic').textContent.includes('headphones')");
  assert.equal(await evaluate("document.getElementById('harmony').textContent"),'Am');
  const graph = await evaluate('({contexts:window.__smoke.contexts.length,constraints:window.__smoke.constraints,late:window.__smoke.notes.filter(note=>note.time<note.now-0.001).length})');
  assert.equal(graph.contexts,1); assert.equal(graph.late,0);
  assert.equal(graph.constraints[0].audio.echoCancellation,true); assert.equal(graph.constraints.at(-1).audio.echoCancellation,false);
  await evaluate("document.getElementById('click-mute').click()");
  await until("window.__smoke.notes.some(note=>note.type==='sine' && note.hz===1300)",3000);
  const downbeat = await evaluate("window.__smoke.notes.find(note=>note.type==='sine' && note.hz===1300).time");
  assert.ok(Math.abs((downbeat-first[0].time)/2-Math.round((downbeat-first[0].time)/2))<0.01,'Harmony was not on a downbeat');
  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot',{format:'png'});
    await writeFile(process.env.SMOKE_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  await evaluate("document.getElementById('companion-mute').click()");
  const mutedCount = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length");
  await pause(1000);
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),mutedCount);
  assert.equal(await evaluate("document.getElementById('harmony').textContent"),'Am');
  await evaluate("document.getElementById('companion-mute').click()");
  await until(`window.__smoke.notes.filter(note=>note.type==='triangle').length>${mutedCount}`,4000);
  await evaluate('window.__smoke.tracks.forEach(track=>track.enabled=false)');
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyL',key:'l'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyL',key:'l'});
  await until("document.getElementById('harmony').textContent === '—'");
  const resetCount = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length");
  await pause(2200);
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),resetCount,'Listen again kept an old accompaniment');
  assert.equal(await evaluate("document.querySelectorAll('.pass.heard').length"),0);
  await evaluate("document.getElementById('bpm').value='80'; document.getElementById('bpm').dispatchEvent(new Event('input')); document.getElementById('responsive').click(); document.getElementById('threshold').value='0.62'; document.getElementById('threshold').dispatchEvent(new Event('input'))");
  const saved = await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1'))");
  assert.equal(saved.bpm,80); assert.equal(saved.responsive,false); assert.equal(saved.voicedThreshold,0.62);
  assert.ok(!('phrase' in saved) && !('memoryBars' in saved));
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape'});
  await until("document.getElementById('hint').textContent.includes('Output silenced')");
  const panicCount = await evaluate('window.__smoke.notes.length'); await pause(1200);
  assert.equal(await evaluate('window.__smoke.notes.length'),panicCount);
  assert.equal(errors.length,0,JSON.stringify(errors));
  assert.ok(requests.some(url=>url===`${origin}/models/crepe-tiny/model.json`));
  assert.ok(requests.filter(url=>/^https?:/.test(url)).every(url=>url.startsWith(origin)));
  await send('Page.reload');
  await until(`document.getElementById('model')?.textContent === '${modelState}'`,60000);
  assert.equal(await evaluate("document.getElementById('bpm').value"),'80');
  assert.equal(await evaluate("document.getElementById('responsive').checked"),false);
  assert.equal(await evaluate("document.getElementById('harmony').textContent"),'—');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({model:modelState,...graph,input,firstChord:first,secondChord:second,persisted:saved,browserErrors:errors.length},null,2));
  await Promise.race([send('Browser.close'),pause(1000)]);
} finally { socket?.close(); chrome.kill(); }
