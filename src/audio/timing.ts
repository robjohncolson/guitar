export function fireTime(targetTime: number, now: number, delay: number): number | null {
  const fireAt = targetTime - delay;
  if (now - fireAt > 0.015) return null;
  return Math.max(now, fireAt);
}
