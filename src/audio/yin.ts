import type { Pitch } from './crepe';
// Emergency fallback only. Ear selects this exclusively after CREPE loading fails.
export function yin(frame: Float32Array, rate = 16000): Pitch {
  const max = Math.floor(rate / 70), min = Math.floor(rate / 1400);
  const difference = new Float32Array(max + 1);
  let total = 0;
  for (let tau = 1; tau <= max; tau++) {
    let sum = 0;
    for (let i = 0; i < frame.length - max; i++) sum += (frame[i] - frame[i + tau]) ** 2;
    total += sum; difference[tau] = total > 0 ? sum * tau / total : 1;
  }
  for (let tau = min; tau < max - 1; tau++) {
    if (difference[tau] >= 0.15) continue;
    while (tau < max - 1 && difference[tau + 1] < difference[tau]) tau++;
    const a = difference[tau - 1], b = difference[tau], c = difference[tau + 1];
    const denominator = 2 * (2 * b - a - c);
    const offset = denominator ? (c - a) / denominator : 0;
    return { hz: rate / (tau + offset), confidence: 1 - b };
  }
  return { hz: 0, confidence: 0 };
}
