/** A take percentage as printed: rounded down, so "90%" on screen always means 90.0% or better. */
export const floorPct = (x: number) => Math.floor(x * 100 + 1e-9);
