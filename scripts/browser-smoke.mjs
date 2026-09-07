// Optional real Chrome smoke check; no browser test dependency or backend needed.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const origin = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:5173';
const modelFailure = process.env.SMOKE_MODEL_FAILURE === '1';
const realGuitar = process.env.SMOKE_SYNTHETIC !== '1';
const firstMode = process.env.SMOKE_REPLY_MODE === 'echo' ? 'echo' : 'harmony';
const nextMode = firstMode === 'harmony' ? 'echo' : 'harmony';
const inputMode = process.env.SMOKE_INPUT_MODE === 'headphones' ? 'headphones' : 'speakers';
const directory = await mkdtemp(path.join(tmpdir(), 'guitar-chrome-'));
const wav = path.join(directory, 'guitar.wav');
const rate = 48000, seconds = 48, pcm = Buffer.alloc(rate * seconds * 2), inputEvents = [];
const plucks = realGuitar ? await readFile(new URL('../tests/fixtures/guitar-plucks.wav',import.meta.url)) : undefined;
const fixture = realGuitar ? JSON.parse(await readFile(new URL('../tests/fixtures/guitar-plucks.json',import.meta.url),'utf8')) : undefined;
if (realGuitar) {
  assert.equal(createHash('sha256').update(plucks).digest('hex'),fixture.sha256,'Guitar fixture hash changed');
  assert.equal(fixture.rate,rate);
}
for (let pass=0;pass<3;pass++) [0,0.5,1.5].forEach((offset,i) => inputEvents.push({t:1+pass*2.5+offset,midi:[57,60,64][i],duration:[0.24,0.3,0.22][i]}));
for (let pass=0;pass<22;pass++) [0,0.375,1].forEach((offset,i) => inputEvents.push({t:8.5+pass*1.75+offset,midi:[55,59,62][i],duration:[0.2,0.18,0.28][i]}));
for (const event of inputEvents) for (let i=0;i<event.duration*rate;i++) {
  const index = Math.round(event.t*rate)+i; if (index>=rate*seconds) break;
  const age = i/rate, hz = 440*2**((event.midi-69)/12), fade = Math.min(1,(event.duration-age)/0.015);
  const source = realGuitar ? plucks.readInt16LE(44+2*(fixture.midis.indexOf(event.midi)*Math.round(fixture.secondsPerPluck*rate)+i))/32768 :
    Math.min(1,age/0.004)*Math.exp(-age*5)*(Math.sin(2*Math.PI*hz*age)+0.35*Math.sin(4*Math.PI*hz*age)+0.12*Math.sin(6*Math.PI*hz*age))*0.42;
  pcm.writeInt16LE(Math.round(source*fade*0.85*32767),index*2);
}
const header = Buffer.alloc(44);
header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
await writeFile(wav, Buffer.concat([header, pcm]));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  `--user-data-dir=${directory}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader',
  ...(process.env.SMOKE_ANGLE ? [`--use-angle=${process.env.SMOKE_ANGLE}`] : []),
  '--window-size=1280,1000', 'about:blank'
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
    const state = await evaluate("({hint:document.getElementById('hint')?.textContent,model:document.getElementById('model')?.textContent,capture:document.getElementById('capture-status')?.textContent,phrase:document.getElementById('phrase-status')?.textContent,reply:document.getElementById('reply')?.textContent,heard:document.getElementById('note')?.textContent,notes:window.__smoke?.notes,attacks:window.__smoke?.attacks})");
    await evaluate("if (document.getElementById('capture')?.textContent.includes('Finish')) document.getElementById('capture').click()");
    await pause(1000);
    const trace = await evaluate("document.getElementById('download-trace')?.href.startsWith('blob:') ? fetch(document.getElementById('download-trace').href).then(r=>r.json()) : null");
    if (trace) await writeFile(path.join(directory,'failed-trace.json'),JSON.stringify(trace,null,2));
    throw new Error(`Timed out: ${expression}\n${JSON.stringify({state,detected:trace?.notes,traceFile:path.join(directory,'failed-trace.json'),errors})}`);
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
      const stream = await getUserMedia(constraints); window.__smoke.tracks.push(...stream.getAudioTracks());
      if (window.__smoke.micDelay) await new Promise(resolve=>setTimeout(resolve,window.__smoke.micDelay));
      return stream;
    };
  ` });
  await send('Page.navigate', {url:origin+'/play.html?mode=partner'});
  const modelState = modelFailure ? 'FALLBACK: YIN' : 'CREPE ready (tiny)';
  await until(`document.getElementById('model')?.textContent === '${modelState}'`,60000);
  const renderer = await evaluate("(() => { const gl=document.createElement('canvas').getContext('webgl'); const debug=gl?.getExtension('WEBGL_debug_renderer_info'); return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable'; })()");
  console.log(JSON.stringify({renderer}));
  assert.equal(await evaluate("document.getElementById('reply-mode').value"),'harmony','New sessions must offer Harmony by default');
  await evaluate(`document.getElementById('reply-mode').value='${firstMode}'; document.getElementById('reply-mode').dispatchEvent(new Event('change'))`);
  await evaluate("document.getElementById('bpm').value='120'; document.getElementById('bpm').dispatchEvent(new Event('input'))");
  if (inputMode === 'headphones') await evaluate("document.getElementById('output').click()");
  assert.equal(await evaluate("document.querySelectorAll('#find-tempo, .beat, .pass, #remember, #harmony, [data-memory-bars], #roles').length"),0);
  await evaluate("document.getElementById('enable').click()");
  await until("document.getElementById('mic').textContent.includes('Mic listening')");
  await until("!document.getElementById('capture').disabled");
  await evaluate("document.getElementById('capture').click()");
  await until("window.__smoke.attacks.length && window.__smoke.contexts[0].currentTime>=window.__smoke.attacks[0]+5",10000);
  assert.equal(await evaluate('window.__smoke.notes.length'),0,'Sound started before three matching phrases');
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>=3",10000);
  await evaluate(`document.getElementById('reply-mode').value='${nextMode}'; document.getElementById('reply-mode').dispatchEvent(new Event('change'))`);
  await until("document.getElementById('reply-mode-help').textContent === 'For the next loop'");
  const input = await evaluate('({firstAttack:window.__smoke.attacks[0],delay:window.__smoke.contexts[0].outputLatency || window.__smoke.contexts[0].baseLatency || 0})');
  await until("document.getElementById('hint').textContent.includes('next loop is ready')",8000);
  const queueTime = await evaluate('window.__smoke.contexts[0].currentTime');
  if (process.env.SMOKE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot',{format:'png'});
    await writeFile(process.env.SMOKE_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  await until("window.__smoke.notes.filter(note=>note.type==='triangle').length>=18",15000);
  await until("document.getElementById('reply').textContent === '—'",5000);
  const replies = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle')");
  const attacks = await evaluate('window.__smoke.attacks');
  const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const aCycle = median(attacks.slice(3,9).map((t,i)=>t-attacks[i]));
  const bCycle = median(attacks.slice(12,18).map((t,i)=>t-attacks[9+i]));
  assert.ok(Math.abs(aCycle-2.5)<0.085 && Math.abs(bCycle-1.75)<0.085,'The fake microphone changed the fixture pace');
  assert.equal(replies.length,18,'Expected two phrases, each played three times');
  assert.ok(Math.abs(replies[0].time+input.delay-input.firstAttack-(3*aCycle+0.25))<0.085,`Reply did not enter half a beat after three captured cycles: ${JSON.stringify({firstReply:replies[0],input,aCycle})}`);
  const pcs = replies.map(note=>(Math.round(69+12*Math.log2(note.hz/440))%12));
  const aPcs = firstMode === 'harmony' ? [0,4,7] : [9,0,4];
  assert.deepEqual(pcs.slice(0,9),Array.from({length:9},(_,i)=>aPcs[i%3]),'Changing mode altered the current line');
  const bPcs = nextMode === 'harmony' ? [11,2,6] : [7,11,2], rotation = bPcs.indexOf(pcs[9]);
  assert.ok(rotation>=0);
  assert.deepEqual(pcs.slice(9),Array.from({length:9},(_,i)=>bPcs[(rotation+i)%3]));
  const bPhase = attacks[9+rotation]+0.25;
  const bCycles = (replies[9].time+input.delay-bPhase)/bCycle;
  assert.ok(Math.abs(bCycles-Math.round(bCycles))*bCycle<0.085,'Queued loop lost its half-beat phase');
  for (const start of [0,9]) for (let i=0;i<9;i++) {
    assert.ok(replies[start+i].time>=replies[start+i].now,'A note was scheduled late');
    if (i%3) assert.ok(Math.abs(replies[start+i].time-replies[start+i-1].time-(start === 0 ? [0,0.5,1][i%3] : [0.375,0.625,0.75][(rotation+i-1)%3]))<0.085,'Within-phrase pace/rest changed');
    if (i>=3) {
      assert.ok(Math.abs(replies[start+i].time-replies[start+i-3].time-(start === 0 ? aCycle : bCycle))<0.085,'Cycle pace or closing rest changed');
      assert.equal(replies[start+i].hz,replies[start+i-3].hz,'Pitch changed between replies');
      const mode = start === 0 ? firstMode : nextMode;
      assert.ok(Math.abs(replies[start+i].peak/replies[start+i%3].peak-(mode === 'harmony' && i>=6 ? 0.8 : 1))<0.01,'The third-pass dynamics changed unexpectedly');
    }
  }
  assert.ok(queueTime<replies[0].time+3*aCycle,'The new phrase was not learned during playback');
  assert.ok(replies[9].time>=replies[0].time+3*aCycle-0.06,'A new phrase interrupted the third pass');
  replies.slice(1).forEach((next,i)=>assert.ok(replies[i].end<=next.time+0.001,'Synthesized notes overlapped'));
  assert.ok(replies[3].time-replies[2].end>0.6,'The closing rest disappeared');
  await until("document.getElementById('download-trace').href.startsWith('blob:')");
  const trace = await evaluate("fetch(document.getElementById('download-trace').href).then(r=>r.json())");
  // Chrome's fake microphone can drift against AudioContext time. Locate the isolated
  // source plucks in the captured WAV, independently of the app's attack/pitch detector.
  const sourceOnsets = await evaluate(`(async () => {
    const data=await fetch(document.getElementById('download-audio').href).then(r=>r.arrayBuffer());
    const rate=new DataView(data).getUint32(24,true), samples=new Int16Array(data,44);
    const hop=Math.round(rate*0.005), onsets=[]; let armed=true, quietSince;
    for (let i=0;i+hop<=samples.length;i+=hop) {
      let power=0; for (let j=0;j<hop;j++) power+=(samples[i+j]/32768)**2;
      const t=i/rate;
      if (Math.sqrt(power/hop)<0.015) { quietSince ??=t; if (t-quietSince>=0.08) armed=true; }
      else { quietSince=undefined; if (armed) { onsets.push(t); armed=false; } }
    }
    return onsets;
  })()`);
  const base = sourceOnsets[0]-1;
  assert.ok(sourceOnsets.length>=inputEvents.filter(event=>event.t+base<trace.duration-0.3).length,'The captured fixture lost source plucks');
  sourceOnsets.forEach((t,i)=>assert.ok(Math.abs(t-inputEvents[i].t-base)<0.2,'The captured fixture changed its source rhythm'));
  const expected = sourceOnsets.map((t,i)=>({...inputEvents[i],t})).filter(event=>event.t<trace.duration-0.2);
  const detected = trace.notes.filter(note=>note.t<trace.duration-0.2), used = new Set();
  let matched = 0, matchedAccepted = 0;
  const durationErrors = [];
  for (const event of expected) {
    const index = detected.findIndex((note,i)=>!used.has(i) && note.midi%12===event.midi%12 && Math.abs(note.t-event.t)<0.09);
    if (index>=0) {
      matched++; used.add(index);
      if (detected[index].accepted) {
        matchedAccepted++;
        if (detected[index].duration !== undefined) durationErrors.push(Math.abs(detected[index].duration-event.duration));
      }
    }
  }
  const masked = detected.filter(note=>!note.accepted);
  const detection = {matched,expected:expected.length,detected:detected.length,accepted:detected.length-masked.length,masked:masked.length,recall:matched/expected.length,precision:matched/detected.length};
  detection.meanDurationError = durationErrors.reduce((a,b)=>a+b,0)/durationErrors.length;
  assert.ok(durationErrors.length>=matchedAccepted-1 && detection.meanDurationError<0.09,'Detected note ends lost the recorded rests');
  for (const note of masked) assert.ok(trace.replies.some(reply => {
    const interval = 69+12*Math.log2(note.hz/440)-reply.midi;
    return note.t>=reply.fireAt+input.delay-0.005 && note.t<=reply.fireAt+input.delay+reply.duration+0.08 &&
      [-12,0,12].some(octave=>Math.abs(interval-octave)<=0.5);
  }),'A player pluck was rejected outside an actual output mask');
  assert.equal(trace.replies[0].kind,firstMode);
  assert.ok(trace.replies.some(note=>note.kind===nextMode),'Trace lost the actual mode of a queued reply');
  await writeFile(path.join(directory,'listening-trace.json'),JSON.stringify(trace,null,2));
  assert.ok(detection.recall>=0.95 && detection.precision>=0.95,`Missed/duplicate plucks: ${JSON.stringify(detection)}; trace: ${directory}`);
  await pause(6000); // The player keeps repeating B; the app must not reply forever.
  const finishedNotes = await evaluate("window.__smoke.notes.filter(note=>note.type==='triangle')");
  assert.equal(finishedNotes.length,18,`A completed phrase retriggered: ${JSON.stringify(finishedNotes.slice(18))}; trace: ${directory}`);
  assert.equal(await evaluate("Number(document.getElementById('bpm').value)"),120,'Playing changed the entered BPM');
  // Reopening Chrome's fake microphone restarts the WAV, so switch after the finite-exchange check.
  await evaluate("document.getElementById('output').click()");
  await until(`document.getElementById('mic').textContent.includes('${inputMode === 'speakers' ? 'headphones' : 'speakers'}')`);
  const graph = await evaluate('({contexts:window.__smoke.contexts.length,constraints:window.__smoke.constraints,late:window.__smoke.notes.filter(note=>note.time<note.now-0.001).length})');
  assert.equal(graph.contexts,1); assert.equal(graph.late,0);
  assert.equal(graph.constraints[0].audio.echoCancellation,inputMode === 'speakers'); assert.equal(graph.constraints.at(-1).audio.echoCancellation,inputMode === 'headphones');
  await evaluate("document.getElementById('companion-mute').click(); document.getElementById('listen-again').click()");
  await until("document.getElementById('phrase-status').textContent.includes('Found a loop')",15000);
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
  for (let i=0;i<4;i++) {
    await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Space',key:' '});
    await send('Input.dispatchKeyEvent',{type:'keyUp',code:'Space',key:' '});
    if (i<3) await pause(500);
  }
  assert.ok(Math.abs(await evaluate("Number(document.getElementById('bpm').value)")-120)<8);
  await evaluate("document.getElementById('bpm').value='80'; document.getElementById('bpm').dispatchEvent(new Event('input')); document.getElementById('responsive').click(); document.getElementById('threshold').value='0.62'; document.getElementById('threshold').dispatchEvent(new Event('input')); document.getElementById('click-mute').click()");
  await until("window.__smoke.notes.some(note=>note.type==='sine')",3000);
  const saved = await evaluate("JSON.parse(localStorage.getItem('guitar.practice.v1'))");
  assert.equal(saved.bpm,80); assert.ok(!('autoTempo' in saved)); assert.equal(saved.responsive,false); assert.equal(saved.voicedThreshold,0.62);
  assert.equal(saved.replyMode,nextMode);
  assert.ok(!('phrase' in saved) && !('memoryBars' in saved));
  await evaluate("document.getElementById('capture-audio').play()");
  await until("document.getElementById('phrase-status').textContent === 'Stopped'");
  assert.equal(await evaluate("window.__smoke.tracks.every(track=>track.readyState==='ended')"),true,'Listening to the clip fed it back into the microphone');
  await evaluate("document.getElementById('capture-audio').pause(); document.getElementById('enable').click()");
  await until("document.getElementById('mic').textContent.includes('Mic listening')");
  await send('Input.dispatchKeyEvent',{type:'keyDown',code:'Escape',key:'Escape'});
  await until("document.getElementById('phrase-status').textContent === 'Stopped'");
  const panicCount = await evaluate('window.__smoke.notes.length'); await pause(1200);
  assert.equal(await evaluate('window.__smoke.notes.length'),panicCount);
  assert.equal(await evaluate("window.__smoke.tracks.every(track=>track.readyState==='ended')"),true,'Stop left a microphone track running');
  await evaluate("window.__smoke.micDelay=500; document.getElementById('enable').click()");
  await until("!document.getElementById('panic').disabled");
  await evaluate("document.getElementById('panic').click()"); await pause(700);
  assert.equal(await evaluate("window.__smoke.tracks.every(track=>track.readyState==='ended')"),true,'Stop raced with a pending microphone request');
  assert.equal(errors.length,0,JSON.stringify(errors));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("document.getElementById('listening-check').open=true; document.getElementById('settings').open=true");
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'The controls overflow a phone viewport');
  assert.ok(requests.some(url=>url===`${origin}/models/crepe-tiny/model.json`));
  assert.ok(requests.filter(url=>/^https?:/.test(url)).every(url=>url.startsWith(origin)));
  await send('Page.reload');
  await until(`document.getElementById('model')?.textContent === '${modelState}'`,60000);
  assert.equal(await evaluate("document.getElementById('bpm').value"),'80');
  assert.equal(await evaluate("document.getElementById('responsive').checked"),false);
  assert.equal(await evaluate("document.getElementById('reply-mode').value"),nextMode);
  assert.equal(await evaluate("document.getElementById('reply').textContent"),'—');
  assert.equal(await evaluate("document.getElementById('capture-downloads').hidden"),true,'A clip persisted across reload');
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({model:modelState,renderer,realGuitar,inputMode,firstMode,nextMode,...graph,input,queueTime,replies,detection,traceFile:path.join(directory,'listening-trace.json'),persisted:saved,browserErrors:errors.length},null,2));
  await Promise.race([send('Browser.close'),pause(1000)]);
} finally { socket?.close(); chrome.kill(); }
