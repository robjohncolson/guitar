import type { Exercise, XEvent } from './exercise';

/** A note's identity on the lane: its start beat and pitch. */
export const noteKey = (beat: number, midi: number) => `${beat}:${midi}`;

/**
 * "Wait for me": the lane scrolls at the chosen tempo but stops at each attack until its keys are pressed.
 * No timing is judged, only the right keys, so it suits learning a passage before playing it in time.
 */
export class WaitRun {
  readonly events: XEvent[];
  index = 0; beat: number; mistakes = 0; seconds = 0;
  /** Notes pressed so far, for the lane; keys of the current attack pressed so far. */
  readonly hits = new Set<string>();
  private pressed = new Set<number>();
  constructor(readonly ex: Exercise, readonly bpm: number) {
    this.events = ex.events.filter(e => e.grade !== 'none');
    // Two beats of lead-in so the first notes can be seen coming; playing them sooner starts at once.
    this.beat = (this.events[0]?.beat ?? 0) - 2;
  }
  get current(): XEvent | undefined { return this.events[this.index]; }
  get done(): boolean { return !this.current && this.beat >= this.ex.beats; }
  /** True while the lane is stopped at an attack that has not been played yet. */
  get waiting(): boolean { const e = this.current; return Boolean(e && this.beat >= e.beat - 1e-6); }
  /** Keys still needed for the current attack. */
  get needed(): number[] { const e = this.current; return e ? e.notes.map(n => n.midi).filter(m => !this.pressed.has(m)) : []; }
  /**
   * Move the lane on by dt seconds at tempo, never past the next unplayed attack. When the player is ahead of the
   * lane (attacks already played), it catches up quickly instead of making them wait for their own notes.
   */
  step(dt: number): void {
    if (this.done) return;
    this.seconds += dt;
    const target = this.current?.beat ?? this.ex.beats, played = this.index > 0 ? this.events[this.index - 1].beat : -Infinity;
    const speed = this.bpm / 60 * (played > this.beat ? 1 + 4 * (played - this.beat) : 1);
    this.beat = Math.min(target, this.beat + dt * speed);
  }
  /**
   * A key went down. A key of the next attack is always a hit, however early, so the player may lead. Any other key
   * is wrong within a beat of that attack; further away it is ignored, so finding the hand position costs nothing.
   */
  press(midi: number): 'hit' | 'wrong' | 'ignored' {
    const e = this.current;
    if (!e) return 'ignored';
    if (!e.notes.some(n => n.midi === midi)) { if (e.beat - this.beat > 1) return 'ignored'; this.mistakes++; return 'wrong'; }
    this.pressed.add(midi); this.hits.add(noteKey(e.beat, midi));
    if (e.notes.every(n => this.pressed.has(n.midi))) { this.index++; this.pressed.clear(); }
    return 'hit';
  }
  /** Notes played right the first time out of all notes, for the summary. */
  summary(): { notes: number; mistakes: number; seconds: number } {
    return { notes: this.events.reduce((n, e) => n + e.notes.length, 0), mistakes: this.mistakes, seconds: this.seconds };
  }
}
