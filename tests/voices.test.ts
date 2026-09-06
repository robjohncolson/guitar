import { describe, expect, it } from 'vitest';
import { Grid, mod } from '../src/audio/grid';
import { makeScale } from '../src/music/scales';
import { midiToHz, pitchClass } from '../src/music/notes';
import { bass } from '../src/music/voice/bass';
import { harmony } from '../src/music/voice/harmony';
import { CallResponse, responsePattern } from '../src/music/voice/call-response';
import type { VoiceContext } from '../src/music/voice/types';
const note = (midi:number,t=0) => ({ midi,t,hz:midiToHz(midi),pitchClass:pitchClass(midi),cents:0,confidence:0.9 });
function context(index=1): VoiceContext {
  const grid = new Grid(0,0.5);
  return { slot:grid.slot(index), previous:grid.slot(index-1), scale:makeScale(0,'major'),lastPlayer:note(64),playerMedian:64,density:'busy',ready:true,playerSinceCompanion:true };
}
describe('bass', () => {
  it('stays C2–E3 and pedals tonic/fifth by beat', () => {
    for (let i=0;i<4;i++) {
      const result = bass(context(i))!;
      expect(result.midi).toBeGreaterThanOrEqual(36); expect(result.midi).toBeLessThanOrEqual(52);
      expect(mod(result.midi,12)).toBe(i%2 ? 7 : 0);
    }
  });
  it('shy allows 2 and 4 only with a player onset between notes', () => {
    const c = context(0); c.density='shy'; expect(bass(c)).toBeNull();
    c.slot=context(1).slot; expect(bass(c)).not.toBeNull(); c.playerSinceCompanion=false; expect(bass(c)).toBeNull();
  });
});
describe('harmony', () => {
  it('E4 in C major gives G4, the diatonic third', () => { expect(harmony(context())?.midi).toBe(67); });
  it('snaps an out-of-scale note, skips occupied slots, and caps the register', () => {
    const c=context(); c.lastPlayer=note(66); expect(c.scale.pitchClasses).toContain(mod(harmony(c)!.midi,12));
    c.slot.occupancy='player'; expect(harmony(c)).toBeNull();
    c.slot.occupancy='empty'; c.lastPlayer=note(79); expect(harmony(c)).toBeNull();
  });
});
describe('call-response', () => {
  it('is silent in a call and retrogrades onto its holes next bar', () => {
    const role = new CallResponse(); role.record(0,note(60,0)); role.record(2,note(64,1));
    expect(role.decide(context(3))).toBeNull(); expect(role.decide(context(4))).toBeNull();
    expect(mod(role.decide(context(5))!.midi,12)).toBe(4);
    expect(role.decide(context(6))).toBeNull(); expect(mod(role.decide(context(7))!.midi,12)).toBe(0);
  });
  it('shy sits out the following full bar, including new calls in that bar', () => {
    const role=new CallResponse(); role.record(0,note(60)); role.record(2,note(64,1));
    const c=context(4); c.density='shy'; role.decide(c);
    role.record(8,note(60,4)); role.record(10,note(64,5));
    for (let i=8;i<16;i++) { const next=context(i);next.density='shy'; expect(role.decide(next)).toBeNull(); }
  });
  it('busy listens again immediately after the response', () => {
    const role=new CallResponse(); role.record(0,note(60)); role.record(2,note(64,1)); role.decide(context(4));
    role.record(8,note(62,4)); role.record(10,note(65,5)); role.decide(context(8));
    expect(role.decide(context(13))).not.toBeNull();
  });
  it('uses tonic on beat 1 if the call has no holes, and inverts degenerate contours', () => {
    const scale=makeScale(0,'major');
    const full=[0,1,2,3].map(beat=>({beat,note:note(60+beat,beat*0.5)}));
    expect([...responsePattern(full,scale)]).toEqual([[0,0]]);
    const degenerate=[{beat:0,note:note(64)},{beat:2,note:note(64,1)}];
    expect([...responsePattern(degenerate,scale)]).toEqual([[1,9],[3,9]]);
  });
});
