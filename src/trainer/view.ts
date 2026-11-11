import { cueMidi, openStrings, type Lesson } from './curriculum';
import type { TrainerTake } from './audio';
import type { SessionPlan } from './session';
import { noteNames } from '../music/notes';
export const nameOf=(midi:number)=>`${noteNames[((Math.round(midi)%12)+12)%12]}${Math.floor(Math.round(midi)/12)-1}`;
export function trainerShell():void {
  document.querySelector('#app')!.innerHTML=`<main class="trainer">
    <nav class="app-nav" aria-label="Guitar tools"><a href="${import.meta.env.BASE_URL}" aria-current="page">Trainer</a><a href="${import.meta.env.BASE_URL}piece.html">Pieces</a><a href="${import.meta.env.BASE_URL}play.html?mode=partner">Partner</a><a href="${import.meta.env.BASE_URL}play.html?mode=looper">Looper</a><span>Your guitar. Your pace.</span></nav>
    <header class="trainer-header"><div><span class="eyebrow">GUITAR · A LITTLE EVERY DAY</span><h1>Find your rhythm.</h1><p class="intro">Listen. Play. Make it yours.</p></div><button id="trainer-stop" disabled>Stop · Esc</button></header>
    <div class="trainer-status"><span id="trainer-mic">Mic off</span><span id="trainer-model">CREPE loading</span><span id="trainer-calibration-label">Timing not calibrated</span></div>
    <section class="lesson-card" aria-labelledby="lesson-title">
      <div class="lesson-heading"><div><span id="lesson-stage" class="eyebrow"></span><h2 id="lesson-title"></h2></div><div class="trainer-tempo"><label for="trainer-bpm">BPM</label><input id="trainer-bpm" type="number" min="40" max="110" step="1" inputmode="numeric"><span id="trainer-tempo-help">A comfortable beginning</span></div></div>
      <p id="lesson-goal"></p>
      <div class="practice-state"><span id="trainer-phase" role="status">Ready when you are</span><span id="trainer-guidance"></span></div>
      <div class="lane-wrap"><canvas id="trainer-lane" width="1000" height="310" role="img" aria-label="Six guitar strings with notes approaching a timing line" aria-describedby="phrase-text"></canvas><div id="lane-help">Thin string at the top · numbers are frets · 0 means open</div></div>
      <p id="phrase-text" class="sr-only"></p><div id="phrase-preview" class="phrase-preview" aria-label="Phrase notes"></div>
      <div class="trainer-actions"><button id="trainer-start" class="primary">Start practice</button><button id="trainer-demo">Hear the phrase</button><button id="trainer-create">Make it yours</button></div>
      <p id="trainer-feedback" class="coach" role="status">One phrase, at a pace that leaves room to listen.</p>
      <div id="take-result" hidden><div id="grade-metrics" class="grade-metrics"></div><p id="grade-details" class="muted"></p><div class="comfort-actions"><button id="trainer-comfortable" class="primary">Felt comfortable</button><button id="trainer-struggling">Needs more room</button></div></div>
      <div id="take-review" hidden><div class="review-heading"><span>Hear yourself</span><span id="take-description" class="muted"></span></div><audio id="trainer-player" controls></audio><div class="review-actions"><button id="trainer-previous">Hear previous take</button><button id="trainer-latest">Hear latest take</button><button id="trainer-loop">Loop latest · play along</button><a id="trainer-download" download="guitar-practice.wav">Download WAV</a><a id="trainer-trace" download="guitar-practice.json">Note details</a></div><p class="muted">Playback stops the microphone. Looping is free play, with no score. Takes stay in this page.</p></div>
    </section>
    <div class="trainer-secondary">
      <details id="lesson-help" open><summary>The idea & your hands</summary><p id="lesson-theory"></p><div class="technique"><div id="fret-guide"></div><p id="lesson-technique"></p></div><p id="lesson-create" class="creative-prompt"></p><p class="muted">The mic checks sound, not finger choice, picking direction or posture. Keep movements comfortable; use the recording to judge tone.</p></details>
      <details id="trainer-course"><summary>Course & your progress <span id="course-count"></span></summary><p>Start where you feel comfortable. Each lesson remembers its own pace.</p><p>Three clear, comfortable takes at 90% or better move from cues to memory, then fewer clicks. Three independent takes certify the tempo and suggest 2 BPM more. Unclear recordings hold your progress.</p><div class="course-tools"><button id="trainer-placement">Find my starting point</button><button id="trainer-guided">Bring back the cues</button><button id="trainer-recommend">Today’s suggestion</button></div><div id="course-list"></div></details>
      <details id="trainer-settings"><summary>Sound & timing <span id="setup-hint">· start here for accurate timing</span></summary>
        <p>Use headphones while practising so the click stays out of the microphone. Tune to standard E A D G B E before a lesson. For scored melodies, quiet the previous string as you change strings so the mic hears one pitch at a time. Let chords ring in creative play.</p>
        <div class="tuner"><span id="trainer-pitch">Hear the open strings</span><div id="string-tones"></div></div>
        <label>Input processing <select id="trainer-output"><option value="headphones">Headphones · clean input</option><option value="speakers">Speakers · echo cancellation</option></select></label>
        <label>Demo & take volume <input id="trainer-volume" type="range" min="0" max="1" step=".01" value=".5"><output id="trainer-volume-value">50%</output></label>
        <label><input id="trainer-click" type="checkbox" checked> Metronome during practice</label>
        <label><input id="trainer-auto" type="checkbox" checked> Suggest tempo changes after steady takes</label>
        <label><input id="trainer-first-demo" type="checkbox" checked> Demonstrate a new lesson before my first take</label>
        <div class="calibration"><p><strong>Measure your sound delay</strong></p><p>Keep the guitar quiet. Hold one headphone earcup close to the microphone so it can hear eight short clicks. Keep the same audio devices for practice.</p><button id="trainer-calibrate">Calibrate with 8 clicks</button><p id="calibration-feedback" role="status">Practice is available now. Calibrate once to certify timing and tempo progress.</p><label for="trainer-offset">Manual input offset (ms)</label><div class="offset-row"><input id="trainer-offset" type="number" min="-300" max="500" step="1" value="0"><button id="trainer-use-offset">Use this offset</button></div><p class="muted">An offset corrects the audio path. Do not use it to hide a habit of playing early or late. Recalibrate after changing devices or input processing.</p></div>
      </details>
      <details id="trainer-journal"><summary>Your practice today</summary><p id="session-plan">Start with a little review, spend five minutes on one idea, then make your own answer.</p><div id="journal-list"></div><button id="trainer-finish">Finish this session</button><div id="session-summary" role="status" hidden></div><button id="trainer-reset">Reset learning progress</button><p id="storage-status" class="muted">Progress stays in this browser. Audio is never saved automatically.</p></details>
    </div>
    <footer><span><kbd>Space</kbd> tap tempo while stopped</span><span><kbd>Esc</kbd> stop everything</span><span id="trainer-footer">13 small lessons · six connected skills</span></footer>
  </main>`;
}
export function fretGuide(lesson:Lesson):string {
  const positions=[...new Map(lesson.notes.map(n=>[`${n.string}:${n.fret}`,n])).values()];
  return `<svg viewBox="0 0 310 160" role="img" aria-label="Suggested note positions, thin string at top">${Array.from({length:6},(_,i)=>`<line x1="48" x2="292" y1="${24+i*23}" y2="${24+i*23}" stroke="#657268" stroke-width="${1+i*.15}"/><text x="8" y="${28+i*23}" fill="#a5b4a8" font-size="12">${i+1} ${noteNames[openStrings[i]%12]}</text>`).join('')}${Array.from({length:5},(_,i)=>`<line x1="${65+i*55}" x2="${65+i*55}" y1="18" y2="144" stroke="#798776" stroke-width="${i===0?4:1}"/>${i?`<text x="${38+i*55}" y="12" fill="#a5b4a8" font-size="10">${i}</text>`:''}`).join('')}${positions.map(n=>`<circle cx="${n.fret ? 38+n.fret*55 : 51}" cy="${24+(n.string-1)*23}" r="9" fill="#c8d8a7"/><text x="${n.fret ? 38+n.fret*55 : 51}" y="${28+(n.string-1)*23}" text-anchor="middle" font-size="10" fill="#17211b">${n.fret}</text>`).join('')}</svg>`;
}
export function drawLane(canvas:HTMLCanvasElement,lesson:Lesson,bpm:number,plan:SessionPlan|undefined,now:number,support:number,take:TrainerTake|undefined,reduced=false):void {
  const w=Math.max(280,Math.round(canvas.clientWidth)),small=w<600,h=small?230:310,dpr=Math.min(2,devicePixelRatio || 1);
  if(canvas.width!==Math.round(w*dpr) || canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  canvas.style.height=`${h}px`;
  const p=canvas.getContext('2d')!;p.setTransform(dpr,0,0,dpr,0,0);
  p.clearRect(0,0,w,h);p.fillStyle='#171f1b';p.fillRect(0,0,w,h);
  const active=plan && plan.kind!=='calibration',playing=active && now>=plan.playAt && now<plan.end;
  const beat=active ? (now-plan.playAt)/plan.period : 0;
  const hit=small?88:160,scale=small?82:140,row=(h-65)/6,yOf=(string:number)=>35+(string-1)*row;
  const previewBeats=small?Math.min(4,lesson.beats):lesson.beats;
  p.font='13px Segoe UI';p.textBaseline='middle';
  for(let i=0;i<6;i++) {
    const y=yOf(i+1);p.strokeStyle=lesson.notes.some(n=>n.string===i+1) ? '#536550' : '#303e35';p.lineWidth=1+i*.15;
    p.beginPath();p.moveTo(55,y);p.lineTo(w-12,y);p.stroke();p.fillStyle='#a9b6a6';p.fillText(`${i+1}  ${noteNames[openStrings[i]%12]}`,10,y);
  }
  const hideNotes=Boolean(playing && (support>0 || lesson.byEar));
  if(active && !reduced) {
    for(let b=Math.max(0,Math.floor(beat)-1);b<=Math.min(lesson.beats,beat+6);b++) {
      const x=hit+(b-beat)*scale;if(x<70 || x>w-20)continue;
      p.strokeStyle=b%4===0 ? '#566c4c' : '#2b3930';p.lineWidth=1;p.beginPath();p.moveTo(x,24);p.lineTo(x,h-24);p.stroke();p.fillStyle='#82967d';p.fillText(String(b%4+1),x+5,15);
    }
  }
  if(!hideNotes)lesson.notes.forEach((cue,index)=>{
    const moving=active && !reduced;
    const previewFrom=reduced && playing && small ? Math.floor(beat/4)*4 : 0;
    if(!moving && (cue.beat<previewFrom || cue.beat>=previewFrom+previewBeats))return;
    const x=moving ? hit+(cue.beat-beat)*scale : 76+(cue.beat-previewFrom)/previewBeats*(w-98),y=yOf(cue.string);
    if(x<60 || x>w-12)return;
    const graded=!plan && take?.lesson===lesson.id ? take.result?.notes[index] : undefined;
    const colour=graded ? graded.mark==='good' ? '#c8d8a7' : graded.mark==='uncertain' ? '#9ea79b' : '#e1ad88' : '#c8d8a7';
    const tail=Math.min(w-x-12,cue.length*(moving ? scale : (w-98)/previewBeats));
    p.fillStyle=colour;p.globalAlpha=.25;p.fillRect(x,y-4,tail,8);p.globalAlpha=1;
    if(cue.damp){p.strokeStyle=colour;p.beginPath();p.moveTo(x+tail,y-8);p.lineTo(x+tail,y+8);p.stroke();}
    p.beginPath();p.arc(x,y,small?10:cue.accent?16:13,0,Math.PI*2);p.fill();p.fillStyle='#172018';p.font=`bold ${small?12:13}px Segoe UI`;p.textAlign='center';p.fillText(lesson.rhythmOnly ? '×' : String(cue.fret),x,y);p.textAlign='left';
    p.fillStyle=colour;p.font=`${small?9:11}px Segoe UI`;p.fillText(lesson.rhythmOnly ? 'strum' : nameOf(cueMidi(cue)),x-10,y+(small?18:23));
  });
  if(active && !reduced){p.strokeStyle='#d8e4c5';p.lineWidth=2;p.beginPath();p.moveTo(hit,25);p.lineTo(hit,h-25);p.stroke();}
  if(hideNotes){p.fillStyle='#c8d8a7';p.font=`${small?15:20}px Segoe UI`;p.textAlign='center';p.fillText(support===2 ? 'Carry the pulse.' : 'You know the phrase.',w*.6,h*.5);p.textAlign='left';}
  if(small && !active){p.fillStyle='#91a48d';p.font='10px Segoe UI';p.fillText('First bar preview · hear the phrase for all bars',12,h-14);}
  if(reduced && playing){p.fillStyle='#c8d8a7';p.font='18px Segoe UI';p.fillText(`Beat ${Math.floor(beat)%4+1}`,w-100,15);}
}
