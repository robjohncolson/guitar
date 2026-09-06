import { describe, expect, it } from 'vitest';
import { Companion } from '../src/music/companion';
import { midiToHz } from '../src/music/notes';
import type { ReplyNote } from '../src/music/reply';
const note = (t: number,midi: number) => ({t,hz:midiToHz(midi),midi,pitchClass:midi%12,cents:0,confidence:0.9,velocity:0.6,duration:0.2});
const establish = (partner: Companion, start: number, pitches = [57,60,64], cycle = 2) => {
  for (let pass=0;pass<3;pass++) pitches.forEach((midi,i) => partner.accept(note(start+pass*cycle+i*cycle/4,midi)));
};
const companion = () => { const result = new Companion(); result.reset(0,0.5); return result; };
function play(partner: Companion,from: number,to: number): ReplyNote[] {
  const notes: ReplyNote[] = [];
  for (let now=from;now<to;now+=0.01) notes.push(...partner.takeDue(now,0.04));
  return notes;
}

describe('finite exchanges with continuous listening', () => {
  it('aligns to a learned pulse without losing the notes already heard or their articulation', () => {
    const partner = new Companion(); partner.reset(0,0.6);
    for (let i=0;i<8;i++) partner.accept(note(1+Math.floor(i/3)*2+(i%3)*0.5,[57,60,64][i%3]));
    expect(partner.listener.repetitions).toBe(2);
    partner.alignPulse(1,0.5);
    expect(partner.listener.repetitions).toBe(2);
    partner.accept(note(6,64));
    expect(partner.waiting?.beats).toBe(4);
    const notes = play(partner,6.1,15);
    expect(notes).toHaveLength(9); expect(notes[0].at).toBe(7); expect(notes[0].duration).toBe(0.2);
  });
  it('preserves a waiting phrase in seconds when the initial estimated tempo changes', () => {
    const partner = companion(); establish(partner,0);
    partner.alignPulse(0.2,0.75);
    expect(partner.waiting!.beats*0.75).toBe(2);
    const notes = play(partner,5.1,15);
    expect(notes).toHaveLength(9); expect(notes[3].at-notes[0].at).toBeCloseTo(2);
    expect(() => partner.alignPulse(0,0.5)).toThrow('before replies begin');
  });
  it('waits for three phrases, replies three times, then stays silent without a manual reset', () => {
    const partner = companion();
    for (let pass=0;pass<2;pass++) [57,60,64].forEach((midi,i) => {
      const t = pass*2+i*0.5; partner.accept(note(t,midi)); expect(partner.takeDue(t+0.1,0.04)).toEqual([]);
    });
    [57,60,64].forEach((midi,i) => partner.accept(note(4+i*0.5,midi)));
    const notes = play(partner,5.1,20);
    expect(notes).toHaveLength(9); expect(notes[0].at).toBe(6);
    expect(notes.map(n => n.midi)).toEqual([57,60,64,57,60,64,57,60,64]);
    expect(partner.active).toBeUndefined(); expect(partner.takeDue(100,0)).toEqual([]);
  });
  it('learns a different phrase during playback and hands it over without overlapping or interrupting', () => {
    const partner = companion(); establish(partner,0); partner.takeDue(5.1,0.04);
    const first = partner.active!;
    establish(partner,6.1,[62,65,69],1); // All three new performances occur during the first reply.
    expect(partner.waiting?.notes.map(n => n.midi)).toEqual([62,65,69]);
    expect(partner.active).toBe(first);
    const notes = play(partner,5.8,20);
    expect(notes).toHaveLength(18);
    expect(notes.slice(0,9).map(n => n.midi)).toEqual([57,60,64,57,60,64,57,60,64]);
    expect(notes[9].at).toBeGreaterThanOrEqual(first.endAt);
    expect(notes.slice(9).map(n => n.midi)).toEqual([62,65,69,62,65,69,62,65,69]);
    notes.slice(1).forEach((next,i) => expect(notes[i].fireAt+notes[i].duration+0.005).toBeLessThanOrEqual(next.fireAt));
  });
  it('keeps only the latest new idea waiting, and repeating the old idea cannot loop forever', () => {
    const partner = companion(); establish(partner,0); partner.takeDue(5.1,0);
    establish(partner,6,[57,60,64]); expect(partner.waiting).toBeUndefined();
    establish(partner,12,[62,65,69]); establish(partner,18,[64,67,71]);
    expect(partner.waiting?.notes.map(n => n.midi)).toEqual([64,67,71]);
    // Expired playback is not replayed after a stalled scheduler.
    expect(partner.takeDue(23.1,0)).toEqual([]); expect(partner.active?.startAt).toBe(24);
    expect(play(partner,23.8,40)).toHaveLength(9);
    establish(partner,40,[64,67,71]); expect(partner.waiting).toBeUndefined();
    expect(play(partner,45.1,60)).toEqual([]);
  });
  it('replays a repeated phrase even when its notes do not form a chord', () => {
    const partner = companion(); establish(partner,0,[57,58,59]);
    expect(play(partner,5.1,14).map(n => n.midi)).toEqual([57,58,59,57,58,59,57,58,59]);
  });
  it('mute keeps the finite clock running and a queued new idea waits for unmute', () => {
    const partner = companion(); establish(partner,0); partner.takeDue(5.1,0);
    partner.setMuted(true); establish(partner,6,[62,65,69]);
    expect(partner.takeDue(20,0)).toEqual([]); expect(partner.active).toBeUndefined(); expect(partner.waiting).toBeDefined();
    partner.setMuted(false); expect(partner.takeDue(20,0)).toEqual([]);
    expect(partner.active?.startAt).toBe(22); expect(play(partner,21.9,30)).toHaveLength(9);
  });
  it('masks output, keeps listening to other pitches, and a reset clears the active and waiting ideas', () => {
    const partner = companion(); establish(partner,0); partner.takeDue(5.1,0.04);
    const first = partner.takeDue(5.9,0.04)[0]; partner.scheduled(first,0.04);
    expect(partner.accept(note(6.1,57))).toBe(false); expect(partner.accept(note(6.1,69))).toBe(false);
    expect(partner.accept(note(6.1,62))).toBe(true);
    partner.mask.release(6.15); expect(partner.accept(note(6.25,57))).toBe(true);
    establish(partner,7,[62,65,69]); expect(partner.waiting).toBeDefined();
    partner.reset(12,0.75,12); expect(partner.active).toBeUndefined(); expect(partner.waiting).toBeUndefined();
    expect(partner.accept(note(11.9,57))).toBe(false); expect(partner.takeDue(30,0)).toEqual([]);
    establish(partner,31); expect(partner.waiting).toBeDefined();
  });
});
