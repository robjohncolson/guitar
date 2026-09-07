import '../styles.css';
import './styles.css';
import { TrainerAudio, type TrainerTake } from './audio';
import { lessons, lessonById, stages, cueMidi, openStrings } from './curriculum';
import { advance, initialSkill, loadProgress, recommended, saveProgress, type Skill } from './progress';
import { drawLane, fretGuide, nameOf, trainerShell } from './view';
import { TapTempo } from '../audio/tap-tempo';
import type { SessionKind } from './session';

trainerShell();
const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const audio=new TrainerAudio(),progress=loadProgress(),taps=new TapTempo(),heard=new Set<string>();
let lesson=lessonById(progress.selected),feedback='One phrase, at a pace that leaves room to listen.';
let pending:{take:TrainerTake;skill:Skill}|undefined,attemptSkill:Skill|undefined;
let wavUrl='',traceUrl='',placement:number|undefined,tuning=false,sessionTakes=0,sessionSeconds=0;
const milestones:string[]=[],player=el<HTMLAudioElement>('trainer-player');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const skill=():Skill=>progress.skills[lesson.id] ??=initialSkill(lesson);
const active=()=>Boolean(audio.plan || audio.busy || audio.playing || !player.paused);
function persist():void {el('storage-status').textContent=saveProgress(progress) ? 'Progress stays in this browser. Audio is never saved automatically.' : 'Storage is unavailable. Practice works, but progress will last only for this page.';}
function paintCourse():void {
  const count=lessons.filter(l=>progress.skills[l.id]?.mastered).length;
  el('course-count').textContent=`· ${count} / ${lessons.length} independent`;
  el('course-list').innerHTML=stages.map((stage,i)=>`<div class="course-stage">${i+1} · ${stage}</div>${lessons.filter(l=>l.stage===i).map(l=>{
    const s=progress.skills[l.id];return `<button class="course-lesson" data-lesson="${l.id}" aria-current="${l.id===lesson.id}"><span>${l.title}</span><span>${s?.mastered ? `${s.best} BPM · independent` : s?.attempts ? `${s.bpm} BPM · practising` : 'Begin at '+l.startBpm+' BPM'}</span></button>`;
  }).join('')}`).join('');
  el('journal-list').innerHTML=progress.history.slice(-6).reverse().map(h=>`<div class="journal-entry"><span>${lessonById(h.lesson).title}</span><span>${h.bpm} BPM · ${h.trusted ? Math.round(h.score*100)+'%' : 'unscored'}</span></div>`).join('') || '<p class="muted">Your completed practice takes will appear here.</p>';
}
function selectLesson(id:string):void {
  audio.stop();player.pause();pending=undefined;attemptSkill=undefined;placement=undefined;tuning=false;
  lesson=lessonById(id);progress.selected=lesson.id;const current=skill();
  el('lesson-stage').textContent=`${String(lesson.stage+1).padStart(2,'0')} · ${stages[lesson.stage]}`;
  el('lesson-title').textContent=lesson.title;el('lesson-goal').textContent=lesson.goal;
  el('lesson-theory').textContent=lesson.theory;el('lesson-technique').textContent=lesson.technique;el('lesson-create').textContent=`Make it yours: ${lesson.create}`;
  el('fret-guide').innerHTML=fretGuide(lesson);
  el('phrase-text').textContent=lesson.notes.map(n=>`Bar ${Math.floor(n.beat/4)+1}, beat ${n.beat%4+1}: ${lesson.rhythmOnly ? 'muted strum' : nameOf(cueMidi(n))}, ${n.length} beats${n.damp ? ', then mute' : ''}`).join('. ');
  const preview=[...new Map(lesson.notes.map(n=>[`${n.string}:${n.fret}`,n])).values()];
  el('phrase-preview').innerHTML=lesson.rhythmOnly ? '<span>Muted strings · rhythm only</span><small>Chord identity and strum direction are not graded.</small>' : preview.map(n=>`<span>${nameOf(cueMidi(n))} · string ${n.string}, fret ${n.fret}</span>`).join('')+'<small>Sound is graded; string choice is a guide.</small>';
  const bpm=el<HTMLInputElement>('trainer-bpm');bpm.max=String(lesson.maxBpm);bpm.value=String(current.bpm);bpm.removeAttribute('aria-invalid');
  el('take-result').hidden=true;feedback=lesson.byEar ? 'Hear the phrase first, then play it from memory.' : 'Hear it once, or start with a count-in. Leave room to listen.';
  el('trainer-next-lesson')?.remove();paintCourse();persist();
}
async function start(kind:SessionKind='practice'):Promise<void> {
  if(el('trainer-bpm').getAttribute('aria-invalid')==='true')return;
  player.pause();pending=undefined;tuning=false;el('take-result').hidden=true;el('session-summary').hidden=true;
  attemptSkill={...skill()};
  const demo=kind==='practice' && (lesson.byEar || el<HTMLInputElement>('trainer-first-demo').checked && !heard.has(lesson.id));
  feedback=kind==='creative' ? lesson.create+' This is free play; there is no correctness score.' : kind==='demo' ? 'Listen to the shape and the spaces.' : 'One bar to count in. Play as the notes reach the line.';
  await audio.start(lesson,skill().bpm,kind,kind==='creative' ? 0 : skill().support,progress.offset,demo);
  if(kind==='demo' || demo)heard.add(lesson.id);
  if(audio.deviceKey && progress.calibrated) {
    if(progress.calibrationKey && progress.calibrationKey!==audio.deviceKey){progress.calibrated=false;el('calibration-feedback').textContent='The audio path changed. Recalibrate to certify timing.';}
    else progress.calibrationKey=audio.deviceKey;
    persist();
  }
}
function displayTake(take:TrainerTake):void {
  URL.revokeObjectURL(wavUrl);URL.revokeObjectURL(traceUrl);
  wavUrl=URL.createObjectURL(new Blob([audio.wav(take)!],{type:'audio/wav'}));
  traceUrl=URL.createObjectURL(new Blob([JSON.stringify({version:1,lesson:take.lesson,bpm:take.bpm,support:take.support,kind:take.kind,calibrated:take.calibrated,offset:take.offset,result:take.result,attacks:take.attacks},null,2)],{type:'application/json'}));
  player.src=wavUrl;el<HTMLAnchorElement>('trainer-download').href=wavUrl;el<HTMLAnchorElement>('trainer-trace').href=traceUrl;
  el<HTMLAnchorElement>('trainer-download').download=`guitar-${take.lesson}-${take.bpm}bpm.wav`;
  el('take-review').hidden=false;
  el('take-description').textContent=`${lessonById(take.lesson).title} · ${take.bpm} BPM · ${Math.round(20*Math.log10(take.levelGain))>=0?'+':''}${Math.round(20*Math.log10(take.levelGain))} dB auto level`;
}
audio.onTake=take=>{
  take.calibrated=progress.calibrated;sessionTakes++;sessionSeconds+=take.samples.length/take.rate;displayTake(take);
  const result=take.result;
  if(!result){feedback='Your answer is recorded. Listen for a clear beginning, some space and an ending you like.';return;}
  pending={take,skill:{...(attemptSkill ?? skill())}};
  progress.history.push({date:Date.now(),lesson:take.lesson,bpm:take.bpm,score:result.score,trusted:result.trusted && progress.calibrated});progress.history=progress.history.slice(-60);
  feedback=result.feedback;
  if(!progress.calibrated)feedback+=' Timing is an estimate until you calibrate; this take will not change your level.';
  if(placement!==undefined)feedback='Starting-point check: '+feedback;
  el('take-result').hidden=false;
  el('grade-metrics').innerHTML=`<span><strong>${Math.round(result.timing*100)}%</strong> timing${progress.calibrated?'':' · estimate'}</span><span>${result.pitch===null ? 'Rhythm only · no pitch score' : `<strong>${Math.round(result.pitch*100)}%</strong> notes`}</span>${result.articulation===null?'':`<span><strong>${Math.round(result.articulation*100)}%</strong> releases</span>`}`;
  el('grade-details').textContent=result.notes.map((n,i)=>`${i+1}: ${n.mark}${n.offset===undefined?'':` (${n.offset>=0?'+':''}${Math.round(n.offset*1000)} ms)`}`).join(' · ')+`${result.extras ? ` · ${result.extras} extra attacks` : ''}${!result.trusted ? ' · Unscored: '+result.reason : ''}`;
  el('trainer-comfortable').textContent=placement!==undefined ? 'Continue starting-point check' : 'Felt comfortable';
  paintCourse();persist();
};
audio.onCalibration=result=>{
  el('calibration-feedback').textContent=result.message;feedback=result.message;
  if(result.ok){progress.offset=result.offset;progress.calibrated=true;progress.calibrationKey=audio.deviceKey;el<HTMLInputElement>('trainer-offset').value=String(Math.round(result.offset*1000));persist();}
};
async function nextTake(comfortable:boolean):Promise<void> {
  const done=pending;if(!done?.take.result)return;
  pending=undefined;
  if(placement!==undefined){
    if(!done.take.result.trusted || !progress.calibrated){feedback='This check needs clear input and calibrated timing. You can also choose any lesson directly.';return;}
    if(placement===0 && done.take.result.score>=.9){selectLesson('crossing');placement=1;await start();return;}
    const id=placement===0 ? 'pulse' : done.take.result.score>=.9 ? 'phrase' : 'two-notes';selectLesson(id);feedback='Begin here. The course will adapt from these first phrases.';el<HTMLDetailsElement>('trainer-course').open=false;return;
  }
  const l=lessonById(done.take.lesson),before=done.skill;
  const change=advance(before,l,done.take.result,comfortable,Date.now(),progress.auto,progress.calibrated);
  progress.skills[l.id]=change.skill;feedback=change.message;
  if(change.skill.best>before.best)milestones.push(`${l.title}: independent at ${change.skill.best} BPM`);
  el<HTMLInputElement>('trainer-bpm').value=String(change.skill.bpm);paintCourse();persist();
  // Give the between-take recommendation time on screen; the player starts the next round.
  el('take-result').hidden=true;
  if(change.skill.mastered){
    el('trainer-next-lesson')?.remove();const button=document.createElement('button');button.id='trainer-next-lesson';button.textContent='Try the next lesson';
    button.onclick=()=>selectLesson(lessons[Math.min(lessons.length-1,lessons.findIndex(x=>x.id===l.id)+1)].id);el('trainer-feedback').after(button);
  }
}
el('trainer-start').onclick=()=>{void start();};el('trainer-demo').onclick=()=>{void start('demo');};el('trainer-create').onclick=()=>{void start('creative');};
function stop():void {audio.stop();player.pause();feedback='Stopped. Your last completed take is still available below.';}
el('trainer-stop').onclick=stop;player.onplay=()=>audio.stop();
el('trainer-comfortable').onclick=()=>{void nextTake(true);};el('trainer-struggling').onclick=()=>{void nextTake(false);};
el('trainer-loop').onclick=()=>{player.pause();feedback='Your take is looping. Play along freely; the microphone and grading are off.';void audio.playTake(audio.take,true).catch(e=>audio.error=String(e));};
el('trainer-latest').onclick=()=>{if(audio.take){displayTake(audio.take);player.play().catch(e=>audio.error=String(e));}};
el('trainer-previous').onclick=()=>{if(audio.previous){displayTake(audio.previous);player.play().catch(e=>audio.error=String(e));}};
el('course-list').onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-lesson]');if(button){selectLesson(button.dataset.lesson!);el<HTMLDetailsElement>('trainer-course').open=false;}};
el('trainer-guided').onclick=()=>{if(active())return;skill().support=0;skill().clean=0;skill().hard=0;pending=undefined;el('take-result').hidden=true;feedback='Moving cues are back. Your certified tempo is kept.';persist();};
el('trainer-recommend').onclick=()=>{const l=recommended(progress,Date.now());selectLesson(l.id);feedback=progress.skills[l.id]?.mastered ? 'A short review: carry this familiar phrase again, then move to a new idea.' : 'This is the next step in your course.';};
el('trainer-placement').onclick=()=>{if(!progress.calibrated){el<HTMLDetailsElement>('trainer-settings').open=true;feedback='Calibrate the audio timing first, or choose a lesson directly from the course.';el('trainer-calibrate').focus();return;}selectLesson('pulse');placement=0;void start();};
el<HTMLInputElement>('trainer-bpm').oninput=()=>{
  const input=el<HTMLInputElement>('trainer-bpm'),value=input.valueAsNumber;
  if(active()){input.value=String(skill().bpm);return;}
  if(!Number.isFinite(value) || value<40 || value>lesson.maxBpm){input.setAttribute('aria-invalid','true');return;}
  input.removeAttribute('aria-invalid');skill().bpm=Math.round(value);skill().clean=0;skill().hard=0;pending=undefined;el('take-result').hidden=true;persist();
};
el<HTMLInputElement>('trainer-bpm').onblur=()=>{const input=el<HTMLInputElement>('trainer-bpm');if(input.getAttribute('aria-invalid')==='true'){input.value=String(skill().bpm);input.removeAttribute('aria-invalid');}};
el<HTMLInputElement>('trainer-auto').checked=progress.auto;
el<HTMLInputElement>('trainer-auto').onchange=()=>{progress.auto=el<HTMLInputElement>('trainer-auto').checked;persist();};
el<HTMLInputElement>('trainer-offset').value=String(Math.round(progress.offset*1000));
el('trainer-use-offset').onclick=()=>{
  if(active())return;const value=el<HTMLInputElement>('trainer-offset').valueAsNumber;if(!Number.isFinite(value) || value<-.3*1000 || value>500){el('calibration-feedback').textContent='Enter an offset between -300 and 500 ms.';return;}
  progress.offset=value/1000;progress.calibrated=true;progress.calibrationKey=audio.deviceKey;persist();el('calibration-feedback').textContent=`Using your manual ${value} ms offset. Recheck it after changing audio devices.`;
};
el('trainer-calibrate').onclick=()=>{player.pause();pending=undefined;progress.calibrated=false;persist();feedback='Keep the guitar quiet. Let the microphone hear the eight clicks.';void audio.start(lesson,60,'calibration');};
el<HTMLSelectElement>('trainer-output').onchange=()=>{stop();audio.mode=el<HTMLSelectElement>('trainer-output').value==='speakers'?'speakers':'headphones';progress.calibrated=false;persist();feedback='Input processing changed. Recalibrate before saving tempo milestones.';};
el<HTMLInputElement>('trainer-volume').oninput=()=>{const value=el<HTMLInputElement>('trainer-volume').valueAsNumber;audio.setVolume(value);player.volume=value;el('trainer-volume-value').textContent=`${Math.round(value*100)}%`;};player.volume=.5;
el<HTMLInputElement>('trainer-click').onchange=()=>{audio.click=el<HTMLInputElement>('trainer-click').checked;};
el('string-tones').innerHTML=[...openStrings].reverse().map((m,i)=>`<button data-tone="${m}">${6-i} · ${nameOf(m)}</button>`).join('');
el('string-tones').onclick=event=>{const button=(event.target as HTMLElement).closest<HTMLElement>('[data-tone]');if(!button || active())return;const midi=Number(button.dataset.tone),string=openStrings.indexOf(midi)+1;tuning=true;feedback=`Reference ${nameOf(midi)} · string ${string}. Match the open string by ear.`;void audio.start({...lesson,beats:2,notes:[{beat:0,string,fret:0,length:1}]},60,'demo');};
el('trainer-finish').onclick=()=>{
  stop();const next=recommended(progress,Date.now());el('session-summary').hidden=false;
  el('session-summary').textContent=`${sessionTakes} takes · ${(sessionSeconds/60).toFixed(1)} minutes of playing. ${milestones.length ? milestones.join('. ')+'. ' : 'A little deliberate practice counts. '}Next time: ${next.title}.`;
};
let resetArmed=false;
el('trainer-reset').onclick=()=>{
  if(!resetArmed){resetArmed=true;el('trainer-reset').textContent='Click again to clear lesson progress';return;}
  stop();progress.skills={};progress.history=[];resetArmed=false;el('trainer-reset').textContent='Reset learning progress';selectLesson('pulse');feedback='Lesson progress cleared. Your timing calibration is retained.';
};
navigator.mediaDevices?.addEventListener('devicechange',()=>{progress.calibrated=false;persist();el('calibration-feedback').textContent='Audio devices changed. Recalibrate timing.';});
window.addEventListener('keydown',event=>{
  if(event.code==='Escape'){stop();return;}
  if(event.code==='Space'){if((event.target as HTMLElement).closest('input,button,select,textarea,a,summary,[contenteditable]'))return;event.preventDefault();if(event.repeat || active())return;const bpm=taps.tap(performance.now()/1000);if(bpm!==null){skill().bpm=Math.max(40,Math.min(lesson.maxBpm,Math.round(bpm)));skill().clean=0;skill().hard=0;pending=undefined;el('take-result').hidden=true;el('trainer-bpm').removeAttribute('aria-invalid');el<HTMLInputElement>('trainer-bpm').value=String(skill().bpm);persist();}return;}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden && active()){stop();feedback='Practice paused while the page was hidden. Start a fresh take when ready.';}});
