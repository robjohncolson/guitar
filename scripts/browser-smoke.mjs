// Optional real Chrome smoke check; no browser test dependency or backend needed.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:5173';
const modelFailure = process.env.SMOKE_MODEL_FAILURE === '1';
const manualTempo = process.env.SMOKE_MANUAL_TEMPO === '1';
const directory = await mkdtemp(path.join(tmpdir(), 'guitar-chrome-'));
const wav = path.join(directory, 'guitar.wav');
const rate = 48000, seconds = 40, pcm = Buffer.alloc(rate * seconds * 2);
for (let i = 0; i < rate * seconds; i++) {
  // Let fake-microphone startup/AEC settle before the first deliberate pluck.
  const t = i / rate - 1;
  if (t < 0) continue;
  const cycle = t < 6 ? 2 : 1.6, step = cycle/4;
  const phase = (t < 6 ? t : t-6)%cycle, index = Math.floor(phase/step), age = phase%step;
  if (index === 3 || age > 0.22) continue;
  const hz = (t < 6 ? [220,261.625565,329.627557] : [293.664768,349.228231,493.883301])[index];
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
    const state = await evaluate("({hint:document.getElementById('hint')?.textContent,phrase:document.getElementById('phrase-status')?.textContent,reply:document.getElementById('reply')?.textContent,heard:document.getElementById('note')?.textContent,notes:window.__smoke?.notes,attacks:window.__smoke?.attacks})");
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
  if (manualTempo) await evaluate("document.getElementById('bpm').value='120'; document.getElementById('bpm').dispatchEvent(new Event('input'))");
  else {
    assert.equal(await evaluate("document.getElementById('bpm').value"),'');
    assert.equal(await evaluate("document.getElementById('find-tempo').disabled"),true);
  }
  assert.equal(await evaluate("document.querySelectorAll('#remember, #harmony, #delay-value, [data-memory-bars], #roles').length"),0);
  await evaluate("document.getElementById('enable').click()");
  await until("document.getElementById('mic').textContent.includes('Mic listening')");
  await until("document.querySelectorAll('.pass.heard').length === 2",15000);
  assert.equal(await evaluate('window.__smoke.notes.length'),0,'Sound started before three matching phrases');
  await until("document.getElementById('bpm').value !== ''",10000);
  const learnedBpm = await evaluate("Number(document.getElementById('bpm').value)");
  assert.ok(Math.abs(learnedBpm-120)<=2,'The plucks did not establish the pulse');
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1')).autoTempo"),!manualTempo);
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>=3",10000);
  const input = await evaluate('({firstAttack:window.__smoke.attacks[0],delay:window.__smoke.contexts[0].outputLatency || window.__smoke.contexts[0].baseLatency || 0})');
  await until("document.getElementById('phrase-status').textContent.includes('next phrase ready')",8000);
  const queueTime = await evaluate('window.__smoke.contexts[0].currentTime');
  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot',{format:'png'});
    await writeFile(process.env.SMOKE_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>=18",15000);
  await until("document.getElementById('reply').textContent === '—'",5000);
  const replies = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle')");
  assert.equal(replies.length,18,'Expected two phrases, each played three times');
  assert.ok(replies[0].time+input.delay>=input.firstAttack+5,'The third input phrase was incomplete');
  const pcs = replies.map(note=>(Math.round(69+12*Math.log2(note.hz/440))%12));
  assert.deepEqual(pcs.slice(0,9),[9,0,4,9,0,4,9,0,4]);
  assert.deepEqual(pcs.slice(9),[2,5,11,2,5,11,2,5,11]);
  for (const start of [0,9]) for (let i=0;i<9;i++) {
    assert.ok(replies[start+i].time>=replies[start+i].now,'A note was scheduled late');
    if (i%3) assert.ok(Math.abs(replies[start+i].time-replies[start+i-1].time-(start === 0 ? 0.5 : 0.4))<0.08,'Within-phrase pace changed');
    if (i>=3) {
      assert.ok(Math.abs(replies[start+i].time-replies[start+i-3].time-(start === 0 ? 2 : 1.6))<0.06,'Cycle pace changed');
      assert.equal(replies[start+i].hz,replies[start+i-3].hz,'Pitch changed between replies');
    }
  }
  assert.ok(queueTime<replies[0].time+6,'The new phrase was not learned during playback');
  assert.ok(replies[9].time>=replies[0].time+6-0.06,'A new phrase interrupted the third pass');
  replies.slice(1).forEach((next,i)=>assert.ok(replies[i].end<=next.time+0.001,'Synthesized notes overlapped'));
  await pause(6000); // The player keeps repeating B; the app must not reply forever.
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),18,'A completed phrase retriggered indefinitely');
  assert.equal(await evaluate("Number(document.getElementById('bpm').value)"),learnedBpm,'New playing changed the locked pulse');
  // Reopening Chrome's fake microphone restarts the WAV, so switch after the finite-exchange check.
  await evaluate("document.getElementById('output').click()");
  await until("document.getElementById('mic').textContent.includes('headphones')");
  const graph = await evaluate('({contexts:window.__smoke.contexts.length,constraints:window.__smoke.constraints,late:window.__smoke.notes.filter(note=>note.time<note.now-0.001).length})');
  assert.equal(graph.contexts,1); assert.equal(graph.late,0);
  assert.equal(graph.constraints[0].audio.echoCancellation,true); assert.equal(graph.constraints.at(-1).audio.echoCancellation,false);
  await evaluate("document.getElementById('companion-mute').click(); document.getElementById('listen-again').click()");
  await until("document.getElementById('phrase-status').textContent.includes('next phrase ready')",15000);
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),18,'Muted replies were scheduled');
  await evaluate("document.getElementById('companion-mute').click()");
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>18",4000);
  await evaluate('window.__smoke.tracks.forEach(track=>track.enabled=false)');
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyL',key:'l'});
  await send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyL',key:'l'});
  await until("document.getElementById('reply').textContent === '—'");
  const resetCount = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length");
  await pause(2200);
  assert.equal(await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle').length"),resetCount,'Start fresh kept an old reply');
  await evaluate("document.getElementById('find-tempo').click()");
  assert.equal(await evaluate("document.getElementById('bpm').value"),'');
  for (let i=0;i<4;i++) {
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});
    await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
    if (i<3) await pause(500);
  }
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1')).autoTempo"),false,'Space did not override Auto');
  assert.ok(Math.abs(await evaluate("Number(document.getElementById('bpm').value)")-120)<8);
  await evaluate("document.getElementById('bpm').value='80'; document.getElementById('bpm').dispatchEvent(new Event('input')); document.getElementById('responsive').click(); document.getElementById('threshold').value='0.62'; document.getElementById('threshold').dispatchEvent(new Event('input')); document.getElementById('click-mute').click()");
  await until("window.__smoke.notes.some(note=>note.type==='sine')",3000);
  const saved = await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1'))");
  assert.equal(saved.bpm,80); assert.equal(saved.autoTempo,false); assert.equal(saved.responsive,false); assert.equal(saved.voicedThreshold,0.62);
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
  assert.equal(await evaluate("document.getElementById('reply').textContent"),'—');
  await evaluate("document.getElementById('find-tempo').click()");
  await send('Page.reload');
  await until(`document.getElementById('model')?.textContent === '${modelState}'`,60000);
  assert.equal(await evaluate("document.getElementById('bpm').value"),'','Auto mode reused a previous session estimate');
  assert.equal(await evaluate("document.getElementById('find-tempo').disabled"),true);
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({model:modelState,manualTempo,learnedBpm,...graph,input,queueTime,replies,persisted:saved,browserErrors:errors.length},null,2));
  await Promise.race([send('Browser.close'),pause(1000)]);
} finally { socket?.close(); chrome.kill(); }
