import { expect, it } from 'vitest';
import { lessons } from '../src/trainer/curriculum';
import { advance, initialSkill, parseProgress, recommended } from '../src/trainer/progress';
import { grade } from '../src/trainer/grader';
const lesson=lessons[0], good=grade(lesson,60,{attacks:lesson.notes.map(n=>({t:n.beat,midi:45,confidence:.9})),coverage:1,clipped:0});
it('reduces guidance before certifying a tempo, then raises only the next attempt by two BPM',()=>{
  let skill=initialSkill(lesson);
  for(let i=0;i<9;i++) skill=advance(skill,lesson,good,true,1000+i).skill;
  expect(skill).toMatchObject({bpm:52,best:50,support:2,mastered:true,attempts:9}); expect(skill.due).toBeGreaterThan(86400000);
});
it('holds progress for an unclear take or uncalibrated timing and honours the comfort check',()=>{
  const original={...initialSkill(lesson),clean:2};
  expect(advance(original,lesson,{...good,trusted:false},true,1).skill).toEqual(original);
  expect(advance(original,lesson,good,true,1,true,false).skill).toEqual(original);
  const strained=advance(original,lesson,good,false,1).skill; expect(strained.clean).toBe(0); expect(strained.support).toBe(0);
  expect(advance(strained,lesson,good,false,2).skill.bpm).toBe(46);
});
it('does not lower tempo after one miss and keeps fixed-tempo practice fixed',()=>{
  const bad={...good,score:0}, first=advance(initialSkill(lesson),lesson,bad,true,1).skill;
  expect(first.bpm).toBe(50); expect(advance(first,lesson,bad,true,2,false).skill.bpm).toBe(50);
});
it('restores only bounded known progress and reviews a previously mastered lesson when due',()=>{
  const progress=parseProgress(JSON.stringify({version:1,selected:'missing',offset:Infinity,skills:{pulse:{bpm:999,best:999,support:50,mastered:true,due:1},other:{bpm:123}},history:[{date:0,lesson:'unknown',score:1,bpm:60}],audio:[1,2,3]}));
  expect(progress.selected).toBe('pulse'); expect(progress.skills.pulse.bpm).toBe(100);expect(progress.skills.pulse.support).toBe(2);expect(progress.skills.other).toBeUndefined();expect(progress.history).toHaveLength(0);expect(progress).not.toHaveProperty('audio');
  expect(recommended(progress,2).id).toBe('pulse'); expect(recommended(progress,0).id).toBe('quarters');
  expect(parseProgress('null')).toEqual(parseProgress(null)); expect(parseProgress('{')).toEqual(parseProgress(null));
});
