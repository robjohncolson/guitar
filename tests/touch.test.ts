import { expect, it } from 'vitest';
import { Touch } from '../src/music/touch';
import { Companion } from '../src/music/companion';

it('keeps soft/loud differences at different microphone levels with bounded output', () => {
  const near = new Touch(), far = new Touch();
  const levels = [0.04,0.01,0.08,0.02];
  const velocities = levels.map(level => near.velocity(level));
  expect(velocities).toEqual(levels.map(level => far.velocity(level/100)));
  expect(velocities[1]).toBeLessThan(velocities[0]); expect(velocities[2]).toBeGreaterThan(velocities[1]);
  expect(near.velocity(10)).toBe(1); expect(near.velocity(0.000001)).toBe(0.25);
  expect(near.velocity(NaN)).toBe(0.75);
  near.reset(); expect(near.velocity(0.001)).toBe(0.75);
});
it('only learns dynamics from accepted player attacks', () => {
  const companion = new Companion();
  const note = {t:0,hz:220,midi:57,pitchClass:9,cents:0,confidence:0.9,level:0.04};
  companion.accept(note); expect(companion.lastPlayer?.velocity).toBe(0.75);
  companion.mask.arm(1,0.5,57);
  expect(companion.accept({...note,t:1,level:10})).toBe(false);
  companion.accept({...note,t:2}); expect(companion.lastPlayer?.velocity).toBe(0.75);
  expect(companion.takeDue(3,0)).toEqual([]);
});
