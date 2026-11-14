import { expect, it } from 'vitest';
import { CAP, MAX_PARTICLES, TAKE_PARTICLES, burstEnd, celebration, hitBurst, isEmpty, lightFrame, particle, particleAt, pruneBursts, revealBurst, rgb, type Burst, type LightInput, type Particle } from '../src/piece/light';

const C = rgb('#88aa66');
const fx = (tier: string, at = 1000) => ({ cx: 100, width: 20, tier, colour: C, at });
const input = (o: Partial<LightInput> = {}): LightInput => ({ now: 1050, lively: true, quiet: false, inTake: false, w: 600, hitY: 300, effects: [], bursts: [], warm: 0, haze: 28, pulse: 0, ...o });
const sum = (l: readonly Burst[]) => l.reduce((n, b) => n + b.count, 0);
const sparks = (now: number, count: number): Burst => ({ ...hitBurst(now, 'good', 50, 20, 300, C, false)[0], count });

it('draws nothing in the calm look or with reduced motion, but keeps the clip', () => {
  const f = lightFrame(input({ lively: false, effects: [fx('perfect')], bursts: hitBurst(1000, 'perfect', 100, 20, 300, C, false), warm: 1, pulse: 1, sweepY: 100 }));
  expect(f.shapes).toEqual([]);
  expect(f.bursts).toEqual([]);
  expect(f.clip).toEqual({ x: 0, y: 0, w: 600, h: 301 });
  expect(isEmpty(f)).toBe(true);
});

it('draws nothing during a microphone take or a demo', () => {
  const f = lightFrame(input({ quiet: true, effects: [fx('perfect'), fx('good')], bursts: hitBurst(1000, 'perfect', 100, 20, 300, C, false), warm: 1 }));
  expect(f.shapes).toEqual([]);
  expect(f.bursts).toEqual([]);
});

it('makes no light for early, late or played keys', () => {
  for (const tier of ['early', 'late', 'played']) expect(lightFrame(input({ effects: [fx(tier)] })).shapes).toEqual([]);
});

it('a perfect key gets a glow and a ring, a good key only a glow, each gone after its window', () => {
  expect(lightFrame(input({ effects: [fx('perfect')] })).shapes.map(s => s.kind)).toEqual(['glow', 'ring']);
  expect(lightFrame(input({ effects: [fx('good')] })).shapes.map(s => s.kind)).toEqual(['glow']);
  expect(lightFrame(input({ now: 1210, effects: [fx('perfect')] })).shapes.map(s => s.kind)).toEqual(['ring']);
  expect(lightFrame(input({ now: 1280, effects: [fx('perfect')] })).shapes).toEqual([]);
  expect(lightFrame(input({ now: 1200, effects: [fx('good')] })).shapes).toEqual([]);
});

it('centres the glow on the hit line and sizes the ring from the key width', () => {
  const [g, r] = lightFrame(input({ now: 1000, effects: [fx('perfect')] })).shapes;
  expect(g).toMatchObject({ x: 100 - 17, y: 300 - 17, w: 34, h: 34 });
  expect(r.w).toBe(20);
  expect(r.x + r.w / 2).toBe(100);
});

it('shows the warmth band only above a threshold', () => {
  expect(lightFrame(input({ warm: 0.01 })).shapes).toEqual([]);
  const [b] = lightFrame(input({ warm: 0.5 })).shapes;
  expect(b).toMatchObject({ kind: 'band', x: 0, y: 272, w: 600, h: 28 });
  expect(b.a).toBeCloseTo(0.06);
});

it('adds the beat glow and the reveal sweep as lines', () => {
  const f = lightFrame(input({ pulse: 1, sweepY: 120 }));
  expect(f.shapes.map(s => [s.kind, s.y + s.h / 2])).toEqual([['line', 300], ['line', 120]]);
});

it('never exceeds an alpha cap', () => {
  const f = lightFrame(input({ now: 1000, effects: [fx('perfect'), fx('good')], warm: 50, pulse: 50, sweepY: 10 }));
  const cap = { glow: CAP.glow, ring: CAP.ring, band: CAP.band };
  for (const s of f.shapes) {
    if (s.kind === 'line') expect(s.a).toBeLessThanOrEqual(CAP.beat);
    else expect(s.a).toBeLessThanOrEqual(cap[s.kind]);
  }
});

