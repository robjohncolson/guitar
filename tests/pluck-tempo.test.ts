import { describe, expect, it } from 'vitest';
import { PluckTempo } from '../src/audio/pluck-tempo';

describe('learning a steady pulse from accepted plucks', () => {
  it('requires eight attacks and stable estimates before locking the tempo and phase', () => {
    const tempo = new PluckTempo();
    const times = [1,1.508,1.99,2.503,3.008,3.496,4.005,4.5];
    times.slice(0,7).forEach(t => expect(tempo.record(t)).toBeUndefined());
    expect(tempo.record(times[7])?.bpm).toBeCloseTo(120,0);
    expect(tempo.pulse?.origin).toBeCloseTo(1,2);
  });
  it.each([40,60,80,100,140,180,240])('finds regular plucks at %i BPM without assuming every tempo is 120', bpm => {
    const tempo = new PluckTempo();
    for (let i=0;i<12;i++) tempo.record(1+i*60/bpm);
    expect(tempo.pulse?.bpm).toBe(bpm);
  });
  it('handles rests and mixed quarter/eighth-note plucks', () => {
    const tempo = new PluckTempo();
    [0,0.5,0.75,1,1.5,2,2.5,3,3.25,3.5,4,5,5.5,6].forEach(t => tempo.record(t));
    expect(tempo.pulse?.bpm).toBe(120);
    const rests = new PluckTempo();
    [0,0.5,1,2,2.5,3,4,4.5,5].forEach(t => rests.record(t));
    expect(rests.pulse?.bpm).toBe(120);
  });
  it('keeps listening to irregular timing rather than displaying a confident arbitrary BPM', () => {
    const tempo = new PluckTempo();
    [0,0.31,0.83,1.55,1.78,2.66,2.99,3.81,4.29,5.05,5.26,6.13].forEach(t => tempo.record(t));
    expect(tempo.pulse).toBeUndefined();
  });
  it('ignores duplicate/invalid attacks and starts fresh after a long silence', () => {
    const tempo = new PluckTempo();
    [0,0.5,1,1.5,2,2.5].forEach(t => { tempo.record(t); tempo.record(t+0.02); tempo.record(NaN); tempo.record(t-1); });
    expect(tempo.attacks).toBe(6); expect(tempo.pulse).toBeUndefined();
    tempo.record(10); expect(tempo.attacks).toBe(1);
    for (let i=1;i<8;i++) tempo.record(10+i*0.75);
    expect(tempo.pulse?.bpm).toBe(80);
  });
  it('holds a learned pulse through new rhythms and silence until explicitly reset', () => {
    const tempo = new PluckTempo();
    for (let i=0;i<8;i++) tempo.record(i*0.5);
    const pulse = tempo.pulse;
    [20,20.2,20.4,20.6,21,21.75,22.5,23.25,24].forEach(t => expect(tempo.record(t)).toBe(pulse));
    tempo.reset(); expect(tempo.pulse).toBeUndefined(); expect(tempo.attacks).toBe(0);
    for (let i=0;i<8;i++) tempo.record(30+i*0.75);
    expect(tempo.pulse?.bpm).toBe(80);
  });
});
