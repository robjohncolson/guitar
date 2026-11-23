import { AttackDetector } from '../audio/attack';
import type { Pitch } from '../audio/crepe';
import type { Attack } from './grader';
/** Resample a stored native-rate window to CREPE's exact 1024 samples at 16 kHz. */
export function pitchFrame(samples: Float32Array, rate: number, center: number): Float32Array {
  return Float32Array.from({ length: 1024 }, (_, i) => {
    const index = (center - 0.032 + i / 16000) * rate,
      from = Math.floor(index),
      fraction = index - from;
    return (samples[from] ?? 0) * (1 - fraction) + (samples[from + 1] ?? 0) * fraction;
  });
}
const rms = (samples: Float32Array, rate: number, from: number, length = 0.01) => {
  const a = Math.max(0, Math.floor(from * rate)),
    b = Math.min(samples.length, Math.ceil((from + length) * rate));
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, b - a));
};
/** A room tail can outlast a click. Muted strums are broadband; the app's pips are tonal. */
function clickLike(samples: Float32Array, rate: number, t: number): boolean {
  const size = Math.round(rate * 0.02),
    from = Math.round((t + 0.012) * rate);
  for (const hz of [1000, 1300]) {
    let sin = 0,
      cos = 0,
      energy = 0;
    for (let i = 0; i < size; i++) {
      const v = samples[from + i] ?? 0;
      sin += v * Math.sin((2 * Math.PI * hz * i) / rate);
      cos += v * Math.cos((2 * Math.PI * hz * i) / rate);
      energy += v * v;
    }
    if ((2 * (sin * sin + cos * cos)) / (size * energy + 1e-12) > 0.6) return true;
  }
  return false;
}
/** Moments after an attack at which pitch may be read, in reading order. */
const READ_AFTER = [0.08, 0.14, 0.2, 0.26];
/**
 * Reads many stored frames at once, results in the order given (see Crepe.inferMany). It may report how many frames it
 * has read so far while it works.
 */
export type PitchBatch = (frames: Float32Array[], progress?: (read: number) => void) => Promise<Pitch[]>;
interface Pluck {
  index: number;
  t: number;
  level: number;
  end: number;
  /** The moments this pluck may read, in order; reading stops early once two usable readings agree. */
  reads: number[];
  readings: Pitch[];
  next: number;
  done: boolean;
}
/** Take one reading in order: keep it if usable, and stop once the latest usable reading agrees with the first. */
function take(pluck: Pluck, pitch: Pitch): void {
  const readings = pluck.readings;
  pluck.next++;
  if (pitch.hz >= 70 && pitch.hz <= 1400 && pitch.confidence >= 0.5) readings.push(pitch);
  if (readings.length >= 2 && Math.abs(12 * Math.log2(readings.at(-1)!.hz / readings[0].hz)) < 0.5) pluck.done = true;
  if (pluck.next >= pluck.reads.length) pluck.done = true;
}
/**
 * No score/expected pitches enter this analysis. Slow hardware gets the same stored evidence.
 * With inferMany, the plucks read in rounds: each round batches, for every pluck still reading, the next readings it
 * is certain to take (two while it has no usable reading, since one reading can never stop it; otherwise one). Each
 * pluck therefore takes exactly the readings, in the same order and with the same early stop, as with infer alone,
 * and no frame is read that infer alone would not have read.
 */
