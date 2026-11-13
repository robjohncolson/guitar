import { expect, it } from 'vitest';
import { measureOnset, needed, nearestSample, playbackRate, startPoint } from '../src/piece/sampler';

const roots = [21, 24, 27, 30, 33];

it('picks the closest root and the lower one on a tie', () => {
  expect(nearestSample(25, roots)).toBe(24);
  expect(nearestSample(26, roots)).toBe(27);
  expect(nearestSample(22.5, [21, 24])).toBe(21);
  expect(nearestSample(60, roots)).toBe(33);
  expect(nearestSample(60, [])).toBeUndefined();
});
it('pitches by rate and corrects the measured detune', () => {
  expect(playbackRate(60, 60, 0)).toBeCloseTo(1, 9);
  expect(playbackRate(72, 60, 0)).toBeCloseTo(2, 9);
  expect(playbackRate(57, 60, 0)).toBeCloseTo(2 ** -0.25, 9);
  expect(playbackRate(60, 60, 20)).toBeCloseTo(2 ** (-20 / 1200), 9);
  expect(playbackRate(60, 60, -20)).toBeGreaterThan(1);
});
it('finds the onset after silence or low noise', () => {
  const rate = 1000, silent = new Float32Array(1000);
  expect(measureOnset(silent, rate)).toBe(0);
  const burst = new Float32Array(1000); burst[120] = 0.8; burst[130] = -1;
  expect(measureOnset(burst, rate)).toBeCloseTo(0.12, 9);
  const noisy = new Float32Array(1000).fill(0.01); noisy[250] = 0.5; noisy[260] = 1;
  expect(measureOnset(noisy, rate)).toBeCloseTo(0.25, 9);
  const late = new Float32Array(1000); late[800] = 1;
  expect(measureOnset(late, rate)).toBe(0);
});
it('starts on time or skips ahead when late', () => {
  expect(startPoint(5, 4, 0.03, 1.2)).toEqual({ when: 5, offset: 0.03 });
  const late = startPoint(5, 5.5, 0.03, 2);
  expect(late.when).toBe(5.5);
  expect(late.offset).toBeCloseTo(1.03, 9);
});
it('lists the roots covering a range', () => {
  expect(needed([21, 27], roots)).toEqual([21, 24, 27]);
  expect(needed([25, 25], roots)).toEqual([24]);
  expect(needed([40, 42], roots)).toEqual([33]);
  expect(needed([21, 27], [])).toEqual([]);
});
