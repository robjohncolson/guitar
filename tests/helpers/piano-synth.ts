/** Test-only piano-like tones: stretched partials, faster decay up high, a hammer transient and a weak low fundamental. */
export interface Strike { midi: number; at: number; dur?: number; amp?: number; cents?: number }
export function render(rate: number, seconds: number, strikes: Strike[], noise = 0, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  let s = seed;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296 - 0.5; };
  for (const { midi, at, dur = 3, amp = 0.15, cents = 0 } of strikes) {
    const f0 = 440 * 2 ** ((midi - 69) / 12) * 2 ** (cents / 1200), stiffness = 10 ** (-4.8 + 0.035 * (midi - 21));
    const start = Math.round(at * rate), end = Math.min(out.length, start + Math.round((dur + 0.08) * rate));
    for (let k = 1; k <= 18; k++) {
      const f = k * f0 * Math.sqrt(1 + stiffness * k * k);
      if (f > Math.min(rate / 2 - 200, 7000)) break;
      const a = amp / k ** 0.85 * (k === 1 && midi < 50 ? 0.25 : 1), decay = 0.6 + 0.3 * k + Math.max(0, midi - 40) * 0.02, phase = random() * 6;
      for (let i = start; i < end; i++) {
        const t = (i - start) / rate, release = t > dur ? Math.max(0, 1 - (t - dur) / 0.08) : 1;
        out[i] += a * Math.sin(2 * Math.PI * f * t + phase) * Math.exp(-decay * t) * Math.min(1, t / 0.002) * release;
      }
    }
    for (let i = start; i < Math.min(out.length, start + Math.round(0.012 * rate)); i++) out[i] += amp * 0.4 * random() * Math.exp(-(i - start) / (0.003 * rate));
  }
  if (noise) for (let i = 0; i < out.length; i++) out[i] += noise * random();
  return out;
}
/** The app's metronome pip, as it might leak from speakers. */
export function addClicks(samples: Float32Array, rate: number, times: number[], amp = 0.05): void {
  for (const t of times) for (let i = 0; i < 0.012 * rate; i++) {
    const at = Math.round(t * rate) + i, x = i / rate;
    if (at < samples.length) samples[at] += amp * Math.sin(2 * Math.PI * 1000 * x) * Math.min(1, x / 0.001) * Math.exp(-x / 0.0025);
  }
}
