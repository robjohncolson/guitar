// Real Chrome + recorded guitar, with a separate worklet probing actual loop output.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin=process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4173';
const inputGain=Number(process.env.SMOKE_INPUT_GAIN ?? .12);
assert.ok(inputGain>0 && inputGain<=1,'SMOKE_INPUT_GAIN must be in (0, 1]');
const directory=await mkdtemp(path.join(tmpdir(),'guitar-looper-')), wav=path.join(directory,'input.wav');
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/guitar-plucks.json',import.meta.url),'utf8'));
const source=await readFile(new URL('../tests/fixtures/guitar-plucks.wav',import.meta.url));
const rate=48000, seconds=180, pcm=Buffer.alloc(rate*seconds*2);
// Overlapping real plucks form chords; the changing pattern makes replacement identifiable.
for(let attack=0;attack<seconds/.375;attack++) {
  const t=.5+attack*.375, pitches=attack%3===0 ? [55,59,62] : [fixture.midis[(attack+Math.floor(attack/11))%fixture.midis.length]];
  for(let i=0;i<.32*rate;i++) {
    const index=Math.round(t*rate)+i; if(index>=rate*seconds) break;
    let sample=0;
    for(const midi of pitches) sample+=source.readInt16LE(44+2*(fixture.midis.indexOf(midi)*Math.round(fixture.secondsPerPluck*rate)+i))/32768;
    pcm.writeInt16LE(Math.round(sample/Math.sqrt(pitches.length)*.7*inputGain*Math.min(1,(.32-i/rate)/.015)*32767),index*2);
  }
}
const header=Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(pcm.length+36,4); header.write('WAVEfmt ',8);
header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22); header.writeUInt32LE(rate,24);
header.writeUInt32LE(rate*2,28); header.writeUInt16LE(2,32); header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(pcm.length,40);
await writeFile(wav,Buffer.concat([header,pcm]));
const chrome=spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${directory}`,
  '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required','--mute-audio','--enable-unsafe-swiftshader',`--use-angle=${process.env.SMOKE_ANGLE || 'swiftshader'}`,
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows',
  '--window-size=1280,1000','about:blank'
],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
try {
  let port; for(let i=0;i<100;i++) { try {port=(await readFile(path.join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0];break;} catch {await pause(100);} }
  assert.ok(port,'Chrome did not start');
  const tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0; const pending=new Map(), errors=[], requests=[];
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id) {pending.get(message.id)?.(message);pending.delete(message.id);}
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if(message.method==='Network.requestWillBeSent') requests.push(message.params.request.url);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,m=>m.error ? reject(m.error) : resolve(m.result));socket.send(JSON.stringify({id:request,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async(expression,timeout=30000)=>{
    const end=Date.now()+timeout;
    while(Date.now()<end) {const result=await evaluate(expression);if(result)return result;await pause(100);}
    throw new Error(`Timed out: ${expression}: ${JSON.stringify(await evaluate("({state:document.getElementById('phrase-status').textContent,hint:document.getElementById('hint').textContent,commands:__loop.commands,events:__loop.events,errors:__loop.errors})"))}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  const probe=`class Probe extends AudioWorkletProcessor {
    constructor(){super();this.data=new Float32Array(4096);this.count=0;this.first=0;this.frame=undefined;}
    process(inputs){const input=inputs[0]?.[0];if(!input)return true;
      const frame=this.frame ?? currentFrame;if(frame!==currentFrame)this.port.postMessage({gap:currentFrame-frame,frame:currentFrame});this.frame=frame+input.length;
      for(let i=0;i<input.length;i++){if(!this.count)this.first=frame+i;this.data[this.count++]=input[i];
        if(this.count===4096){this.port.postMessage({frame:this.first,samples:this.data},[this.data.buffer]);this.data=new Float32Array(4096);this.count=0;}}
      return true;}}
    registerProcessor('loop-probe',Probe);`;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__loop={contexts:[],commands:[],events:[],chunks:[],output:[],gaps:[],tracks:[],constraints:[],clicks:[],errors:[]};
    const NativeContext=AudioContext, NativeWorklet=AudioWorkletNode;
    window.AudioContext=class extends NativeContext {
      constructor(...args){super(...args);__loop.contexts.push(this);const add=this.audioWorklet.addModule.bind(this.audioWorklet);let ready=false;
        this.audioWorklet.addModule=async url=>{await add(url);if(String(url).includes('looper.worklet')&&!ready){ready=true;const blob=URL.createObjectURL(new Blob([${JSON.stringify(probe)}],{type:'text/javascript'}));await add(blob);URL.revokeObjectURL(blob);}};}
    };
    window.AudioWorkletNode=class extends NativeWorklet {
      constructor(context,name,...args){super(context,name,...args);this.isLoop=name==='guitar-looper';if(!this.isLoop)return;
        const post=this.port.postMessage.bind(this.port);this.port.postMessage=message=>{__loop.commands.push({...message,now:context.currentTime});post(message);};
        this.port.addEventListener('message',event=>{if(event.data.type==='chunk')__loop.chunks.push(event.data);else __loop.events.push(event.data);});this.port.start();
        this.addEventListener('processorerror',()=>__loop.errors.push('Looper processor error'));
      }
      connect(destination,...args){const result=super.connect(destination,...args);if(this.isLoop&&!this.probed){this.probed=true;
        const probe=new NativeWorklet(this.context,'loop-probe'),silent=this.context.createGain();silent.gain.value=0;
        destination.connect(probe).connect(silent).connect(this.context.destination);probe.port.onmessage=event=>('gap' in event.data ? __loop.gaps : __loop.output).push(event.data);
      }return result;}
    };
    const getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{__loop.constraints.push(constraints);const stream=await getUserMedia(constraints);__loop.tracks.push(...stream.getTracks());if(__loop.micDelay)await new Promise(r=>setTimeout(r,__loop.micDelay));return stream;};
    const start=OscillatorNode.prototype.start;
    OscillatorNode.prototype.start=function(time){__loop.clicks.push({time,hz:this.frequency.value,now:this.context.currentTime});return start.call(this,time);};
    __loop.audio=(from,length)=>{const samples=new Float32Array(length);for(const chunk of __loop.output){const a=Math.max(from,chunk.frame),b=Math.min(from+length,chunk.frame+chunk.samples.length);if(b>a)samples.set(chunk.samples.subarray(a-chunk.frame,b-chunk.frame),a-from);}return samples;};
    __loop.take=id=>{const event=__loop.events.find(e=>e.type==='take'&&e.id===id);const samples=new Float32Array(event.length);for(const chunk of __loop.chunks)if(chunk.id===id)samples.set(chunk.samples,chunk.offset);return {event,samples};};
    // Independent reference: derive gain from captured samples, never from app metadata.
    __loop.level=samples=>{const peak=samples.reduce((peak,sample)=>Math.max(peak,Math.abs(sample)),0);return {inputPeak:peak,levelGain:peak<.005 ? 1 : Math.min(16,.8/peak)};};
    __loop.compare=(id,from,cycles=1,gain=1)=>{const {samples}=__loop.take(id),level=__loop.level(samples),rate=__loop.contexts[0].sampleRate,output=__loop.audio(from,samples.length*cycles);let maxError=0,energy=0,outputEnergy=0,outputPeak=0,bad=0,firstBad;
      for(let i=0;i<output.length;i++){const at=i%samples.length,fade=Math.max(0,Math.min(1,at/(rate*.003),(samples.length-1-at)/(rate*.003))),expected=samples[at]*level.levelGain*fade*gain,error=Math.abs(output[i]-expected);maxError=Math.max(maxError,error);energy+=expected*expected;outputEnergy+=output[i]*output[i];outputPeak=Math.max(outputPeak,Math.abs(output[i]));if(error>.00001){bad++;firstBad ??={i,actual:output[i],expected};}}
      return {...level,maxError,rms:Math.sqrt(energy/output.length),outputRms:Math.sqrt(outputEnergy/output.length),outputPeak,bad,firstBad,gaps:__loop.gaps};};
  `});
  await send('Page.navigate',{url:origin});
  await until("document.getElementById('model')?.textContent==='CREPE ready (tiny)'",60000);
  await evaluate("document.getElementById('app-mode').value='looper';document.getElementById('app-mode').dispatchEvent(new Event('change'));document.getElementById('bpm').value='120';document.getElementById('bpm').dispatchEvent(new Event('input'));document.getElementById('volume').value='.5';document.getElementById('volume').dispatchEvent(new Event('input'));document.getElementById('output').click();document.getElementById('enable').click()");
  await until("__loop.commands.some(c=>c.type==='record')");
  const plan=await evaluate("__loop.commands.find(c=>c.type==='record')"), actualRate=await evaluate('__loop.contexts[0].sampleRate');
  assert.ok(plan.startFrame/actualRate-plan.now>=2,'One-bar count-in was missing');
  await until("__loop.events.some(e=>e.type==='take')",15000);
  const first=await evaluate("__loop.events.find(e=>e.type==='take')");
  assert.equal(first.length,actualRate*8); assert.equal(first.startFrame,plan.startFrame+first.length);
  const clicks=await evaluate('__loop.clicks.slice(0,5)');
  assert.deepEqual(clicks.map(c=>c.hz),[1300,1000,1000,1000,1300]);
  clicks.forEach((c,i)=>assert.ok(Math.abs(c.time-(plan.startFrame/actualRate-2+i*.5))<.012,'Count-in click drifted'));
  assert.ok(await evaluate(`__loop.audio(${plan.startFrame},${first.length}).every(sample=>sample===0)`),'Loop audio played during recording');
  await until("document.getElementById('loop-download').href.startsWith('blob:')");
  const wavInfo=await evaluate(`fetch(document.getElementById('loop-download').href).then(r=>r.arrayBuffer()).then(async bytes=>{
    const view=new DataView(bytes),{samples}=__loop.take(${first.id}),{levelGain}=__loop.level(samples),rate=view.getUint32(24,true);let maxError=0,peak=0;
    for(let i=0;i<samples.length;i++){const value=view.getInt16(44+i*2,true)/32767,fade=Math.max(0,Math.min(1,i/(rate*.003),(samples.length-1-i)/(rate*.003)));maxError=Math.max(maxError,Math.abs(value-samples[i]*levelGain*fade));peak=Math.max(peak,Math.abs(value));}
    return {rate,length:bytes.byteLength,first:view.getInt16(44,true),last:view.getInt16(bytes.byteLength-2,true),maxError,peak,hash:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).join(',')};})`);
  assert.equal(wavInfo.rate,actualRate); assert.equal(wavInfo.length,44+first.length*2); assert.equal(wavInfo.first,0);assert.equal(wavInfo.last,0);
  assert.ok(wavInfo.maxError<=.5/32767+1e-9 && wavInfo.peak<=.80002,'WAV gain differs from playback or clips');
  await evaluate("document.getElementById('bpm').value='80';document.getElementById('bpm').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.getElementById('bpm').value"),'120','Tempo changed during playback');
  await until(`__loop.contexts[0].currentTime>${(first.startFrame+first.length*2)/actualRate+.2}`,20000);
  const repeated=await evaluate(`__loop.compare(${first.id},${first.startFrame},2)`);
  assert.ok(repeated.rms>.01 && repeated.maxError<.00001,`Playback differs from captured audio: ${JSON.stringify(repeated)}`);
  assert.ok(Math.abs(first.levelGain-repeated.levelGain)<1e-6,'Take metadata has the wrong gain');
  assert.ok(repeated.outputPeak<=.800001 && repeated.outputPeak+.126<1,'No headroom for the metronome');
  if(inputGain===.12) assert.ok(repeated.levelGain>=8 && repeated.outputPeak>.4,'Quiet recording was not made substantially louder');
  assert.equal(await evaluate("document.getElementById('volume-value').textContent"),'100%');
  assert.ok((await evaluate("document.getElementById('loop-take-detail').textContent")).includes(`Auto level +${Math.round(20*Math.log10(first.levelGain))} dB`));
  console.log(JSON.stringify({phase:'two exact audio passes',inputGain,first,repeated,wavInfo}));
  if(process.env.SMOKE_SCREENSHOT) await writeFile(process.env.SMOKE_SCREENSHOT,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate("document.getElementById('enable').click()");
  const replacement=await until("__loop.commands.filter(c=>c.type==='record')[1]");
  assert.equal((replacement.startFrame-first.startFrame)%first.length,0,'Replacement did not wait for a boundary');
  await until("__loop.events.filter(e=>e.type==='take').length===2",18000);
  const second=await evaluate("__loop.events.filter(e=>e.type==='take')[1]");
  assert.equal(second.startFrame,replacement.startFrame+first.length);
  await until(`__loop.contexts[0].currentTime>${second.startFrame/actualRate+.2}`);
  assert.ok(await evaluate(`__loop.audio(${replacement.startFrame},${first.length}).every(sample=>sample===0)`),'Old loop leaked into replacement');
  const distinct=await evaluate(`(()=>{const a=__loop.take(${first.id}).samples,b=__loop.take(${second.id}).samples;return a.some((sample,i)=>Math.abs(sample-b[i])>.01);})()`);
  assert.ok(distinct,'Replacement did not change the saved audio');
  await until("!document.getElementById('loop-undo').disabled"); await evaluate("document.getElementById('loop-undo').click()");
  const undo=await until("__loop.commands.find(c=>c.type==='undo')");
  assert.equal((undo.startFrame-second.startFrame)%second.length,0);
  await until(`__loop.contexts[0].currentTime>${(undo.startFrame+first.length)/actualRate+.2}`,18000);
  const restored=await evaluate(`__loop.compare(${first.id},${undo.startFrame})`);
  assert.ok(restored.maxError<.00001,`Undo changed the old recording: ${JSON.stringify({restored,undo,events:await evaluate('__loop.events'),secondMatch:await evaluate(`__loop.compare(${second.id},${undo.startFrame})`)})}`);
  assert.equal(await evaluate("document.getElementById('loop-undo').disabled"),true);
  console.log(JSON.stringify({phase:'replace and undo',replacement,second,restored}));
  await evaluate("document.getElementById('enable').click()");
  const cancelled=await until("__loop.commands.filter(c=>c.type==='record')[2]");
  await until(`__loop.contexts[0].currentTime>${cancelled.startFrame/actualRate+.5}`,10000);
  await evaluate("document.getElementById('panic').click()");
  await until("__loop.tracks.every(track=>track.readyState==='ended')");
  assert.equal(await evaluate("__loop.events.filter(e=>e.type==='take').length"),2);
  await until("!document.getElementById('loop-play').disabled");
  await evaluate("document.getElementById('bpm').value='80';document.getElementById('bpm').dispatchEvent(new Event('input'));document.getElementById('volume').value='.25';document.getElementById('volume').dispatchEvent(new Event('input'));document.getElementById('loop-play').click()");
  await until("document.getElementById('bpm').value==='120'");
  const played=await until("__loop.commands.find(c=>c.type==='play')");
  await until(`__loop.contexts[0].currentTime>${(played.startFrame+first.length)/actualRate+.2}`,10000);
  assert.ok((await evaluate(`__loop.compare(${first.id},${played.startFrame},1,.5)`)).maxError<.00001,'Stop/cancel/Play lost the saved take or volume control');
  const restoredHash=await evaluate("fetch(document.getElementById('loop-download').href).then(r=>r.arrayBuffer()).then(async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).join(','))");
  assert.equal(restoredHash,wavInfo.hash,'Undo or volume changed the saved WAV');
  // Mute preserves transport position, and Stop also cancels a pending permission request.
  await evaluate("document.getElementById('companion-mute').click()");
  const mutedAt=await evaluate('__loop.contexts[0].currentTime'); await pause(500);
  assert.ok(await evaluate(`__loop.audio(${Math.round((mutedAt+.25)*actualRate)},${Math.round(.1*actualRate)}).every(sample=>Math.abs(sample)<.000001)`));
  await evaluate("document.getElementById('companion-mute').click();document.getElementById('app-mode').value='partner';document.getElementById('app-mode').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('looper-panel').hidden"),true);
  await evaluate("document.getElementById('app-mode').value='looper';document.getElementById('app-mode').dispatchEvent(new Event('change'))");
  await until("!document.getElementById('loop-take').hidden");
  await until("!document.getElementById('loop-play').disabled");
  await evaluate("__loop.micDelay=500;document.getElementById('enable').click()");
  await until("!document.getElementById('panic').disabled"); await evaluate("document.getElementById('panic').click()");
  await pause(800); assert.equal(await evaluate("__loop.tracks.every(track=>track.readyState==='ended')"),true);
  assert.equal(await evaluate("__loop.events.filter(e=>e.type==='take').length"),2);
  await until("!document.getElementById('loop-clear').disabled");
  await evaluate("document.getElementById('loop-clear').click()");
  await until("document.getElementById('loop-take').hidden");
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("document.getElementById('settings').open=true");
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'Mobile controls overflow');
  const state=await evaluate("({contexts:__loop.contexts.length,errors:__loop.errors,preferences:JSON.parse(localStorage.getItem('guitar.practice.v1'))})");
  assert.equal(state.contexts,1); assert.deepEqual(state.errors,[]); assert.equal(errors.length,0,JSON.stringify(errors));
  assert.equal(state.preferences.appMode,'looper'); assert.equal(state.preferences.loopClickMuted,false);
  assert.ok(!('take' in state.preferences));
  assert.ok(requests.filter(url=>/^https?:/.test(url)).every(url=>url.startsWith(origin)));
  await send('Page.reload'); await until("document.getElementById('app-mode')?.value==='looper'");
  assert.equal(await evaluate("document.getElementById('loop-take').hidden"),true,'Recorded audio persisted across reload');
  assert.equal(await evaluate('__loop.contexts.length'),0,'Reload started audio automatically');
  console.log(JSON.stringify({phase:'complete',origin,...state,browserErrors:errors.length},null,2));
  await Promise.race([send('Browser.close'),pause(1000)]);
} finally {socket?.close();chrome.kill();}
