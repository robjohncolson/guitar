import { describe, expect, it } from 'vitest';
import { TapTempo } from '../src/audio/tap-tempo';
import { Grid } from '../src/audio/grid';

describe('tap clock', () => {
  it('four taps 500 ms apart set 120 BPM', () => {
    const tempo = new TapTempo();
    [0, 0.5, 1, 1.5].forEach((t) => tempo.tap(t));
    expect(tempo.bpm).toBeCloseTo(120);
    expect(tempo.t0).toBe(1.5);
  });
  it('ignores an interval outlier and resets', () => {
    const tempo = new TapTempo();
    [0, 0.5, 1, 2.2, 2.7].forEach((t) => tempo.tap(t));
    expect(tempo.bpm).toBeCloseTo(120);
    tempo.reset();
    expect(tempo.bpm).toBeNull();
  });
  it('smooths further estimates without abandoning the clock', () => {
    const tempo = new TapTempo();
    [0, 0.5, 1, 1.5, 2.1].forEach((t) => tempo.tap(t));
    expect(tempo.bpm).toBeGreaterThan(114);
    expect(tempo.bpm).toBeLessThan(120);
  });
});
describe('grid', () => {
  it('accepts a 30% early attack', () => {
    expect(new Grid(0, 1).claimPlayer(0.7).index).toBe(1);
  });
  it('moves a 60% late attack into the next slot', () => {
    expect(new Grid(0, 1).claimPlayer(0.6).index).toBe(1);
  });
  it('retains past and future bars', () => {
    const grid = new Grid(0, 0.5);
    grid.maintain(10);
    expect(grid.slot(12).startTime).toBe(6);
    expect(grid.slot(28).startTime).toBe(14);
  });
});
