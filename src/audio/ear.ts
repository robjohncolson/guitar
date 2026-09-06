import { Crepe } from './crepe';
import type { Pitch } from './crepe';
import { yin } from './yin';
import { OnsetDetector } from './onset';
import type { CaptureMessage } from './worklet-grabber';
import type { CaptureFrame } from './frame-buffer';
import type { NoteOn, NoteEnd } from '../music/notes';

export class Ear {
  readonly onsets: OnsetDetector;
  private crepe = new Crepe();
  private fallback = false;
  private ready = false;
  private busy = false;
  private queued?: CaptureFrame;
  private attackFrames: CaptureFrame[] = [];
  private attackAt = -Infinity;
  private snapshots = 0;
  private latestFrameAt = -Infinity;
  private rawAttacks: number[] = [];
  private generation = 0;
  constructor(readonly status: (text: string) => void, readonly pitch: (pitch: Pitch) => void,
    readonly note: (note: NoteOn) => void, readonly attack: (t: number) => void = () => {},
    readonly ended: (note: NoteEnd) => void = () => {},
    readonly observed: (t:number,rms:number,pitch:Pitch) => void = () => {}) { this.onsets = new OnsetDetector(ended); }
  async load(): Promise<void> {
    this.status('CREPE loading');
    try { await this.crepe.load(); this.status('CREPE ready (tiny)'); }
    catch (error) { this.crepe.dispose(); this.fallback = true; this.status('FALLBACK: YIN'); console.error('CREPE loading failed:', error); }
    this.ready = true;
  }
  receive(message: CaptureMessage): void {
    if (!this.ready) return;
    if (message.type === 'attack') {
      this.rawAttacks.push(message.t); this.rawAttacks = this.rawAttacks.filter(t => message.t-t <= 1);
      this.attack(message.t);
      this.attackAt = message.t; this.snapshots = 0;
      return;
    }
    this.onsets.observeLevel(message.t,message.rms);
    this.latestFrameAt = message.t;
    // Preserve two attack snapshots; latest-only inference can skip an entire short pluck.
    if (this.snapshots < 2 && message.t >= this.attackAt+0.04+this.snapshots*0.04-1e-6 && message.t <= this.attackAt+0.14) {
      this.attackFrames.push(message); this.attackFrames = this.attackFrames.slice(-4); this.snapshots++;
    }
    // Bound the queue. A slow GPU must not accumulate seconds of stale pitch frames.
    this.queued = message;
    if (!this.busy) void this.drain();
  }
  resetCapture(now?: number): void {
    this.generation++; this.queued = undefined; this.attackFrames = []; this.attackAt = -Infinity;
    this.snapshots = 0; this.latestFrameAt = -Infinity; this.rawAttacks = []; this.onsets.reset(now);
  }
  private async drain(): Promise<void> {
    this.busy = true;
    try {
      while (this.queued || this.attackFrames.length) {
        this.attackFrames = this.attackFrames.filter(frame => this.latestFrameAt-frame.t <= 0.5);
        const frame = this.attackFrames.shift() ?? this.queued;
        if (!frame) break;
        if (this.queued && this.queued.t <= frame.t) this.queued = undefined;
        const generation = this.generation;
        const pitch = frame.rms < 0.001 ? { hz: 0, confidence: 0 } : this.fallback ? yin(frame.samples) : await this.crepe.infer(frame.samples);
        if (generation !== this.generation) continue;
        this.pitch(pitch);
        this.observed(frame.t,frame.rms,pitch);
        // A later live attack must not replace the pluck whose inference is still completing.
        for (const t of this.rawAttacks.filter(t => t <= frame.t)) this.onsets.attack(t);
        this.rawAttacks = this.rawAttacks.filter(t => t > frame.t);
        const note = this.onsets.process(frame.t, pitch, frame.rms);
        if (note) this.note(note);
      }
    } catch (error) { this.ready = false; this.status(`CREPE error: ${String(error)}`); }
    finally { this.busy = false; }
  }
}
