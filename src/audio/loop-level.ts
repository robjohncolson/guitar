/** Reserve headroom for the metronome (peak 0.126) even at full loop volume. */
export const LOOP_PEAK = 0.8;
const MAX_BOOST = 16; // +24 dB; never chase the noise floor with unlimited gain.
const MIN_PEAK = 0.005;

/** One fixed gain for the whole take: preserve attacks, rests, and dynamics. */
export function loopLevelGain(peak:number):number {
  if (!Number.isFinite(peak) || peak < MIN_PEAK) return 1;
  return Math.min(MAX_BOOST,LOOP_PEAK/peak);
}
