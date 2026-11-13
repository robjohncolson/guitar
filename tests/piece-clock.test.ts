import { expect, it } from 'vitest';
import { readClock } from '../src/piece/clock';

/** An audio clock that moves in 10 ms callbacks, with 40 ms of output latency, read once a frame. */
function simulate(latency: number, frames: number, broken?: (t: number) => { contextTime: number; performanceTime: number } | undefined) {
  const out: { raw: number; time: number; smooth: boolean; truth: number }[] = [];
  let lag: number | undefined;
  for (let i = 0; i < frames; i++) {
    const perf = 5000 + i * 16.7 + (i % 3), truth = 2 + (perf - 5000) / 1000;
    const currentTime = Math.floor(truth / 0.01) * 0.01 + 0.01;
    const block = Math.floor((truth - latency) / 0.01) * 0.01;
    const stamp = broken ? broken(truth) : { contextTime: block, performanceTime: 5000 + (block + latency - 2) * 1000 };
    const r = readClock(currentTime, stamp, perf, lag); lag = r.lag;
    out.push({ raw: currentTime, time: r.time, smooth: r.smooth, truth });
  }
  return out;
}

it('tracks currentTime within a few ms on the same timeline, without adding latency twice', () => {
  const run = simulate(0.04, 600).slice(60);
  for (const f of run) { expect(f.smooth).toBe(true); expect(Math.abs(f.time - f.raw)).toBeLessThan(0.008); }
  // Smoother than the raw clock: frame-to-frame steps vary far less.
  const steps = (k: 'raw' | 'time') => run.slice(1).map((f, i) => f[k] - run[i][k]), spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  expect(spread(steps('time'))).toBeLessThan(spread(steps('raw')) / 2);
});

it('falls back to raw currentTime when the API is missing, returns zeros, or disagrees', () => {
  for (const r of [simulate(0.04, 30, () => undefined), simulate(0.04, 30, () => ({ contextTime: 0, performanceTime: 0 }))]) for (const f of r) expect(f.time).toBe(f.raw);
  // Output stamps that jump about (here by up to 0.2 s) are never trusted beyond 30 ms from currentTime.
  let k = 0;
  for (const f of simulate(0.04, 200, t => ({ contextTime: t - 0.04 + (k++ % 2 ? 0.2 : 0), performanceTime: 5000 + (t - 2) * 1000 }))) expect(Math.abs(f.time - f.raw)).toBeLessThanOrEqual(0.03);
});

it('dates an earlier event stamp back from now', () => {
  const r = readClock(10, { contextTime: 9.96, performanceTime: 1000 }, 1000, 0.04, 950);
  expect(r.time).toBeCloseTo(9.95, 6);
});
