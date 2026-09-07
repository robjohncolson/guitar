import { lessonById, lessons, type Lesson } from './curriculum';
import type { Grade } from './grader';
export const progressKey='guitar.trainer.v1';
export interface Skill { bpm:number; best:number; support:0|1|2; clean:number; hard:number; attempts:number; mastered:boolean; due:number; last:number }
export interface History { date:number; lesson:string; bpm:number; score:number; trusted:boolean }
export interface Progress { version:1; selected:string; skills:Record<string,Skill>; history:History[]; offset:number; calibrated:boolean; calibrationKey:string; auto:boolean }
const bounded=(n:unknown,min:number,max:number,fallback:number)=>typeof n==='number' && Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : fallback;
export const initialSkill=(lesson:Lesson):Skill=>({bpm:lesson.startBpm,best:0,support:0,clean:0,hard:0,attempts:0,mastered:false,due:0,last:0});
export function parseProgress(raw:string|null):Progress {
  const result:Progress={version:1,selected:lessons[0].id,skills:{},history:[],offset:0,calibrated:false,calibrationKey:'',auto:true};
  try {
    const value=JSON.parse(raw ?? '{}'); if(!value || value.version!==1) return result;
    result.selected=lessonById(value.selected).id;
    result.offset=bounded(value.offset,-.3,.5,0); result.calibrated=value.calibrated===true; result.auto=value.auto!==false;
    result.calibrationKey=typeof value.calibrationKey==='string' && value.calibrationKey.length<300 ? value.calibrationKey : '';
    for(const lesson of lessons) {
      const saved=value.skills?.[lesson.id]; if(!saved || typeof saved!=='object') continue;
      result.skills[lesson.id]={bpm:Math.round(bounded(saved.bpm,40,lesson.maxBpm,lesson.startBpm)),best:Math.round(bounded(saved.best,0,lesson.maxBpm,0)),support:Math.round(bounded(saved.support,0,2,0)) as 0|1|2,clean:0,hard:0,attempts:Math.floor(bounded(saved.attempts,0,100000,0)),mastered:saved.mastered===true,due:bounded(saved.due,0,1e14,0),last:bounded(saved.last,0,1e14,0)};
    }
    if(Array.isArray(value.history)) result.history=value.history.filter((h:any)=>h && lessons.some(l=>l.id===h.lesson) && Number.isFinite(h.date) && h.date>=0 && Number.isFinite(h.bpm) && h.bpm>=40 && h.bpm<=120 && Number.isFinite(h.score) && h.score>=0 && h.score<=1).slice(-60).map((h:any)=>({date:h.date,lesson:h.lesson,bpm:h.bpm,score:h.score,trusted:h.trusted===true}));
  } catch { /* An unavailable or old save never blocks practice. */ }
  return result;
}
export function loadProgress():Progress {try{return parseProgress(localStorage.getItem(progressKey));}catch{return parseProgress(null);}}
export function saveProgress(progress:Progress):boolean {try{localStorage.setItem(progressKey,JSON.stringify(progress));return true;}catch{return false;}}
/** A recommendation for the NEXT attempt. Never changes an active musical clock. */
export function advance(skill:Skill,lesson:Lesson,result:Grade,comfortable:boolean,now:number,auto=true,calibrated=true):{skill:Skill;message:string} {
  const next={...skill};
  if(!result.trusted || !calibrated) return {skill:next,message:!calibrated ? 'Calibrate timing to save tempo milestones. You can keep practising meanwhile.' : 'Same lesson, same tempo. Unclear input does not count against you.'};
  next.attempts++; next.last=now;
  const clean=result.score>=.9 && comfortable;
  if(clean) {next.clean++;next.hard=0;} else {next.clean=0;next.hard=result.score<.65 || !comfortable ? next.hard+1 : 0;}
  if(next.hard>=2) {
    next.hard=0; next.clean=0;
    if(auto) next.bpm=Math.max(40,next.bpm-4);
    return {skill:next,message:auto ? `Make room for the movement. Next take: ${next.bpm} BPM.` : 'Try a slower tempo or practise just the difficult change.'};
  }
  if(next.clean<3) return {skill:next,message:clean ? `${next.clean} of 3 steady, comfortable takes at this tempo.` : 'Keep this tempo. Work on one detail from the take.'};
  next.clean=0;
  if(next.support<2) {
    next.support=(next.support+1) as 1|2;
    return {skill:next,message:next.support===1 ? 'Keep this tempo. Next, play from memory with the full click.' : 'Keep this tempo. Next, carry the pulse with fewer clicks.'};
  }
  next.best=Math.max(next.best,next.bpm); next.mastered=true; next.due=now+86400000;
  if(auto) next.bpm=Math.min(lesson.maxBpm,next.bpm+2);
  return {skill:next,message:`You carried the phrase independently at ${skill.bpm} BPM. ${auto && next.bpm>skill.bpm ? `Next practice: ${next.bpm} BPM.` : 'Try a variation or move to the next lesson.'}`};
}
export function recommended(progress:Progress,now:number):Lesson {
  const due=lessons.filter(l=>progress.skills[l.id]?.mastered && progress.skills[l.id].due<=now).sort((a,b)=>progress.skills[a.id].due-progress.skills[b.id].due)[0];
  return due ?? lessons.find(l=>!progress.skills[l.id]?.mastered) ?? lessonById(progress.selected);
}
