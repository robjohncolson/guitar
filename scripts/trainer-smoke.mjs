// Real CREPE and native worklets. Known input is transformed recorded guitar, never injected note events.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromeSession,pause} from './chrome-session.mjs';
const origin=process.env.SMOKE_ORIGIN || 'http://127.0.0.1:4173',quick=process.env.SMOKE_TRAINER_QUICK==='1',course=process.env.SMOKE_TRAINER_COURSE==='1';
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/guitar-plucks.json',import.meta.url),'utf8'));
const wav=(await readFile(new URL('../tests/fixtures/guitar-plucks.wav',import.meta.url))).toString('base64');
const browser=await chromeSession(),{send,evaluate,until}=browser;
const results=[];
try {
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.__trainer={contexts:[],records:[],tracks:[],errors:[],sounds:[],sources:[],calibration:false,scenario:'clean',delay:.12};
    const Context=AudioContext,Worklet=AudioWorkletNode,connect=AudioNode.prototype.connect,startOsc=OscillatorNode.prototype.start;
    window.AudioContext=class extends Context{constructor(...args){super(...args);__trainer.contexts.push(this);if(${process.env.SMOKE_NEGATIVE_LATENCY==='1'})Object.defineProperty(this,"outputLatency",{get:()=>.35});}};
    const data=Uint8Array.from(atob(${JSON.stringify(wav)}),c=>c.charCodeAt(0)),view=new DataView(data.buffer),fixture=${JSON.stringify(fixture)};
    navigator.mediaDevices.getUserMedia=async constraints=>{
      const context=__trainer.contexts[0],destination=context.createMediaStreamDestination();__trainer.mic=destination;__trainer.tracks.push(...destination.stream.getTracks());
      destination.stream.getAudioTracks().forEach(track=>{const settings=track.getSettings.bind(track);track.getSettings=()=>({...settings(),deviceId:"recorded-guitar-test-input"});});
      if(__trainer.permissionDelay)await new Promise(r=>setTimeout(r,__trainer.permissionDelay));return destination.stream;
    };
    AudioNode.prototype.connect=function(destination,...args){
      const result=connect.call(this,destination,...args);
      if(destination===this.context.destination && __trainer.calibration && __trainer.mic){const delay=this.context.createDelay();delay.delayTime.value=__trainer.delay;connect.call(this,delay);connect.call(delay,__trainer.mic);}
      return result;
    };
    OscillatorNode.prototype.start=function(at){__trainer.sounds.push({at,hz:this.frequency.value});return startOsc.call(this,at);};
    __trainer.pluck=(midi,at,length=.42,noise=false)=>{
      const context=__trainer.contexts[0],same=fixture.midis.find(m=>m%12===midi%12),base=same ?? fixture.midis.reduce((a,b)=>Math.abs(a-midi)<Math.abs(b-midi)?a:b),index=fixture.midis.indexOf(base),count=Math.round(fixture.secondsPerPluck*fixture.rate);
      const buffer=context.createBuffer(1,count,fixture.rate),out=buffer.getChannelData(0);let seed=7;
      for(let i=0;i<count;i++){seed=(Math.imul(seed,1664525)+1013904223)|0;out[i]=noise ? ((seed>>>0)/4294967296-.5)*.35 : view.getInt16(44+(index*count+i)*2,true)/32768*.7;}
      const source=context.createBufferSource(),gain=context.createGain();source.buffer=buffer;source.playbackRate.value=noise ? 1 : 2**((midi-base)/12);
      gain.gain.setValueAtTime(1,at);gain.gain.setValueAtTime(1,at+length-.02);gain.gain.linearRampToValueAtTime(0,at+length);
      source.connect(gain).connect(__trainer.mic);source.start(at);source.stop(at+length);__trainer.sources.push({midi,at,length,noise});source.onended=()=>{source.disconnect();gain.disconnect();};
    };
    __trainer.feed=command=>{
      if(__trainer.calibration || __trainer.scenario==='silence')return;
      const context=__trainer.contexts[0],playAt=command.startFrame/context.sampleRate+.5,period=60/command.bpm,offset=__trainer.delay-(context.outputLatency||context.baseLatency||0);
      const title=document.getElementById('lesson-title').textContent;
      // Authored independent test scores, not imported from the app's curriculum/grader.
      let score=title==='A small conversation' ? [[0,45],[2,48],[4,45],[6,48]] : title==='Make the silence' ? [[0,45],[1,48],[4,45],[5,48]] : [[0,45],[2,45],[4,45],[6,45]];
      const id=document.querySelector('[data-lesson][aria-current="true"]').dataset.lesson;
      const scores={quarters:Array.from({length:8},(_,i)=>[i,45]),crossing:[[0,45],[1,50],[2,45],[3,50],[4,50],[5,45],[6,50],[7,45]],phrase:[[0,45],[1,48],[2,52],[4,52],[5,48],[6,45]],minor:[[0,45],[1,48],[2,52],[3,48],[4,45],[5,48],[6,52],[7,48]],major:[[0,45],[1,49],[2,52],[4,45],[5,49],[6,52]],offbeats:[0,1.5,2,3.5,4,4.5,6,7.5].map(b=>[b,45]),strum:[0,1,1.5,2.5,3,4,5,5.5,6.5,7].map(b=>[b,45]),fingerpick:Array.from({length:4},(_,i)=>[[i*4,45],[i*4+1,52],[i*4+2,48],[i*4+3,52]]).flat(),ear:[[0,55],[2,57],[4,59],[6,57]],transfer:[[0,48],[1,52],[2,55],[4,55],[5,52],[6,48]]};
      score=scores[id] || score;
      score.forEach(([beat,midi],i)=>__trainer.pluck(__trainer.scenario==='wrong' && i===1 ? 48 : midi,playAt+beat*period+offset+(__trainer.scenario==='late'?.23:0),title==='Make the silence' ? (__trainer.scenario==='long'?1.2:.75)*period : id==='strum' ? .15 : .42,__trainer.scenario==='noise' || id==='strum'));
      if(__trainer.scenario==='extra')__trainer.pluck(45,playAt+period+offset);
    };
    window.AudioWorkletNode=class extends Worklet{
      constructor(context,name,...args){super(context,name,...args);this.addEventListener('processorerror',()=>__trainer.errors.push(name));
        if(name==='guitar-looper'){const post=this.port.postMessage.bind(this.port);this.port.postMessage=message=>{if(message.type==='record'){__trainer.records.push({...message,now:context.currentTime});__trainer.feed(message);}post(message);};}
      }
    };
  `});
  await send('Page.navigate',{url:origin});await until("document.getElementById('trainer-model')?.textContent==='CREPE ready (tiny)'",60000);
  assert.equal(await evaluate("document.querySelectorAll('[data-lesson]').length"),13);
  await evaluate("document.getElementById('trainer-settings').open=true;__trainer.calibration=true;document.getElementById('trainer-calibrate').click()");
  await until("document.getElementById('calibration-feedback').textContent.startsWith('Timing measured')",15000);
  const calibration=await evaluate("JSON.parse(localStorage.getItem('guitar.trainer.v1'))");assert.equal(calibration.calibrated,true);assert.ok(Math.abs(calibration.offset)<.3);
  await evaluate("__trainer.calibration=false;document.getElementById('trainer-first-demo').checked=false;document.getElementById('trainer-settings').open=false;document.getElementById('trainer-bpm').value='60';document.getElementById('trainer-bpm').dispatchEvent(new Event('input'))");
  const take=async scenario=>{
    const previous=await evaluate("document.getElementById('trainer-trace').href");
    await evaluate(`__trainer.scenario=${JSON.stringify(scenario)};document.getElementById('trainer-start').click()`);
    await until(`document.getElementById('trainer-trace').href.startsWith('blob:') && document.getElementById('trainer-trace').href!==${JSON.stringify(previous)}`,50000);
    const trace=await evaluate("fetch(document.getElementById('trainer-trace').href).then(r=>r.json())");results.push({scenario,...trace});
    assert.equal(await evaluate('__trainer.tracks.every(t=>t.readyState===\'ended\')'),true,'Mic stayed open after a take');
    return trace;
  };
  const first=await take('clean');console.log(JSON.stringify({phase:'first graded guitar take',calibration:calibration.offset,...first}));
  assert.equal(first.calibrated,true);assert.equal(first.result.trusted,true);assert.equal(first.result.score,1);assert.equal(first.result.notes.length,4);
  const wavInfo=await evaluate("fetch(document.getElementById('trainer-download').href).then(r=>r.arrayBuffer()).then(b=>({length:b.byteLength,rate:new DataView(b).getUint32(24,true)}))");
  assert.equal(wavInfo.length,44+wavInfo.rate*8*2);
  await browser.screenshot(process.env.SMOKE_SCREENSHOT || 'smoke-artifacts/trainer-local.png');
  if(!quick && !course){
    await evaluate("document.getElementById('trainer-comfortable').click()");
    for(let i=1;i<9;i++){
      const result=await take('clean');assert.equal(result.result.score,1);assert.equal(result.result.trusted,true);
      await evaluate("document.getElementById('trainer-comfortable').click()");
      if(i===2 || i===5 || i===8)console.log(JSON.stringify({phase:'progression',take:i+1,skill:await evaluate("JSON.parse(localStorage.getItem('guitar.trainer.v1')).skills.pulse")}));
    }
    const skill=await evaluate("JSON.parse(localStorage.getItem('guitar.trainer.v1')).skills.pulse");assert.equal(skill.best,60);assert.equal(skill.bpm,62);assert.equal(skill.support,2);assert.equal(skill.mastered,true);
    for(const scenario of ['wrong','late','extra','silence','noise']){
      const result=await take(scenario);console.log(JSON.stringify({phase:'honest grading',scenario,result:result.result}));
      if(scenario==='noise')assert.equal(result.result.trusted,false);else {assert.equal(result.result.trusted,true);assert.ok(result.result.score<.9);}
      if(scenario==='wrong')assert.ok(result.result.notes.some(n=>n.mark==='wrong'));
      if(scenario==='late')assert.ok(result.result.notes.some(n=>n.mark==='late'));
      if(scenario==='extra')assert.ok(result.result.extras>0);
      if(scenario==='silence')assert.ok(result.result.notes.every(n=>n.mark==='missed'));
    }
    await evaluate("document.querySelector('[data-lesson=\"two-notes\"]').click()");
    const two=await take('clean');assert.equal(two.result.trusted,true);assert.equal(two.result.score,1);
  }
  if(course){
    for(const id of ['quarters','two-notes','crossing','rests','phrase','minor','major','offbeats','strum','fingerpick','ear','transfer']){
      await evaluate(`document.querySelector('[data-lesson="${id}"]').click();document.getElementById("trainer-bpm").value="60";document.getElementById("trainer-bpm").dispatchEvent(new Event("input"))`);
      const result=await take('clean');console.log(JSON.stringify({phase:'course',lesson:id,result:result.result}));
      assert.equal(result.result.trusted,true,id+' untrusted');assert.equal(result.result.score,1,id+' inaccurate');
      if(id==='strum')assert.equal(result.result.pitch,null);
      if(id==='rests')assert.equal(result.result.articulation,1);
    }
    await evaluate(`document.querySelector('[data-lesson="rests"]').click()`);
    const long=await take('long');assert.equal(long.result.trusted,true);assert.ok(long.result.articulation<.9);
    const previous=await evaluate('document.getElementById("trainer-trace").href');
    await evaluate('__trainer.scenario="clean";document.getElementById("trainer-create").click()');
    await until('document.getElementById("trainer-trace").href!=='+JSON.stringify(previous),30000);
    const creative=await evaluate('fetch(document.getElementById("trainer-trace").href).then(r=>r.json())');assert.equal(creative.kind,'creative');assert.equal(creative.result,undefined);
    await evaluate('document.getElementById("trainer-latest").click()');await pause(200);assert.equal(await evaluate('__trainer.tracks.every(t=>t.readyState==="ended")'),true);
    await evaluate('document.getElementById("trainer-stop").click();document.getElementById("trainer-previous").click()');await pause(200);assert.equal(await evaluate('document.getElementById("trainer-player").paused'),false);
    await evaluate('document.getElementById("trainer-stop").click();document.getElementById("trainer-finish").click()');assert.equal(await evaluate('document.getElementById("session-summary").hidden'),false);
  }
  if(process.env.SMOKE_TRAINER_PLACEMENT==='1'){
    await evaluate("__trainer.scenario='clean';document.getElementById('trainer-placement').click()");
    await until("!document.getElementById('take-result').hidden && document.getElementById('trainer-comfortable').textContent.includes('starting-point')",40000);
    await until("!document.getElementById('trainer-comfortable').disabled");
    await evaluate("document.getElementById('trainer-comfortable').click()");
    await until("document.getElementById('lesson-title').textContent==='Across two strings' && !document.getElementById('take-result').hidden",40000);
    await until("!document.getElementById('trainer-comfortable').disabled");
    await evaluate("document.getElementById('trainer-comfortable').click()");
    assert.equal(await evaluate("document.getElementById('lesson-title').textContent"),'A beginning and an ending');
    console.log(JSON.stringify({phase:'starting-point check',recommended:'phrase'}));
  }
  await evaluate("document.getElementById('trainer-loop').click()");await pause(250);assert.equal(await evaluate('__trainer.tracks.every(t=>t.readyState===\'ended\')'),true);
  await evaluate("document.getElementById('trainer-stop').click()");await until("!document.getElementById('trainer-start').disabled");
  await evaluate("__trainer.permissionDelay=500;document.getElementById('trainer-start').click()");
  await until("!document.getElementById('trainer-stop').disabled");await evaluate("document.getElementById('trainer-stop').click()");await pause(700);
  assert.equal(await evaluate('__trainer.tracks.every(t=>t.readyState===\'ended\')'),true,'Late mic permission was not closed');
  const records=await evaluate('__trainer.records.length');
  await until("!document.getElementById('trainer-start').disabled");
  await evaluate("__trainer.permissionDelay=0;document.getElementById('trainer-start').click()");
  await until(`__trainer.records.length>${records}`);await until("!document.getElementById('trainer-stop').disabled");
  await evaluate("document.getElementById('trainer-stop').click()");await pause(200);
  assert.equal(await evaluate('__trainer.tracks.every(t=>t.readyState===\'ended\')'),true,'Stop left an active recorder open');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  for(const panel of ['lesson-help','trainer-course','trainer-settings','trainer-journal'])await evaluate(`document.getElementById('${panel}').open=true`);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Mobile overflow');
  await browser.screenshot('smoke-artifacts/trainer-mobile.png');
  assert.equal(await evaluate('__trainer.contexts.length'),1);assert.deepEqual(await evaluate('__trainer.errors'),[]);assert.deepEqual(browser.errors,[]);
  assert.ok(browser.requests.filter(u=>/^https?:/.test(u)).every(u=>u.startsWith(origin)),'External runtime request');
  const progress=await evaluate("JSON.parse(localStorage.getItem('guitar.trainer.v1'))");assert.ok(!('samples' in progress));
  await send('Page.reload');await until("document.getElementById('lesson-title')?.textContent");assert.equal(await evaluate("document.getElementById('take-review').hidden"),true);assert.equal(await evaluate('__trainer.contexts.length'),0);
  await writeFile('smoke-artifacts/trainer-results.json',JSON.stringify({origin,quick,calibration:calibration.offset,results,progress},null,2));
  console.log(JSON.stringify({phase:'complete',origin,quick,takes:results.length,errors:browser.errors.length}));
}catch(error){await browser.screenshot('smoke-artifacts/trainer-failed.png').catch(()=>{});await writeFile('smoke-artifacts/trainer-failed.json',JSON.stringify({error:String(error),results},null,2));throw error;}finally{await browser.close();}
