/** Reward light on the lane as a pure per-frame list of shapes and particle bursts; a WebGL layer or a 2D fallback draws it. */
export type Rgb = readonly [number, number, number];
/** A '#rrggbb' colour as 0..1 channels. */
export const rgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
/** Blend a colour toward white by t (0..1). */
export const toWhite = (c: Rgb, t: number): Rgb => [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t];

/** CSS px, y down. */
export interface Rect { x: number; y: number; w: number; h: number }
/**
 * One soft shape filling a rect. glow: round disc, 1 at the centre, .45 at .45 of the radius, 0 at the edge. ring: the upper half of a
 * 2 px soft ring of radius w/2. band: alpha rising linearly from 0 at the top to a at the bottom. line: horizontal line through the
 * vertical centre, a at the centre fading to 0 at h/2 above and below.
 */
export interface Shape { kind: 'glow' | 'ring' | 'band' | 'line'; x: number; y: number; w: number; h: number; colour: Rgb; a: number }

/**
 * A burst of particles born at `at` (performance.now ms, possibly in the future). Spawn x spreads over `spread` centred on x;
 * vx is a half range (px/s), vy/life/size are [min, max] (px/s with negative up, s, half-size px). soft: a large ember, else a small spark.
 */
export interface Burst { id: number; at: number; x: number; y: number; spread: number; count: number; vx: number; vy: readonly [number, number]; life: readonly [number, number]; size: readonly [number, number]; colour: Rgb; soft: boolean }
export interface Particle { x: number; y: number; vx: number; vy: number; life: number; size: number }
/** Downward acceleration of every particle, px/s². */
export const GRAVITY = 90;
/** Live particles allowed during a timed take or Wait for me. */
export const TAKE_PARTICLES = 150;
/** Capacity of the GPU ring: the most particles live at any time. */
export const MAX_PARTICLES = 1536;
export const CAP = { glow: 0.9, ring: 0.6, band: 0.12, beat: 0.3, sweep: 0.18 } as const;

let ids = 0;
/** The next burst id. */
export const nextId = (): number => ++ids;

