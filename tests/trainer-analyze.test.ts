import { expect, it, vi } from 'vitest';
import { analyzeTake, pitchFrame } from '../src/trainer/analyze';
const rate = 48000;
function recording(plucks: { at: number; length: number }[]): Float32Array {
  const samples = new Float32Array(rate * 3);
  for (const { at, length } of plucks)
    for (let i = 0; i < length * rate; i++)
      samples[Math.round(at * rate) + i] = 0.2 * Math.sin((2 * Math.PI * 110 * i) / rate);
  return samples;
}
it('resamples the stored signal to the exact CREPE window, padding edges', () => {
  const samples = recording([{ at: 0.25, length: 0.5 }]),
    frame = pitchFrame(samples, rate, 0.4);
  expect(frame).toHaveLength(1024);
  expect(frame[512]).toBeCloseTo(samples[Math.round(0.4 * rate)], 6);
  expect(
    pitchFrame(samples, rate, 0)
      .slice(0, 512)
      .every((v) => v === 0),
  ).toBe(true);
});
it('retains native attack times and deliberate quiet releases even with slow inference', async () => {
  const infer = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 2));
    return { hz: 110, confidence: 0.8 };
  });
  const attacks = await analyzeTake(
    recording([
      { at: 0.25, length: 0.4 },
      { at: 1.25, length: 0.7 },
    ]),
    rate,
    0.25,
    2,
    infer,
  );
  expect(attacks).toHaveLength(2);
  expect(attacks[0].t).toBeCloseTo(0, 2);
  expect(attacks[1].t).toBeCloseTo(1, 2);
  expect(attacks[0].midi).toBeCloseTo(45, 5);
  expect(attacks[0].duration).toBeCloseTo(0.4, 1);
  expect(attacks[1].duration).toBeCloseTo(0.7, 1);
  expect(infer).toHaveBeenCalledTimes(4);
});
it('does not turn unclear or conflicting pitches into correct notes', async () => {
  const samples = recording([{ at: 0.25, length: 0.5 }]);
  const unclear = await analyzeTake(samples, rate, 0.25, 2, async () => ({ hz: 110, confidence: 0.3 }));
  expect(unclear[0].midi).toBeUndefined();
  let i = 0;
  const conflicting = await analyzeTake(samples, rate, 0.25, 2, async () => ({
    hz: [110, 165, 220, 330][i++],
    confidence: 0.9,
  }));
  expect(conflicting[0].midi).toBeUndefined();
  expect(conflicting[0].confidence).toBeUndefined();
});
it('rejects short click bleed, keeps rhythmic strums, and avoids pitch claims for them', async () => {
  const infer = vi.fn(async () => ({ hz: 110, confidence: 0.9 }));
  const attacks = await analyzeTake(
    recording([
      { at: 0.25, length: 0.009 },
      { at: 1.25, length: 0.15 },
    ]),
    rate,
    0.25,
    2,
    infer,
    undefined,
    undefined,
    true,
  );
  expect(attacks).toHaveLength(1);
  expect(attacks[0].t).toBeCloseTo(1, 2);
  expect(attacks[0].midi).toBeUndefined();
  expect(infer).not.toHaveBeenCalled();
});
it('discards an analysis cancelled while a pitch read is pending', async () => {
  let alive = true;
  const attacks = await analyzeTake(
    recording([{ at: 0.25, length: 0.5 }]),
    rate,
    0.25,
    2,
    async () => {
      alive = false;
      return { hz: 110, confidence: 0.9 };
    },
    () => alive,
  );
  expect(attacks).toEqual([]);
});
it('does not credit long reverberant metronome pips as muted strums', async () => {
  const samples = new Float32Array(rate * 3);
  for (const [at, hz] of [
    [0.25, 1000],
    [1.25, 1300],
  ])
    for (let i = 0; i < rate * 0.25; i++)
      samples[Math.round(at * rate) + i] = 0.2 * Math.sin((2 * Math.PI * hz * i) / rate) * Math.exp(-i / (rate * 0.12));
  const attacks = await analyzeTake(
    samples,
    rate,
    0.25,
    2,
    async () => ({ hz: 0, confidence: 0 }),
    undefined,
    undefined,
    true,
  );
  expect(attacks).toEqual([]);
});
it('batched pitch reading takes exactly the readings, in the same order and with the same early stop, as one at a time', async () => {
  // Plucks of different lengths (each may read one to four moments), with seeded noise so no two frames match.
  let seed = 3;
  const samples = recording(
    [0.1, 0.24, 0.3, 0.5, 0.21, 0.4, 0.15, 0.35, 0.6, 0.27].map((length, i) => ({ at: 0.2 + i * 0.27, length })),
  ).map((v) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return v ? v + ((seed >>> 0) / 4294967296 - 0.5) * 0.004 : 0;
  });
  const key = (frame: Float32Array) => frame.reduce((sum, v, i) => sum + v * ((i % 37) + 1), 0).toFixed(9);
  // A deterministic stand-in for the model: agreeing, slightly sharp, conflicting, out-of-range and unsure readings.
  const read = (frame: Float32Array) => {
    const pick = Math.floor(Math.abs(Number(key(frame))) * 1e4) % 6;
    return [
      { hz: 110, confidence: 0.9 },
      { hz: 110 * 2 ** (0.3 / 12), confidence: 0.8 },
      { hz: 165, confidence: 0.9 },
      { hz: 220, confidence: 0.7 },
      { hz: 60, confidence: 0.9 },
      { hz: 110, confidence: 0.3 },
    ][pick];
  };
  const single: string[] = [];
  const oneByOne = await analyzeTake(samples, rate, 0.2, 2.6, async (frame) => {
    single.push(key(frame));
    return read(frame);
  });
  const sent: string[] = [],
    used: string[] = [],
    calls: number[] = [],
    events: (string | number)[] = [];
  const batched = await analyzeTake(
    samples,
    rate,
    0.2,
    2.6,
    async () => {
      throw new Error('The batch path must not read frames one at a time');
    },
    undefined,
    (done) => events.push(done),
    false,
    async (frames, progress) => {
      events.push('model');
      calls.push(frames.length);
      // Report progress after each chunk of eight, as Crepe.inferMany does.
      for (let read = 8; read < frames.length + 8; read += 8) progress?.(Math.min(read, frames.length));
      events.push('done');
      const keys = frames.map(key);
      sent.push(...keys);
      // Record each reading as it is actually consumed.
      return new Proxy(frames.map(read), {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) used.push(keys[Number(property)]);
          return Reflect.get(target, property, receiver);
        },
      });
    },
  );
  expect(batched).toEqual(oneByOne);
  expect(oneByOne.length).toBe(10);
  expect(oneByOne.some((a) => a.midi !== undefined)).toBe(true);
  expect(oneByOne.some((a) => a.midi === undefined)).toBe(true);
  // Group readings by pluck: each frame belongs to one pluck and one moment after its attack.
  const owner = new Map<string, [number, number]>();
  oneByOne.forEach((a, p) =>
    [0.08, 0.14, 0.2, 0.26].forEach((after, k) => owner.set(key(pitchFrame(samples, rate, a.t + 0.2 + after)), [p, k])),
  );
  const perPluck = (keys: string[]) =>
    oneByOne.map((_, p) =>
      keys
        .map((k) => owner.get(k)!)
        .filter(([q]) => q === p)
        .map(([, k]) => k),
    );
  expect(single.every((k) => owner.has(k))).toBe(true);
  expect(perPluck(used)).toEqual(perPluck(single));
  // Nothing extra is read, and early stops happened at different points.
  expect([...sent].sort()).toEqual([...single].sort());
  expect(used).toEqual(sent);
  const counts = perPluck(single).map((k) => k.length);
  expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
  expect(calls.length).toBeLessThanOrEqual(4);
  // "Checking note X of Y" moves while the first model call is still reading, and never goes back.
  const progress = events.filter((e): e is number => typeof e === 'number'),
    during = events.slice(1, events.indexOf('done')).filter((e) => typeof e === 'number');
  expect(calls[0]).toBeGreaterThan(8);
  expect(new Set(during).size).toBeGreaterThanOrEqual(2);
  expect(progress[0]).toBeGreaterThan(0);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  expect(progress.at(-1)).toBe(10);
});
it('batched reading cancels like one at a time when Stop arrives during a batch', async () => {
  let alive = true;
  const attacks = await analyzeTake(
    recording([{ at: 0.25, length: 0.5 }]),
    rate,
    0.25,
    2,
    async () => ({ hz: 110, confidence: 0.9 }),
    () => alive,
    undefined,
    false,
    async (frames) => {
      alive = false;
      return frames.map(() => ({ hz: 110, confidence: 0.9 }));
    },
  );
  expect(attacks).toEqual([]);
});
