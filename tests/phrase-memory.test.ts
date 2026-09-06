import { describe, expect, it } from 'vitest';
import { PhraseMemory } from '../src/music/phrase-memory';
import type { MemoryBars } from '../src/music/phrase-memory';
import { Repeater } from '../src/music/repeater';
import { hzToMidi, pitchClass } from '../src/music/notes';
const note = (t: number, hz = 220) => ({t,hz,midi:Math.round(hzToMidi(hz)),pitchClass:pitchClass(hzToMidi(hz)),cents:0,confidence:0.9});
function memory(): PhraseMemory { const result = new PhraseMemory(); result.reset(0,0.5); return result; }

describe('phrase memory', () => {
  it.each([1,2,4] as MemoryBars[])('captures the last %i completed bars, including rests and unquantized offsets', bars => {
    const loop = memory(), end = bars*2;
    loop.record(note(0.13,221.7)); loop.record(note(end-0.4,330)); loop.record(note(end+0.1,440));
    expect(loop.remember(bars,end+0.3,0.04)).toBe(true);
    expect(loop.active?.duration).toBe(bars*2);
    expect(loop.active?.startAt).toBe(end+2);
    expect(loop.active?.notes.map(n => [n.beat,n.hz])).toEqual([[0.26,221.7],[(end-0.4)/0.5,330]]);
    const first = loop.takeDue(end+2+0.13-0.04,0.04);
    expect(first).toHaveLength(1); expect(first[0].hz).toBe(221.7);
    expect(first[0].at).toBeCloseTo(end+2.13); expect(first[0].fireAt).toBeCloseTo(end+2.09);
  });
  it('uses the most recent complete window and excludes notes on its ending downbeat', () => {
    const loop = memory(); [0,2,4,6,8].forEach((t,i) => loop.record(note(t,220+i*10)));
    loop.remember(2,8.2,0);
    expect(loop.active?.notes.map(n => n.sourceTime)).toEqual([4,6]);
  });
  it('does not capture a partial or entirely silent phrase', () => {
    const loop = memory(); loop.record(note(0.3));
    expect(loop.remember(2,3.9,0)).toBe(false);
    expect(loop.remember(1,4.1,0)).toBe(false);
    expect(loop.remember(2,4.1,0)).toBe(true);
  });
  it('requires full listening bars when the mic starts after the clock', () => {
    const loop = memory(); loop.reset(0,0.5,1); loop.record(note(1.1));
    expect(loop.availableBars(2)).toBe(0);
    loop.record(note(2.2)); expect(loop.canRemember(1,4.1)).toBe(true);
  });
  it('freezes pitches and rhythm while later player notes continue entering history', () => {
    const loop = memory(); const source = note(0.1); loop.record(source); loop.remember(1,2.1,0);
    source.hz = 999; loop.record(note(4.1,330));
    expect(loop.active?.notes[0].hz).toBe(220);
    expect(loop.takeDue(4.1,0).map(n => n.hz)).toEqual([220]);
    expect(loop.takeDue(6.1,0).map(n => n.hz)).toEqual([220]);
    expect(loop.takeDue(6.1,0)).toEqual([]);
    loop.clear(); loop.remember(1,6.2,0);
    expect(loop.active?.notes[0].hz).toBe(330);
  });
  it('keeps multiple notes and rests in each cycle without overdubbing', () => {
    const loop = memory(); loop.record(note(0)); loop.record(note(0.75,330)); loop.remember(1,2.1,0);
    expect(loop.takeDue(4,0).map(n => n.at)).toEqual([4]);
    expect(loop.takeDue(4.5,0)).toEqual([]);
    expect(loop.takeDue(4.75,0).map(n => n.at)).toEqual([4.75]);
    expect(loop.takeDue(5.5,0)).toEqual([]);
    expect(loop.takeDue(6,0).map(n => n.at)).toEqual([6]);
  });
  it('selects a playable next downbeat on high-latency output', () => {
    const loop = memory(); loop.record(note(0)); loop.remember(1,3.95,0.2);
    expect(loop.active?.startAt).toBe(6); expect(loop.takeDue(5.8,0.2)[0].fireAt).toBe(5.8);
  });
  it('clips a tone at the phrase boundary so its rest at the next start survives', () => {
    const loop = memory(); loop.record(note(1.95)); loop.remember(1,2.1,0);
    expect(loop.takeDue(5.95,0)[0].duration).toBeCloseTo(0.05);
  });
  it('mute retains the frozen phrase and resumes its phase without a burst', () => {
    const loop = memory(); loop.record(note(0.1)); loop.remember(1,2.1,0);
    loop.setMuted(true); expect(loop.takeDue(4.1,0)).toEqual([]);
    loop.setMuted(false); expect(loop.takeDue(24.1,0).map(n => n.at)).toEqual([24.1]);
    expect(loop.active).toBeDefined();
  });
  it('clear cancels the loop; tempo/reset also clears its old history', () => {
    const loop = memory(); loop.record(note(0)); loop.remember(1,2.1,0); loop.clear();
    expect(loop.takeDue(4,0)).toEqual([]); expect(loop.canRemember(1,2.1)).toBe(true);
    loop.reset(10,1); expect(loop.availableBars(10)).toBe(0); expect(loop.noteCount(1,20)).toBe(0);
  });
  it('records accepted playing during a loop without queuing another echo or hearing itself', () => {
    const loop = memory(), repeater = new Repeater();
    const original = note(0); repeater.accept(original); loop.record(original); loop.remember(1,2.1,0);
    repeater.clear(); const played = loop.takeDue(4,0)[0]; repeater.scheduled(played,0);
    expect(repeater.accept(note(4.02),false)).toBe(false);
    expect(repeater.accept(note(4.03,330),false)).toBe(true);
    expect(repeater.pending).toBe(0);
  });
});
