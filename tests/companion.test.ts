import { describe, expect, it } from 'vitest';
import { Companion } from '../src/music/companion';
import { midiToHz } from '../src/music/notes';
import type { NoteOn } from '../src/music/notes';
import type { ReplyNote } from '../src/music/reply';
const note = (t: number,midi: number): NoteOn => ({t,hz:midiToHz(midi),midi,pitchClass:midi%12,cents:0,confidence:0.9,velocity:0.6,duration:0.2});
const phrase = (start: number,pitches = [57,60,64],cycle = 2,passes = 3) =>
  Array.from({length:passes},(_,pass) => pitches.map((midi,i) => note(start+pass*cycle+i*cycle/4,midi))).flat();
const companion = () => { const partner = new Companion(); partner.setReplyMode('echo'); partner.reset(0,0.5); return partner; };
function run(partner: Companion,from: number,to: number,input: NoteOn[] = []): ReplyNote[] {
  const played: ReplyNote[] = []; let cursor = 0;
  for (let now=from;now<to;now+=0.01) {
    while (cursor<input.length && input[cursor].t <= now+1e-6) partner.accept(input[cursor++]);
    for (const note of partner.takeDue(now,0.04)) { played.push(note); partner.scheduled(note,0.04); }
  }
  return played;
}

describe('offbeat finite exchanges with continuous listening', () => {
  it('waits for complete cycles and their rests, then replies exactly three times half a beat later', () => {
    const partner = companion();
    expect(run(partner,0,6.1,phrase(0))).toEqual([]);
    const notes = run(partner,6.1,20);
    expect(notes).toHaveLength(9); expect(notes[0].at).toBe(6.25);
    expect(notes.map(n => n.midi)).toEqual([57,60,64,57,60,64,57,60,64]);
    expect(partner.active).toBeUndefined(); expect(partner.takeDue(100,0)).toEqual([]);
  });
  it('keeps a five-beat loop and its rests without waiting for a four-beat bar', () => {
    const partner = companion(), input: NoteOn[] = [];
    for (let pass=0;pass<3;pass++) [0,0.5,1.5].forEach((offset,i) => input.push(note(0.17+pass*2.5+offset,[57,60,64][i])));
    const notes = run(partner,0,18,input);
    expect(notes).toHaveLength(9); expect(notes[0].at).toBeCloseTo(7.92);
    expect(notes[3].at-notes[0].at).toBeCloseTo(2.5);
    expect(notes[2].at-notes[1].at).toBeCloseTo(1);
    expect(notes[3].at-(notes[2].at+notes[2].duration)).toBeCloseTo(0.8);
  });
  it('learns a new loop during playback, retains its first boundary note, and hands over without overlap', () => {
    const partner = companion();
    const notes = run(partner,0,23,[...phrase(0),...phrase(6,[62,65,71],1.5)]);
    expect(notes).toHaveLength(18);
    expect(notes.slice(9).map(n => n.midi)).toEqual([62,65,71,62,65,71,62,65,71]);
    expect(notes[9].at).toBeGreaterThanOrEqual(notes[0].at+6);
    notes.slice(1).forEach((next,i) => expect(notes[i].fireAt+notes[i].duration+0.005).toBeLessThanOrEqual(next.fireAt));
  });
  it('retains only the latest waiting idea and never restarts the same input forever', () => {
    const partner = companion();
    const notes = run(partner,0,19.2,[...phrase(0,[57,60,64],4),...phrase(12.1,[62,65,71],1),...phrase(16,[64,67,71],1)]);
    expect(partner.waiting?.notes.map(n => n.midi)).toEqual([64,67,71]);
    notes.push(...run(partner,19.2,32));
    expect(notes).toHaveLength(18); expect(notes.slice(9).map(n => n.midi)).toEqual([64,67,71,64,67,71,64,67,71]);
    const repeating = companion();
    expect(run(repeating,0,35,phrase(0,[57,60,64],2,15))).toHaveLength(9);
  });
  it('mute lets the finite window expire, keeps a new loop waiting, and resumes without catch-up notes', () => {
    const partner = companion(); run(partner,0,6.1,phrase(0));
    partner.setMuted(true);
    expect(run(partner,6.1,20,phrase(6.5,[62,65,71]))).toEqual([]);
    expect(partner.active).toBeUndefined(); expect(partner.waiting).toBeDefined();
    partner.setMuted(false);
    const notes = run(partner,20,30);
    expect(notes).toHaveLength(9); expect(notes[0].at).toBeCloseTo(20.75);
  });
  it('masks adjacent octaves, releases stopped tails, and resets both loops without accepting stale input', () => {
    const partner = companion(); const notes = run(partner,0,6.22,phrase(0));
    expect(notes).toHaveLength(1);
    expect(partner.accept(note(6.3,57))).toBe(false); expect(partner.accept(note(6.3,69))).toBe(false);
    expect(partner.accept(note(6.3,62))).toBe(true);
    partner.mask.release(6.35); expect(partner.accept(note(6.5,57))).toBe(true);
    partner.reset(7,0.5,7); expect(partner.active).toBeUndefined(); expect(partner.waiting).toBeUndefined();
    expect(partner.accept(note(6.9,57))).toBe(false);
    expect(run(partner,7,22,phrase(7))).toHaveLength(9);
  });
  it('replays chromatic loops too, without a chord gate', () => {
    const notes = run(companion(),0,14,phrase(0,[57,58,59]));
    expect(notes.map(n => n.midi)).toEqual([57,58,59,57,58,59,57,58,59]);
  });
  it('locks a harmony for three passes and applies a mode change only to the waiting exchange', () => {
    const partner = new Companion(); partner.reset(0,0.5);
    const notes = run(partner,0,6.3,phrase(0));
    expect(partner.active?.kind).toBe('harmony'); expect(notes[0].midi).toBe(60);
    partner.setReplyMode('echo');
    notes.push(...run(partner,6.3,22,phrase(6.5,[62,65,69],1.5)));
    expect(notes).toHaveLength(18);
    expect(notes.slice(0,9).map(n=>n.midi)).toEqual([60,64,67,60,64,67,60,64,67]);
    expect(notes.slice(9).map(n=>n.midi)).toEqual([62,65,69,62,65,69,62,65,69]);
    expect(notes[6].velocity).toBeCloseTo(notes[0].velocity*0.8);
    expect(notes[9].at).toBeGreaterThanOrEqual(12.25);
    notes.slice(1).forEach((next,i)=>expect(notes[i].fireAt+notes[i].duration+0.005).toBeLessThanOrEqual(next.fireAt));
  });
  it('masks actual harmony pitches, while original-loop identity prevents endless re-answering', () => {
    const partner = new Companion(); partner.reset(0,0.5);
    run(partner,0,6.22,phrase(0));
    expect(partner.accept(note(6.3,60))).toBe(false);
    expect(partner.accept(note(6.3,72))).toBe(false);
    expect(partner.accept(note(6.3,57))).toBe(true);
    const repeating = new Companion(); repeating.reset(0,0.5);
    expect(run(repeating,0,35,phrase(0,[57,60,64],2,15))).toHaveLength(9);
  });
});
