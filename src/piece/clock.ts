/**
 * One clock for the lane and for key-press stamps, on the timeline the app already uses: AudioContext.currentTime,
 * against which plan times are "heard" times. currentTime only moves in audio-callback steps (often 10 ms or more),
 * so between steps it is read through getOutputTimestamp() and performance.now(). The output timestamp sits behind
 * currentTime by about the output latency; that gap (lag) is measured, smoothed and added back, so latency is never
 * applied twice. If the API is missing, reports zeros, or disagrees with currentTime by more than 30 ms, the raw
 * currentTime is used instead.
 */
export interface OutputStamp { contextTime?: number; performanceTime?: number }
export interface ClockReading { time: number; lag: number | undefined; smooth: boolean }
export const CLOCK_LIMIT = 0.03;

/** Pure: where the audio clock is at perfMs (performance.now() milliseconds), given the last lag estimate. */
export function readClock(currentTime: number, stamp: OutputStamp | undefined, perfNow: number, lag: number | undefined, perfMs = perfNow): ClockReading {
  const raw = currentTime - (perfNow - perfMs) / 1000;
  if (!stamp || !stamp.contextTime || !stamp.performanceTime || !Number.isFinite(stamp.contextTime) || !Number.isFinite(stamp.performanceTime)) return { time: raw, lag: undefined, smooth: false };
  const played = stamp.contextTime + (perfNow - stamp.performanceTime) / 1000, gap = currentTime - played;
  if (Math.abs(gap) > 0.5) return { time: raw, lag: undefined, smooth: false };
  // currentTime runs ahead in steps, so the gap is a sawtooth; its running mean puts the smooth clock mid-step.
  const next = lag === undefined || Math.abs(gap - lag) > CLOCK_LIMIT ? gap : lag + (gap - lag) * 0.05;
  const time = played + next - (perfNow - perfMs) / 1000;
  return Math.abs(time - raw) > CLOCK_LIMIT ? { time: raw, lag: next, smooth: false } : { time, lag: next, smooth: true };
}

export class AudioClock {
  private lag: number | undefined;
  /** The audio-clock time now, or at an earlier performance.now() stamp such as a key event's timeStamp. */
  at(context: AudioContext | undefined, perfMs?: number): number {
    if (!context) return 0;
    const now = performance.now();
    let stamp: OutputStamp | undefined;
    try { stamp = context.getOutputTimestamp?.(); } catch { stamp = undefined; }
    const reading = readClock(context.currentTime, stamp, now, this.lag, Math.min(now, perfMs ?? now));
    this.lag = reading.lag;
    return reading.time;
  }
}
