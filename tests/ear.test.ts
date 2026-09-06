import { describe, expect, it } from 'vitest';
import { binCents, normalize, postprocess } from '../src/audio/crepe';
import { OnsetDetector } from '../src/audio/onset';
import { FrameBuffer } from '../src/audio/frame-buffer';
import { Grid } from '../src/audio/grid';

describe('CREPE official contract', () => {
  it('reconstructs a known bin to within 1%', () => {
    const bins = new Float32Array(360); bins[140] = 0.9;
    const result = postprocess(bins);
    expect(result.hz).toBeCloseTo(10 * 2 ** (binCents(140) / 1200), 5);
    expect(result.confidence).toBeCloseTo(0.9);
  });
  it('uses only the local weighted neighborhood and guards silence', () => {
    const bins = new Float32Array(360); bins[140] = 1; bins[141] = 0.5; bins[10] = 0.8;
    expect(postprocess(bins).hz).toBeCloseTo(10 * 2 ** ((binCents(140) + binCents(141) * 0.5) / 1.5 / 1200));
    expect(postprocess(new Float32Array(360)).hz).toBe(0);
    expect(normalize(new Float32Array(1024)).every(x => x === 0)).toBe(true);
  });
  it('normalizes DC offset to zero mean and unit RMS', () => {
    const result = normalize(Float32Array.from({ length: 1024 }, (_, i) => 3 + Math.sin(i)));
    expect(result.reduce((a,b) => a+b,0)/1024).toBeCloseTo(0, 5);
    expect(Math.sqrt(result.reduce((a,b) => a+b*b,0)/1024)).toBeCloseTo(1, 5);
  });
});
describe('capture and attacks', () => {
  it.each([44100, 48000])('resamples %i Hz to overlapping 1024-sample frames at 20 ms hops', rate => {
    const capture = new FrameBuffer(rate);
    const input = Float32Array.from({length: rate / 5}, (_, i) => Math.sin(2*Math.PI*220*i/rate));
    const frames = capture.push(input, 0);
    expect(frames.length).toBeGreaterThanOrEqual(7);
    expect(frames[0].samples.length).toBe(1024);
    expect(frames[1].t-frames[0].t).toBeCloseTo(0.02, 4);
    expect(frames[0].rms).toBeCloseTo(Math.SQRT1_2, 1);
  });
  it('a sustained voiced note occupies one slot, then a new pluck emits one more', () => {
    const detector = new OnsetDetector(), grid = new Grid(0, 0.5);
    const notes = [];
    for (let i=0;i<100;i++) {
      if (i === 50) detector.attack(1);
      const note = detector.process(i * 0.02, { hz: 220, confidence: 0.9 });
      if (note) { notes.push(note); grid.claimPlayer(note.t); }
    }
    expect(notes).toHaveLength(2);
    expect(grid.slot(0).occupancy).toBe('player'); expect(grid.slot(1).occupancy).toBe('empty'); expect(grid.slot(2).occupancy).toBe('player');
  });
  it('waits 60 ms for the median and debounces attacks', () => {
    const detector = new OnsetDetector(); detector.attack(0); detector.attack(0.02);
    expect(detector.process(0, {hz: 219, confidence: 0.8})).toBeNull();
    detector.process(0.02, {hz: 220, confidence: 0.8}); detector.process(0.04, {hz: 221, confidence: 0.8});
    expect(detector.process(0.06, {hz: 220, confidence: 0.8})?.hz).toBe(220);
  });
});
