import { describe, expect, it } from 'vitest';
import { PhraseReply } from '../src/music/reply';
import type { ReplyNote } from '../src/music/reply';
import { sameMotif, MotifListener } from '../src/music/motif';
import { midiToHz } from '../src/music/notes';
const note = (t: number,midi: number,duration = 0.2) => ({t,hz:midiToHz(midi),midi,pitchClass:midi%12,cents:0,confidence:0.9,duration,velocity:0.6});
const motif = {beats:3.5,notes:[note(10,57.1),note(10.37,60),note(11,64)]};

describe('three finite phrase replies', () => {
  it('preserves actual pitch, uneven spacing, cycle pace and rests for exactly three passes', () => {
    const reply = new PhraseReply(motif,20,0.5), played = [];
    for (let now=19.9;now<30;now+=0.01) played.push(...reply.takeDue(now,0.04));
    expect(played).toHaveLength(9); expect(reply.endAt).toBe(25.25);
    played.forEach((played,i) => {
      const source = motif.notes[i%3];
      expect(played.hz).toBe(source.hz); expect(played.at).toBeCloseTo(20+Math.floor(i/3)*1.75+source.t-10);
      expect(played.fireAt).toBeCloseTo(played.at-0.04); expect(played.velocity).toBe(0.6);
    });
    expect(reply.takeDue(100,0)).toEqual([]);
  });
  it('clips ringing notes, including slightly late starts, so synthesized voices never overlap', () => {
    const reply = new PhraseReply({beats:1,notes:[note(0,57,10),note(0.1,60,10),note(0.49,64,10)]},1,0.5);
    const played: ReplyNote[] = [];
    for (let now=1.01;now<3;now+=0.01) played.push(...reply.takeDue(now,0));
    expect(played).toHaveLength(9);
    played.slice(1).forEach((next,i) => expect(played[i].fireAt+played[i].duration+0.005).toBeLessThanOrEqual(next.fireAt+1e-6));
    expect(played.at(-1)!.fireAt+played.at(-1)!.duration+0.005).toBeLessThanOrEqual(reply.endAt);
  });
  it('skips expired passes after a stalled tab instead of restarting the three-repeat budget', () => {
    const reply = new PhraseReply(motif,20,0.5);
    expect(reply.takeDue(23.5,0).map(n => n.at)).toEqual([23.5]);
    expect(reply.takeDue(100,0)).toEqual([]); expect(reply.scheduledAll).toBe(true);
  });
  it('compares rotated versions as one idea so ongoing playing cannot cause endless replies', () => {
    const rotated = {beats:3.5,notes:[note(0,60),note(0.63,64),note(1.38,57)]};
    expect(sameMotif(motif,rotated,0.5)).toBe(true);
    expect(sameMotif(motif,{...rotated,notes:[note(0,62),note(0.63,65),note(1.38,69)]},0.5)).toBe(false);
  });
  it('retains measured articulation from earlier passes when the last note is still ringing', () => {
    const listener = new MotifListener(0.5);
    for (let pass=0;pass<3;pass++) for (let i=0;i<3;i++) {
      const source = note(pass*2+i*0.5,[57,60,64][i]);
      listener.record({...source,duration:undefined});
      listener.finish(source.t,source.t+0.12);
    }
    listener.advance(6);
    expect(listener.motif?.notes[2].duration).toBeCloseTo(0.12);
  });
});
