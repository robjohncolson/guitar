import { expect, it } from 'vitest';
import { loopLevelGain } from '../src/audio/loop-level';

it('raises a quiet take while preserving its relative accents and silence', () => {
  const samples = [0, 0.01, -0.1, 0.025, 0],
    gain = loopLevelGain(0.1);
  expect(samples.map((sample) => sample * gain)).toEqual([0, 0.08, -0.8, 0.2, 0]);
});

it('bounds boost for very faint input and leaves near-silence alone', () => {
  expect(loopLevelGain(0.01)).toBe(16);
  for (const peak of [0, 0.001, 0.0049, NaN, Infinity]) expect(loopLevelGain(peak)).toBe(1);
});

it('keeps quiet and hot takes below full scale with room for an accented click', () => {
  for (const peak of [0.005, 0.02, 0.1, 0.5, 0.8, 1, 1.2, 4]) {
    const outputPeak = peak * loopLevelGain(peak);
    expect(outputPeak).toBeLessThanOrEqual(0.800001);
    expect(outputPeak + 0.126).toBeLessThan(1);
  }
  expect(loopLevelGain(1)).toBe(0.8);
});