it('limits live particles in a take and in general', () => {
  const many = Array.from({ length: 30 }, (_, i) => sparks(1000 + i, 100));
  const take = lightFrame(input({ inTake: true, bursts: many }));
  expect(sum(take.bursts)).toBeLessThanOrEqual(TAKE_PARTICLES);
  expect(take.bursts.at(-1)).toBe(many.at(-1));
  expect(sum(lightFrame(input({ bursts: many })).bursts)).toBeLessThanOrEqual(MAX_PARTICLES);
  expect(sum(lightFrame(input({ bursts: Array.from({ length: 40 }, (_, i) => sparks(1000 + i, 100)) })).bursts)).toBeLessThanOrEqual(MAX_PARTICLES);
});

it('keeps future bursts and drops ended ones', () => {
  const past = sparks(0, 5), future = sparks(2000, 5);
  const f = lightFrame(input({ now: 5000, bursts: [past, future, sparks(4990, 5)] }));
  expect(f.bursts).toHaveLength(1);
  const g = lightFrame(input({ now: 1050, bursts: [past, future] }));
  expect(g.bursts).toEqual([future]);
  expect(isEmpty(g)).toBe(true);
  const list = [past, future];
  pruneBursts(list, 1050);
  expect(list).toEqual([future]);
  expect(burstEnd(future)).toBe(2000 + future.life[1] * 1000);
});

it('makes the same particle for the same burst and index, inside its ranges', () => {
  const b = revealBurst(0, 200, 40, 300, C), a: Particle = { x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0 }, c = { ...a };
  const seen = new Set<number>();
  for (let i = 0; i < 6; i++) {
    expect(particle(b, i, a)).toEqual(particle(b, i, c));
    expect(Math.abs(a.x - 200)).toBeLessThanOrEqual(20);
    expect(Math.abs(a.vx)).toBeLessThanOrEqual(25);
    expect(a.vy).toBeGreaterThanOrEqual(-160); expect(a.vy).toBeLessThanOrEqual(-40);
    expect(a.life).toBeGreaterThanOrEqual(0.3); expect(a.life).toBeLessThanOrEqual(0.7);
    expect(a.size).toBeGreaterThanOrEqual(0.4); expect(a.size).toBeLessThanOrEqual(1.1);
    expect(a.y).toBe(300);
    seen.add(a.x);
  }
  expect(seen.size).toBeGreaterThan(1);
});

it('fades a particle to nothing at the end of its life', () => {
  const p: Particle = { x: 10, y: 100, vx: 5, vy: -50, life: 1, size: 1 };
  expect(particleAt(p, -0.1)).toBeUndefined();
  expect(particleAt(p, 0)).toEqual({ x: 10, y: 100, a: 1 });
  expect(particleAt(p, 0.5)!.a).toBeCloseTo(0.5);
  expect(particleAt(p, 0.5)!.y).toBeCloseTo(100 - 25 + 90 * 0.125);
  expect(particleAt(p, 1)).toBeUndefined();
});

it('sizes celebrations and times the waves of a big one', () => {
  const cols = [rgb('#5599cc'), rgb('#88aa66'), rgb('#e1c48f')];
  expect(sum(celebration(0, 'small', 600, 300, cols))).toBe(204);
  expect(sum(celebration(0, 'medium', 600, 300, cols))).toBe(296);
  const big = celebration(1000, 'big', 600, 300, cols);
  expect(sum(big)).toBe(708);
  expect([...new Set(big.map(b => b.at))]).toEqual([1000, 1700, 2500]);
  expect(big.every(b => b.x === 300 && b.spread === 600 && b.y === 298)).toBe(true);
});

it('hit bursts: perfect adds embers, good only sparks', () => {
  const p = hitBurst(0, 'perfect', 100, 20, 300, C, false), g = hitBurst(0, 'good', 100, 20, 300, C, true);
  expect(p.map(b => [b.count, b.soft])).toEqual([[14, false], [3, true]]);
  expect(g.map(b => [b.count, b.soft])).toEqual([[6, false]]);
  expect(g[0].size[1]).toBe(1);
  expect(new Set([...p, ...g].map(b => b.id)).size).toBe(3);
});
