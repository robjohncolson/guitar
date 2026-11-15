import { readFileSync, statSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { measureOnset, needed, nearestSample, PianoSampler, playbackRate, startPoint } from '../src/piece/sampler';

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

const notes = [{ midi: 48, file: 'C3.mp3', gain: 1, cents: 0 }, { midi: 51, file: 'Eb3.mp3', gain: 1, cents: 0 }, { midi: 54, file: 'Gb3.mp3', gain: 1, cents: 0 }];
const context = { decodeAudioData: async () => ({ getChannelData: () => new Float32Array(100), sampleRate: 1000, duration: 0.1 }) } as unknown as BaseAudioContext;
const sampler = () => new PianoSampler(context, {} as AudioNode);
/** A fake site: each name in `fail` answers 404 that many times first; `delay` makes every answer slow. Returns the names fetched, in order. */
function site(fail: Record<string, number> = {}, delay = 0): string[] {
  const asked: string[] = [], left = { ...fail };
  vi.stubGlobal('fetch', async (url: string) => {
    const name = url.replace(/^.*piano\//, ''); asked.push(name);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (left[name] > 0) { left[name]--; return { ok: false, status: 404 }; }
    return name === 'manifest.json' ? { ok: true, status: 200, json: async () => ({ notes }) } : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  return asked;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('loads the recordings that cover a range and says when it is ready', async () => {
  const asked = site(), s = sampler();
  expect(s.ready(48, 54)).toBe(false);
  const done = s.load(48, 54);
  expect(s.loading).toBe(true);
  expect(s.load(48, 54)).toBe(done);
  await done;
  expect([s.ready(48, 54), s.failed, s.loading]).toEqual([true, false, false]);
  expect(asked.sort()).toEqual(['C3.mp3', 'Eb3.mp3', 'Gb3.mp3', 'manifest.json']);
});
it('tries a failed manifest request again instead of staying on the simple piano for the session', async () => {
  vi.useFakeTimers();
  site({ 'manifest.json': 1 });
  const s = sampler(), done = s.load(48, 54);
  await vi.advanceTimersByTimeAsync(0);
  expect([s.ready(48, 54), s.failed, s.loading]).toEqual([false, false, true]);
  await vi.advanceTimersByTimeAsync(1000); await done;
  expect([s.ready(48, 54), s.failed, s.loading]).toEqual([true, false, false]);
});
it('fetches only the recording that failed when it tries again', async () => {
  vi.useFakeTimers();
  const asked = site({ 'Eb3.mp3': 1 }), s = sampler(), done = s.load(48, 54);
  await vi.advanceTimersByTimeAsync(1000); await done;
  expect(s.ready(48, 54)).toBe(true);
  expect(asked.filter(n => n === 'Eb3.mp3')).toHaveLength(2);
  expect(asked.filter(n => n === 'C3.mp3' || n === 'Gb3.mp3' || n === 'manifest.json')).toHaveLength(3);
});
it('gives up after the last try, and starts a fresh round when asked again', async () => {
  vi.useFakeTimers();
  site({ 'manifest.json': 99 });
  const s = sampler(), done = s.load(48, 54);
  await vi.advanceTimersByTimeAsync(1000 + 3000 + 8000); await done;
  expect([s.ready(48, 54), s.failed, s.loading]).toEqual([false, true, false]);
  expect(s.message).toContain('manifest 404');
  site();
  const again = s.load(48, 54);
  expect([s.failed, s.loading]).toEqual([false, true]);
  await again;
  expect([s.ready(48, 54), s.failed]).toEqual([true, false]);
});
it('holds a start for slow recordings, but never longer than it was told to', async () => {
  vi.useFakeTimers();
  site({}, 5000);
  const s = sampler();
  expect(await s.settled(48, 54, 3000)).toBe(false);
  void s.load(48, 54);
  const early = s.settled(48, 54, 3000);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await early).toBe(false);
  expect(s.loading).toBe(true);
  const later = s.settled(48, 54, 30000);
  await vi.advanceTimersByTimeAsync(20000);
  expect(await later).toBe(true);
});
it('answers at once when the recordings are already decoded', async () => {
  site();
  const s = sampler(); await s.load(48, 54);
  expect(await s.settled(48, 54, 3000)).toBe(true);
});
it('ships every recording the manifest lists, so the page never has to fall back to the simple piano', () => {
  const dir = new URL('../public/piano/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as { notes: { midi: number; file: string; gain: number; cents: number }[] };
  expect(manifest.notes.length).toBeGreaterThan(20);
  for (const n of manifest.notes) {
    expect(statSync(new URL(n.file, dir)).size, n.file).toBeGreaterThan(10_000);
    expect(Number.isFinite(n.midi) && Number.isFinite(n.gain) && Number.isFinite(n.cents), n.file).toBe(true);
  }
  expect(needed([36, 96], manifest.notes.map(n => n.midi)).length).toBeGreaterThan(10);
});