/** A uniform value in [0, 1) from an integer, a small murmur-style hash. */
function hash(n: number): number {
  let h = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const u = (b: Burst, i: number, salt: number) => hash(Math.imul(b.id * 7919 + i, 0x9e3779b1) + Math.imul(salt, 0x632be5ab));
const lerp = (r: readonly [number, number], t: number) => r[0] + (r[1] - r[0]) * t;

/** Particle i of a burst, the same every time for the same (id, i). Writes into out. */
export function particle(b: Burst, i: number, out: Particle): Particle {
  out.x = b.x + (u(b, i, 1) - 0.5) * b.spread;
  out.y = b.y;
  out.vx = (u(b, i, 2) - 0.5) * 2 * b.vx;
  out.vy = lerp(b.vy, u(b, i, 3));
  out.life = lerp(b.life, u(b, i, 4));
  out.size = lerp(b.size, u(b, i, 5));
  return out;
}
/** A particle t seconds after birth, or undefined before birth or after its life. */
export function particleAt(p: Particle, t: number): { x: number; y: number; a: number } | undefined {
  if (t < 0 || t >= p.life) return undefined;
  return { x: p.x + p.vx * t, y: p.y + p.vy * t + GRAVITY * t * t / 2, a: 1 - t / p.life };
}
/** When the last particle of a burst is gone (performance.now ms). */
export const burstEnd = (b: Burst): number => b.at + b.life[1] * 1000;

const burst = (now: number, x: number, y: number, spread: number, count: number, vx: number, vy: readonly [number, number], life: readonly [number, number], size: readonly [number, number], colour: Rgb, soft: boolean): Burst =>
  ({ id: nextId(), at: now, x, y, spread, count, vx, vy, life, size, colour, soft });

/** Sparks off a judged key (and, for a perfect one, a few embers). small: a narrower key, smaller sparks. */
export function hitBurst(now: number, tier: 'perfect' | 'good', cx: number, width: number, y: number, colour: Rgb, small: boolean): Burst[] {
  const out = [burst(now, cx, y, width * 0.8, tier === 'perfect' ? 14 : 6, 30, [-240, -50], [0.35, 0.85], [0.4, small ? 1 : 1.3], toWhite(colour, 0.35), false)];
  if (tier === 'perfect') out.push(burst(now, cx, y, width * 0.8, 3, 12, [-90, -40], [0.5, 0.9], [3, 5], toWhite(colour, 0.5), true));
  return out;
}
/** Sparks as a revealed note's verdict lands. */
export const revealBurst = (now: number, x: number, width: number, y: number, colour: Rgb): Burst =>
  burst(now, x, y, width, 6, 25, [-160, -40], [0.3, 0.7], [0.4, 1.1], toWhite(colour, 0.35), false);

/** Waves of sparks and embers across the whole keyboard width, one spark burst per colour in each wave. */
export function celebration(now: number, size: 'small' | 'medium' | 'big', w: number, hitY: number, colours: Rgb[]): Burst[] {
  const waves: [number, number, number][] = size === 'small' ? [[0, 180, 24]] : size === 'medium' ? [[0, 260, 36]] : [[0, 260, 36], [700, 200, 28], [1500, 160, 24]];
  const out: Burst[] = [], y = hitY - 2, k = colours.length;
  for (const [dt, sparks, embers] of waves) {
    colours.forEach((c, i) => out.push(burst(now + dt, w / 2, y, w, Math.floor(sparks / k) + (i < sparks % k ? 1 : 0), 70, [-380, -120], [0.8, 1.7], [0.5, 1.6], toWhite(c, 0.3), false)));
    out.push(burst(now + dt, w / 2, y, w, embers, 40, [-200, -60], [1.2, 2], [3, 6], toWhite(colours[0], 0.5), true));
  }
  return out;
}

export interface LightInput {
  now: number;
  /** Lively look and no reduced motion. */
  lively: boolean;
  /** A microphone take or a demo is playing. */
  quiet: boolean;
  inTake: boolean;
  w: number;
  hitY: number;
  effects: readonly { cx: number; width: number; tier: string; colour: Rgb; at: number }[];
  bursts: readonly Burst[];
  /** 0..1 */
  warm: number;
  /** Height of the warmth band above the hit line, px. */
  haze: number;
  /** 0..1 beat glow on the hit line. */
  pulse: number;
  sweepY?: number;
}
/** What to draw this frame. clip: the light stays inside; keepOut: rects it must not cover (text), appended by the caller. */
export interface LightFrame { now: number; shapes: Shape[]; bursts: Burst[]; clip: Rect; keepOut: Rect[] }

const ease = (t: number) => 1 - (1 - t) * (1 - t);
const WARM = rgb('#e1c48f'), BEAT = rgb('#e8f0dc'), SWEEP = rgb('#d8e4c5');

const whites = new WeakMap<Rgb, [Rgb, Rgb]>();
/** The glow (toward white .8) and ring (.5) tints of a colour, made once per colour. */
const tints = (c: Rgb) => { let t = whites.get(c); if (!t) { t = [toWhite(c, 0.8), toWhite(c, 0.5)]; whites.set(c, t); } return t; };
/** An empty frame to fill; pass the same one every frame to draw without allocating. */
export const newFrame = (): LightFrame => ({ now: 0, shapes: [], bursts: [], clip: { x: 0, y: 0, w: 0, h: 0 }, keepOut: [] });
const pool: Shape[] = [];

/**
 * The light for one frame: flashes and rings from judged keys, the warmth band, the beat glow, the reveal sweep and
 * live bursts (the newest that fit the particle limit). Fills out (a fresh frame by default), reusing its shapes.
 */
export function lightFrame(s: LightInput, out?: LightFrame): LightFrame {
  const f = out ?? newFrame(), reuse = out !== undefined;
  f.now = s.now; f.clip.x = 0; f.clip.y = 0; f.clip.w = s.w; f.clip.h = s.hitY + 1;
  f.shapes.length = 0; f.bursts.length = 0; f.keepOut.length = 0;
  if (!s.lively || s.quiet) return f;
  const add = (kind: Shape['kind'], cx: number, cy: number, w: number, h: number, colour: Rgb, a: number, cap: number) => {
    const n = f.shapes.length, sh = reuse ? pool[n] ?? (pool[n] = { kind, x: 0, y: 0, w: 0, h: 0, colour, a: 0 }) : { kind, x: 0, y: 0, w: 0, h: 0, colour, a: 0 };
    sh.kind = kind; sh.x = cx - w / 2; sh.y = cy - h / 2; sh.w = w; sh.h = h; sh.colour = colour; sh.a = Math.max(0, Math.min(cap, a));
    f.shapes.push(sh);
  };
  for (const e of s.effects) {
    if (e.tier !== 'perfect' && e.tier !== 'good') continue;
    const age = s.now - e.at, [glow, ring] = tints(e.colour);
    if (age < 200) add('glow', e.cx, s.hitY, e.width + 14, e.width + 14, glow, (e.tier === 'perfect' ? 0.9 : 0.55) * (1 - ease(age / 200)), CAP.glow);
    if (e.tier === 'perfect' && age < 280) { const d = 2 * e.width * (0.5 + 0.3 * ease(age / 280)); add('ring', e.cx, s.hitY, d, d, ring, 0.6 * (1 - age / 280), CAP.ring); }
  }
  if (s.warm > 0.01) add('band', s.w / 2, s.hitY - s.haze / 2, s.w, s.haze, WARM, 0.12 * s.warm, CAP.band);
  if (s.pulse > 0) add('line', s.w / 2, s.hitY, s.w, 8, BEAT, 0.3 * s.pulse, CAP.beat);
  if (s.sweepY !== undefined) add('line', s.w / 2, s.sweepY, s.w, 12, SWEEP, 0.18, CAP.sweep);
  // The newest live bursts whose counts fit the limit, kept in their order.
  const cap = s.inTake ? TAKE_PARTICLES : MAX_PARTICLES;
  let sum = 0, from = s.bursts.length;
  for (let i = s.bursts.length - 1; i >= 0; i--) {
    const b = s.bursts[i];
    if (s.now >= burstEnd(b)) continue;
    if (sum + b.count > cap) break;
    sum += b.count; from = i;
  }
  for (let i = from; i < s.bursts.length; i++) if (s.now < burstEnd(s.bursts[i])) f.bursts.push(s.bursts[i]);
  return f;
}

/** Whether nothing is lit: no shapes and no burst already born. */
export const isEmpty = (f: LightFrame): boolean => f.shapes.length === 0 && !f.bursts.some(b => f.now >= b.at);
/** Remove ended bursts in place. */
export function pruneBursts(list: Burst[], now: number): void {
  let n = 0;
  for (const b of list) if (now < burstEnd(b)) list[n++] = b;
  list.length = n;
}
