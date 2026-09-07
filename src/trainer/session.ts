import { cueMidi, type Lesson } from './curriculum';
export type SessionKind='practice'|'demo'|'creative'|'calibration';
export interface SessionPlan {kind:SessionKind;start:number;playAt:number;end:number;finish:number;period:number;support:number;events:SoundEvent[]}
export interface SoundEvent {at:number;kind:'click'|'note'|'calibration';midi?:number;length:number;accent?:boolean}
/** All musical boundaries are absolute audio-clock times. */
export function planSession(lesson:Lesson,bpm:number,now:number,kind:SessionKind,support=0,demonstrate=false):SessionPlan {
  const period=60/bpm,start=now+.4, events:SoundEvent[]=[];
  if(kind==='calibration') {
    for(let i=0;i<8;i++)events.push({at:start+.3+i*.6,kind:'calibration',length:.008});
    return {kind,start,playAt:start,end:start+5.4,finish:start+5.6,period:1,support:0,events};
  }
  const demo=kind==='demo' || demonstrate, demoLength=demo ? lesson.beats*period : 0;
  if(demo)lesson.notes.forEach((note,i)=>events.push({at:start+note.beat*period,kind:'note',midi:cueMidi(note),length:Math.min(note.length*period,((lesson.notes[i+1]?.beat ?? lesson.beats)-note.beat)*period-.01),accent:note.accent}));
  if(kind==='demo') return {kind,start,playAt:start,end:start+demoLength,finish:start+demoLength+.1,period,support,events};
  const countAt=start+demoLength+(demo ? period : 0),playAt=countAt+4*period,end=playAt+lesson.beats*period;
  for(let i=0;i<4;i++)events.push({at:countAt+i*period,kind:'click',length:.01,accent:i===0});
  for(let i=0;i<lesson.beats;i++) if(support<2 || i%4===0) events.push({at:playAt+i*period,kind:'click',length:.01,accent:i%4===0});
  return {kind,start,playAt,end,finish:end+.65,period,support,events:events.sort((a,b)=>a.at-b.at)};
}
