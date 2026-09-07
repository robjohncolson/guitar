import { expect, it } from 'vitest';
import { cueMidi, lessons, openStrings } from '../src/trainer/curriculum';
import { grade, type Evidence } from '../src/trainer/grader';
const lesson=lessons[2];
const clean=():Evidence=>({coverage:1,clipped:0,attacks:lesson.notes.map(n=>({t:n.beat,midi:cueMidi(n)-.2,confidence:.9}))});
it('provides a playable course through six stages with valid frets, timing and musical instruction',()=>{
  expect(new Set(lessons.map(l=>l.id)).size).toBe(lessons.length);
  expect(new Set(lessons.map(l=>l.stage)).size).toBe(6);
  for(const l of lessons) {
    expect(l.notes.length).toBeGreaterThan(2); expect(l.theory.length).toBeGreaterThan(30); expect(l.technique.length).toBeGreaterThan(30); expect(l.create.length).toBeGreaterThan(20);
    expect(l.startBpm).toBeGreaterThanOrEqual(50); expect(l.maxBpm).toBeLessThanOrEqual(120);
    let last=-1;
    for(const n of l.notes) {expect(n.beat).toBeGreaterThan(last);last=n.beat;expect(n.beat+n.length).toBeLessThanOrEqual(l.beats);expect(openStrings[n.string-1]).toBeDefined();expect(n.fret).toBeGreaterThanOrEqual(0);expect(n.fret).toBeLessThanOrEqual(4);}
  }
});
it('accepts a clean phrase with natural tuning and a measured audio offset',()=>{
  const evidence=clean(); evidence.attacks.forEach(a=>a.t+=.12);
  const result=grade(lesson,60,evidence,.12);
  expect(result.trusted).toBe(true); expect(result.score).toBe(1); expect(result.offset).toBeCloseTo(0);
});
it('separates a wrong note from late timing instead of snapping either onto the target',()=>{
  const evidence=clean(); evidence.attacks[1].midi=52; evidence.attacks[2].t+=.22;
  const result=grade(lesson,60,evidence);
  expect(result.notes.map(n=>n.mark)).toEqual(['good','wrong','late','good']); expect(result.pitch).toBe(.75); expect(result.timing).toBe(.75);
});
it('matches once per attack, penalizes extras in spaces and does not reward a missing note',()=>{
  const evidence=clean(); evidence.attacks.splice(1,1); evidence.attacks.push({t:3,midi:45,confidence:.9},{t:4.15,midi:45,confidence:.9});
  const result=grade(lesson,60,evidence);
  expect(result.notes.filter(n=>n.mark==='missed')).toHaveLength(1); expect(result.extras).toBe(2); expect(result.score).toBeLessThan(.5);
});
it('treats healthy silence as missed playing, but uncertain pitch or broken capture as unscorable',()=>{
  const silent=grade(lesson,60,{attacks:[],coverage:1,clipped:0}); expect(silent.trusted).toBe(true); expect(silent.score).toBe(0);
  for(const change of [{coverage:.6},{clipped:.02},{interrupted:true}]) expect(grade(lesson,60,{...clean(),...change}).trusted).toBe(false);
  const uncertain=clean(); uncertain.attacks[0].confidence=.2; expect(grade(lesson,60,uncertain).trusted).toBe(false);
});
it('checks deliberate note releases without treating an ordinary ringing gap as a failure',()=>{
  const rests=lessons.find(l=>l.id==='rests')!;
  const attacks=rests.notes.map(n=>({t:n.beat,midi:cueMidi(n),confidence:.9,duration:n.length}));
  expect(grade(rests,60,{attacks,coverage:1,clipped:0}).articulation).toBe(1);
  attacks[1].duration=2.5; const long=grade(rests,60,{attacks,coverage:1,clipped:0}); expect(long.notes[1].articulation).toBe('long');expect(long.score).toBe(.75);
  expect(grade(lesson,60,clean()).articulation).toBeNull();
});
it('grades muted strumming rhythm without claiming that a chord was identified',()=>{
  const strum=lessons.find(l=>l.rhythmOnly)!;
  const result=grade(strum,60,{attacks:strum.notes.map(n=>({t:n.beat})),coverage:1,clipped:0});
  expect(result.trusted).toBe(true);expect(result.pitch).toBeNull();expect(result.score).toBe(1);
});
