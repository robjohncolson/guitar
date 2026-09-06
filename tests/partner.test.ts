import { describe, expect, it } from 'vitest';
import { Grid } from '../src/audio/grid';
import { SelfMask } from '../src/audio/self-mask';
import { Partner } from '../src/music/partner';
import { makeScale } from '../src/music/scales';
import { midiToHz, pitchClass } from '../src/music/notes';
import { holeFiller } from '../src/music/voice/hole-filler';
import type { VoiceContext } from '../src/music/voice/types';
const note = (midi: number, t=0) => ({ midi, t, hz: midiToHz(midi), pitchClass: pitchClass(midi), cents: 0, confidence: 0.9 });
export function voiceContext(): VoiceContext {
  const grid = new Grid(0,0.5); grid.claimPlayer(0);
  return { slot: grid.slot(1), previous: grid.slot(0), scale: makeScale(9,'minor pentatonic'), lastPlayer: note(57), playerMedian: 57, density:'shy',ready:true,playerSinceCompanion:true };
}
describe('hole-filler and density', () => {
  it('fills empty slots with a fifth, never the last player class', () => {
    const context = voiceContext(); expect(holeFiller(context)!.midi % 12).toBe(4);
    context.lastPlayer = note(64); expect(holeFiller(context)!.midi % 12).toBe(9);
    context.slot.occupancy = 'player'; expect(holeFiller(context)).toBeNull();
    context.slot.occupancy = 'companion'; expect(holeFiller(context)).toBeNull();
  });
  it('shy needs the previous player slot and an intervening onset', () => {
    const context = voiceContext(); context.previous.occupancy = 'companion'; expect(holeFiller(context)).toBeNull();
    context.density = 'busy'; expect(holeFiller(context)).not.toBeNull();
    context.ready = false; expect(holeFiller(context)).toBeNull();
  });
  it('runs the north-star pattern, rejecting speaker bleed without changing the scale', () => {
    const partner = new Partner(), grid = new Grid(0,0.5); partner.setGrid(grid);
    [57,60,62,64,67,69].forEach((midi,i) => partner.accept(note(midi, i < 3 ? 0 : 1)));
    partner.scales.toggleLock(); const scale = partner.scales.locked;
    const answer = partner.decide(3,1.5)!; expect(answer).not.toBeNull(); partner.scheduled(3,answer);
    expect(partner.accept(note(answer.midi,1.55))).toBe(false);
    expect(partner.scales.onsetCount).toBe(6); expect(partner.scales.locked).toBe(scale);
    expect(partner.decide(4,2)).toBeNull();
    partner.accept(note(57,2)); expect(partner.decide(5,2.5)).not.toBeNull();
    expect(grid.slot(4).occupancy).toBe('player');
  });
  it('reserves a fresh raw attack while pitch settles', () => {
    const partner = new Partner(); partner.setGrid(new Grid(0,0.5));
    for (let i=0;i<6;i++) partner.accept(note(57,0)); partner.scales.toggleLock();
    partner.attack(0.49); expect(partner.decide(1,0.5)).toBeNull();
  });
});
describe('self masking', () => {
  it('drops matching pitches for duration plus 80 ms and keeps different ones', () => {
    const mask = new SelfMask(); mask.arm(1,0.3,64);
    expect(mask.drops(note(64,1.2))).toBe(true);
    expect(mask.drops(note(64,1.37))).toBe(true);
    expect(mask.drops(note(64,1.4))).toBe(false);
    expect(mask.drops(note(67,1.2))).toBe(false);
    expect(mask.drops({ t:1.2,hz:midiToHz(64.49) })).toBe(true);
    expect(mask.drops({ t:1.2,hz:midiToHz(64.51) })).toBe(false);
  });
  it('a different player attack wins a companion slot', () => {
    const partner = new Partner(), grid = new Grid(0,0.5); partner.setGrid(grid);
    partner.scheduled(2,{midi:64,duration:0.275}); partner.accept(note(57,1.1));
    expect(grid.slot(2).occupancy).toBe('player');
  });
});
