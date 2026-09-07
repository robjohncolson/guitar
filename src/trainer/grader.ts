import { cueMidi, type Lesson } from './curriculum';
export interface Attack { t:number; midi?:number; confidence?:number; duration?:number; level?:number }
export interface Evidence { attacks:Attack[]; coverage:number; clipped:number; interrupted?:boolean }
export type Mark='good'|'early'|'late'|'wrong'|'missed'|'uncertain';
export interface GradeNote { index:number; mark:Mark; offset?:number; heard?:number; articulation?:'good'|'short'|'long'|'uncertain' }
export interface Grade {
  trusted:boolean; reason:string; notes:GradeNote[]; timing:number; pitch:number|null; articulation:number|null;
  extras:number; coverage:number; score:number; feedback:string; offset:number;
}
/** Monotonic one-to-one matching. Pitch never moves a clearly played attack onto a different beat. */
export function grade(lesson:Lesson,bpm:number,evidence:Evidence,offset=0):Grade {
  const period=60/bpm, duration=lesson.beats*period;
  const attacks=evidence.attacks.filter(a=>Number.isFinite(a.t) && a.t-offset>=-.4 && a.t-offset<=duration+.3)
    .map(a=>({...a,t:a.t-offset})).sort((a,b)=>a.t-b.t).slice(0,256);
  const targets=lesson.notes, rows=targets.length+1, cols=attacks.length+1;
  const cost=Array.from({length:rows},()=>new Float64Array(cols)), path=Array.from({length:rows},()=>new Uint8Array(cols));
  for(let i=1;i<rows;i++) {cost[i][0]=i;path[i][0]=1;}
  for(let j=1;j<cols;j++) {cost[0][j]=j;path[0][j]=2;}
  const window=Math.min(.13,period*.16), reach=Math.min(.4,period*.45);
  for(let i=1;i<rows;i++) for(let j=1;j<cols;j++) {
    const error=Math.abs(attacks[j-1].t-targets[i-1].beat*period);
    const matched=error<=reach ? cost[i-1][j-1]+error/reach : Infinity;
    const missing=cost[i-1][j]+1, extra=cost[i][j-1]+1;
    if(matched<=missing && matched<=extra) {cost[i][j]=matched;path[i][j]=0;}
    else if(missing<=extra) {cost[i][j]=missing;path[i][j]=1;} else {cost[i][j]=extra;path[i][j]=2;}
  }
  const paired=new Map<number,Attack>(); let extras=0;
  for(let i=rows-1,j=cols-1;i || j;) {
    if(i && j && path[i][j]===0) {paired.set(--i,attacks[--j]);}
    else if(i && (!j || path[i][j]===1)) i--; else {extras++;j--;}
  }
  let timing=0,pitch=0,articulation=0,artCount=0,unknown=0;
  const offsets:number[]=[];
  const notes=targets.map((cue,index):GradeNote=>{
    const attack=paired.get(index);
    if(!attack) return {index,mark:'missed'};
    const delta=attack.t-cue.beat*period; offsets.push(delta);
    const inTime=Math.abs(delta)<=window; if(inTime) timing++;
    const certain=lesson.rhythmOnly || attack.midi!==undefined && (attack.confidence ?? 0)>=.5;
    const correct=lesson.rhythmOnly || certain && Math.abs(attack.midi!-cueMidi(cue))<=.65;
    if(!certain) unknown++; else if(correct) pitch++;
    let articulationMark:GradeNote['articulation'];
    if(cue.damp) {
      artCount++;
      if(attack.duration===undefined) {articulationMark='uncertain';unknown++;}
      else if(attack.duration<cue.length*period-.2) articulationMark='short';
      else if(attack.duration>cue.length*period+.2) articulationMark='long';
      else {articulationMark='good';articulation++;}
    }
    return {index,mark:!certain ? 'uncertain' : !correct ? 'wrong' : !inTime ? delta<0 ? 'early' : 'late' : 'good',offset:delta,heard:attack.midi,articulation:articulationMark};
  });
  const count=targets.length, confidenceProblem=unknown>Math.max(0,count*.15);
  const reason=evidence.interrupted ? 'Audio timing was interrupted. This take will not change your progress.' : evidence.coverage<.9 ? 'The microphone recording had gaps. This take could not be judged.' : evidence.clipped>.005 ? 'The input distorted. Move a little farther from the microphone and try again.' : confidenceProblem ? 'Some notes were unclear. This take will not change your progress.' : '';
  const timingScore=Math.max(0,(timing-extras)/count), pitchScore=lesson.rhythmOnly ? null : pitch/count, artScore=artCount ? articulation/artCount : null;
  const score=Math.max(0,Math.min(timingScore,pitchScore ?? 1,artScore ?? 1));
  const wrong=notes.filter(n=>n.mark==='wrong').length, missed=notes.filter(n=>n.mark==='missed').length;
  const early=notes.filter(n=>n.mark==='early').length, late=notes.filter(n=>n.mark==='late').length;
  let feedback=reason || (wrong ? 'Keep the rhythm; review the highlighted note positions.' : missed ? 'Leave time to prepare the next note. Follow the count through the whole phrase.' : extras ? 'Use one clear pluck for each cue. Keep counting through the gaps.' : notes.some(n=>n.articulation==='long') ? 'Touch the string sooner so the marked rests become quiet.' : notes.some(n=>n.articulation==='short') ? 'Let the short notes last a little longer before muting.' : late>early ? 'Anticipate the next beat; several attacks arrived a little late.' : early ? 'Give each beat its full space; several attacks arrived early.' : 'Steady notes and a clear pulse. Notice how that felt in your hands.');
  offsets.sort((a,b)=>a-b);
  return {trusted:!reason,reason,notes,timing:timingScore,pitch:pitchScore,articulation:artScore,extras,coverage:evidence.coverage,score,feedback,offset:offsets.length ? offsets[Math.floor(offsets.length/2)] : 0};
}