export async function analyzeTake(
  samples: Float32Array,
  rate: number,
  relativeStart: number,
  duration: number,
  infer: (frame: Float32Array) => Promise<Pitch>,
  alive: () => boolean = () => true,
  update: (done: number, total: number) => void = () => {},
  rhythmOnly = false,
  inferMany?: PitchBatch,
): Promise<Attack[]> {
  const detector = new AttackDetector(rate),
    raw: number[] = [];
  for (let from = 0; from < samples.length; from += 128) {
    const t = from / rate;
    if (
      detector.process(samples.subarray(from, from + 128), t) &&
      t >= relativeStart - 0.3 &&
      t <= relativeStart + duration + 0.3
    )
      raw.push(t);
  }
  // Limit work on an extremely noisy take. The caller treats this as unscorable.
  if (raw.length > 96)
    throw new Error('Too many attacks to judge. Try a quieter recording with clear, separate plucks.');
  // Segment every pluck first (no pitch is involved): which attacks count, where each ends, which moments it may read.
  const plucks: Pluck[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i],
      level = rms(samples, rate, t, 0.1);
    // Require energy after the metronome's short tail, even in rhythm-only mode.
    if (rms(samples, rate, t + 0.035, 0.035) < 0.003) continue;
    if (rhythmOnly && clickLike(samples, rate, t)) continue;
    let quiet: number | undefined,
      end = Math.min(raw[i + 1] ?? Infinity, relativeStart + duration + 0.5),
      peak = level;
    for (let at = t; at < end; at += 0.01) {
      const value = rms(samples, rate, at);
      peak = Math.max(peak, value);
      if (value < Math.max(0.0015, peak * 0.04)) {
        quiet ??= at;
        if (at - quiet >= 0.08 - 1e-6) {
          end = quiet;
          break;
        }
      } else quiet = undefined;
    }
    const reads: number[] = [];
    if (!rhythmOnly)
      for (const after of READ_AFTER) {
        if (t + after + 0.032 > end + 0.02) break;
        reads.push(after);
      }
    plucks.push({ index: i, t, level, end, reads, readings: [], next: 0, done: reads.length === 0 });
  }
  const frame = (pluck: Pluck, k: number) => pitchFrame(samples, rate, pluck.t + pluck.reads[k]);
  // "Checking note X of Y" as last shown; it never goes back.
  let checked = 0;
  const show = (done: number) => update((checked = Math.max(checked, done)), raw.length);
  if (inferMany)
    for (;;) {
      const wanted: Pluck[] = [],
        frames: Float32Array[] = [];
      for (const pluck of plucks) {
        if (pluck.done) continue;
        const count = Math.min(pluck.reads.length - pluck.next, pluck.readings.length ? 1 : 2);
        for (let k = 0; k < count; k++) {
          wanted.push(pluck);
          frames.push(frame(pluck, pluck.next + k));
        }
      }
      if (!frames.length) break;
      if (!alive()) return [];
      // While the model works, the note whose frames were read last is the one being checked.
      const pitches = await inferMany(frames, (read) => {
        if (alive() && read > 0 && read <= wanted.length) show(wanted[read - 1].index + 1);
      });
      if (!alive()) return [];
      if (pitches.length !== frames.length) throw new Error('The pitch model returned the wrong number of readings.');
      wanted.forEach((pluck, i) => {
        if (!pluck.done) take(pluck, pitches[i]);
      });
      // Every attack whose pitch is settled (or that needs none) is checked.
      show(raw.length - plucks.filter((pluck) => !pluck.done).length);
    }
  const attacks: Attack[] = [];
  for (const pluck of plucks) {
    if (!alive()) return [];
    while (!pluck.done) {
      take(pluck, await infer(frame(pluck, pluck.next)));
      if (!alive()) return [];
    }
    const { readings, t, end, level } = pluck;
    const clusters = readings
        .map((p) => readings.filter((q) => Math.abs(12 * Math.log2(q.hz / p.hz)) < 0.5))
        .sort((a, b) => b.length - a.length),
      cluster = clusters[0] ?? [];
    const certain = cluster.length >= 2 && cluster.length >= readings.length * 0.65;
    const midi = certain
      ? cluster.reduce((sum, p) => sum + 69 + 12 * Math.log2(p.hz / 440), 0) / cluster.length
      : undefined;
    attacks.push({
      t: t - relativeStart,
      midi,
      confidence: certain ? Math.min(...cluster.map((p) => p.confidence)) : undefined,
      duration: Math.max(0, end - t),
      level,
    });
    show(pluck.index + 1);
  }
  return attacks;
}