const timer=window.setInterval(()=>audio.tick(),10);
window.addEventListener('pagehide',()=>{clearInterval(timer);audio.stop();player.pause();URL.revokeObjectURL(wavUrl);URL.revokeObjectURL(traceUrl);});
function paint():void {
  requestAnimationFrame(paint);const plan=audio.plan,now=audio.now,playing=Boolean(plan && now>=plan.playAt && now<plan.end),current=skill();
  const running=active();el<HTMLButtonElement>('trainer-stop').disabled=!running;
  for(const id of ['trainer-start','trainer-demo','trainer-create','trainer-calibrate','trainer-output','trainer-use-offset','trainer-placement','trainer-recommend','trainer-guided'])el<HTMLButtonElement>(id).disabled=running || id==='trainer-start' && el('trainer-bpm').getAttribute('aria-invalid')==='true';
  el<HTMLInputElement>('trainer-bpm').disabled=running;el<HTMLInputElement>('trainer-auto').disabled=running;
  el<HTMLInputElement>('trainer-click').disabled=Boolean(plan);el<HTMLInputElement>('trainer-offset').disabled=running;
  el<HTMLButtonElement>('trainer-comfortable').disabled=!pending || running;el<HTMLButtonElement>('trainer-struggling').disabled=!pending || running;
  el<HTMLButtonElement>('trainer-latest').disabled=!audio.take || Boolean(plan || audio.busy);
  el<HTMLButtonElement>('trainer-previous').disabled=!audio.previous || Boolean(plan || audio.busy);el<HTMLButtonElement>('trainer-loop').disabled=!audio.take || Boolean(plan || audio.busy);
  el('trainer-model').textContent=audio.model;el('trainer-model').classList.toggle('needs-attention',!audio.model.startsWith('CREPE ready'));
  el('trainer-mic').textContent=audio.busy ? audio.analysis ? 'Mic off · reviewing' : 'Preparing audio' : audio.micActive ? 'Mic listening' : 'Mic off';
  el('trainer-calibration-label').textContent=progress.calibrated ? `Timing offset ${Math.round(progress.offset*1000)} ms` : 'Timing not calibrated';el('trainer-calibration-label').classList.toggle('needs-attention',!progress.calibrated);
  el('setup-hint').textContent=progress.calibrated ? '· calibrated' : '· start here for accurate timing';
  el('trainer-tempo-help').textContent=running ? 'Fixed for this take' : current.best ? `Independent at ${current.best} BPM` : 'Your pace · Space to tap';
  let phase=audio.busy ? audio.analysis || 'Preparing audio…' : audio.playing || !player.paused ? 'Listen or play along' : 'Ready when you are';
  if(plan){
    const countAt=plan.playAt-4*plan.period;
    phase=plan.kind==='calibration' ? 'Measuring sound delay…' : plan.kind==='demo' || now<countAt ? tuning ? 'Open-string reference' : 'Listen to the phrase' : now<plan.playAt ? `Count in · ${Math.min(4,Math.max(1,Math.ceil((plan.playAt-now)/plan.period)))}` : now<plan.end ? `${plan.kind==='creative'?'Your answer':'Play'} · bar ${Math.floor((now-plan.playAt)/plan.period/4)+1} of ${lesson.beats/4}` : 'Listening to the ending…';
  }
  el('trainer-phase').textContent=phase;el('trainer-guidance').textContent=placement!==undefined ? `Starting-point check ${placement+1} / 2` : ['Follow the notes','Play from memory','Carry the pulse'][current.support];
  el('trainer-feedback').textContent=audio.error || feedback;
  el('phrase-text').hidden=playing && Boolean(current.support>0 || lesson.byEar);
  el('phrase-preview').style.visibility=playing && (current.support>0 || lesson.byEar) ? 'hidden' : 'visible';
  if(audio.micActive && audio.pitch>0)el('trainer-pitch').textContent=`Heard ${nameOf(69+12*Math.log2(audio.pitch/440))} · ${audio.pitch.toFixed(1)} Hz · ${Math.round(audio.confidence*100)}% confidence`;
  drawLane(el<HTMLCanvasElement>('trainer-lane'),lesson,current.bpm,tuning?undefined:plan,now,current.support,audio.take,reduced.matches);
}
selectLesson(lesson.id);paint();
